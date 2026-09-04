/** Client mirror for the Queue v2 single-snapshot Remote. */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  QueueSnapshotView, QueueStatsView, QueueUnknownResolutionInput, QueueWorkSummaryView, QueueWorkView,
} from '@changanhua/dsh-task-queue-remote/views'

/** The narrow Queue v2 Remote face driven by this store. */
export interface QueueRemoteFace {
  snapshot(input?: { detailId?: string }): Promise<RemoteResult<QueueSnapshotView>>
  cancel(id: string): Promise<RemoteResult<void>>
  retry(id: string): Promise<RemoteResult<void>>
  resolveUnknown(id: string, resolution: QueueUnknownResolutionInput): Promise<RemoteResult<void>>
  pause(): Promise<RemoteResult<void>>
  resume(): Promise<RemoteResult<void>>
}
/** Browser state derived from one Queue Remote snapshot. */
export interface QueueSnapshot {
  stats: QueueStatsView | null
  rows: QueueWorkSummaryView[]
  selectedId: string | null
  detail: QueueWorkView | null
  loading: boolean
  refreshing: boolean
  error: string | null
  /** ISO timestamp of the most recent successful snapshot read; null before the first success. */
  lastSuccessfulRefreshAt: string | null
}
/** Result displayed after a Queue mutation. */
export interface QueueActionResult { ok: boolean; message: string }
const EMPTY: QueueSnapshot = {
  stats: null, rows: [], selectedId: null, detail: null, loading: false, refreshing: false, error: null,
  lastSuccessfulRefreshAt: null,
}
function value<T>(result: RemoteResult<T>): T { if (!result.ok) throw new Error(result.error.message); return result.value }

/** Store whose every refresh is exactly one host snapshot. */
export class QueueStore {
  #snapshot: QueueSnapshot = EMPTY
  #listeners = new Set<() => void>()
  #disposed = false
  #refreshTail: Promise<void> = Promise.resolve()
  constructor(private readonly remote: QueueRemoteFace) {}
  /**
   * Read the current browser projection.
   * @returns Current immutable-by-convention browser snapshot.
   */
  getSnapshot = (): QueueSnapshot => this.#snapshot
  /**
   * Subscribe to snapshot changes.
   * @param listener Callback invoked after each update.
   * @returns Subscription disposer.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }
  /** Stop updates and release every listener. */
  dispose(): void { this.#disposed = true; this.#listeners.clear() }
  #set(patch: Partial<QueueSnapshot>): void {
    if (this.#disposed) return
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of this.#listeners) listener()
  }
  /**
   * Replace browser state from one Remote snapshot.
   * @returns Completion after the refresh settles.
   */
  async refresh(): Promise<void> {
    if (this.#disposed) return
    const read = async (): Promise<void> => {
      this.#set({ refreshing: true, error: null })
      try {
        const input = this.#snapshot.selectedId === null ? {} : { detailId: this.#snapshot.selectedId }
        const next = value(await this.remote.snapshot(input))
        this.#set({
          stats: next.stats,
          rows: next.rows,
          detail: next.detail,
          loading: false,
          refreshing: false,
          lastSuccessfulRefreshAt: new Date().toISOString(),
        })
      } catch (error) {
        this.#set({ refreshing: false, error: error instanceof Error ? error.message : 'Queue refresh failed' })
      }
    }
    const queued = this.#refreshTail.then(read, read)
    this.#refreshTail = queued.then(() => undefined, () => undefined)
    await queued
  }
  /**
   * Select one WorkItem and load its detail.
   * @param id WorkItem identifier.
   * @returns Completion after the detail refresh.
   */
  async select(id: string): Promise<void> {
    if (this.#disposed) return
    this.#set({ selectedId: id, loading: true })
    await this.refresh()
  }
  async #act(action: () => Promise<RemoteResult<void>>, message: string): Promise<QueueActionResult> {
    try {
      value(await action())
      await this.refresh()
      return { ok: true, message }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Queue action failed' }
    }
  }
  /**
   * Cancel one WorkItem and refresh the projection.
   * @param id WorkItem identifier.
   * @returns Display result after cancellation and refresh.
   */
  async cancel(id: string): Promise<QueueActionResult> {
    return await this.#act(() => this.remote.cancel(id), `Cancellation requested for ${id}.`)
  }
  /**
   * Retry one WorkItem and refresh the projection.
   * @param id WorkItem identifier.
   * @returns Display result after retry and refresh.
   */
  async retry(id: string): Promise<QueueActionResult> {
    return await this.#act(() => this.remote.retry(id), `Retried ${id}.`)
  }
  /**
   * Apply one operator resolution to an unknown WorkItem and refresh the projection.
   * @param id WorkItem identifier.
   * @param resolution Operator resolution selected by the browser.
   * @returns Display result after durable resolution and refresh.
   */
  async resolveUnknown(id: string, resolution: QueueUnknownResolutionInput): Promise<QueueActionResult> {
    return await this.#act(
      () => this.remote.resolveUnknown(id, resolution),
      `Unknown attempt retry authorized for ${id}.`,
    )
  }
  /**
   * Pause dispatch and refresh the projection.
   * @returns Display result after pausing dispatch and refreshing.
   */
  async pause(): Promise<QueueActionResult> {
    return await this.#act(() => this.remote.pause(), 'Dispatch paused.')
  }
  /**
   * Resume dispatch and refresh the projection.
   * @returns Display result after resuming dispatch and refreshing.
   */
  async resume(): Promise<QueueActionResult> {
    return await this.#act(() => this.remote.resume(), 'Dispatch resumed.')
  }
  /**
   * Cancel several WorkItems and refresh once.
   * @param ids WorkItems to cancel.
   * @returns Combined display result after refresh.
   */
  async cancelMany(ids: readonly string[]): Promise<QueueActionResult> {
    return await this.#many(ids, id => this.remote.cancel(id), 'Canceled')
  }
  /**
   * Retry several WorkItems and refresh once.
   * @param ids WorkItems to retry.
   * @returns Combined display result after refresh.
   */
  async retryMany(ids: readonly string[]): Promise<QueueActionResult> {
    return await this.#many(ids, id => this.remote.retry(id), 'Retried')
  }
  async #many(
    ids: readonly string[],
    action: (id: string) => Promise<RemoteResult<void>>,
    verb: string,
  ): Promise<QueueActionResult> {
    const errors: string[] = []
    for (const id of ids) {
      try {
        value(await action(id))
      } catch (error) {
        errors.push(`${id}: ${error instanceof Error ? error.message : 'Queue action failed'}`)
      }
    }
    await this.refresh()
    return errors.length === 0
      ? { ok: true, message: `${verb} ${ids.length} WorkItems.` }
      : { ok: false, message: errors.join('; ') }
  }
}
