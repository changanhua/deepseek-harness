import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { SubprocessRuntime, type SubprocessHandle, type SubprocessOutcome, type SubprocessSpawnSpec, type SubprocessTerminalHandle, type SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ImageGeneration from '../../image-generation/src/index.ts'
import * as arkcliProvider from '../src/index.ts'

const MODEL = 'doubao-seedream-5-0-260128'
const PROFILE = { name: 'agent-images', type: 'agent-plan' }
const PARAMS = [
  { name: 'size', type: 'string', support: true },
  { name: 'output_format', type: 'enum', support: true, enum: ['png'] },
  { name: 'watermark', type: 'boolean', support: true, enum: [false] },
]

function reader(text: string) {
  return { readFrom: (_offset: number) => ({ text, nextOffset: Buffer.byteLength(text), lossy: false }) }
}

class LoaderSubprocess extends SubprocessRuntime {
  readonly executionWorld = 'local' as const
  static instance: LoaderSubprocess | undefined
  readonly specs: SubprocessSpawnSpec[] = []
  readonly counts = { profile: 0, resources: 0, models: 0, generation: 0 }
  private image: Promise<Buffer> = sharp({
    create: { width: 1920, height: 1920, channels: 3, background: '#245678' },
  }).png().toBuffer()

  constructor(ctx: Context) {
    super(ctx)
    LoaderSubprocess.instance = this
  }

  override resolveExecutable(command: string): Promise<string> { return Promise.resolve(command) }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.specs.push(spec)
    const args = spec.argv.slice(1)
    let stdout: unknown
    let sideEffect: Promise<void> = Promise.resolve()
    if (args[0] === 'profile') {
      this.counts.profile += 1
      stdout = PROFILE
    } else if (args[0] === 'resources') {
      this.counts.resources += 1
      stdout = {
        profile: PROFILE.name,
        type: PROFILE.type,
        modality: 'image',
        current_default: MODEL,
        item_count: 1,
        items: [{ id: MODEL, invocable: true, is_default: true }],
      }
    } else if (args[0] === 'models') {
      this.counts.models += 1
      stdout = PARAMS
    } else if (args[0] === '+gen') {
      this.counts.generation += 1
      stdout = { kind: 'image', status: 'succeeded', output_url: 'https://never-return.example/signed' }
      const saveDir = args[args.indexOf('--save-to') + 1]
      if (saveDir === undefined) throw new Error('generation omitted --save-to')
      sideEffect = this.image.then(async (bytes) => {
        await writeFile(join(saveDir, `image-${this.counts.generation}.png`), bytes)
      })
    } else {
      throw new Error(`unexpected ArkCLI argv: ${spec.argv.join(' ')}`)
    }
    const done = sideEffect.then((): SubprocessOutcome => ({ exitCode: 0, signal: null }))
    return {
      pid: 100 + this.specs.length,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: { stdout: reader(JSON.stringify(stdout)), stderr: reader('') },
      done,
      terminate: vi.fn(),
      waitForExit: vi.fn(async () => true),
    }
  }

  override spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    throw new Error('unused')
  }
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  LoaderSubprocess.instance = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('ArkCLI image provider real Loader composition', () => {
  it('resolves one model once and generates ten images', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-image-arkcli-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-image-generation'",
      "- name: '@test/subprocess'",
      "- name: '@deepseek-ai/dsh-image-generation-arkcli'",
      '  config:',
      '    minImagePixels: 3686400',
      '    maxImagePixels: 16777216',
      '    minAspectRatio: 0.0625',
      '    maxAspectRatio: 16',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-image-generation', ImageGeneration],
      ['@test/subprocess', LoaderSubprocess],
      ['@deepseek-ai/dsh-image-generation-arkcli', arkcliProvider],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    const spec = await context.imageGeneration.resolve({
      provider: 'arkcli', model: MODEL, size: '1920x1920', outputFormat: 'png', watermark: false,
    }, {})
    const results = []
    for (let index = 0; index < 10; index += 1) {
      results.push(await context.imageGeneration.generate({ prompt: `image ${index}`, spec }, {}))
    }

    const subprocess = LoaderSubprocess.instance
    expect(subprocess?.counts).toEqual({ profile: 1, resources: 1, models: 1, generation: 10 })
    expect(results).toHaveLength(10)
    expect(results.every(result => result.images[0]?.width === 1920 && result.images[0].height === 1920)).toBe(true)
    const generationSpecs = subprocess?.specs.filter(item => item.argv.includes('+gen')) ?? []
    expect(generationSpecs).toHaveLength(10)
  })
})
