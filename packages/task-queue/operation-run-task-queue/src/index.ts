/** Allowlisted host-operation handler for Queue v2. */
import { stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TextRetainer } from '@deepseek-ai/dsh-output-retention'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { SubprocessHandle, SubprocessSpawnSpec, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { LiveAttempt, WorkFailure, WorkHandler } from '@deepseek-ai/dsh-task-queue'
import type { OperationDefinition, OperationRunOutput, PreparedOperationRun, ResolvedOperationRun } from './types.ts'

export type {
  OperationDefinition,
  OperationRunIntent,
  OperationRunOutput,
  PreparedOperationRun,
  ResolvedOperationRun,
} from './types.ts'
export const name = 'operation-run-task-queue'
export const inject = ['taskQueue', 'subprocess']
/** Host-owned allowlist supplied to the operation WorkKind bridge. */
export interface Config {
  /** Closed map from caller-visible ids to trusted, fixed operation definitions. */
  readonly operations: Readonly<Record<string, OperationDefinition>>
}
/** Loader-visible shape; the factory additionally rejects widened fields and cross-field violations. */
export const Config: z<Config> = z.object({
  operations: z.dict(z.object({
    revision: z.string(),
    description: z.string(),
    argv: z.array(z.string()),
    cwd: z.string(),
    resource: z.string(),
    units: z.number().min(1).step(1),
    maxAttempts: z.number().min(1).step(1),
    collectBytes: z.number().min(1).step(1),
    resultBytes: z.number().min(1).step(1),
    failureTailBytes: z.number().min(1).step(1),
    graceMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).step(1),
    timeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).step(1),
  })),
}) as unknown as z<Config>
type Cause = 'canceled' | 'timeout' | undefined
const sensitiveEnvironmentName = new RegExp([
  '(?:^|_)',
  '(?:api_?key|api_?token|access_?token|auth_?token|token|password|secret|credentials?|authorization|bearer|private_?key)',
  '(?:_|$)',
].join(''), 'iu')
const credentialLiteralPattern = new RegExp([
  '^(?:sk-(?:live|proj|test)-|gh[pous]_|github_pat_|AKIA[0-9A-Z]{8,}|AIza[0-9A-Za-z_-]{10,}|',
  'xox[baprs]-|eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]+\\.)',
].join(''), 'u')
const sensitiveFlag = new RegExp([
  '^--(?:api[-_]?key|api[-_]?token|access[-_]?token|auth[-_]?token|oauth2[-_]?bearer|token|password|',
  'secret|credentials?|authorization|bearer|private[-_]?key)(?:=|$)',
].join(''), 'iu')
function configuration(message: string): Error { return new Error(`operation.run configuration: ${message}`) }
function admission(message: string): Error { return new Error(`operation.run admission: ${message}`) }
function failure(
  category: string,
  message: string,
  sideEffect: WorkFailure['sideEffect'],
  retriable = false,
): WorkFailure { return { category, message, sideEffect, retriable } }
function retained(text: string, kind: 'head' | 'tail', maxBytes: number): { text: string; truncated: boolean } {
  const value = new TextRetainer({ kind, maxBytes })
  value.push(text)
  const result = value.finish()
  return { text: result.text, truncated: result.truncated }
}
function output(stdout: { text: string; truncated: boolean }, prepared: PreparedOperationRun): OperationRunOutput {
  return {
    operationId: prepared.operationId,
    revision: prepared.revision,
    summary: stdout.text === ''
      ? 'operation completed without stdout'
      : stdout.truncated ? `operation completed; stdout truncated to ${prepared.resultBytes} UTF-8 bytes` : 'operation completed',
    ...(stdout.text === '' ? {} : { stdout }),
  }
}
function ownRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function requiredText(value: unknown, field: string): string { if (typeof value !== 'string' || value.trim() === '') throw configuration(`${field} must be a non-blank string`); return value }
function positiveInteger(value: unknown, field: string, max = Number.MAX_SAFE_INTEGER): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw configuration(`${field} must be a positive safe integer no greater than ${max}`); return value }
function sensitiveEnvironmentAssignment(value: string): boolean {
  const name = /^([A-Za-z_][A-Za-z0-9_]*)=/u.exec(value)?.[1]
  return name !== undefined
    && sensitiveEnvironmentName.test(name)
}
function credentialLiteral(value: string): boolean {
  return credentialLiteralPattern.test(value)
}
function sensitiveHeader(value: string): boolean {
  return /^\s*(?:authorization|x-api-key|api-key|x-auth-token)\s*:/iu.test(value) || /^\s*bearer\s+\S+/iu.test(value)
}
function networkCredentialCarrier(executable: string | undefined, value: string): boolean {
  if (/^--[_-]?auth[-_]?token(?:=|$)/iu.test(value) || /(?:^|[/:])_?auth[-_]?token$/iu.test(value)) return true
  if (executable === undefined || !/(?:^|[\\/])(?:curl|wget)(?:\.exe)?$/iu.test(executable)) return false
  return /^-u(?:$|.+)/u.test(value)
    || /^--(?:user|proxy[-_]?user|http[-_]?user|http[-_]?password|proxy[-_]?password)(?:=|$)/iu.test(value)
}
function credentialShapedArgv(argv: readonly string[]): boolean {
  const headerFlag = /^(?:-H|--header)$/u
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]
    if (value === undefined) continue
    if (sensitiveFlag.test(value) || networkCredentialCarrier(argv[0], value) || sensitiveEnvironmentAssignment(value)
      || credentialLiteral(value) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#\s]*@/u.test(value)) return true
    const headerValue = argv[index + 1]
    if (headerFlag.test(value) && headerValue !== undefined && sensitiveHeader(headerValue)) return true
    if (value.startsWith('--header=') && sensitiveHeader(value.slice('--header='.length))) return true
  }
  return false
}
function resolveConfig(config: Config): Readonly<Record<string, ResolvedOperationRun>> {
  if (!ownRecord(config) || !ownRecord(config.operations)) throw configuration('operations must be an object')
  const records: Record<string, ResolvedOperationRun> = Object.create(null) as Record<string, ResolvedOperationRun>
  const revisions = new Set<string>()
  for (const [operationId, candidate] of Object.entries(config.operations)) {
    if (operationId.trim() === '' || operationId !== operationId.trim() || !ownRecord(candidate)) {
      throw configuration('operation ids and definitions must be objects with non-blank, trimmed ids')
    }
    const allowed = new Set(['revision', 'description', 'argv', 'cwd', 'resource', 'units', 'maxAttempts', 'collectBytes', 'resultBytes', 'failureTailBytes', 'graceMs', 'timeoutMs'])
    if (Object.keys(candidate).some(key => !allowed.has(key))) throw configuration(`${operationId} contains an unsupported field`)
    if (!Array.isArray(candidate.argv) || candidate.argv.length === 0 || candidate.argv.some(value => typeof value !== 'string' || value.trim() === '')) {
      throw configuration(`${operationId}.argv must be a non-empty string array`)
    }
    if (credentialShapedArgv(candidate.argv)) throw configuration(`${operationId}.argv must not contain credential-shaped arguments`)
    const collectBytes = positiveInteger(candidate.collectBytes, 'collectBytes')
    const resultBytes = positiveInteger(candidate.resultBytes, 'resultBytes')
    const failureTailBytes = positiveInteger(candidate.failureTailBytes, 'failureTailBytes')
    if (resultBytes > collectBytes || failureTailBytes > collectBytes) throw configuration('resultBytes and failureTailBytes must not exceed collectBytes')
    const revision = requiredText(candidate.revision, 'revision')
    if (revisions.has(revision)) throw configuration(`duplicate revision ${JSON.stringify(revision)}`)
    revisions.add(revision)
    records[operationId] = Object.freeze({
      operationId,
      revision,
      argv: Object.freeze(Array.from(candidate.argv as string[])),
      cwd: requiredText(candidate.cwd, 'cwd'),
      resource: requiredText(candidate.resource, 'resource'),
      units: positiveInteger(candidate.units, 'units'),
      maxAttempts: positiveInteger(candidate.maxAttempts, 'maxAttempts'),
      collectBytes,
      resultBytes,
      failureTailBytes,
      graceMs: positiveInteger(candidate.graceMs, 'graceMs', MAX_TIMER_DELAY_MS),
      timeoutMs: positiveInteger(candidate.timeoutMs, 'timeoutMs', MAX_TIMER_DELAY_MS),
    })
    requiredText(candidate.description, 'description')
  }
  return Object.freeze(records)
}
/**
 * Build an operation handler from the host's closed allowlist.
 * @param config Host-owned allowlist and execution limits.
 * @param subprocess Runtime used to start only resolved allowlist entries.
 * @returns a handler that persists resolved operation facts before execution.
 */
