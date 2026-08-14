/**
 * The task-queue Service Definition (`ctx.taskQueue`). It owns the contract for
 * durable task admission, the two-phase state machine, the change-record schema,
 * and the executor registry. The durable backend lives in
 * `@deepseek-ai/dsh-task-queue-local`.
 * @module @deepseek-ai/dsh-task-queue
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  EnqueueSpec, ExecutorAdapter, ListFilter, NotificationId, NotificationRecord,
  QueueStats, Task, TaskId, TaskStatus, TaskSummary,
} from './types.ts'

export type {
  ChangeRecord,
  EnqueueSpec,
  ExecutorAdapter,
  ListFilter,
  NotificationRecord,
  QueueStats,
  RunRecord,
  ServiceState,
  Task,
  TaskResult,
  TaskStatus,
  TaskSummary,
} from './types.ts'
export {
  NotificationId,
  RunId,
  TaskId,
} from './brand.ts'
export {
  isTerminalStatus,
  createTask,
  claimTask,
  markRunning,
  settleSucceeded,
  settleFailed,
  requestStop,
  settleCanceled,
  cancelPending,
  retryTask,
  recoverTaskAfterCrash,
} from './transitions.ts'
export {
  canonicalJson,
  canonicalQueueState,
} from './canonical.ts'
export type { FoldedQueue } from './fold.ts'
export { foldChanges, applyChange } from './fold.ts'

/**
 * Event names published after the corresponding change is fsync'd and memory is
 * updated (spec §7.2). Names mirror the persistent ops one-to-one.
 */
export const TASK_QUEUE_EVENTS = {
  created: 'task-queue/created',
  starting: 'task-queue/starting',
  running: 'task-queue/running',
  succeeded: 'task-queue/succeeded',
  failed: 'task-queue/failed',
  requeued: 'task-queue/requeued',
  canceled: 'task-queue/canceled',
  drained: 'task-queue/drained',
  orphanUnknown: 'task-queue/orphan-unknown',
  faulted: 'task-queue/faulted',
} as const

declare module '@deepseek-ai/cordis' {
  interface Context {
    taskQueue: TaskQueue
  }

  interface Events {
    /**
     * A task's `created` change committed (fsync + fold before emission).
     * @param payload.taskId - the admitted task id.
     * @mode emit
     */
    'task-queue/created'(payload: { taskId: TaskId }): void
    /**
     * A task entered `starting` (attempt incremented).
     * @param payload.taskId - the claimed task id.
     * @param payload.attempt - the attempt ordinal that just started.
     * @mode emit
     */
    'task-queue/starting'(payload: { taskId: TaskId; attempt: number }): void
    /**
     * A task entered `running` (pid persisted).
     * @param payload.taskId - the spawned task id.
     * @mode emit
     */
    'task-queue/running'(payload: { taskId: TaskId }): void
    /**
     * A task settled successfully.
     * @param payload.taskId - the succeeded task id.
     * @mode emit
     */
    'task-queue/succeeded'(payload: { taskId: TaskId }): void
    /**
     * A task exhausted its attempts or failed without retry.
     * @param payload.taskId - the failed task id.
     * @param payload.reason - the failure summary.
     * @mode emit
     */
    'task-queue/failed'(payload: { taskId: TaskId; reason: string }): void
    /**
     * A failed attempt requeued to pending with backoff.
     * @param payload.taskId - the requeued task id.
     * @param payload.reason - the failure summary.
     * @mode emit
     */
    'task-queue/requeued'(payload: { taskId: TaskId; reason: string }): void
    /**
     * A task reached the canceled terminal state.
     * @param payload.taskId - the canceled task id.
     * @mode emit
     */
    'task-queue/canceled'(payload: { taskId: TaskId }): void
    /**
     * The queue drained (no live starting/running/stopping work remains).
     * @param payload.pending - the pending count at drain time.
     * @mode emit
     */
    'task-queue/drained'(payload: { pending: number }): void
    /**
     * A crash left a possibly-orphaned child or an unrecognized inbox entry.
     * @param payload.taskId - the recovered task id, when known.
     * @param payload.priorStatus - the pre-recovery status, when known.
     * @param payload.reason - the diagnostic detail, when known.
     * @mode emit
     */
    'task-queue/orphan-unknown'(payload: { taskId?: TaskId; priorStatus?: TaskStatus; reason?: string }): void
    /**
     * The queue entered `faulted`; operator recovery or restart required.
     * @param payload.reason - the fault summary.
     * @mode emit
     */
    'task-queue/faulted'(payload: { reason: string }): void
  }
}

