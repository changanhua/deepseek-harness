/**
 * The Queue workspace's client store: a framework-neutral snapshot/subscribe
 * surface over the panel Remote (`ctx.remote.taskQueue`). It owns the refresh
 * chain — full snapshot reads (stats + list), detail reads (get), and the
 * steering verbs (cancel/retry/pause/resume) — and re-reads after every
 * successful mutation, so the view never fabricates a state the host did not
 * confirm. The plugin polls the snapshot while mounted; the panel also
 * refreshes on open and offers a manual refresh.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  QueueCancelOutcomeView,
  QueueStatsView,
  QueueTaskSummaryView,
  QueueTaskView,
} from '@deepseek-ai/dsh-task-queue-remote/views'

/** The narrow Remote face the store drives; test fakes satisfy exactly this. */
export interface QueueRemoteFace {
  stats(): Promise<RemoteResult<QueueStatsView>>
  list(filter: { status?: QueueTaskSummaryView['status']; limit?: number }): Promise<RemoteResult<QueueTaskSummaryView[]>>
  get(id: string): Promise<RemoteResult<QueueTaskView>>
  cancel(id: string): Promise<RemoteResult<QueueCancelOutcomeView>>
  retry(id: string): Promise<RemoteResult<string>>
  pause(): Promise<RemoteResult<void>>
  resume(): Promise<RemoteResult<void>>
}

/** One store snapshot; the view subscribes through getSnapshot/subscribe. */
export interface QueueSnapshot {
  stats: QueueStatsView | null
  summaries: QueueTaskSummaryView[]
  selectedId: string | null
  detail: QueueTaskView | null
  loading: boolean
  refreshing: boolean
  error: string | null
}

/** A mutation's outcome for view feedback; the snapshot already refreshed on success. */
export interface QueueActionResult {
  ok: boolean
  message: string
}

const EMPTY: QueueSnapshot = {
  stats: null,
  summaries: [],
  selectedId: null,
  detail: null,
  loading: false,
  refreshing: false,
  error: null,
}

/** Read the RemoteResult value or throw its wire error message. */
function valueOf<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/**
 * Queue panel store.
 */
export class QueueStore {
  #snapshot: QueueSnapshot = EMPTY
  #listeners = new Set<() => void>()
  #disposed = false

  constructor(private readonly remote: QueueRemoteFace) {}

  getSnapshot = (): QueueSnapshot => this.#snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  dispose(): void {
    this.#disposed = true
    this.#listeners.clear()
  }

  #set(patch: Partial<QueueSnapshot>): void {
    if (this.#disposed) return
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of [...this.#listeners]) listener()
  }

  /**
   * Re-read the stats and summary rows in one refresh. A failure keeps the
   * previous snapshot and surfaces the wire message; a missing backend reads
   * as a load-guidance error rather than a blank panel.
   */
  async refresh(): Promise<void> {
    if (this.#disposed) return
    this.#set({ refreshing: true, error: null })
    try {
      const [stats, list] = await Promise.all([
        this.remote.stats(),
        this.remote.list({}),
      ])
      const detail = this.#snapshot.selectedId === null
        ? null
        : await this.remote.get(this.#snapshot.selectedId).then(valueOf).catch((error) => {
          console.error(`task-queue: failed to load detail ${String(this.#snapshot.selectedId)}: ${String(error)}`)
          return null
        })
      this.#set({
        stats: valueOf(stats),
        summaries: valueOf(list),
        detail,
        loading: false,
        refreshing: false,
        error: null,
      })
    } catch (error: unknown) {
      this.#set({
        refreshing: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Select one task and read its full durable state. */
  async select(id: string): Promise<void> {
    if (this.#disposed) return
    this.#set({ selectedId: id, loading: true, error: null })
    try {
      this.#set({ detail: valueOf(await this.remote.get(id)), loading: false })
    } catch (error: unknown) {
      this.#set({
        detail: null,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Cancel one task, then confirm the change from the host. */
  async cancel(id: string): Promise<QueueActionResult> {
    try {
      const outcome = valueOf(await this.remote.cancel(id))
      await this.refresh()
      return { ok: true, message: outcome === 'canceled' ? 'task canceled' : 'task stopping' }
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Re-queue one task, then confirm the change from the host. */
  async retry(id: string): Promise<QueueActionResult> {
    try {
      valueOf(await this.remote.retry(id))
      await this.refresh()
      return { ok: true, message: 'task re-queued' }
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Pause the service switch, then confirm from the host. */
  async pause(): Promise<QueueActionResult> {
    try {
      valueOf(await this.remote.pause())
      await this.refresh()
      return { ok: true, message: 'queue paused' }
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Resume the service switch, then confirm from the host. */
  async resume(): Promise<QueueActionResult> {
    try {
      valueOf(await this.remote.resume())
      await this.refresh()
      return { ok: true, message: 'queue resumed' }
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
}
