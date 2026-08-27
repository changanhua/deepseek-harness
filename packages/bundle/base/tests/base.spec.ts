/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list.
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader, { evaluate } from '@deepseek-ai/cordis-plugin-loader'
import { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { ImageGeneration } from '@deepseek-ai/dsh-image-generation'
import * as ImageGenerationTaskQueue from '@deepseek-ai/dsh-image-generation-task-queue'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import LocalTaskQueue from '@deepseek-ai/dsh-task-queue-local'
import * as DshTaskQueueExecutor from '@deepseek-ai/dsh-task-queue-executor-dsh'
import * as ToolAgentRunTaskQueue from '@deepseek-ai/dsh-tool-agent-run-task-queue'
import * as ToolImageGenerationTaskQueue from '@deepseek-ai/dsh-tool-image-generation-task-queue'
import * as ToolTaskQueue from '@deepseek-ai/dsh-tool-task-queue'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Test-only providers: no child process, image request, or durable attachment is exercised here. */
class TestSubprocess extends SubprocessRuntime {
  readonly executionWorld = 'local' as const
  resolveExecutable(): Promise<string> { return Promise.reject(new Error('test composition must not spawn a worker')) }
  spawn(): never { throw new Error('test composition must not spawn a worker') }
  spawnTerminal(): Promise<never> { return Promise.reject(new Error('test composition must not spawn a terminal')) }
}

class TestAttachments extends AttachmentStore {
  readonly imageLimits = {
    maxImageBytes: 1,
    maxImagesPerMessage: 1,
    maxMessageImageBytes: 1,
    maxImagePixels: 1,
    maxImageDimension: 1,
    mediaTypes: ['image/png'] as const,
  }
  validateImage(): Promise<void> { return Promise.reject(new Error('test composition must not save images')) }
  saveImage(): Promise<never> { return Promise.reject(new Error('test composition must not save images')) }
  readImage(): Promise<never> { return Promise.reject(new Error('test composition must not read images')) }
}

/** Loader-mounted capability fixture for Queue's host-plane composition. */
async function applyQueueTestSupport(ctx: Context): Promise<void> {
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(TestSubprocess)
  await ctx.plugin(ImageGeneration)
  await ctx.plugin(TestAttachments)
}

async function loadQueueComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-base-queue-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: queue-test-support',
    '  name: "@deepseek-ai/dsh-base-test-queue-support"',
    '- id: task-queue',
    '  name: "@deepseek-ai/dsh-task-queue-local"',
    '  config:',
    `    queueRoot: ${JSON.stringify(join(root, 'queue'))}`,
    '    maxConcurrent: 1',
    '    resourceCapacity:',
    '      image-generation: 1',
    '      agent-run: 1',
    '- id: image-generation-task-queue',
    '  name: "@deepseek-ai/dsh-image-generation-task-queue"',
    '  inject: [taskQueue, imageGeneration, attachments]',
    '  config: { maxAttempts: 1 }',
    '- id: tool-image-generation-task-queue',
    '  name: "@deepseek-ai/dsh-tool-image-generation-task-queue"',
    '- id: task-queue-executor-dsh',
    '  name: "@deepseek-ai/dsh-task-queue-executor-dsh"',
    '  inject: [taskQueue, subprocess]',
    '  config:',
    `    launcher: [${JSON.stringify(process.execPath)}]`,
    `    dshHome: ${JSON.stringify(root)}`,
    `    workspaceDir: ${JSON.stringify(root)}`,
    '- id: tool-task-queue',
    '  name: "@deepseek-ai/dsh-tool-task-queue"',
    '  inject: [tools, taskQueue, sessions]',
    '  config: { maxNotificationsPerStep: 1 }',
    '- id: tool-agent-run-task-queue',
    '  name: "@deepseek-ai/dsh-tool-agent-run-task-queue"',
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-base-test-queue-support', applyQueueTestSupport],
    ['@deepseek-ai/dsh-task-queue-local', LocalTaskQueue],
    ['@deepseek-ai/dsh-image-generation-task-queue', ImageGenerationTaskQueue],
    ['@deepseek-ai/dsh-tool-image-generation-task-queue', ToolImageGenerationTaskQueue],
    ['@deepseek-ai/dsh-task-queue-executor-dsh', DshTaskQueueExecutor],
    ['@deepseek-ai/dsh-tool-task-queue', ToolTaskQueue],
    ['@deepseek-ai/dsh-tool-agent-run-task-queue', ToolAgentRunTaskQueue],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      const loaded = modules.get(specifier)
      if (loaded === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
      return loaded
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('dsh-base bundle', () => {
  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    // The base layer is one insert list over the empty profile root.
    const rows = (parsed as { insert?: { id?: string; config?: Record<string, unknown>; inject?: string[] }[] }[]).flatMap(
      patch => patch.insert ?? [],
    )
    expect(rows.length).toBeGreaterThan(50)
    expect(rows.some(row => row.id === 'agent-loop')).toBe(true)
    expect(rows.find(row => row.id === 'session-telemetry-otel')?.config?.['mode']).toEqual({
      __jsExpr: "process.env.DSH_TELEMETRY_MODE || 'FEEDBACK_ONLY'",
    })
    expect(rows.filter(row => row.id === 'subagent-codex')).toHaveLength(1)
    expect(rows.filter(row => row.id === 'subagent-claude-code')).toHaveLength(1)
    expect(rows.find(row => row.id === 'task-queue')?.config).toMatchObject({
      queueRoot: { __jsExpr: "dshHomePath('task-queue-v3')" },
      maxConcurrent: 3,
      resourceCapacity: { 'image-generation': 3, 'agent-run': 1, 'operation-run': 1 },
    })
    expect(rows.filter(row => row.id === 'operation-run-task-queue')).toHaveLength(0)
    expect(rows.filter(row => row.id === 'tool-operation-run-task-queue')).toHaveLength(0)
    expect(rows.filter(row => row.id === 'task-queue-executor-dsh')).toHaveLength(1)
    expect(rows.find(row => row.id === 'task-queue-executor-dsh')?.inject).toEqual([
      'taskQueue',
      'subprocess',
    ])
    expect(rows.filter(row => row.id === 'image-generation-task-queue')).toHaveLength(1)
    expect(rows.find(row => row.id === 'image-generation-task-queue')?.inject).toEqual([
      'taskQueue',
      'imageGeneration',
      'attachments',
    ])
    expect(rows.find(row => row.id === 'tool-task-queue')?.config).toEqual({
      maxNotificationsPerStep: 1,
    })
    expect(rows.find(row => row.id === 'tool-task-queue')?.inject).toEqual([
      'tools',
      'taskQueue',
      'sessions',
    ])
    expect(rows.filter(row => row.id === 'tool-agent-run-task-queue')).toHaveLength(1)
    expect(manifest.dependencies).toMatchObject({
      '@deepseek-ai/dsh-subagent-codex': 'workspace:^',
      '@deepseek-ai/dsh-subagent-claude-code': 'workspace:^',
      '@deepseek-ai/dsh-task-queue-executor-dsh': 'workspace:^',
      '@deepseek-ai/dsh-tool-agent-run-task-queue': 'workspace:^',
    })
  })

  it('loads the Queue v2 host chain through Loader and disposes every registration', { timeout: 30_000 }, async () => {
    const loaded = await loadQueueComposition()
    const requiredRows = [
      'queue-test-support',
      'task-queue',
      'image-generation-task-queue',
      'tool-image-generation-task-queue',
      'task-queue-executor-dsh',
      'tool-task-queue',
      'tool-agent-run-task-queue',
    ]
    for (const id of requiredRows) {
      expect([...loaded.loader.entries()].find(entry => entry.options.id === id)?.fiber, id).toBeDefined()
    }
    expect(loaded.taskQueue.listKinds()).toEqual(['agent.run@1', 'image.generate@1'])
    const toolNames = loaded.tools.schemas().map(schema => schema.name)
    expect(toolNames).toEqual(expect.arrayContaining([
      'task_queue_list',
      'task_queue_enqueue',
      'task_queue_enqueue_batch',
      'image_generate_enqueue',
      'image_generate_enqueue_batch',
    ]))

    const activeEntries = [...loaded.loader.entries()]
    await loaded.fiber.dispose()
    context = undefined
    expect(loaded.get('taskQueue')).toBeUndefined()
    expect(loaded.get('tools')).toBeUndefined()
    expect(activeEntries.filter(entry => requiredRows.includes(entry.options.id ?? '') && entry.fiber !== undefined)
      .every(entry => entry.fiber!.uid === null)).toBe(true)
  })

  it('gates each shell stack by platform with a symmetric disabled expression', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const parsed = yaml.load(
      readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(parsed)) throw new TypeError('base patch must parse to a patch list')
    const rows = parsed.flatMap((patch): Record<string, unknown>[] =>
      typeof patch === 'object' && patch !== null
        ? (patch as { insert?: Record<string, unknown>[] }).insert ?? []
        : [],
    )
    // Symmetric gating: each stack's executor and tool rows carry the same
    // platform fact, inverted between the bash and pwsh twins, so exactly one
    // shell stack mounts per host. Evaluate with a platform-scoped context
    // (the `with` scope shadows the global `process`) so both outcomes pin on
    // every host.
    for (const [id, win32, linux] of [
      ['bash-sandbox', true, false],
      ['tool-bash', true, false],
      ['pwsh-sandbox', false, true],
      ['tool-pwsh', false, true],
    ] as const) {
      const row = rows.find(candidate => candidate.id === id)
      if (row === undefined) throw new Error(`base patch must mount ${id}`)
      const expression = (row.disabled as { __jsExpr?: string } | undefined)?.__jsExpr
      if (expression === undefined) throw new Error(`${id} must gate on a !!js disabled expression`)
      expect(Boolean(evaluate({ process: { platform: 'win32' } }, expression)), `${id} on win32`).toBe(win32)
      expect(Boolean(evaluate({ process: { platform: 'linux' } }, expression)), `${id} on linux`).toBe(linux)
    }
    // The platform layer folded into these rows: no separate patch file ships.
    expect(existsSync(resolve(root, 'windows.cordis.patch.yml'))).toBe(false)
  })
})
