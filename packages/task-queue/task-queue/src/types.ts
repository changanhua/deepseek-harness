/**
 * Task-queue vocabulary shared by producers, the scheduler, the durable back
 * end, and the Service seam. The service implementation contract lives in
 * `./index.ts`; the transition functions live in `./transitions.ts`.
 * @module @deepseek-ai/dsh-task-queue/types
 */

import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { NotificationId, RunId, TaskId } from './brand.ts'

export { NotificationId, RunId, TaskId } from './brand.ts'

/**
 * Task lifecycle: `pending` absorbs claim/requeue; `starting`/`running` are the
 * two-phase execution side-effect states (intent persisted before the spawn);
 * `stopping` is the cancel-intent state for live work; `succeeded`/`failed`/
 * `canceled` are the terminal states.
 */
export type TaskStatus =
  | 'pending'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'succeeded'
  | 'failed'
  | 'canceled'

/**
 * Success summary attached to a settled task. `exitCode`/`signal` mirror the
 * subprocess outcome; `durationMs` is the wall-clock execution span.
 */
export interface TaskResult {
  /** Exit code; null when the process died from a signal. */
  exitCode: number | null
  /** Terminating signal; null on normal exit. */
  signal: string | null
  /** Execution duration in milliseconds. */
  durationMs: number
  /** Paths of produced artifacts, relative to the output directory. */
  outputFiles?: string[]
}

/**
 * One durable execution attempt. A fresh record is pushed when the task is
 * claimed (`pending → starting`); its pid is written only on the
 * `starting → running` transition, and is diagnostic only — never a
 * cross-restart termination token.
 */
export interface RunRecord {
  /** The attempt-scoped run id. */
  runId: RunId
  /** The attempt ordinal this record describes (1-based). */
  attempt: number
  /** Child pid once spawned; null while starting. Diagnostic only. */
  pid: number | null
  /** ISO timestamp when the attempt was scheduled to start. */
  plannedStartedAt: string | null
  /** ISO timestamp when spawn actually returned; null until running. */
  actualStartedAt: string | null
  /** Path to this attempt's run log (`runs/<taskId>/run-<attempt>.log`). */
  logPath: string | null
  /** Fingerprint of the resolved command, for diagnostic correlation. */
  commandFingerprint: string | null
  /** Set on crash recovery when a stopping task cannot verify termination. */
  terminationUnverified?: boolean
}

/**
 * The full durable task state, opaque to producers and surfaced read-only to
 * tools through {@link TaskSummary}. `source`/`receiptId` are assigned only by
 * the trusted admission entry points; callers never provide them.
 */
export interface Task {
  id: TaskId
  title: string
  prompt: string
  executor: string
  status: TaskStatus
  priority: number
  attempt: number
  maxAttempts: number
  backoffMs: number
  delayUntil: string | null
  timeoutMs: number
  outputDir: string
  tags: string[]
  createdAt: string
  updatedAt: string
  lastError: string | null
  result: TaskResult | null
  ownerSessionId: string | null
  source: 'tool' | 'inbox'
  receiptId: string
  terminalSeq: number | null
  runs: RunRecord[]
  /** Soft-conclude flag: a dismissed terminal task leaves the attention badge/filters but keeps its record; reset to false on requeue. */
  dismissed: boolean
}

/**
 * One durable notification outbox record, folded independently of the task so a
 * retry never clobbers a pending notification. `status` and `acknowledgedAt`
 * update only through a CAS ack change.
 */
export interface NotificationRecord {
  notificationId: NotificationId
  taskId: TaskId
  runId: RunId
  attempt: number
  terminalSeq: number
  ownerSessionId: string
  messageId: string
  status: 'pending' | 'acknowledged'
  acknowledgedAt: string | null
}

/**
 * The change-record union persisted to the segment log and folded into queue
 * state. Task ops carry a full post-op snapshot (including run records); an
 * owned terminal task op atomically creates its notification. The ack op is a
 * CAS on a pending notification.
 */
export type ChangeRecord =
  | {
    seq: number
    version: 1
    op: 'created' | 'starting' | 'running' | 'stopping' | 'succeeded' | 'failed' | 'requeued' | 'canceled' | 'dismissed'
    taskId: TaskId
    state: Task
    notification?: NotificationRecord
    at: string
  }
  | {
    seq: number
    version: 1
    op: 'notification-acknowledged'
    notificationId: NotificationId
    expectedStatus: 'pending'
    expectedMessageId: string
    state: NotificationRecord
    at: string
  }

/**
 * Read-only projection returned by `list`, deliberately stripping the prompt,
 * run records, and notify details so tools receive only audit-and-filter facts.
 */
export interface TaskSummary {
  id: TaskId
  title: string
  executor: string
  status: TaskStatus
  priority: number
  attempt: number
  maxAttempts: number
  createdAt: string
  updatedAt: string
  lastError: string | null
  tags: string[]
  ownerSessionId: string | null
  /** Soft-conclude flag projected from {@link Task.dismissed}. */
  dismissed: boolean
}

/**
 * Task admission spec passed to the trusted entry points. `source` and
 * `receiptId` are intentionally absent — only the entry code assigns them.
 */
export interface EnqueueSpec {
  title: string
  prompt: string
  executor: string
  priority?: number
  maxAttempts?: number
  backoffMs?: number
  delayUntil?: string
  timeoutMs?: number
  outputDir?: string
  tags?: string[]
  ownerSessionId?: string
  idempotencyKey?: string
}

/** Filter projection for {@link TaskQueue.list}. */
export interface ListFilter {
  status?: TaskStatus
  executor?: string
  tags?: string[]
  limit?: number
}

/**
 * Aggregate counters reported by {@link TaskQueue.stats}, alongside the
 * service-level run state which is independent of per-task status.
 */
export interface QueueStats {
  serviceState: ServiceState
  fault?: { reason: string }
  byStatus: Record<TaskStatus, number>
  byExecutor: Record<string, number>
  /** Count of failed tasks not yet dismissed — drives the attention badge. */
  undismissedFailed: number
  /** Count of dismissed terminal tasks — drives the "Dismissed" filter badge. */
  byDismissed: number
}

/**
 * Service-level run state, independent of task status: `faulted` persists until
 * a successful log redetermination or operator recovery + restart; `resume()`
 * must reject a `faulted` queue.
 */
export type ServiceState = 'running' | 'paused' | 'faulted'

/**
 * One registered executor as exposed to the model-facing tools. `enabled`
 * reports the deployment gate for the built-in adapters; `toolAllowed` marks
 * inbox-only executors that the model tools must refuse to submit.
 */
export interface QueueExecutorView {
  /** Executor registry name tasks select with `executor`. */
  name: string
  /** Whether this deployment currently admits tasks for the executor. */
  enabled: boolean
  /** Whether the model-facing tools may submit this executor (`false` for `shell`). */
  toolAllowed: boolean
}

/**
 * A pluggable executor. It only produces a fully-specified spawn request; the
 * scheduler is the sole spawn/terminate/waitForExit owner and passes the
 * attempt-scoped abort signal to constrain both `prepare` and the eventual
 * spawn.
 */
export type ExecutorAdapter = {
  prepare(task: Task, run: RunRecord, signal: AbortSignal): Promise<SubprocessSpawnSpec>
}
