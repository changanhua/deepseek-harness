import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import ImageGeneration, { ImageGenerationError, type ImageGenerationRequest } from '../../image-generation/src/index.ts'
import { SubprocessRuntime, type SubprocessHandle, type SubprocessOutcome, type SubprocessSpawnSpec, type SubprocessTerminalHandle, type SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkcliImageGenerationError, type Config } from '../src/index.ts'
import * as arkcliProvider from '../src/index.ts'

const DEFAULT_CONFIG: Config = {
  executable: 'arkcli',
  stdoutMaxBytes: 64 * 1024,
  stderrMaxBytes: 16 * 1024,
  graceMs: 1_000,
  quiescenceTimeoutMs: 2_000,
  maxImageBytes: 8 * 1024 * 1024,
  maxImagePixels: 16_000_000,
  minImagePixels: 1,
  minAspectRatio: 1 / 16,
  maxAspectRatio: 16,
}

const MODEL = 'doubao-seedream-5-0-260128'
const REQUEST: ImageGenerationRequest = {
  model: MODEL,
  size: '64x32',
  outputFormat: 'png',
  watermark: false,
}

const PROFILE = { name: 'agent-images', type: 'agent-plan' }
const RESOURCES = {
  profile: PROFILE.name,
  type: PROFILE.type,
  modality: 'image',
  current_default: MODEL,
  item_count: 1,
  items: [{ id: MODEL, resource_kind: 'plan-model', data_plane: 'plan', credential_kind: 'plan', invocable: true, is_default: true }],
}
const PARAMS = [
  { name: 'size', type: 'string', support: true, enum: ['64x32', '128x64'] },
  { name: 'output_format', type: 'enum', support: true, enum: ['png', 'jpeg'] },
  { name: 'watermark', type: 'boolean', support: true, enum: [true, false] },
]

interface ScriptedRun {
  stdout?: string
  stderr?: string
  outcome?: SubprocessOutcome
  done?: Promise<SubprocessOutcome>
  reject?: Error
  onSpawn?: (spec: SubprocessSpawnSpec) => void | Promise<void>
  waitForExit?: (signal?: AbortSignal) => Promise<boolean>
  terminate?: () => void
}

function outputReader(text: string) {
  return { readFrom: (_offset: number) => ({ text, nextOffset: Buffer.byteLength(text), lossy: false }) }
}

class ScriptedSubprocess extends SubprocessRuntime {
  readonly executionWorld = 'local' as const
  readonly specs: SubprocessSpawnSpec[] = []
  readonly handles: SubprocessHandle[] = []
  readonly terminates: Array<ReturnType<typeof vi.fn>> = []
  readonly scripts: ScriptedRun[]

  constructor(ctx: Context, scripts: ScriptedRun[]) {
    super(ctx)
    this.scripts = scripts
  }

  override resolveExecutable(command: string): Promise<string> { return Promise.resolve(command) }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const script = this.scripts.shift()
    if (script === undefined) throw new Error('unexpected subprocess call')
    this.specs.push(spec)
    const done = Promise.resolve()
      .then(() => script.onSpawn?.(spec))
      .then(() => {
        if (script.reject !== undefined) throw script.reject
        return script.done ?? script.outcome ?? { exitCode: 0, signal: null }
      })
    const terminate = vi.fn(script.terminate ?? (() => undefined))
    const handle: SubprocessHandle = {
      pid: 123,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        stdout: outputReader(script.stdout ?? '{}'),
        stderr: outputReader(script.stderr ?? ''),
      },
      done,
      terminate,
      waitForExit: vi.fn(script.waitForExit ?? (async () => true)),
    }
    spec.signal?.addEventListener('abort', () => { handle.terminate() }, { once: true })
    this.handles.push(handle)
    this.terminates.push(terminate)
    return handle
  }

  override spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    throw new Error('unused')
  }
}