/**
 * Abstract durable task queue. Subclass, implement the abstract methods, and
 * load the subclass as a plugin — it registers as `ctx.taskQueue` (one
 * implementation per context; loading a second throws, cordis' standard
 * duplicate-service behavior).
 *
 * Mutations are serialized through the backend's service FIFO and are
 * fail-closed on append error (the queue enters `faulted`); `resume()` must
 * never clear `faulted`. `source`/`receiptId` are assigned only by the trusted
 * entry points, so the tool-surface methods accept a spec without them.
 */
export abstract class TaskQueue extends Service {
  constructor(ctx: Context) {
    // `abstract` erases at runtime; fail loud at load rather than far from the
    // misconfiguration.
    if (new.target === TaskQueue) {
      throw new Error('@deepseek-ai/dsh-task-queue is the abstract task queue seam; load an implementation such as @deepseek-ai/dsh-task-queue-local instead')
    }
    super(ctx, 'taskQueue')
  }

  /**
   * Enqueue a single tool-originated task; rejects `executor: 'shell'`.
   * @param spec - the validated admission spec (source/receipt assigned by the entry).
   * @returns the minted task id.
   */
  abstract enqueueFromTool(spec: EnqueueSpec): Promise<TaskId>

  /**
   * Enqueue tool-originated tasks in one batch (bounded, e.g. 200).
   * @param specs - the validated admission specs; any `shell` rejects the whole batch.
   * @returns the minted task ids, in spec order.
   */
  abstract enqueueBatchFromTool(specs: EnqueueSpec[]): Promise<TaskId[]>

  /**
   * List summary projections, filtered by status/executor/tags, bounded by limit.
   * @param filter - optional status/executor/tags filters and a result limit.
   * @returns fresh summary rows.
   */
  abstract list(filter?: ListFilter): TaskSummary[]

  /**
   * Return the full durable state of one task.
   * @param id - the task id to look up.
   * @returns the durable task snapshot; throws for an unknown id.
   */
  abstract get(id: TaskId): Task

  /**
   * Cancel a task: pending → canceled; starting/running → stopping intent.
   * @param id - the task id to cancel.
   * @returns `canceled` for a directly-canceled pending task, `stopping` when a cancel intent was persisted.
   */
  abstract cancel(id: TaskId): Promise<'canceled' | 'stopping'>

  /**
   * Retry a failed task; returns the (unchanged) task id.
   * @param id - the failed task id to requeue.
   * @returns the same task id, now pending with `attempt` reset.
   */
  abstract retry(id: TaskId): Promise<TaskId>

  /**
   * Aggregate service state and per-status/per-executor counters.
   * @returns the current service state, optional fault, and counters.
   */
  abstract stats(): QueueStats

  /**
   * Register an executor adapter; returns a disposer that unregisters it.
   * @param name - the registry name tasks select with `executor`.
   * @param adapter - the prepare-only adapter producing spawn specs.
   * @returns a disposer removing exactly this registration.
   */
  abstract registerExecutor(name: string, adapter: ExecutorAdapter): () => void

  /**
   * Pause the queue (running → paused only).
   */
  abstract pause(): void

  /**
   * Resume the queue (paused → running only; faulted rejected).
   */
  abstract resume(): void

  /**
   * Acknowledge a pending notification with a CAS (spec §7.4): only a
   * `pending` record whose `messageId` matches `messageId` transitions to
   * `acknowledged`. An already-acknowledged record with a matching message id
   * is an idempotent no-op.
   * @param notificationId - the outbox record to acknowledge.
   * @param messageId - the stable message id the record must match.
   */
  abstract ackNotification(notificationId: NotificationId, messageId: string): Promise<void>

  /**
   * List notification outbox records for one owner session, ordered by
   * `terminalSeq` ascending. The pre-step hook consumes this to propose
   * candidate notice messages (spec §7.4 step 4).
   * @param filter.ownerSessionId - the session whose outbox records to list.
   * @returns the session's notification records in terminal order.
   */
  abstract listNotifications(filter: { ownerSessionId: string }): NotificationRecord[]
}

export default TaskQueue