export function createOperationRunHandler(config: Config, subprocess: Pick<SubprocessRuntime, 'spawn'>): WorkHandler<'operation.run@1'> {
  const operations = resolveConfig(config)
  return { kind: 'operation.run@1',
    resolveAdmission(input) {
      return Promise.resolve().then(() => {
        if (!ownRecord(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, 'operationId') || typeof input.operationId !== 'string') {
          throw admission('intent must contain only operationId')
        }
        const operationId = input.operationId.trim()
        if (!Object.hasOwn(operations, operationId)) throw admission(`unknown operationId ${JSON.stringify(operationId)}`)
        return operations[operationId] as ResolvedOperationRun
      })
    },
    resources(resolved) { return [{ resource: resolved.resource, units: resolved.units }] },
    policy(resolved) { return { maxAttempts: resolved.maxAttempts } },
    async prepare(resolved) {
      try {
        if (!(await stat(resolved.cwd)).isDirectory()) throw new Error('not a directory')
      } catch {
        throw new Error(`operation.run preparation: cwd is not an existing directory: ${resolved.cwd}`)
      }
      return resolved
    },
    start(prepared, context): LiveAttempt<'operation.run@1'> {
      let handle: SubprocessHandle
      try {
        handle = subprocess.spawn({
          argv: prepared.argv,
          cwd: prepared.cwd,
          stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: prepared.collectBytes } },
          graceMs: prepared.graceMs,
        } satisfies SubprocessSpawnSpec)
      } catch (error) {
        return {
          done: Promise.resolve({
            status: 'failed',
            failure: failure('operation-spawn', error instanceof Error ? error.message : 'operation spawn threw', 'not-started', true),
          }),
          cancel: async () => {},
        }
      }
      const stdout = new TextRetainer({ kind: 'head', maxBytes: prepared.resultBytes })
      let outputFailure: Error | undefined
      const stdoutObserved = new Promise<void>((resolve) => {
        if (handle.stdout === undefined) {
          outputFailure = new Error('operation stdout pipe is missing')
          resolve()
          return
        }
        handle.stdout.on('data', (chunk: Uint8Array) => stdout.push(chunk))
        handle.stdout.once('end', resolve)
        handle.stdout.once('error', (error) => {
          outputFailure = error instanceof Error ? error : new Error('operation stdout stream failed')
          resolve()
        })
      })
      let cause: Cause
      let termination: Promise<boolean> | undefined
      let treeWait: Promise<boolean> | undefined
      const waitForTree = (): Promise<boolean> => treeWait ??= handle.waitForExit()
      const terminateAndWait = (): Promise<boolean> => termination ??= (async () => {
        handle.terminate()
        const exited = await waitForTree()
        if (!exited) throw new Error('process tree did not quiesce')
        return true
      })()
      const request = (next: Exclude<Cause, undefined>): Promise<void> => {
        cause ??= next
        return terminateAndWait().then(() => {}, () => {})
      }
      const onAbort = () => { void request('canceled') }
      context.signal.addEventListener('abort', onAbort, { once: true })
      if (context.signal.aborted) onAbort()
      const timeout = setTimeout(() => { void request('timeout') }, prepared.timeoutMs)
      const done = (async () => {
        try {
          let exit: Awaited<SubprocessHandle['done']>
          try {
            exit = await handle.done
          } catch (error) {
            return { status: 'failed' as const, failure: failure('operation-spawn', error instanceof Error ? error.message : 'operation handle rejected', 'not-started', true) }
          }
          try {
            const quiescent = await waitForTree()
            if (!quiescent) return { status: 'unknown' as const, failure: failure('operation-quiescence', 'process tree did not quiesce', 'unknown') }
          } catch (error) {
            return { status: 'unknown' as const, failure: failure('operation-quiescence', error instanceof Error ? error.message : 'tree wait failed', 'unknown') }
          }
          await stdoutObserved
          if (cause === 'canceled') return { status: 'canceled' as const }
          if (cause === 'timeout') return { status: 'failed' as const, failure: failure('operation-timeout', `operation exceeded ${prepared.timeoutMs}ms`, 'started') }
          if (outputFailure !== undefined) return { status: 'unknown' as const, failure: failure('operation-output', outputFailure.message, 'unknown') }
          if (exit.exitCode !== 0) {
            const stderr = retained(
              handle.collected.stderr?.readFrom(0).text ?? '',
              'tail',
              prepared.failureTailBytes,
            ).text.trimEnd()
            const status = exit.exitCode === null ? exit.signal ?? 'unknown signal' : `code ${exit.exitCode}`
            return { status: 'failed' as const, failure: failure('operation-exit', `operation exited with ${status}${stderr === '' ? '' : `: ${stderr}`}`, 'started') }
          }
          const retainedStdout = stdout.finish()
          return {
            status: 'succeeded' as const,
            output: output({
              text: retainedStdout.text.replace(/(?:\r?\n)+$/u, ''),
              truncated: retainedStdout.truncated,
            }, prepared),
          }
        } finally {
          clearTimeout(timeout)
          context.signal.removeEventListener('abort', onAbort)
        }
      })()
      return { done, cancel: () => request('canceled') }
    },
  }
}
/** Register the allowlisted operation handler for this plugin lifetime. */
export function apply(ctx: Context, config: Config): void {
  const handler = createOperationRunHandler(config, ctx.subprocess)
  ctx.effect(
    () => ctx.taskQueue.registerHandler(handler),
    'operation-run-task-queue: register operation.run@1',
  )
}