async function mount(scripts: ScriptedRun[], config: Config = DEFAULT_CONFIG) {
  const ctx = new Context()
  await ctx.plugin(ImageGeneration)
  class Runtime extends ScriptedSubprocess {
    constructor(inner: Context) { super(inner, scripts) }
  }
  await ctx.plugin(Runtime)
  const runtime = ctx.subprocess as ScriptedSubprocess
  const fiber = await ctx.plugin(arkcliProvider, config)
  return { ctx, runtime, fiber }
}

function discoveryScripts(overrides: Partial<{ profile: unknown; resources: unknown; params: unknown }> = {}): ScriptedRun[] {
  return [overrides.profile ?? PROFILE, overrides.resources ?? RESOURCES, overrides.params ?? PARAMS]
    .map(value => ({ stdout: JSON.stringify(value) }))
}

async function resolve(runtimeCtx: Context, request: ImageGenerationRequest = REQUEST) {
  return await runtimeCtx.imageGeneration.resolve({ ...request, provider: 'arkcli' }, {})
}

async function encoded(format: 'png' | 'jpeg', width = 64, height = 32): Promise<Buffer> {
  const pipeline = sharp({ create: { width, height, channels: 3, background: '#123456' } })
  return await (format === 'png' ? pipeline.png() : pipeline.jpeg()).toBuffer()
}

afterEach(() => vi.restoreAllMocks())

