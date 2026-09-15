/** Browser Remote over the trusted Queue v2 operator facade. */
import { Context } from '@deepseek-ai/cordis'
import { canonicalJson, createVerifiedOperatorAuthority } from '@changanhua/dsh-task-queue'
import type { OperatorWorkQueue, UnknownResolution, WorkView } from '@changanhua/dsh-task-queue'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  QueueJsonValue, QueueSnapshotInput, QueueSnapshotView, QueueStatsView, QueueUnknownResolutionInput,
  QueueTaskOutcome, QueueTaskState, QueueWorkSummaryView, QueueWorkView,
} from './views.ts'

export type {
  QueueSnapshotInput, QueueSnapshotView, QueueStatsView, QueueUnknownResolutionInput, QueueFailureInput,
  QueueTaskOutcome, QueueTaskState, QueueWorkAttemptView, QueueWorkStatus, QueueWorkSummaryView, QueueWorkView,
} from './views.ts'
/** Reserved Remote plugin configuration. */
export type Config = Record<string, never>

function summary(view: WorkView): QueueWorkSummaryView {
  const presentation = present(view)
  return {
    id: view.work.id, kind: view.work.kind, title: view.work.title, status: view.state.status,
    state: presentation.state, outcome: presentation.outcome,
    attemptCount: view.state.attemptCount, maxAttempts: view.work.policy.maxAttempts,
    batchId: view.work.batchId, ownerSessionId: view.work.ownerSessionId,
    createdAt: view.work.createdAt, updatedAt: view.state.updatedAt,
  }
}
/** Project detailed durable states into the four states used by the MVP operator UI. */
function present(view: WorkView): { state: QueueTaskState; outcome: QueueTaskOutcome } {
  switch (view.state.status) {
    case 'queued': return { state: 'queued', outcome: null }
    case 'starting':
    case 'running': return { state: 'running', outcome: null }
    case 'unknown': return { state: 'attention', outcome: null }
    case 'succeeded': return { state: 'done', outcome: 'succeeded' }
    case 'failed': return { state: 'done', outcome: 'failed' }
    case 'canceled': return { state: 'done', outcome: 'canceled' }
  }
}
function detail(view: WorkView): QueueWorkView {
  return {
    ...summary(view),
    failure: view.state.failure,
    attempts: view.attempts.map(attempt => ({
      id: attempt.id, ordinal: attempt.ordinal, status: attempt.status, startedAt: attempt.startedAt,
      runningAt: attempt.runningAt, finishedAt: attempt.finishedAt,
      failure: attempt.failure === null
        ? null
        : { category: attempt.failure.category, message: attempt.failure.message },
    })),
    result: view.result === null
      ? null
      : { id: view.result.id, output: remoteJson(view.result.output), createdAt: view.result.createdAt },
  }
}
function stats(views: readonly WorkView[], paused: boolean): QueueStatsView {
  const byStatus: QueueStatsView['byStatus'] = { queued: 0, starting: 0, running: 0, unknown: 0, succeeded: 0, failed: 0, canceled: 0 }
  const byKind: Record<string, number> = {}
  for (const view of views) { byStatus[view.state.status] += 1; byKind[view.work.kind] = (byKind[view.work.kind] ?? 0) + 1 }
  return { paused, byStatus, byKind }
}

function unknownResolution(input: unknown): UnknownResolution {
  if (input !== null && typeof input === 'object' && 'kind' in input) {
    if (input.kind === 'authorize-retry') return { kind: 'authorize-retry' }
    if (input.kind === 'confirm-failed' && 'failure' in input) {
      const value = input.failure
      if (value !== null
        && typeof value === 'object'
        && 'category' in value
        && 'message' in value
        && 'sideEffect' in value
        && 'retriable' in value
        && typeof value.category === 'string'
        && typeof value.message === 'string'
        && (value.sideEffect === 'not-started' || value.sideEffect === 'started' || value.sideEffect === 'unknown')
        && typeof value.retriable === 'boolean') {
        return {
          kind: 'confirm-failed',
          failure: {
            category: value.category,
            message: value.message,
            sideEffect: value.sideEffect,
            retriable: value.retriable,
          },
        }
      }
    }
  }
  throw new Error('Queue Remote does not accept reconcile or unverified success')
}

/** Host service contributing the `taskQueue` Remote namespace. */
export class TaskQueueRemoteService extends TypertRemoteService {
  static inject = ['taskQueue']
  private readonly queue: OperatorWorkQueue
  private paused = false
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'taskQueueRemote', { namespace: 'taskQueue' })
    void config
    this.queue = ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
  }

  /**
   * Return rows, aggregate counters, and optional detail from one durable read.
   * @param input Row filters, limit, and optional detail id.
   * @returns One internally consistent Queue snapshot.
   */
  @Remote('snapshot')
  snapshot(input: QueueSnapshotInput): QueueSnapshotView {
    const all = [...this.queue.list()].sort(
      (left, right) => right.state.updatedAt.localeCompare(left.state.updatedAt)
        || right.work.id.localeCompare(left.work.id),
    )
    const statuses = input.statuses
    const selected = statuses === undefined ? all : all.filter(view => statuses.includes(view.state.status))
    const limit = input.limit === undefined ? Math.max(selected.length, 1) : input.limit
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Queue snapshot limit must be a positive integer')
    const requested = input.detailId === undefined ? null : all.find(view => view.work.id === input.detailId) ?? null
    return {
      stats: stats(all, this.paused), rows: selected.slice(0, limit).map(summary),
      detail: requested === null ? null : detail(requested),
    }
  }
  /**
   * Request cancellation for one WorkItem.
   * @param id WorkItem identifier.
   */
  @Remote('cancel')
  async cancel(id: string): Promise<void> { await this.queue.cancel(id as never) }
  /**
   * Manually retry one failed WorkItem.
   * @param id WorkItem identifier.
   */
  @Remote('retry')
  async retry(id: string): Promise<void> { await this.queue.retry(id as never) }
  /**
   * Resolve an unknown WorkItem through the trusted operator facade.
   * @param id WorkItem identifier.
   * @param resolution Browser-safe operator resolution.
   * @returns Completion after the durable resolution append.
   */
  @Remote('resolveUnknown')
  async resolveUnknown(id: string, resolution: QueueUnknownResolutionInput): Promise<void> {
    await this.queue.resolveUnknown(id as never, unknownResolution(resolution))
  }
  /** Pause dispatch while retaining admissions and operator actions. */
  @Remote('pause')
  pause(): void { this.queue.pause(); this.paused = true }
  /** Resume dispatch. */
  @Remote('resume')
  resume(): void { this.queue.resume(); this.paused = false }
}
/** Validate and copy a result output before it crosses the JSON Remote boundary. */
function remoteJson(value: unknown): QueueJsonValue { return JSON.parse(canonicalJson(value)) as QueueJsonValue }
export default TaskQueueRemoteService
