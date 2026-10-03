/** Host protocol ownership. Role reports remain untrusted even after an orderly exchange. */
import type { GuardedModelResult } from './broker.ts'
import type { RoleChannel, RoleFrame } from './channel.ts'
import type { WindowsRoleProcess } from './windows.ts'
import type { RoleObserver } from './observer.ts'
import type { IsolatedTaskResult } from './task.ts'

const ownedChannels = new WeakSet<RoleChannel>()

/** Only a Host-created broker can supply model authority; no authority is recovered from a frame. */
export interface RoleProtocolBinding {
  readonly sessionId: string
  readonly maxRequests: number
  readonly model: (input: unknown, signal: AbortSignal) => Promise<GuardedModelResult>
  /** Interrupt model work while keeping the protocol alive for the role's flush/close response. */
  readonly cancelSignal?: AbortSignal
  /** Pinned-core provenance; absent only for raw transport diagnostics. */
  readonly observer?: RoleObserver
  /** Remove the private startup carrier before the core may deliver input to its Agent. */
  readonly ready?: (observation: unknown) => Promise<void>
  /** Validate a fresh authenticated capability observation before every model request. */
  readonly observe?: (observation: unknown) => void | Promise<void>
  readonly task?: (source: string, signal: AbortSignal) => Promise<IsolatedTaskResult>
}

/** Raw reports require an independent observer; reported is deliberately not completed. */
export interface RoleProtocolResult {
  readonly status: 'reported' | 'invalid' | 'uncertain' | 'canceled'
  readonly reason: string | null
  readonly rawReports: { readonly ready: unknown
    readonly complete: unknown }
  readonly accounting: readonly GuardedModelResult[]
  readonly observations: readonly unknown[]
  readonly tasks: readonly IsolatedTaskResult[]
}

/**
 * Own one sequential ready/model/complete conversation, with no replay of a dispatched request.
 * @param channel Host-held original channel handles; caller closes only after process quiescence.
 * @param binding Exact Host session, finite exchange bound and Budget-guarded model broker.
 * @param signal Owning execution deadline/cancellation, also propagated to an active model request.
 * @returns Raw role reports and Host accounting. This is neither a Manifest nor process-exit proof.
 */
export async function runRoleProtocol(channel: RoleChannel, binding: RoleProtocolBinding,
  signal: AbortSignal): Promise<RoleProtocolResult> {
  const { sessionId, maxRequests, model } = binding
  if (!sessionId || !Number.isSafeInteger(maxRequests) || maxRequests < 2) throw new Error('eval-role-invalid-bound')
  if (ownedChannels.has(channel)) throw new Error('eval-role-channel-already-owned')
  ownedChannels.add(channel)
  let ready: unknown = null, complete: unknown = null
  const send = (frame: RoleFrame) => channel.send(binding.observer ? binding.observer.respond(frame) : frame)
  const accounting: GuardedModelResult[] = []
  const observations: unknown[] = []
  const tasks: IsolatedTaskResult[] = []
  const result = (status: RoleProtocolResult['status'], reason: string | null): RoleProtocolResult => ({
    status, reason, rawReports: { ready, complete }, accounting, observations, tasks,
  })
  let inModel = false
  const state: { terminal?: { status: 'invalid' | 'uncertain'; reason: string | null } } = {}
  const isTerminal = () => !!state.terminal
  const observe = async (value: unknown) => {
    try { await binding.observe?.(value) }
    catch (error) {
      if (!(error instanceof Error) || error.message !== 'eval-role-identity-mismatch') throw error
      state.terminal = { status: 'invalid', reason: error.message }
      await channel.requestCancellation()
    }
  }
  try {
    for (let sequence = 1; sequence <= maxRequests; sequence++) {
      const received = await channel.receive(sequence, signal)
      const frame = binding.observer ? binding.observer.accept(received) : received
      if (sequence === 1) {
        if (frame.kind !== 'ready' || !hasSession(frame.value, sessionId)) return result('invalid', 'eval-role-protocol-invalid')
        ready = frame.value
        observations.push(ready)
        await binding.ready?.(ready)
        await observe(ready)
        await send({ sequence, kind: 'ready-result', value: state.terminal ? { canceled: true } : null })
      } else if (frame.kind === 'model') {
        if (state.terminal) return result(state.terminal.status, state.terminal.reason)
        let input = frame.value
        if (binding.observer) {
          if (!input || typeof input !== 'object' || !('observation' in input) || !('request' in input)) return result('invalid', 'eval-role-protocol-invalid')
          observations.push(input.observation)
          await observe(input.observation)
          input = input.request
        }
        if (isTerminal()) {
          await send({ sequence, kind: 'model-result', value: [{ type: 'finish', reason: { kind: 'error',
            failure: { code: 'EVAL_IDENTITY_MISMATCH', message: 'Execution identity changed.' } } }] })
          continue
        }
        inModel = true
        const response = await model(input, binding.cancelSignal ? AbortSignal.any([signal, binding.cancelSignal]) : signal)
        inModel = false
        accounting.push(response)
        if (response.status !== 'settled') {
          state.terminal = { status: response.status === 'denied' ? 'invalid' : 'uncertain', reason: response.reason }
          await channel.requestCancellation()
          await send({ sequence, kind: 'model-result', value: [{ type: 'finish', reason: { kind: 'error',
            failure: { code: 'EVAL_MODEL_STOPPED', message: 'Model execution stopped.' } } }] })
          continue
        }
        signal.throwIfAborted()
        await send({ sequence, kind: 'model-result', value: response.chunks })
      } else if (frame.kind === 'task' && binding.task && !state.terminal) {
        if (typeof frame.value !== 'string') return result('invalid', 'eval-role-protocol-invalid')
        const task = await binding.task(frame.value, binding.cancelSignal ? AbortSignal.any([signal, binding.cancelSignal]) : signal)
        tasks.push(task)
        if (task.status === 'uncertain') {
          state.terminal = { status: 'uncertain', reason: 'eval-role-task-uncertain' }
          await channel.requestCancellation()
        }
        await send({ sequence, kind: 'task-result', value: task })
      } else if (frame.kind === 'complete' && hasSession(frame.value, sessionId) && frame.value.flushed === true
        && typeof frame.value.output === 'string') {
        complete = frame.value
        if (binding.observer) {
          if (!('observation' in frame.value)) return result('invalid', 'eval-role-protocol-invalid')
          observations.push(frame.value.observation)
          await observe(frame.value.observation)
        }
        await send({ sequence, kind: 'complete-result', value: null })
        return state.terminal ? result(state.terminal.status, state.terminal.reason)
          : binding.cancelSignal?.aborted ? result('canceled', 'eval-role-canceled') : result('reported', null)
      } else return result('invalid', 'eval-role-protocol-invalid')
    }
    return state.terminal ? result(state.terminal.status, state.terminal.reason) : result('invalid', 'eval-role-request-bound')
  } catch (error) {
    // An exception during dispatch can mean an unaccounted remote effect, including abort races.
    if (state.terminal) return result(state.terminal.status, state.terminal.reason)
    if (inModel) return result('uncertain', 'eval-role-model-uncertain')
    if (signal.aborted) return result('canceled', 'eval-role-canceled')
    if (error instanceof SyntaxError || error instanceof Error && ['eval-channel-sequence-mismatch',
      'eval-channel-invalid-frame', 'eval-channel-capacity', 'eval-observer-signature', 'eval-observer-replay'].includes(error.message)) return result('invalid', 'eval-role-protocol-invalid')
    if (error instanceof Error && error.message === 'eval-role-identity-mismatch') return result('invalid', error.message)
    return result('uncertain', 'eval-role-transport-uncertain')
  }
}

