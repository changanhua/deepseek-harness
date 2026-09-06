/**
 * Browser-local state machine over the contentRemote namespace, created by
 * the plugin's apply and disposed with its fiber — never a module singleton.
 * The Host owns idempotency, revision checks, and source verification: this
 * store never reconciles content locally. It re-reads the whole snapshot
 * after every successful capture instead of patching a projection, and every
 * in-flight request is bound to the store's lifetime through an AbortSignal,
 * so results from a superseded load can neither resolve nor land.
 * @module @changanhua/dsh-client-ui-content/client/controller
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ContentEntry, ContentReceipt, ContentSnapshot, ContentStatus,
} from '@changanhua/dsh-content/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { captureKey, captureNonce, captureOperationId, type CaptureTarget } from './capture-target.ts'

/** The Remote calls this store needs, narrowed from the generated face. */
export interface ContentLibraryRemote {
  status: (signal?: AbortSignal) => Promise<RemoteResult<ContentStatus>>
  snapshot: (signal?: AbortSignal) => Promise<RemoteResult<ContentSnapshot>>
  get: (entryId: string, signal?: AbortSignal) => Promise<RemoteResult<ContentEntry | null>>
  capture: (
    input: { operationId: string; sessionId: string; messageId: string },
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ContentReceipt>>
}

/** Single load-lane state: one machine, not independent booleans. */
export type LibraryLoadState = 'idle' | 'loading' | 'ready' | 'error'

/** One capture attempt in flight, addressed by its capture key. */
export interface PendingCapture {
  readonly key: string
  readonly operationId: string
  readonly sessionId: string
  readonly seq: number
}

/** Settled failure surfaced by the workspace and the capture entries. */
export interface LibraryError {
  readonly code: string
  readonly message: string
}

/** Immutable view published to the capture entries and the library workspace. */
export interface ContentLibraryView {
  loadState: LibraryLoadState
  /** Host-reported medium status; null until the first status read settles. */
  status: ContentStatus | null
  /** Committed entries from the last successful snapshot, creation order. */
  entries: readonly ContentEntry[]
  /** Entry opened in the workspace detail pane, if any. */
  selectedEntryId: string | null
  /** The most recent capture attempt while it is in flight. */
  pendingCapture: PendingCapture | null
  /** entryId per capture this page performed, keyed by {@link captureKey}. */
  captured: ReadonlyMap<string, string>
  /** The last load failure, cleared by the next successful load. */
  error: LibraryError | null
}

/** Settled shape of one capture attempt, rendered by the message entry. */
export type CaptureOutcome =
  | { ok: true; entryId: string }
  | { ok: false; error: LibraryError }

const INITIAL_VIEW: ContentLibraryView = Object.freeze({
  loadState: 'idle',
  status: null,
  entries: Object.freeze([]),
  selectedEntryId: null,
  pendingCapture: null,
  captured: new Map(),
  error: null,
})

const DISPOSED: CaptureOutcome = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'disposed', message: 'content library store is disposed' }),
})

/**
 * Page-wide library store. One instance backs the workspace view and every
 * per-message capture entry, so a capture lands in the list without a second
 * wiring path. The instance is created inside apply and disposed with the
 * plugin fiber.
 */
export class ContentLibraryStore implements HostObservable<ContentLibraryView> {
  private view = INITIAL_VIEW
  private readonly listeners = new Set<() => void>()
  private loadLane: Promise<void> | null = null
  private loadGeneration = 0
  private loadAbort: AbortController | null = null
  private readonly captureAbort = new AbortController()
  private readonly capturePromises = new Map<string, Promise<CaptureOutcome>>()
  private disposed = false

  /**
   * @param remote - the contentRemote Remote namespace.
   */
  constructor(private readonly remote: ContentLibraryRemote) {}

  /** Return the cached immutable view. */
  getSnapshot = (): ContentLibraryView => this.view

  /** Subscribe to view replacement. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Load once from idle; a failed load stays retryable.
   */
  ensure(): Promise<void> {
    if (this.view.loadState !== 'idle') return Promise.resolve()
    return this.refresh()
  }

  /**
   * Re-read status and snapshot on the single load lane. A newer refresh
   * aborts the previous request and takes the lane, so a late reply from a
   * superseded load can neither resolve nor publish.
   */
  refresh(): Promise<void> {
    if (this.loadLane !== null) return this.loadLane
    // A new lane cancels the previous request outright; the generation check
    // below additionally guarantees its results can never publish.
    this.loadGeneration += 1
    const generation = this.loadGeneration
    this.loadAbort?.abort()
    const abort = new AbortController()
    this.loadAbort = abort
    this.publish({ ...this.view, loadState: 'loading', error: null })
    const pending = this.load(generation, abort.signal)
    this.loadLane = pending
    return pending.finally(() => {
      if (this.loadLane === pending) this.loadLane = null
    })
  }

