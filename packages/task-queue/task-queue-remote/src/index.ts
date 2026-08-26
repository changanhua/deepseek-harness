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
import { readFile } from 'node:fs/promises'
import { TASK_QUEUE_HOST_ACCESS, TaskId } from '@deepseek-ai/dsh-task-queue'
import type {
  TaskQueue,
  TaskSummary,
} from '@deepseek-ai/dsh-task-queue'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  QueueCancelOutcomeView,
  QueueExecutorView,
  QueueListFilterView,
  QueueStatsView,
  QueueTaskSummaryView,
  QueueTaskView,
} from './views.ts'

export type {
  QueueCancelOutcomeView,
  QueueExecutorView,
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
    dismissed: task.dismissed,
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
    return this.queue.list(TASK_QUEUE_HOST_ACCESS, filter).map(toSummaryView)
  }

  /**
   * Return the full durable state of one task as its wire view.
   * @param id - the task id (`tq-<uuid>`).
   * @returns the projected durable snapshot; throws for an unknown id.
   */
  @Remote('get')
  get(id: string): QueueTaskView {
    const task = this.queue.get(TASK_QUEUE_HOST_ACCESS, TaskId(id))
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
   * List executor registration/enable gates plus current live task counts.
   * @returns one row per registered executor.
   */
  @Remote('executors')
  executors(): QueueExecutorView[] {
    const live = new Set(['starting', 'running', 'stopping'])
    const liveByExecutor = new Map<string, number>()
    for (const task of this.queue.list(TASK_QUEUE_HOST_ACCESS)) {
      if (live.has(task.status)) {
        liveByExecutor.set(task.executor, (liveByExecutor.get(task.executor) ?? 0) + 1)
      }
    }
    return this.queue.listExecutors().map(executor => ({
      ...executor,
      running: liveByExecutor.get(executor.name) ?? 0,
    }))
  }

  /**
   * Read the on-disk run log for one completed/attempted run.
   * @param id - the task id (`tq-<uuid>`).
   * @param runId - the run id to read.
   * @returns the merged stdout/stderr log body as UTF-8 text.
   */
  @Remote('readRunLog')
  async readRunLog(id: string, runId: string): Promise<string> {
    const task = this.queue.get(TASK_QUEUE_HOST_ACCESS, TaskId(id))
    const run = task.runs.find(r => r.runId === runId)
    if (run === undefined || run.logPath === null) {
      throw new Error(`run ${runId} has no log path`)
    }
    return await readFile(run.logPath, 'utf8')
  }

  /**
   * Aggregate service state and per-status/per-executor counters.
   * @returns the current service state, optional fault, and counters.
   */
  @Remote('stats')
  stats(): QueueStatsView {
    const stats = this.queue.stats(TASK_QUEUE_HOST_ACCESS)
    return {
      serviceState: stats.serviceState,
      fault: stats.fault === undefined ? null : { reason: stats.fault.reason },
      byStatus: { ...stats.byStatus },
      byExecutor: { ...stats.byExecutor },
      undismissedFailed: stats.undismissedFailed,
      byDismissed: stats.byDismissed,
    }
  }

  /**
   * Cancel a task: pending → canceled; starting/running → stopping intent.
   * @param id - the task id to cancel.
   * @returns `canceled` for a directly-canceled pending task, `stopping` when a cancel intent was persisted.
   */
  @Remote('cancel')
  async cancel(id: string): Promise<QueueCancelOutcomeView> {
    return await this.queue.cancel(TASK_QUEUE_HOST_ACCESS, TaskId(id))
  }

  /**
   * Retry a failed task; returns the (unchanged) task id, now pending.
   * @param id - the failed task id to requeue.
   * @returns the same task id, now pending with `attempt` reset.
   */
  @Remote('retry')
  async retry(id: string): Promise<string> {
    return await this.queue.retry(TASK_QUEUE_HOST_ACCESS, TaskId(id))
  }

  /**
   * Soft-conclude (or restore) a terminal task by toggling its `dismissed`
   * flag. A dismissed task leaves the attention badge/filters but keeps its
   * record; requeuing resets `dismissed` to false.
   * @param id - the terminal task id (`tq-<uuid>`).
   * @param dismissed - true to conclude, false to restore.
   */
  @Remote('dismiss')
  async dismiss(id: string, dismissed: boolean): Promise<void> {
    await this.queue.dismiss(TASK_QUEUE_HOST_ACCESS, TaskId(id), dismissed)
  }

  /**
   * Pause the queue (running → paused only). The seam rejects a faulted
   * queue, so the panel cannot fake-clear a service fault.
   */
  @Remote('pause')
  pause(): void {
    this.queue.pause(TASK_QUEUE_HOST_ACCESS)
  }

  /**
   * Resume the queue (paused → running only; faulted rejected). A faulted
   * service needs operator recovery, so the panel disables this until the
   * service state leaves `faulted`.
   */
  @Remote('resume')
  resume(): void {
    this.queue.resume(TASK_QUEUE_HOST_ACCESS)
  }
}

export default TaskQueueRemoteService
