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

/** Local mirror of the remote executor view; kept until lib types regenerate. */
export interface QueueExecutorView {
  name: string
  enabled: boolean
  toolAllowed: boolean
  running: number
}

/** The narrow Remote face the store drives; test fakes satisfy exactly this. */
export interface QueueRemoteFace {
  stats(): Promise<RemoteResult<QueueStatsView>>
  list(filter: { status?: QueueTaskSummaryView['status']; limit?: number }): Promise<RemoteResult<QueueTaskSummaryView[]>>
  executors(): Promise<RemoteResult<QueueExecutorView[]>>
  get(id: string): Promise<RemoteResult<QueueTaskView>>
  readRunLog(id: string, runId: string): Promise<RemoteResult<string>>
  cancel(id: string): Promise<RemoteResult<QueueCancelOutcomeView>>
  retry(id: string): Promise<RemoteResult<string>>
  dismiss(id: string, dismissed?: boolean): Promise<RemoteResult<void>>
  pause(): Promise<RemoteResult<void>>
  resume(): Promise<RemoteResult<void>>
}

/** One store snapshot; the view subscribes through getSnapshot/subscribe. */
export interface QueueSnapshot {
  stats: QueueStatsView | null
  summaries: QueueTaskSummaryView[]
  executors: QueueExecutorView[]
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
  executors: [],
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

  /** Current snapshot for synchronous readers. */
  getSnapshot = (): QueueSnapshot => this.#snapshot

  /** Subscribe to snapshot changes; returns the unsubscribe disposer. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /** Drop listeners and reject further updates. */
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
      const [stats, list, executors] = await Promise.all([
        this.remote.stats(),
        this.remote.list({}),
        this.remote.executors(),
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
        executors: valueOf(executors),
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

  /** Select one task and read its full durable state.
   * @param id - the task id to select. */
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

  /** Read one run's log from the host.
   * @param id - the owning task id.
   * @param runId - the run id to read.
   * @returns the run log content, or a failure message. */
  async readRunLog(id: string, runId: string): Promise<{ ok: true; content: string } | { ok: false; message: string }> {
    try {
      return { ok: true, content: valueOf(await this.remote.readRunLog(id, runId)) }
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Cancel one task, then confirm the change from the host.
   * @param id - the task id to cancel.
   * @returns the action outcome. */
  async cancel(id: string): Promise<QueueActionResult> {
    try {
      const outcome = valueOf(await this.remote.cancel(id))
      await this.refresh()
      return { ok: true, message: outcome === 'canceled' ? 'task canceled' : 'task stopping' }
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Cancel many tasks, then confirm from the host.
   * @param ids - the task ids to cancel.
   * @returns the action outcome, collecting per-id failures. */
  async cancelMany(ids: string[]): Promise<QueueActionResult> {
    if (ids.length === 0) return { ok: true, message: 'no tasks' }
    const failures: string[] = []
    for (const id of ids) {
      try {
        valueOf(await this.remote.cancel(id))
      } catch (error: unknown) {
        failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    await this.refresh()
    if (failures.length > 0) return { ok: false, message: failures.join('; ') }
    return { ok: true, message: `canceled ${ids.length}` }
  }

  /** Re-queue many tasks, then confirm from the host.
   * @param ids - the task ids to re-queue.
   * @returns the action outcome, collecting per-id failures. */
  async retryMany(ids: string[]): Promise<QueueActionResult> {
    if (ids.length === 0) return { ok: true, message: 'no tasks' }
    const failures: string[] = []
    for (const id of ids) {
      try {
        valueOf(await this.remote.retry(id))
      } catch (error: unknown) {
        failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    await this.refresh()
    if (failures.length > 0) return { ok: false, message: failures.join('; ') }
    return { ok: true, message: `retried ${ids.length}` }
  }

  /** Dismiss one terminal task (default dismissed=true), then confirm from the host.
   * @param id - the task id to dismiss.
   * @param dismissed - whether to dismiss (true) or restore (false).
   * @returns the action outcome. */
  async dismiss(id: string, dismissed: boolean = true): Promise<QueueActionResult> {
    try {
      valueOf(await this.remote.dismiss(id, dismissed))
      await this.refresh()
      return { ok: true, message: dismissed ? 'task dismissed' : 'task restored' }
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Restore one dismissed task to attention.
   * @param id - the task id to restore.
   * @returns the action outcome. */
  async undismiss(id: string): Promise<QueueActionResult> {
    return this.dismiss(id, false)
  }

  /** Dismiss/restore many tasks, then confirm from the host.
   * @param ids - the task ids to dismiss or restore.
   * @param dismissed - whether to dismiss (true) or restore (false).
   * @returns the action outcome, collecting per-id failures. */
  async dismissMany(ids: string[], dismissed: boolean): Promise<QueueActionResult> {
    if (ids.length === 0) return { ok: true, message: 'no tasks' }
    const failures: string[] = []
    for (const id of ids) {
      try {
        valueOf(await this.remote.dismiss(id, dismissed))
      } catch (error: unknown) {
        failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    await this.refresh()
    if (failures.length > 0) return { ok: false, message: failures.join('; ') }
    return { ok: true, message: `${dismissed ? 'dismissed' : 'restored'} ${ids.length}` }
  }

  /** Re-queue one task, then confirm the change from the host.
   * @param id - the task id to re-queue.
   * @returns the action outcome. */
  async retry(id: string): Promise<QueueActionResult> {
    try {
      valueOf(await this.remote.retry(id))
      await this.refresh()
      return { ok: true, message: 'task re-queued' }
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Pause the service switch, then confirm from the host.
   * @returns the action outcome. */
  async pause(): Promise<QueueActionResult> {
    try {
      valueOf(await this.remote.pause())
      await this.refresh()
      return { ok: true, message: 'queue paused' }
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Resume the service switch, then confirm from the host.
   * @returns the action outcome. */
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