  /**
   * Re-read after a transport reset. An idle store stays idle until something
   * asks for it, matching the seeding discipline of the other sidecars.
   */
  resync(): Promise<void> {
    if (this.view.loadState === 'idle') return Promise.resolve()
    return this.refresh()
  }

  /**
   * Open one entry in the workspace detail pane.
   * @param entryId - entry to open, or null to close the pane.
   */
  select(entryId: string | null): void {
    if (this.view.selectedEntryId === entryId) return
    this.publish({ ...this.view, selectedEntryId: entryId })
  }

  /**
   * Capture one completed assistant message. Every attempt mints a fresh
   * operation id; repeated clicks while one attempt is in flight share it,
   * and a later attempt after a failure starts a new operation. The Host's
   * source idempotency answers any retry over the same message with the
   * original creation receipt either way.
   * @param sessionId - owning session.
   * @param target - the resolved capture target of the message.
   */
  async capture(sessionId: SessionId, target: CaptureTarget): Promise<CaptureOutcome> {
    if (this.disposed) return DISPOSED
    const key = captureKey(sessionId, target)
    const pending = this.capturePromises.get(key)
    if (pending !== undefined) return pending
    const attempt = this.captureOnce(sessionId, target, key)
    this.capturePromises.set(key, attempt)
    try {
      return await attempt
    } finally {
      this.capturePromises.delete(key)
    }
  }

  /** Drop subscribers, abort in-flight requests, and refuse further work. */
  dispose(): void {
    this.disposed = true
    this.loadAbort?.abort()
    this.captureAbort.abort()
    this.listeners.clear()
  }

  /** One wire attempt; the caller owns the in-flight bookkeeping. */
  private async captureOnce(
    sessionId: SessionId,
    target: CaptureTarget,
    key: string,
  ): Promise<CaptureOutcome> {
    const operationId = captureOperationId(sessionId, target, captureNonce())
    this.publish({
      ...this.view,
      pendingCapture: Object.freeze({ key, operationId, sessionId, seq: target.seq }),
    })
    try {
      const carried = await this.remote.capture(
        { operationId, sessionId, messageId: String(target.seq) },
        this.captureAbort.signal,
      )
      if (this.disposed) return DISPOSED
      if (!carried.ok) {
        return { ok: false, error: { code: carried.error.code, message: carried.error.message } }
      }
      const captured = new Map(this.view.captured)
      captured.set(key, carried.value.entryId)
      this.publish({ ...this.view, captured: Object.freeze(captured) })
      // The capture is committed; the list refresh is presentation repair and
      // its own failure must not fail the click.
      void this.refresh()
      return { ok: true, entryId: carried.value.entryId }
    } catch (error) {
      if (this.disposed) return DISPOSED
      return {
        ok: false,
        error: {
          code: 'transport',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    } finally {
      // Only clear the slot this attempt filled; a newer attempt owns it then.
      if (this.view.pendingCapture?.key === key && !this.disposed) {
        this.publish({ ...this.view, pendingCapture: null })
      }
    }
  }

  /** Fetch status then snapshot on one generation; superseded runs stay silent. */
  private async load(generation: number, signal: AbortSignal): Promise<void> {
    try {
      const statusCarried = await this.remote.status(signal)
      if (this.stale(generation, signal)) return
      if (!statusCarried.ok) {
        this.publish({ ...this.view, loadState: 'error', error: failureOf(statusCarried.error) })
        return
      }
      // An opening or unavailable medium is a Host phase the workspace
      // renders verbatim, not a transport failure; there is nothing to list.
      const status = statusCarried.value
      if (status.phase !== 'ready') {
        this.publish({
          ...this.view, loadState: 'ready', status, entries: Object.freeze([]), error: null,
        })
        return
      }
      const snapshotCarried = await this.remote.snapshot(signal)
      if (this.stale(generation, signal)) return
      if (!snapshotCarried.ok) {
        this.publish({ ...this.view, loadState: 'error', error: failureOf(snapshotCarried.error) })
        return
      }
      this.publish({
        ...this.view,
        loadState: 'ready',
        status,
        entries: Object.freeze([...snapshotCarried.value.entries]),
        error: null,
      })
    } catch (error) {
      if (this.stale(generation, signal)) return
      this.publish({
        ...this.view,
        loadState: 'error',
        error: { code: 'transport', message: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  /** True when this load run was superseded, aborted, or the store unloaded. */
  private stale(generation: number, signal: AbortSignal): boolean {
    return this.disposed || signal.aborted || generation !== this.loadGeneration
  }

  /** Replace the view and contain subscriber failures at the observable boundary. */
  private publish(view: ContentLibraryView): void {
    this.view = Object.freeze(view)
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[ui-content] subscriber threw:', error)
      }
    }
  }
}

/** Normalize a carrier failure into the settled shape the controls render. */
function failureOf(error: { code: string; message: string }): LibraryError {
  return { code: error.code, message: error.message }
}