describe('ArkCLI admission', () => {
  it('discovers the active plan profile, validates the selected model, and persists only serializable facts', async () => {
    const { ctx, runtime } = await mount(discoveryScripts())

    const spec = await resolve(ctx)

    expect(spec).toEqual({
      provider: 'arkcli',
      model: MODEL,
      size: '64x32',
      outputFormat: 'png',
      watermark: false,
      providerSpec: {
        profile: PROFILE,
        canonicalModel: MODEL,
        parameters: { size: '64x32', outputFormat: 'png', watermark: false },
      },
    })
    expect(JSON.parse(JSON.stringify(spec.providerSpec))).toEqual(spec.providerSpec)
    expect(runtime.specs.map(spec => spec.argv)).toEqual([
      ['arkcli', 'profile', 'show', '--format', 'json'],
      ['arkcli', 'resources', 'list', '--profile', 'agent-images', '--modality', 'image', '--format', 'json'],
      ['arkcli', 'models', 'get', MODEL, '--profile', 'agent-images', '--transform', 'supported_params', '--format', 'json'],
    ])
  })

  it('runs all discovery commands for every admission instead of caching profile state', async () => {
    const { ctx, runtime } = await mount([...discoveryScripts(), ...discoveryScripts()])
    await resolve(ctx)
    await resolve(ctx)
    expect(runtime.specs).toHaveLength(6)
  })

  it('chooses the sole invocable resource when no model is requested', async () => {
    const resources = { ...RESOURCES, current_default: undefined, item_count: 2, items: [
      { id: 'unavailable', invocable: false, required_overrides: ['api_key'] },
      { id: MODEL, invocable: true },
    ] }
    const { ctx } = await mount(discoveryScripts({ resources }))
    const request = {
      ...(REQUEST.provider === undefined ? {} : { provider: REQUEST.provider }),
      size: REQUEST.size, outputFormat: REQUEST.outputFormat, watermark: REQUEST.watermark,
    }
    await expect(resolve(ctx, request)).resolves.toMatchObject({ model: MODEL })
  })

  it('rejects an ambiguous model choice before parameter discovery', async () => {
    const resources = { ...RESOURCES, current_default: undefined, item_count: 2, items: [
      { id: 'first', invocable: true }, { id: 'second', invocable: true },
    ] }
    const { ctx, runtime } = await mount(discoveryScripts({ resources }))
    const request = {
      ...(REQUEST.provider === undefined ? {} : { provider: REQUEST.provider }),
      size: REQUEST.size, outputFormat: REQUEST.outputFormat, watermark: REQUEST.watermark,
    }
    await expect(resolve(ctx, request)).rejects.toMatchObject({
      category: 'invalid-input', sideEffect: 'not-started', retriable: false,
    })
    expect(runtime.specs).toHaveLength(2)
  })

  it.each(['platform', 'coding-plan', 'coding-plan-team'])(
    'rejects unsupported profile type %s before resource discovery',
    async (type) => {
      const { ctx, runtime } = await mount(discoveryScripts({ profile: { name: 'wrong', type } }))
      await expect(resolve(ctx)).rejects.toMatchObject({ category: 'authentication', sideEffect: 'not-started', retriable: false })
      expect(runtime.specs).toHaveLength(1)
    },
  )

  it.each([
    ['profile', [{ stdout: '{not-json' }]],
    ['resources', [{ stdout: JSON.stringify(PROFILE) }, { stdout: '{not-json' }]],
    ['params', [{ stdout: JSON.stringify(PROFILE) }, { stdout: JSON.stringify(RESOURCES) }, { stdout: '{not-json' }]],
  ])('rejects malformed %s JSON without exposing its contents', async (_label, scripts) => {
    const { ctx } = await mount(scripts)
    const error = await resolve(ctx).catch((value: unknown) => value)
    expect(error).toMatchObject({ category: 'provider', sideEffect: 'not-started', retriable: false })
    expect(String(error)).not.toContain('{not-json')
  })

  it.each([
    ['size', PARAMS.map(param => param.name === 'size' ? { ...param, support: false } : param)],
    ['output format', PARAMS.map(param => param.name === 'output_format' ? { ...param, enum: ['jpeg'] } : param)],
    ['watermark', PARAMS.filter(param => param.name !== 'watermark')],
  ])('rejects incompatible %s instead of dropping the requested parameter', async (_label, params) => {
    const { ctx } = await mount(discoveryScripts({ params }))
    await expect(resolve(ctx)).rejects.toMatchObject({ category: 'invalid-input', sideEffect: 'not-started', retriable: false })
  })

  it.each([
    ['minimum pixels', { minImagePixels: 3_000 }],
    ['maximum pixels', { maxImagePixels: 2_000 }],
    ['minimum aspect ratio', { minAspectRatio: 3 }],
    ['maximum aspect ratio', { maxAspectRatio: 1 }],
  ] as const)('rejects a request outside the configured %s admission limit', async (_label, patch) => {
    const config = Object.assign({}, DEFAULT_CONFIG, patch) as Config
    const { ctx, runtime } = await mount(discoveryScripts(), config)
    await expect(resolve(ctx)).rejects.toMatchObject({
      category: 'invalid-input', sideEffect: 'not-started', retriable: false,
    })
    expect(runtime.specs).toHaveLength(3)
  })
})

