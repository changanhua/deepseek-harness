/** JSON-compatible value carried over the Queue Remote transport. */
export type QueueJsonValue = null | boolean | number | string | readonly QueueJsonValue[] | { readonly [key: string]: QueueJsonValue }
/** JSON wire projections for Queue v2 WorkItems. */
export type QueueWorkStatus = 'queued' | 'starting' | 'running' | 'unknown' | 'succeeded' | 'failed' | 'canceled'
/** Small operator-facing lifecycle projection; durable statuses stay internal. */
export type QueueTaskState = 'queued' | 'running' | 'attention' | 'done'
/** Terminal outcome carried only by a completed operator task. */
export type QueueTaskOutcome = 'succeeded' | 'failed' | 'canceled' | null
/** Browser-safe failure facts used when an operator confirms an unknown attempt failed. */
export interface QueueFailureInput {
  category: string
  message: string
  sideEffect: 'not-started' | 'started' | 'unknown'
  retriable: boolean
}
/** Operator action that resolves an unknown attempt without exposing persistence identifiers. */
export type QueueUnknownResolutionInput =
  | { kind: 'authorize-retry' }
  | { kind: 'confirm-failed'; failure: QueueFailureInput }
/** Compact Queue row returned to browser clients. */
export interface QueueWorkSummaryView {
  id: string
  kind: string
  title: string
  status: QueueWorkStatus
  state: QueueTaskState
  outcome: QueueTaskOutcome
  attemptCount: number
  maxAttempts: number
  batchId: string | null
  ownerSessionId: string | null
  createdAt: string
  updatedAt: string
}
/** Attempt projection embedded in WorkItem detail. */
export interface QueueWorkAttemptView {
  id: string
  ordinal: number
  status: string
  startedAt: string
  runningAt: string | null
  finishedAt: string | null
  failure: { category: string; message: string } | null
}
/** Detailed Queue WorkItem projection. */
export interface QueueWorkView extends QueueWorkSummaryView {
  failure: { category: string; message: string; sideEffect: string; retriable: boolean } | null
  attempts: QueueWorkAttemptView[]
  result: { id: string; output: QueueJsonValue; createdAt: string } | null
}
/** Aggregate Queue counters and dispatch pause state. */
export interface QueueStatsView { paused: boolean; byStatus: Record<QueueWorkStatus, number>; byKind: Record<string, number> }
/** Filters accepted by the snapshot Remote method. */
export interface QueueSnapshotInput { statuses?: QueueWorkStatus[]; limit?: number; detailId?: string }
/** Snapshot returned by one Remote read. */
export interface QueueSnapshotView { stats: QueueStatsView; rows: QueueWorkSummaryView[]; detail: QueueWorkView | null }
