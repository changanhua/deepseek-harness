/** Restricted DSH implementation of the explicit `agent.run@1` WorkKind. */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TextRetainer } from '@deepseek-ai/dsh-output-retention'
import type { SubprocessHandle, SubprocessSpawnSpec, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { LiveAttempt, WorkFailure, WorkHandler, WorkKindDefinition } from '@changanhua/dsh-task-queue'

export const name = 'task-queue-executor-dsh'
export const inject = ['taskQueue', 'subprocess']
const DEFAULT_PROFILE = 'task-worker'
const DEFAULT_MAX_ASSISTANT_BYTES = 64 * 1024
const DEFAULT_COLLECT_BYTES = 256 * 1024
const DEFAULT_GRACE_MS = 5_000
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_FAILURE_TAIL_BYTES = 8 * 1024
const MAX_CONFIGURED_BYTES = 64 * 1024 * 1024
const DIR_MODE = 0o700
/** Absolute path of the final worker restriction patch in source and built layouts. */
export const WORKER_PATCH_PATH = fileURLToPath(new URL('../worker.cordis.patch.yml', import.meta.url))

/** Immutable intent submitted by an Agent for one restricted Harness worker. */
export interface AgentRunIntent { readonly prompt: string }
/** Admission facts consumed without discovery at the side-effect boundary. */
export interface ResolvedAgentRun { readonly prompt: string; readonly workspaceDir: string }
/** Semantic worker result persisted as the terminal WorkResult output. */
export interface AgentRunOutput { readonly summary: string; readonly assistantText?: string }
declare module '@changanhua/dsh-task-queue' {
  interface WorkKindMap {
    'agent.run@1': WorkKindDefinition<AgentRunIntent, ResolvedAgentRun, ResolvedAgentRun, AgentRunOutput>
  }
}

/** Deployment configuration for the restricted DSH worker handler. */
export interface Config {
  /** Executable and fixed argv prefix used to launch the worker. */
  launcher: string[]
  /** DSH home exposed to the restricted worker process. */
  dshHome: string
  /** Working directory allowed for every admitted request. */
  workspaceDir: string
  /** DSH profile loaded by the worker. */
  profile?: string
  /** Maximum UTF-8 bytes persisted from the semantic worker answer. */
  maxAssistantBytes?: number
  /** Maximum stdout bytes retained before spill collection. */
  collectBytes?: number
  /** Maximum UTF-8 bytes retained from nonzero-exit stderr. */
  failureTailBytes?: number
  /** Grace period for worker termination. */
  graceMs?: number
  /** Maximum attempts permitted for one admitted worker request. */
  maxAttempts?: number
}
/** Fully defaulted, cross-field-validated handler configuration. */
export interface ResolvedConfig {
  readonly launcher: readonly string[]
  readonly dshHome: string
  readonly workspaceDir: string
  readonly profile: string
  readonly maxAssistantBytes: number
  readonly collectBytes: number
  readonly failureTailBytes: number
  readonly graceMs: number
  readonly maxAttempts: number
}
/** Schemastery config accepted by the Cordis loader. */
export const Config: z<Config> = z.object({
  launcher: z.array(z.string()).min(1),
  dshHome: z.string(),
  workspaceDir: z.string(),
  profile: z.string().default(DEFAULT_PROFILE),
  maxAssistantBytes: z.number().step(1).min(1).max(MAX_CONFIGURED_BYTES).default(DEFAULT_MAX_ASSISTANT_BYTES),
  collectBytes: z.number().step(1).min(1).max(MAX_CONFIGURED_BYTES).default(DEFAULT_COLLECT_BYTES),
  failureTailBytes: z.number().step(1).min(1).max(MAX_CONFIGURED_BYTES).default(DEFAULT_FAILURE_TAIL_BYTES),
  graceMs: z.number().step(1).min(0).default(DEFAULT_GRACE_MS),
  maxAttempts: z.number().step(1).min(1).default(DEFAULT_MAX_ATTEMPTS),
})

/**
 * Resolve configuration defaults and reject unsafe worker limits.
 * @param config Loader configuration.
 * @returns Frozen, fully resolved handler configuration.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  if (!Array.isArray(config.launcher)
    || typeof config.dshHome !== 'string'
    || typeof config.workspaceDir !== 'string') {
    throw new Error('dsh agent.run handler requires launcher, dshHome, and workspaceDir configuration')
  }
  const profile = config.profile ?? DEFAULT_PROFILE
  const maxAssistantBytes = config.maxAssistantBytes ?? DEFAULT_MAX_ASSISTANT_BYTES
  const collectBytes = config.collectBytes ?? DEFAULT_COLLECT_BYTES
  const failureTailBytes = config.failureTailBytes ?? DEFAULT_FAILURE_TAIL_BYTES
  const graceMs = config.graceMs ?? DEFAULT_GRACE_MS
  const maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  if (config.launcher.length === 0 || config.launcher.some(part => part.length === 0)) {
    throw new Error('dsh agent.run handler requires non-empty launcher argv')
  }
  if (config.dshHome.length === 0 || config.workspaceDir.length === 0 || profile.length === 0) {
    throw new Error('dsh agent.run handler requires non-empty home, workspace, and profile')
  }
  for (const [field, value] of [['maxAssistantBytes', maxAssistantBytes], ['collectBytes', collectBytes], ['failureTailBytes', failureTailBytes], ['graceMs', graceMs], ['maxAttempts', maxAttempts]] as const) {
    if (!Number.isSafeInteger(value)
      || value < 0
      || (field !== 'graceMs' && value === 0)
      || value > MAX_CONFIGURED_BYTES) {
      throw new Error(`dsh agent.run handler has invalid ${field}`)
    }
  }
  if (maxAssistantBytes > collectBytes || failureTailBytes > collectBytes) throw new Error('dsh agent.run handler retained output limits must not exceed collectBytes')
  return Object.freeze({
    launcher: Object.freeze([...config.launcher]),
    dshHome: config.dshHome,
    workspaceDir: config.workspaceDir,
    profile,
    maxAssistantBytes,
    collectBytes,
    failureTailBytes,
    graceMs,
    maxAttempts,
  })
}

function renderTask(resolved: ResolvedAgentRun): string {
  return [
    'Background task execution context:',
    `- workspaceDir: ${JSON.stringify(resolved.workspaceDir)}`,
    '- Work only in workspaceDir. Delegation, durable task submission, goals, workflows, and background jobs are unavailable.',
    '- Foreground shell execution is available inside the workspace sandbox for installed Skills.',
    '',
    'Task:',
    resolved.prompt,
  ].join('\n')
}
function collect(maxBytes: number): SubprocessSpawnSpec['stdio']['stdout'] { return { maxBytes, spill: { maxBytes: maxBytes * 16 } } }
function failure(category: string, message: string, sideEffect: WorkFailure['sideEffect'], retriable = false): WorkFailure { return { category, message, sideEffect, retriable } }
function retain(text: string, kind: 'head' | 'tail', maxBytes: number): { readonly text: string; readonly truncated: boolean } {
  const retainer = new TextRetainer({ kind, maxBytes })
  retainer.push(text)
  const retained = retainer.finish()
  return { text: retained.text, truncated: retained.truncated }
}
function settle(handle: SubprocessHandle, config: ResolvedConfig): Promise<Awaited<LiveAttempt<'agent.run@1'>['done']>> {
  return handle.done.then((exit) => {
    if (exit.exitCode !== 0) {
      const stderr = retain(handle.collected.stderr?.readFrom(0).text ?? '', 'tail', config.failureTailBytes).text.trimEnd()
      const status = exit.exitCode === null ? exit.signal ?? 'an unknown signal' : `code ${exit.exitCode}`
      return { status: 'failed' as const, failure: failure('worker-exit', `DSH worker exited with ${status}${stderr === '' ? '' : `: ${stderr}`}`, 'started') }
    }
    const text = handle.collected.stdout?.readFrom(0).text.replace(/(?:\r?\n)+$/u, '') ?? ''
    if (text.trim().length === 0) return { status: 'succeeded' as const, output: { summary: 'dsh worker completed without semantic text' } }
    const bounded = retain(text, 'head', config.maxAssistantBytes)
    return { status: 'succeeded' as const, output: { summary: bounded.truncated ? `dsh worker completed; semantic result truncated to ${config.maxAssistantBytes} UTF-8 bytes` : 'dsh worker completed with semantic result', assistantText: bounded.text } }
  }, (error: unknown) => ({
    status: 'failed' as const,
    failure: failure('worker-spawn', error instanceof Error ? error.message : 'worker promise rejected', 'unknown'),
  }))
}

/**
 * Build the typed worker handler from trusted deployment configuration.
 * @param config Resolved worker settings.
 * @param subprocess Runtime used to launch the restricted worker.
 * @returns The `agent.run@1` WorkHandler.
 */
export function createDshWorkHandler(config: ResolvedConfig, subprocess: Pick<SubprocessRuntime, 'spawn'>): WorkHandler<'agent.run@1'> {
  return {
    kind: 'agent.run@1',
    resolveAdmission(input) {
      if (input.prompt.trim() === '') return Promise.reject(new Error('agent.run prompt must not be blank'))
      return Promise.resolve(Object.freeze({ prompt: input.prompt, workspaceDir: config.workspaceDir }))
    },
    resources() { return [{ resource: 'agent-run', units: 1 }] },
    policy() { return { maxAttempts: config.maxAttempts } },
    async prepare(resolved) { await mkdir(resolved.workspaceDir, { recursive: true, mode: DIR_MODE }); return resolved },
    start(prepared, context): LiveAttempt<'agent.run@1'> {
      let handle: SubprocessHandle
      try {
        handle = subprocess.spawn({ argv: [...config.launcher, '--profile', config.profile, '--patch', WORKER_PATCH_PATH, renderTask(prepared)], cwd: prepared.workspaceDir, env: { DSH_HOME: config.dshHome, DSH_PERMISSION_MODE: 'workspace-write', DSH_TELEMETRY_DISABLED: '1' }, stdio: { stdin: 'ignore', stdout: collect(config.collectBytes), stderr: collect(config.collectBytes) }, graceMs: config.graceMs, signal: context.signal })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'worker spawn threw a non-Error value'
        return {
          done: Promise.resolve({ status: 'failed', failure: failure('worker-spawn', message, 'not-started') }),
          cancel: () => Promise.resolve(),
        }
      }
      return {
        done: settle(handle, config),
        cancel() { handle.terminate(); return Promise.resolve() },
      }
    },
  }
}

/** Register the v2 handler for this plugin lifetime. */
export function apply(ctx: Context, config: Config): void {
  const handler = createDshWorkHandler(resolveConfig(config), ctx.subprocess)
  ctx.effect(() => ctx.taskQueue.registerHandler(handler), 'task-queue-executor-dsh: register agent.run@1')
}