describe('ArkCLI generation', () => {
  it.each(['png', 'jpeg'] as const)('generates one %s, returns original bytes and cleans its private directory', async (format) => {
    const bytes = await encoded(format)
    let saveDir = ''
    const scripts = [...discoveryScripts({
      params: PARAMS.map(param => param.name === 'output_format' ? { ...param, enum: [format] } : param),
    }), {
      stdout: JSON.stringify({ output_url: 'https://secret.example/signed', local_path: 'do-not-trust.png' }),
      onSpawn: async (spec: SubprocessSpawnSpec) => {
        saveDir = spec.argv[spec.argv.indexOf('--save-to') + 1]!
        await writeFile(`${saveDir}/result.${format === 'png' ? 'png' : 'jpg'}`, bytes)
      },
    }]
    const request = { ...REQUEST, outputFormat: format }
    const { ctx, runtime } = await mount(scripts)
    const spec = await resolve(ctx, request)
    const result = await ctx.imageGeneration.generate({ prompt: 'draw --profile literally', spec }, {})

    expect(result).toEqual({
      provider: 'arkcli', model: MODEL,
      images: [{ bytes: new Uint8Array(bytes), mediaType: `image/${format}`, width: 64, height: 32 }],
    })
    expect(runtime.specs).toHaveLength(4)
    expect(runtime.specs[3]!.argv).toEqual([
      'arkcli', '+gen', '--profile', 'agent-images', '--model', MODEL,
      '--modality', 'image', '--size', '64x32', '--output-format', format,
      '--watermark=false', '--save-to', saveDir, '--no-open', '--format', 'json', 'draw --profile literally',
    ])
    expect(runtime.specs[3]!.env).toEqual({
      ARKCLI_CALLER_TYPE: 'ai_agent', ARKCLI_CALLER_NAME: 'deepseek-harness', ARKCLI_SKILL_NAME: 'arkcli-gen',
    })
    expect(runtime.specs[3]!.stdio).toEqual({
      stdin: 'ignore', stdout: { maxBytes: DEFAULT_CONFIG.stdoutMaxBytes }, stderr: { maxBytes: DEFAULT_CONFIG.stderrMaxBytes },
    })
    expect(existsSync(saveDir)).toBe(false)
    expect(JSON.stringify(result)).not.toContain('output_url')
  })

  it('does not rediscover profile, resources, or model facts during generation', async () => {
    const bytes = await encoded('png')
    const { ctx, runtime } = await mount([...discoveryScripts(), {
      onSpawn: async spec => writeFile(`${spec.argv[spec.argv.indexOf('--save-to') + 1]!}/only.png`, bytes),
    }])
    const spec = await resolve(ctx)
    await ctx.imageGeneration.generate({ prompt: 'one', spec }, {})
    expect(runtime.specs).toHaveLength(4)
    expect(runtime.specs.filter(spec => spec.argv.includes('+gen'))).toHaveLength(1)
  })

  it('rejects zero or multiple files and cleans the private directory', async () => {
    for (const count of [0, 2]) {
      let saveDir = ''
      const bytes = await encoded('png')
      const { ctx } = await mount([...discoveryScripts(), {
        onSpawn: async (spec) => {
          saveDir = spec.argv[spec.argv.indexOf('--save-to') + 1]!
          for (let index = 0; index < count; index += 1) await writeFile(`${saveDir}/${index}.png`, bytes)
        },
      }])
      const spec = await resolve(ctx)
      await expect(ctx.imageGeneration.generate({ prompt: 'one', spec }, {})).rejects.toMatchObject({
        category: 'provider', sideEffect: count === 0 ? 'unknown' : 'started', retriable: false,
      })
      expect(existsSync(saveDir)).toBe(false)
    }
  })

  it.each([
    ['wrong format', 'png', 64, 32, { outputFormat: 'jpeg' }],
    ['wrong width', 'png', 63, 32, {}],
  ] as const)('rejects %s after full decode and cleans the directory', async (_label, encodedFormat, width, height, requestPatch) => {
    const bytes = await encoded(encodedFormat, width, height)
    let saveDir = ''
    const request = { ...REQUEST, ...requestPatch }
    const params = PARAMS.map(param => param.name === 'output_format' ? { ...param, enum: [request.outputFormat] } : param)
    const { ctx } = await mount([...discoveryScripts({ params }), {
      onSpawn: async (spec) => {
        saveDir = spec.argv[spec.argv.indexOf('--save-to') + 1]!
        await writeFile(`${saveDir}/result.bin`, bytes)
      },
    }])
    const spec = await resolve(ctx, request)
    await expect(ctx.imageGeneration.generate({ prompt: 'one', spec }, {})).rejects.toMatchObject({
      category: 'provider', sideEffect: 'started', retriable: false,
    })
    expect(existsSync(saveDir)).toBe(false)
  })

  it('aborts generation through the subprocess signal and cleans the directory', async () => {
    const controller = new AbortController()
    const waitSignals: Array<AbortSignal | undefined> = []
    let saveDir = ''
    const { ctx, runtime } = await mount([...discoveryScripts(), {
      onSpawn: (spec) => {
        saveDir = spec.argv[spec.argv.indexOf('--save-to') + 1]!
        controller.abort(new Error('stop now'))
      },
      outcome: { exitCode: null, signal: 'SIGTERM' },
      waitForExit: async (signal) => {
        waitSignals.push(signal)
        return true
      },
    }])
    const spec = await resolve(ctx)
    await expect(ctx.imageGeneration.generate({ prompt: 'one', spec }, { signal: controller.signal })).rejects.toMatchObject({
      category: 'transport', sideEffect: 'unknown', retriable: true,
    })
    expect(runtime.specs[3]!.signal).not.toBe(controller.signal)
    expect(runtime.specs[3]!.signal?.aborted).toBe(true)
    expect(runtime.terminates[3]).toHaveBeenCalled()
    expect(waitSignals).toHaveLength(1)
    expect(waitSignals[0]?.aborted).toBe(false)
    expect(existsSync(saveDir)).toBe(false)
  })

  it('forces an unbounded reap when the bounded quiescence probe throws', async () => {
    const controller = new AbortController()
    const waits: Array<AbortSignal | undefined> = []
    const { ctx } = await mount([...discoveryScripts(), {
      onSpawn: () => { controller.abort(new Error('cancel')) },
      outcome: { exitCode: null, signal: 'SIGTERM' },
      waitForExit: async (signal) => {
        waits.push(signal)
        if (signal !== undefined) throw new Error('inspector unavailable during bounded wait')
        return true
      },
    }])
    const spec = await resolve(ctx)
    await expect(ctx.imageGeneration.generate({ prompt: 'one', spec }, { signal: controller.signal })).rejects.toMatchObject({
      category: 'transport', sideEffect: 'unknown', retriable: true,
    })
    expect(waits.some(signal => signal === undefined)).toBe(true)
  })

  it('keeps unknown side-effect state when post-exit file inspection fails', async () => {
    const { ctx } = await mount([...discoveryScripts(), {
      stderr: '401 Unauthorized',
      outcome: { exitCode: 1, signal: null },
      onSpawn: async (spec) => {
        const saveDir = spec.argv[spec.argv.indexOf('--save-to') + 1]!
        await rm(saveDir, { recursive: true, force: true })
      },
    }])
    const spec = await resolve(ctx)
    await expect(ctx.imageGeneration.generate({ prompt: 'one', spec }, {})).rejects.toMatchObject({
      category: 'provider', sideEffect: 'unknown', retriable: false,
    })
  })

  it('does not follow a generated junction during recursive cleanup', async () => {
    const external = await mkdtemp(join(tmpdir(), 'dsh-arkcli-external-'))
    const marker = join(external, 'marker.txt')
    await writeFile(marker, 'preserve')
    let saveDir = ''
    try {
      const { ctx } = await mount([...discoveryScripts(), {
        onSpawn: async (spec) => {
          saveDir = spec.argv[spec.argv.indexOf('--save-to') + 1]!
          await symlink(external, join(saveDir, 'outside'), 'junction')
        },
      }])
      const spec = await resolve(ctx)
      await expect(ctx.imageGeneration.generate({ prompt: 'one', spec }, {})).rejects.toBeInstanceOf(ArkcliImageGenerationError)
      await expect(readFile(marker, 'utf8')).resolves.toBe('preserve')
      expect(existsSync(saveDir)).toBe(false)
    } finally {
      await rm(external, { recursive: true, force: true })
    }
  })
})

