/**
 * The browser panel's Host remote face over the durable task queue: a thin
 * Typert Remote service exposing the read shapes (list/stats/get), the two
 * high-frequency steering verbs (cancel/retry), and the service-level
 * pause/resume switch of `ctx.taskQueue` as plain JSON wire views. The Client
 * reaches it as `ctx.remote.taskQueue` — the wire namespace — while the
 * Service key stays `taskQueueRemote` so it never collides with the queue
 * backend itself. Enqueue, executor registration, and notification acks are
 * deliberately NOT exposed: those are tool- and operator-bound surfaces.
 * @module @deepseek-ai/dsh-task-queue-remote
 */

import { Context } from '@deepseek-ai/cordis'
import { TaskId } from '@deepseek-ai/dsh-task-queue'
import type {
  TaskQueue,
  TaskSummary,
} from '@deepseek-ai/dsh-task-queue'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  QueueCancelOutcomeView,
  QueueListFilterView,
  QueueStatsView,
  QueueTaskSummaryView,
  QueueTaskView,
} from './views.ts'

export type {
  QueueCancelOutcomeView,
  QueueListFilterView,
  QueueRunView,
  QueueStatsView,
  QueueTaskResultView,
  QueueTaskStatus,
  QueueTaskSummaryView,
  QueueTaskView,
} from './views.ts'

/** The panel remote's configuration (reserved; the surface needs none today). */
export type Config = Record<string, never>

/** Project one summary row onto its wire view. */
function toSummaryView(task: TaskSummary): QueueTaskSummaryView {
  return {
    id: task.id,
    title: task.title,
    executor: task.executor,
    status: task.status,
    priority: task.priority,
    attempt: task.attempt,
    maxAttempts: task.maxAttempts,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    tags: [...task.tags],
    ownerSessionId: task.ownerSessionId,
  }
}

/** Host service: the browser panel's Remote contribution over ctx.taskQueue. */
export class TaskQueueRemoteService extends TypertRemoteService {
  static inject = ['taskQueue']

  private readonly queue: TaskQueue

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'taskQueueRemote', { namespace: 'taskQueue' })
    void config
    // `inject` guarantees the queue backend is live before this service
    // activates; the seam methods are the only reads/writes used below.
    this.queue = ctx.taskQueue
  }

  /**
   * List summary projections, filtered by status/executor/tags, bounded by limit.
   * @param filter - optional status/executor/tags filters and a result limit.
   * @returns fresh summary rows as wire views.
   */
  @Remote('list')
  list(filter?: QueueListFilterView): QueueTaskSummaryView[] {
    // The wire filter mirrors the seam's ListFilter one-to-one.
    return this.queue.list(filter).map(toSummaryView)
  }

  /**
   * Return the full durable state of one task as its wire view.
   * @param id - the task id (`tq-<uuid>`).
   * @returns the projected durable snapshot; throws for an unknown id.
   */
  @Remote('get')
  get(id: string): QueueTaskView {
    const task = this.queue.get(TaskId(id))
    return {
      ...toSummaryView(task),
      prompt: task.prompt,
      backoffMs: task.backoffMs,
      delayUntil: task.delayUntil,
      timeoutMs: task.timeoutMs,
      outputDir: task.outputDir,
      lastError: task.lastError,
      result: task.result === null ? null : {
        exitCode: task.result.exitCode,
        signal: task.result.signal,
        durationMs: task.result.durationMs,
        outputFiles: [...task.result.outputFiles ?? []],
      },
      source: task.source,
      receiptId: task.receiptId,
      runs: task.runs.map(run => ({
        runId: run.runId,
        attempt: run.attempt,
        pid: run.pid,
        plannedStartedAt: run.plannedStartedAt,
        actualStartedAt: run.actualStartedAt,
        logPath: run.logPath,
        commandFingerprint: run.commandFingerprint,
        terminationUnverified: run.terminationUnverified === true,
      })),
    }
  }

  /**
   * Aggregate service state and per-status/per-executor counters.
   * @returns the current service state, optional fault, and counters.
   */
  @Remote('stats')
  stats(): QueueStatsView {
    const stats = this.queue.stats()
    return {
      serviceState: stats.serviceState,
      fault: stats.fault === undefined ? null : { reason: stats.fault.reason },
      byStatus: { ...stats.byStatus },
      byExecutor: { ...stats.byExecutor },
    }
  }

  /**
   * Cancel a task: pending → canceled; starting/running → stopping intent.
   * @param id - the task id to cancel.
   * @returns `canceled` for a directly-canceled pending task, `stopping` when a cancel intent was persisted.
   */
  @Remote('cancel')
  async cancel(id: string): Promise<QueueCancelOutcomeView> {
    return await this.queue.cancel(TaskId(id))
  }

  /**
   * Retry a failed task; returns the (unchanged) task id, now pending.
   * @param id - the failed task id to requeue.
   * @returns the same task id, now pending with `attempt` reset.
   */
  @Remote('retry')
  async retry(id: string): Promise<string> {
    return await this.queue.retry(TaskId(id))
  }

  /**
   * Pause the queue (running → paused only). The seam rejects a faulted
   * queue, so the panel cannot fake-clear a service fault.
   */
  @Remote('pause')
  pause(): void {
    this.queue.pause()
  }

  /**
   * Resume the queue (paused → running only; faulted rejected). A faulted
   * service needs operator recovery, so the panel disables this until the
   * service state leaves `faulted`.
   */
  @Remote('resume')
  resume(): void {
    this.queue.resume()
  }
}

export default TaskQueueRemoteService
