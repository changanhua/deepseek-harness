/**
 * Wire views of the durable task queue for the browser panel: plain JSON
 * projections of the {@link TaskQueue} Service seam's read shapes. This leaf
 * imports nothing from the host face — a Client program resolves it directly
 * (the package root reaches `@deepseek-ai/dsh-subprocess` through the executor
 * adapter signature, which a browser compile face cannot load). The service
 * maps the branded host types onto these views at the wire boundary.
 * @module @deepseek-ai/dsh-task-queue-remote/views
 */

/**
 * Task lifecycle projection, mirroring the Service seam's canonical statuses.
 */
export type QueueTaskStatus =
  | 'pending'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'succeeded'
  | 'failed'
  | 'canceled'

/**
 * List filter accepted by the panel's list view.
 */
export interface QueueListFilterView {
  status?: QueueTaskStatus
  executor?: string
  tags?: string[]
  limit?: number
}

/**
 * One summary row, exactly the Service seam's {@link TaskSummary} minus the
 * branded id (a plain `tq-<uuid>` string on the wire).
 */
export interface QueueTaskSummaryView {
  id: string
  title: string
  executor: string
  status: QueueTaskStatus
  priority: number
  attempt: number
  maxAttempts: number
  createdAt: string
  updatedAt: string
  tags: string[]
  ownerSessionId: string | null
  /** Soft-conclude flag: a dismissed terminal task leaves attention but keeps its record. */
  dismissed: boolean
}

/**
 * Success summary of a settled task, projected from {@link TaskResult}.
 */
export interface QueueTaskResultView {
  /** Exit code; null when the process died from a signal. */
  exitCode: number | null
  /** Terminating signal; null on normal exit. */
  signal: string | null
  /** Execution duration in milliseconds. */
  durationMs: number
  /** Paths of produced artifacts, relative to the output directory. */
  outputFiles: string[]
}

/**
 * One durable execution attempt, projected from {@link RunRecord}; the pid is
 * diagnostic only, never a cross-restart termination token.
 */
export interface QueueRunView {
  runId: string
  attempt: number
  pid: number | null
  plannedStartedAt: string | null
  actualStartedAt: string | null
  logPath: string | null
  commandFingerprint: string | null
  /** Set on crash recovery when a stopping task cannot verify termination. */
  terminationUnverified: boolean
}

/**
 * The full durable state of one task, projected from {@link Task} for the
 * panel's detail view.
 */
export interface QueueTaskView extends QueueTaskSummaryView {
  prompt: string
  backoffMs: number
  delayUntil: string | null
  timeoutMs: number
  outputDir: string
  lastError: string | null
  result: QueueTaskResultView | null
  source: 'tool' | 'inbox'
  receiptId: string
  runs: QueueRunView[]
}

/**
 * One executor's panel view: registration/enable gates plus the number of
 * currently live tasks (starting/running/stopping) using that executor.
 */
export interface QueueExecutorView {
  name: string
  enabled: boolean
  toolAllowed: boolean
  running: number
}

/**
 * Aggregate service state and counters, projected from {@link QueueStats}.
 * `faulted` is sticky and never clears through the panel.
 */
export interface QueueStatsView {
  serviceState: 'running' | 'paused' | 'faulted'
  fault: { reason: string } | null
  byStatus: Record<QueueTaskStatus, number>
  byExecutor: Record<string, number>
  /** Count of failed tasks not yet dismissed — drives the attention badge. */
  undismissedFailed: number
  /** Count of dismissed terminal tasks — drives the "Dismissed" filter badge. */
  byDismissed: number
}

/**
 * Cancel outcome: a pending task settles directly; live work records the
 * stopping intent and settles later.
 */
export type QueueCancelOutcomeView = 'canceled' | 'stopping'