describe('ArkCLI failures and lifecycle', () => {
  it.each([
    ['rate-limit', '429 TooManyRequests', true],
    ['authentication', '401 Unauthorized', false],
    ['policy', 'ContentRiskBlocked SensitiveContentDetected', false],
    ['invalid-input', 'InvalidParameter size rejected', false],
    ['transport', 'ECONNRESET while waiting', true],
    ['provider', 'internal failure request-id=secret-value', false],
  ] as const)('classifies %s without leaking stderr', async (category, stderr, retriable) => {
    const { ctx } = await mount([...discoveryScripts(), { stderr, outcome: { exitCode: 1, signal: null } }])
    const spec = await resolve(ctx)
    const error = await ctx.imageGeneration.generate({ prompt: 'one', spec }, {}).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(ArkcliImageGenerationError)
    expect(error).toMatchObject({
      category,
      sideEffect: 'unknown',
      retriable,
    })
    expect(String(error)).not.toContain(stderr)
    expect(String(error)).not.toContain('secret-value')
  })

  it('classifies a pre-aborted admission as not-started without spawning', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancel'))
    const { ctx, runtime } = await mount(discoveryScripts())
    await expect(ctx.imageGeneration.resolve({ ...REQUEST, provider: 'arkcli' }, { signal: controller.signal })).rejects.toMatchObject({
      category: 'transport', sideEffect: 'not-started', retriable: true,
    })
    expect(runtime.specs).toHaveLength(0)
  })

  it('removes the provider when its contributing fiber is disposed', async () => {
    const { ctx, fiber } = await mount(discoveryScripts())
    await expect(resolve(ctx)).resolves.toMatchObject({ provider: 'arkcli' })
    await fiber.dispose()
    await expect(resolve(ctx)).rejects.toBeInstanceOf(ImageGenerationError)
  })

  it('aborts and drains an active admission before provider disposal settles', async () => {
    const outcome = Promise.withResolvers<SubprocessOutcome>()
    const started = Promise.withResolvers<undefined>()
    const allowQuiet = Promise.withResolvers<undefined>()
    const scripts: ScriptedRun[] = [{
      stdout: JSON.stringify(PROFILE),
      done: outcome.promise,
      onSpawn: () => { started.resolve(undefined) },
      terminate: () => { outcome.resolve({ exitCode: null, signal: 'SIGTERM' }) },
      waitForExit: async () => {
        await allowQuiet.promise
        return true
      },
    }]
    const { ctx, runtime, fiber } = await mount(scripts)
    const operation = resolve(ctx)
    const observed = operation.catch((error: unknown) => error)
    await started.promise
    let disposed = false
    const disposal = fiber.dispose().then(() => { disposed = true })
    await new Promise(resolve => setTimeout(resolve, 0))
    try {
      expect(runtime.specs[0]!.signal?.aborted).toBe(true)
      expect(runtime.terminates[0]).toHaveBeenCalled()
      expect(disposed).toBe(false)
      allowQuiet.resolve(undefined)
      await expect(observed).resolves.toMatchObject({ category: 'transport', sideEffect: 'not-started' })
      await disposal
      expect(disposed).toBe(true)
    } finally {
      outcome.resolve({ exitCode: null, signal: 'SIGTERM' })
      allowQuiet.resolve(undefined)
      await operation.catch(() => undefined)
      await disposal
    }
  })

  it('uses no spill output mode for discovery or generation', async () => {
    const bytes = await encoded('png')
    const { ctx, runtime } = await mount([...discoveryScripts(), {
      onSpawn: spec => writeFile(`${spec.argv[spec.argv.indexOf('--save-to') + 1]!}/one.png`, bytes),
    }])
    const spec = await resolve(ctx)
    await ctx.imageGeneration.generate({ prompt: 'one', spec }, {})
    for (const spawn of runtime.specs) {
      expect(spawn.stdio.stdout).toEqual({ maxBytes: DEFAULT_CONFIG.stdoutMaxBytes })
      expect(spawn.stdio.stderr).toEqual({ maxBytes: DEFAULT_CONFIG.stderrMaxBytes })
    }
  })
})