function hasSession(value: unknown, sessionId: string): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && 'sessionId' in value && value.sessionId === sessionId
}

/** Process ownership outcome; unknown quiescence requires retaining the boundary and workspace. */
export interface SupervisedRoleResult {
  readonly status: 'reported' | 'invalid' | 'uncertain' | 'canceled'
  readonly reason: string | null
  readonly quiescent: boolean
  readonly exitCode: number | null
  readonly protocol: RoleProtocolResult | null
}

/**
 * Join protocol, broker and Windows Job ownership before a caller can release the role world.
 * @param process Already-launched role Job, exclusively owned by this operation.
 * @param channel Original Host file handles, retained by the caller on unknown quiescence.
 * @param binding Host-owned session and model broker.
 * @param limits Finite execution and forced-stop deadlines in milliseconds.
 * @param signal Caller cancellation starts graceful shutdown before the finite forced-stop deadline.
 * @returns Observed process exit and raw reports. Even reported still needs independent identity/evidence verification.
 */
export async function superviseRoleProcess(process: WindowsRoleProcess, channel: RoleChannel,
  binding: RoleProtocolBinding, limits: { readonly executionMs: number
    readonly graceMs: number
    readonly stopMs: number },
  signal: AbortSignal): Promise<SupervisedRoleResult> {
  for (const value of [limits.executionMs, limits.graceMs, limits.stopMs]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('eval-role-invalid-bound')
  }
  if (ownedChannels.has(channel)) throw new Error('eval-role-channel-already-owned')
  const lifecycle = new AbortController()
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(limits.executionMs)])
  const lifecycleState = { forced: false }
  let stopTimer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    lifecycleState.forced = true
    lifecycle.abort()
    try { process.terminate() } catch { /* wait remains the authority for process-tree quiescence. */ }
  }
  let cancellationWrite: Promise<void> | undefined
  const cancel = () => {
    if (cancellationWrite) return
    cancellationWrite = channel.requestCancellation().catch(() => { stop() })
    stopTimer = setTimeout(stop, limits.graceMs)
  }
  deadline.addEventListener('abort', cancel, { once: true })
  if (deadline.aborted) cancel()
  try {
    const protocol = runRoleProtocol(channel, { ...binding, cancelSignal: deadline }, lifecycle.signal).then((value) => {
      if (value.rawReports.complete === null) stop()
      return value
    }, () => { stop(); return null })
    let exitCode: number | null = null
    try { exitCode = await process.wait(limits.executionMs + limits.graceMs) }
    catch {
      stop()
      try { exitCode = await process.wait(limits.stopMs) } catch { /* Retain the unresolved Job and lease. */ }
    }
    lifecycle.abort()
    const observed = await protocol
    const base = { quiescent: exitCode !== null, exitCode, protocol: observed }
    if (exitCode === null) return { ...base, status: 'uncertain', reason: 'eval-role-quiescence-uncertain' }
    if (observed?.status === 'uncertain') return { ...base, status: 'uncertain', reason: observed.reason }
    if (lifecycleState.forced && (observed?.rawReports.complete !== null || deadline.aborted)) return { ...base, status: 'uncertain', reason: 'eval-role-forced-stop' }
    if (observed?.status === 'invalid') return { ...base, status: 'invalid', reason: observed.reason }
    if (exitCode === 0 && observed?.status === 'canceled' && observed.rawReports.complete !== null) return { ...base, status: 'canceled', reason: 'eval-role-canceled' }
    if (exitCode !== 0 || observed?.status !== 'reported') return { ...base, status: 'uncertain', reason: 'eval-role-exit-without-completion' }
    return { ...base, status: 'reported', reason: null }
  } finally {
    deadline.removeEventListener('abort', cancel)
    if (stopTimer) clearTimeout(stopTimer)
    await cancellationWrite
  }
}
