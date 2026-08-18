/**
 * Durable-log folder: reduces an ordered stream of {@link ChangeRecord}s into
 * live queue state. Fail-closed per spec §4.1 — any seq gap/duplicate, state
 * mismatch, notification inconsistency, or ack mismatch throws; the folder
 * never skips a bad record.
 * @module @deepseek-ai/dsh-task-queue/fold
 */

import type {
  ChangeRecord, NotificationId, NotificationRecord, Task, TaskId,
} from './types.ts'

/**
 * Folded queue state: task states keyed by id, notification records keyed by
 * notification id, and the highest seq seen so far.
 */
export interface FoldedQueue {
  tasksById: Map<TaskId, Task>
  notificationsById: Map<NotificationId, NotificationRecord>
  lastSeq: number
}

/**
 * Fold `changes` into a fresh queue state, validating strict seq monotonicity
 * (`lastSeq + 1`), task-op identity, terminal notification consistency, and
 * CAS ack semantics. An empty input yields an empty queue with `lastSeq = 0`.
 * @param changes - the ordered change stream to fold.
 * @returns the folded queue state.
 */
export function foldChanges(changes: readonly ChangeRecord[]): FoldedQueue {
  const folded: FoldedQueue = { tasksById: new Map(), notificationsById: new Map(), lastSeq: 0 }
  for (const change of changes) {
    applyChange(folded, change)
  }
  return folded
}

/**
 * Apply a single validated change to `folded` in place (the incremental fold).
 * @param folded - the folded state to advance.
 * @param change - the change to apply; seq must be `folded.lastSeq + 1`.
 */
export function applyChange(folded: FoldedQueue, change: ChangeRecord): void {
  if (!Number.isSafeInteger(change.seq) || change.seq !== folded.lastSeq + 1) {
    throw new Error(`fold: seq ${change.seq} out of order; expected ${folded.lastSeq + 1}`)
  }
  if (change.version !== 1) {
    throw new Error(`fold: unsupported change version ${change.version}`)
  }

  if (change.op === 'notification-acknowledged') {
    applyAck(folded, change)
  } else {
    applyTaskOp(folded, change)
  }

  folded.lastSeq = change.seq
}

/** One task-op change: every non-ack record. */
type TaskChange = Exclude<ChangeRecord, { op: 'notification-acknowledged' }>

/**
 * Normalize a task entering the folded queue so `dismissed` is always a
 * defined boolean. `dismissed` (soft-conclude) was added to the persisted Task
 * state after the first releases, so logs and snapshots written before that
 * flag carry no value; folding it to the well-defined `false` (never
 * dismissed) prevents leaking `undefined` into projections, which the gateway
 * rejects as non-JSON-safe. Every task materialized into `folded.tasksById`
 * goes through this function, so all readers see a boolean.
 * @param state - the task state read from a change record or snapshot.
 * @returns the task with a defined `dismissed` field.
 */
export function materializeTask(state: Task): Task {
  return state.dismissed === undefined ? { ...state, dismissed: false } : state
}

function applyTaskOp(
  folded: FoldedQueue,
  change: TaskChange,
): void {
  if (change.state.id !== change.taskId) {
    throw new Error(`fold: task op ${change.op} state.id ${change.state.id} does not match change taskId ${change.taskId}`)
  }

  const { notification } = change
  if (notification !== undefined) {
    if (!isTerminalOp(change.op)) {
      throw new Error(`fold: non-terminal op ${change.op} must not carry a notification`)
    }
    if (notification.taskId !== change.taskId) {
      throw new Error(`fold: notification ${notification.notificationId} taskId ${notification.taskId} does not match change taskId ${change.taskId}`)
    }
    if (folded.notificationsById.has(notification.notificationId)) {
      throw new Error(`fold: duplicate notification id ${notification.notificationId}`)
    }
    folded.notificationsById.set(notification.notificationId, notification)
  }

  folded.tasksById.set(change.taskId, materializeTask(change.state))
}

function applyAck(
  folded: FoldedQueue,
  change: Extract<ChangeRecord, { op: 'notification-acknowledged' }>,
): void {
  const existing = folded.notificationsById.get(change.notificationId)
  if (existing === undefined) {
    throw new Error(`fold: ack references unknown notification ${change.notificationId}`)
  }
  if (existing.status === 'acknowledged') {
    // Idempotent no-op only when the expected message id matches; a mismatched
    // late ack must not confirm another terminal transition.
    if (existing.messageId !== change.expectedMessageId) {
      throw new Error(`fold: ack of acknowledged notification ${change.notificationId} has wrong messageId`)
    }
    return
  }
  if (existing.status !== change.expectedStatus) {
    throw new Error(`fold: ack expected status ${change.expectedStatus} but notification ${change.notificationId} is ${existing.status}`)
  }
  if (existing.messageId !== change.expectedMessageId) {
    throw new Error(`fold: ack messageId does not match notification ${change.notificationId}`)
  }
  if (change.state.notificationId !== change.notificationId) {
    throw new Error(`fold: ack state.notificationId ${change.state.notificationId} does not match notificationId ${change.notificationId}`)
  }
  folded.notificationsById.set(change.notificationId, change.state)
}

function isTerminalOp(op: string): boolean {
  return op === 'succeeded' || op === 'failed' || op === 'canceled'
}
