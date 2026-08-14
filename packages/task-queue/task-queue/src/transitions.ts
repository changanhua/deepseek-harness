/**
 * Pure state-machine transitions for a queued {@link Task}. Every function is
 * side-effect free and I/O free: it validates the pre-state, applies exactly
 * one transition, and returns a new task object (or `{ task, orphan }` for
 * crash recovery). An illegal transition throws.
 *
 * Attempt semantics (spec §3): `attempt` counts executed attempts and is
 * incremented ONCE, at claim (`pending → starting`). Failure requeues back to
 * `pending` with `attempt` unchanged; the next claim increments it again.
 * @module @deepseek-ai/dsh-task-queue/transitions
 */

import type { EnqueueSpec, RunId, Task, TaskResult } from './types.ts'

/** Default per-execution timeout (spec §3.2). */
const CREATE_TIMEOUT_MS = 1_800_000

/**
 * Build a fresh admitted `pending` task from a validated {@link EnqueueSpec}.
 * Pure: assigns defaults, timestamps, and the trusted `source`/`receiptId`.
 * @param id - backend-minted task id (`tq-<UUIDv4>`).
 * @param spec - validated admission spec.
 * @param source - trusted ingress origin (`tool` or `inbox`).
 * @param receiptId - admission idempotency key.
 * @param now - ISO timestamp for createdAt/updatedAt.
 * @returns the fresh `pending` task with attempt zero and no run records yet.
 */
export function createTask(
  id: Task['id'],
  spec: EnqueueSpec,
  source: Task['source'],
  receiptId: string,
  now: string,
): Task {
  return {
    id,
    title: spec.title,
    prompt: spec.prompt,
    executor: spec.executor,
    status: 'pending',
    priority: spec.priority ?? 10,
    attempt: 0,
    maxAttempts: spec.maxAttempts ?? 3,
    backoffMs: spec.backoffMs ?? 30_000,
    delayUntil: spec.delayUntil ?? null,
    timeoutMs: spec.timeoutMs ?? CREATE_TIMEOUT_MS,
    outputDir: spec.outputDir ?? `output/${id}`,
    tags: spec.tags ?? [],
    createdAt: now,
    updatedAt: now,
    lastError: null,
    result: null,
    ownerSessionId: spec.ownerSessionId ?? null,
    source,
    receiptId,
    terminalSeq: null,
    runs: [],
  }
}

/**
 * True when `status` is one of the three terminal states.
 * @param status - the task status to classify.
 * @returns `true` for `succeeded`/`failed`/`canceled`, otherwise `false`.
 */
