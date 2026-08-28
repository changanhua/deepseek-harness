/**
 * Restricted DSH worker provider for the durable task queue. It registers one
 * executor adapter; the queue backend remains the only subprocess owner.
 * @module @deepseek-ai/dsh-task-queue-executor-dsh
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import type { SubprocessCollect, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { ExecutorAdapter, Task } from '@deepseek-ai/dsh-task-queue'

/** Cordis plugin name. */
export const name = 'task-queue-executor-dsh'
/** The executor registry owner required before this provider can activate. */
export const inject = ['taskQueue']

const DEFAULT_PROFILE = 'task-worker'
const DEFAULT_MAX_ASSISTANT_BYTES = 64 * 1024
const DEFAULT_COLLECT_BYTES = 256 * 1024
const DEFAULT_GRACE_MS = 5_000
const MAX_CONFIGURED_BYTES = 64 * 1024 * 1024
const DIR_MODE = 0o700

/** Absolute path of the final worker restriction patch in source and built layouts. */
export const WORKER_PATCH_PATH = fileURLToPath(new URL('../worker.cordis.patch.yml', import.meta.url))

/** Deployment configuration for the DSH executor provider. */
export interface Config {
  /** DSH launch argv prefix, for example `[process.execPath, process.argv[1]]`. */
  launcher: string[]
  /** Harness home explicitly forwarded after the subprocess environment scrub. */
  dshHome: string
  /** Dedicated one-shot profile name. */
  profile?: string
  /** Maximum UTF-8 bytes persisted as semantic assistant text. */
  maxAssistantBytes?: number
  /** In-memory bytes collected per output stream before spill. */
  collectBytes?: number
  /** Grace before subprocess termination escalates. */
  graceMs?: number
}

/** Fully defaulted, cross-field-validated provider configuration. */
export interface ResolvedConfig {
  launcher: string[]
  dshHome: string
  profile: string
  maxAssistantBytes: number
  collectBytes: number
  graceMs: number
}

/** Schemastery config accepted by the Cordis loader. */
export const Config: z<Config> = z.object({
  launcher: z.array(z.string()).min(1),
  dshHome: z.string(),
  profile: z.string().default(DEFAULT_PROFILE),
  maxAssistantBytes: z.number().step(1).min(1).max(MAX_CONFIGURED_BYTES).default(DEFAULT_MAX_ASSISTANT_BYTES),
  collectBytes: z.number().step(1).min(1).max(MAX_CONFIGURED_BYTES).default(DEFAULT_COLLECT_BYTES),
  graceMs: z.number().step(1).min(0).default(DEFAULT_GRACE_MS),
})

function requireIntegerInRange(name: string, value: number, minimum: number, maximum?: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || (maximum !== undefined && value > maximum)) {
    const upper = maximum === undefined ? '' : ` and at most ${String(maximum)}`
    throw new Error(`dsh executor: ${name} must be a safe integer of at least ${String(minimum)}${upper}`)
  }
}

/**
 * Apply defaults and constraints that involve more than one config field.
 * @param config - loader or direct-call configuration.
 * @returns a fresh resolved configuration.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  if (config.launcher.length === 0 || config.launcher.some(part => part.length === 0)) {
    throw new Error('dsh executor: launcher must contain non-empty argv entries')
  }
  if (config.dshHome.length === 0) throw new Error('dsh executor: dshHome must be non-empty')
  const profile = config.profile ?? DEFAULT_PROFILE
  if (profile.length === 0) throw new Error('dsh executor: profile must be non-empty')
  const maxAssistantBytes = config.maxAssistantBytes ?? DEFAULT_MAX_ASSISTANT_BYTES
  const collectBytes = config.collectBytes ?? DEFAULT_COLLECT_BYTES
  const graceMs = config.graceMs ?? DEFAULT_GRACE_MS
  requireIntegerInRange('maxAssistantBytes', maxAssistantBytes, 1, MAX_CONFIGURED_BYTES)
  requireIntegerInRange('collectBytes', collectBytes, 1, MAX_CONFIGURED_BYTES)
  requireIntegerInRange('graceMs', graceMs, 0)
  if (maxAssistantBytes > collectBytes) {
    throw new Error('dsh executor: maxAssistantBytes must not exceed collectBytes')
  }
  return {
    launcher: [...config.launcher],
    dshHome: config.dshHome,
    profile,
    maxAssistantBytes,
    collectBytes,
    graceMs,
  }
}

function collect(maxBytes: number): SubprocessCollect {
  return { maxBytes, spill: { maxBytes: maxBytes * 16 } }
}

function stdio(maxBytes: number): SubprocessSpawnSpec['stdio'] {
  return { stdin: 'ignore', stdout: collect(maxBytes), stderr: collect(maxBytes) }
}

/** Render the ordinary user task submitted to the restricted one-shot worker. */
function renderTask(task: Task, workspaceDir: string): string {
  return [
    'Background task execution context:',
    `- workspaceDir: ${JSON.stringify(workspaceDir)}`,
    `- outputDir: ${JSON.stringify(task.outputDir)}`,
    '- Work in workspaceDir. Put artifacts intended for the owning Agent in outputDir.',
    '- Delegation, durable task submission, goals, workflows, and shell execution are unavailable in this worker.',
    '',
    'Task:',
    task.prompt,
  ].join('\n')
}

/** Keep a UTF-8 prefix without splitting a code point. */
function utf8Prefix(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false }
  const buffer = Buffer.from(text, 'utf8')
  let end = maxBytes
  while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80) end -= 1
  return { text: buffer.subarray(0, end).toString('utf8'), truncated: true }
}

/**
 * Build the queue adapter from resolved deployment configuration.
 * @param config - validated launcher, home, bounds, and lifecycle values.
 * @returns the prepare and semantic-normalization adapter.
 */
export function createDshExecutor(config: ResolvedConfig): ExecutorAdapter {
  return {
    async prepare(task, _run, signal): Promise<SubprocessSpawnSpec> {
      void signal
      const workspaceDir = task.workspaceDir ?? task.outputDir
      await mkdir(workspaceDir, { recursive: true, mode: DIR_MODE })
      await mkdir(task.outputDir, { recursive: true, mode: DIR_MODE })
      return {
        argv: [
          ...config.launcher,
          '--profile', config.profile,
          '--patch', WORKER_PATCH_PATH,
          renderTask(task, workspaceDir),
        ],
        cwd: workspaceDir,
        env: {
          DSH_HOME: config.dshHome,
          DSH_PERMISSION_MODE: 'workspace-write',
          DSH_TELEMETRY_DISABLED: '1',
        },
        stdio: stdio(config.collectBytes),
        graceMs: config.graceMs,
      }
    },
    normalize(_task, stdout) {
      const semantic = stdout.replace(/(?:\r?\n)+$/u, '')
      if (semantic.trim().length === 0) {
        return { summary: 'dsh worker completed without semantic text' }
      }
      const bounded = utf8Prefix(semantic, config.maxAssistantBytes)
      return {
        summary: bounded.truncated
          ? `dsh worker completed; semantic result truncated to ${config.maxAssistantBytes} UTF-8 bytes (full text in run log)`
          : 'dsh worker completed with semantic result',
        assistantText: bounded.text,
      }
    },
  }
}

/**
 * Register the restricted DSH adapter for the lifetime of this plugin fiber.
 * @param ctx - Cordis context carrying the task queue.
 * @param config - provider configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const adapter = createDshExecutor(resolveConfig(config))
  ctx.effect(() => ctx.taskQueue.registerExecutor('dsh', adapter), 'task-queue-executor-dsh: register')
}