export function isTerminalStatus(status: Task['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled'
}

/**
 * Claim a pending task for execution: the only point where `attempt` increments.
 * Legal only from `pending` with `attempt < maxAttempts`; pushes a fresh run
 * record with `pid: null` and transitions to `starting`.
 * @param task - the pending task to claim (must be `pending` with `attempt < maxAttempts`).
 * @param runId - the attempt-scoped run id for the new run record.
 * @param plannedStartedAt - ISO timestamp when this attempt was scheduled.
 * @param logPath - path of this attempt's run log.
 * @param commandFingerprint - fingerprint of the resolved command for diagnostics.
 * @returns a new `starting` task with `attempt` incremented and a fresh run record appended.
 */
export function claimTask(
  task: Task,
  runId: RunId,
  plannedStartedAt: string,
  logPath: string,
  commandFingerprint: string,
): Task {
  assertStatus(task, 'pending', 'claim')
  if (task.attempt >= task.maxAttempts) {
    throw new Error(`cannot claim task ${task.id}: attempt ${task.attempt} has reached maxAttempts ${task.maxAttempts}`)
  }
  const attempt = task.attempt + 1
  return {
    ...task,
    status: 'starting',
    attempt,
    updatedAt: plannedStartedAt,
    runs: [
      ...task.runs,
      {
        runId,
        attempt,
        pid: null,
        plannedStartedAt,
        actualStartedAt: null,
        logPath,
        commandFingerprint,
      },
    ],
  }
}

/**
 * Record the spawn: legal only from `starting`. Writes the pid and
 * `actualStartedAt` into the most recent run record and transitions to
 * `running`.
 * @param task - the `starting` task whose spawn just returned.
 * @param pid - the spawned child pid (diagnostic only, never a cross-restart token).
 * @param actualStartedAt - ISO timestamp when spawn actually returned.
 * @returns a new `running` task with `pid`/`actualStartedAt` on its last run record.
 */
export function markRunning(task: Task, pid: number, actualStartedAt: string): Task {
  assertStatus(task, 'starting', 'mark running')
  const runs = [...task.runs]
  const last = runs[runs.length - 1]
  if (last === undefined) throw new Error(`cannot mark ${task.id} running: no run record`)
  runs[runs.length - 1] = { ...last, pid, actualStartedAt }
  return { ...task, status: 'running', updatedAt: actualStartedAt, runs }
}

/**
 * Settle a running task successfully. Legal only from `running`. `terminalSeq`
 * is left null — the backend fills it when persisting the terminal change.
 * @param task - the `running` task to settle.
 * @param result - the success summary (exit code, signal, duration, output files).
 * @param now - ISO timestamp for `updatedAt`.
 * @returns a new `succeeded` task carrying `result` and `terminalSeq: null`.
 */
export function settleSucceeded(task: Task, result: TaskResult, now: string): Task {
  assertStatus(task, 'running', 'settle succeeded')
  return { ...task, status: 'succeeded', result, lastError: null, updatedAt: now, terminalSeq: null }
}

/**
 * Settle a failed run. Legal only from `running`. If `attempt >= maxAttempts`
 * the task is exhausted (`failed`); otherwise it requeues to `pending` with a
 * backoff delay `backoffMs * 2^(attempt-1)` from `now`, `attempt` unchanged.
 * @param task - the `running` task whose attempt failed.
 * @param error - the failure reason recorded into `lastError`.
 * @param now - ISO timestamp for `updatedAt` and the backoff delay base.
 * @returns a new `failed` task when attempts are exhausted, else a `pending` task with a backoff delay.
 */
export function settleFailed(task: Task, error: string, now: string): Task {
  assertStatus(task, 'running', 'settle failed')
  const lastError = error === '' ? 'task failed' : error
  if (task.attempt >= task.maxAttempts) {
    return { ...task, status: 'failed', lastError, updatedAt: now, terminalSeq: null }
  }
  const delayUntil = new Date(Date.parse(now) + task.backoffMs * 2 ** (task.attempt - 1)).toISOString()
  return { ...task, status: 'pending', lastError, delayUntil, updatedAt: now, terminalSeq: null }
}

/**
 * Record a cancel intent on live work. Legal from `starting` or `running`;
 * transitions to `stopping` and records the cancel reason in `lastError`.
 * @param task - the `starting` or `running` task to cancel.
 * @param reason - the cancel reason recorded into `lastError`.
 * @param now - ISO timestamp for `updatedAt`.
 * @returns a new `stopping` task carrying the cancel reason.
 */
export function requestStop(task: Task, reason: string, now: string): Task {
  assertStatus(task, 'stopping-intent', 'request stop')
  return { ...task, status: 'stopping', lastError: reason, updatedAt: now }
}

/**
 * Settle a stopped task as canceled. Legal only from `stopping`.
 * @param task - the `stopping` task to finalize.
 * @param now - ISO timestamp for `updatedAt`.
 * @returns a new `canceled` task with `terminalSeq: null`.
 */
export function settleCanceled(task: Task, now: string): Task {
  assertStatus(task, 'stopping', 'settle canceled')
  return { ...task, status: 'canceled', updatedAt: now, terminalSeq: null }
}

/**
 * Cancel a still-pending task. Legal only from `pending`; transitions directly
 * to `canceled`.
 * @param task - the `pending` task to cancel.
 * @param reason - the cancel reason recorded into `lastError`.
 * @param now - ISO timestamp for `updatedAt`.
 * @returns a new `canceled` task carrying the cancel reason.
 */
export function cancelPending(task: Task, reason: string, now: string): Task {
  assertStatus(task, 'pending', 'cancel pending')
  return { ...task, status: 'canceled', lastError: reason, updatedAt: now, terminalSeq: null }
}

/**
 * Manually retry a failed task. Legal only from `failed`; resets `attempt` to
 * zero, clears the backoff delay and last error, and requeues to `pending`.
 * @param task - the `failed` task to retry.
 * @param now - ISO timestamp for `updatedAt`.
 * @returns a new `pending` task with `attempt` zero and cleared error/delay.
 */
export function retryTask(task: Task, now: string): Task {
  assertStatus(task, 'failed', 'retry')
  return {
    ...task,
    status: 'pending',
    attempt: 0,
    delayUntil: null,
    lastError: null,
    updatedAt: now,
    terminalSeq: null,
  }
}

/**
 * Crash-recovery fold (spec §4.3): the host died with no live handle, so no pid
 * is ever signaled. Returns the recovered task plus an `orphan` flag indicating
 * a possible orphaned child should be surfaced (`orphan-unknown`).
 *
 * - starting/running → attempt >= maxAttempts ? `failed` : `pending`
 *   (`attempt` unchanged), orphan: true
 * - stopping → `canceled` with the last run record marked
 *   `terminationUnverified: true`, orphan: true
 * - any other status → returned unchanged, orphan: false
 * @param task - the task to recover after an ungraceful host crash.
 * @param now - ISO timestamp for `updatedAt` when a transition is applied.
 * @returns the recovered task plus an `orphan` flag signaling a possible orphaned child.
 */
export function recoverTaskAfterCrash(task: Task, now: string): { task: Task; orphan: boolean } {
  if (task.status === 'starting' || task.status === 'running') {
    const recovered: Task = task.attempt >= task.maxAttempts
      ? { ...task, status: 'failed', lastError: 'host crashed before settlement; attempt outcome unknown', updatedAt: now, terminalSeq: null }
      : { ...task, status: 'pending', lastError: 'host crashed before settlement; attempt outcome unknown', delayUntil: null, updatedAt: now, terminalSeq: null }
    return { task: recovered, orphan: true }
  }
  if (task.status === 'stopping') {
    const runs = [...task.runs]
    const last = runs[runs.length - 1]
    if (last !== undefined) runs[runs.length - 1] = { ...last, terminationUnverified: true }
    return {
      task: { ...task, status: 'canceled', runs, updatedAt: now, terminalSeq: null },
      orphan: true,
    }
  }
  return { task, orphan: false }
}

/** Throw unless `task.status` equals `expected`, for transition `op`. */
function assertStatus(task: Task, expected: 'pending' | 'starting' | 'running' | 'stopping' | 'failed' | 'stopping-intent', op: string): void {
  const matches = expected === 'stopping-intent'
    ? task.status === 'starting' || task.status === 'running'
    : task.status === expected
  if (!matches) {
    throw new Error(`cannot ${op} task ${task.id}: expected ${expected}, got ${task.status}`)
  }
}
