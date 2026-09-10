/**
 * Browser-local state machine over the contentRemote namespace, created by
 * the plugin's apply and disposed with its fiber — never a module singleton.
 * The Host owns idempotency, revision checks, and source verification: this
 * store never reconciles content locally. It re-reads the whole snapshot
 * after every successful capture or edit instead of patching a projection,
 * every in-flight request is bound to the store's lifetime through an
 * AbortSignal, and a revision conflict re-reads exactly the contested entry
 * before surfacing the choice — the editor's local text is never silently
 * replaced or discarded.
 * @module @changanhua/dsh-client-ui-content/client/controller
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ContentCommand, ContentEntry, ContentReceipt, ContentSnapshot, ContentStatus,
} from '@changanhua/dsh-content/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
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
  execute: (input: ContentCommand, signal?: AbortSignal) => Promise<RemoteResult<ContentReceipt>>
  receipt: (entryId: string, operationId: string, signal?: AbortSignal) => Promise<RemoteResult<ContentReceipt | null>>
}

/** One metadata intent; the wire rejects an empty command.
 * @property favorite - set or clear the favorite flag.
 * @property archived - set or clear the archived flag.
 * @property addProjectRef - attach one project reference id.
 * @property removeProjectRef - detach one project reference id.
 */
export interface MetadataPatch {
  readonly favorite?: boolean
  readonly archived?: boolean
  readonly addProjectRef?: string
  readonly removeProjectRef?: string
}

/** Settled shape of one library edit attempt. */
export type EditOutcome =
  | { ok: true }
  | { ok: false; error: LibraryError }

/** One open editor seat: a new entry (no id yet) or one existing entry. */
export interface EditorSession {
  readonly entryId: string | null
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
  /** Open editor seat: one new entry (null id) or one existing entry. */
  editor: EditorSession | null
  /** True after a revision conflict re-read while the editor is open. */
  editConflict: boolean
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
  editor: null,
  editConflict: false,
  error: null,
})

const DISPOSED: CaptureOutcome = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'disposed', message: 'content library store is disposed' }),
})

const DISPOSED_EDIT: EditOutcome = DISPOSED
const ENTRY_GONE: LibraryError = Object.freeze({
  code: 'not_found', message: 'the addressed entry is no longer in the view',
})
const DRAFT_GONE: LibraryError = Object.freeze({
  code: 'invalid_transition', message: 'the draft vanished before the edit settled',
})

/**
 * Operation id for one edit attempt. A fresh nonce per command means every
 * user action owns its own idempotency record; the entry address inside
 * keeps retries recognizable while never deriving authority from content.
 * @param entryId - the entry this command addresses.
 * @returns an operation id within the Content identity bound.
 */
function editOperationId(entryId: string): string {
  return `edit-ui:${entryId}:${randomUUID()}`.slice(0, 512)
}

/** Entry id for one manual creation; the Host records it verbatim. */
function newEntryId(): string {
  return `idea-ui:${randomUUID()}`
}

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
  private readonly editAbort = new AbortController()
  private readonly editPromises = new Map<string, Promise<EditOutcome>>()
  private disposed = false
  private editorGeneration = 0

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
   * Re-read status and snapshot, sharing concurrent ordinary refreshes.
   * A committed write or connection reset supersedes this lane, and its
   * aborted or older generation cannot publish a late result.
   */
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve()
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
    return this.refreshAfterWrite()
  }

  /**
   * Open one entry in the workspace detail pane.
   * @param entryId - entry to open, or null to close the pane.
   */
  select(entryId: string | null): void {
    if (this.view.selectedEntryId === entryId) return
    this.editorGeneration += 1
    this.publish({ ...this.view, selectedEntryId: entryId })
  }

  /**
   * Refresh and open an externally addressed entry; newer navigation wins.
   * @param entryId - Content identity from the browser link.
   */
  async openEntry(entryId: string): Promise<void> {
    if (this.disposed) return
    const generation = ++this.editorGeneration
    this.publish({ ...this.view, editor: null, editConflict: false, selectedEntryId: null })
    await this.refreshAfterWrite()
    while (!this.editAbort.signal.aborted && this.loadLane !== null && this.getSnapshot().loadState === 'loading') await this.loadLane
    if (this.editAbort.signal.aborted || generation !== this.editorGeneration || this.getSnapshot().loadState !== 'ready'
      || this.view.status?.phase !== 'ready') return
    if (!this.view.entries.some(entry => entry.id === entryId)) {
      this.publish({ ...this.view, loadState: 'error', error: ENTRY_GONE })
      return
    }
    this.publish({ ...this.view, selectedEntryId: entryId })
  }

  /**
   * Open the editor for one new entry. The create command is issued by the
   * editor's own save verb; this seat only marks the intent.
   */
  beginCreate(): void {
    this.editorGeneration += 1
    this.publish({ ...this.view, editor: Object.freeze({ entryId: null }), editConflict: false })
  }

  /**
   * Close the editor seat. An in-flight edit is not cancelled — it settles
   * and its refresh lands; only the presentation is dropped.
   */
  closeEditor(): void {
    this.editorGeneration += 1
    if (this.view.editor === null) return
    this.publish({ ...this.view, editor: null, editConflict: false })
  }

  /**
   * Clear the conflict mark after the user chose a side; the re-read entry is
   * already in the view and the editor keeps or resets its own text.
   */
  clearConflict(): void {
    if (!this.view.editConflict) return
    this.publish({ ...this.view, editConflict: false })
  }

  /**
   * Open the editor on one entry. A draft that already exists is opened as
   * committed; an original without one is given a draft through a real
   * start-draft command, so the editor never fabricates a base the Host did
   * not record. A start-draft conflict re-reads the entry and remains a
   * failed attempt until the user explicitly reloads and retries.
   * @param entryId - entry to edit.
   */
  async beginEdit(entryId: string): Promise<EditOutcome> {
    if (this.disposed) return DISPOSED_EDIT
    const generation = ++this.editorGeneration
    const entry = this.view.entries.find(item => item.id === entryId)
    if (entry === undefined) return { ok: false, error: ENTRY_GONE }
    if (entry.draft !== null) {
      this.publish({ ...this.view, editor: Object.freeze({ entryId }), editConflict: false })
      return { ok: true }
    }
    const carried = await this.editLane(entryId, async () => this.command(entryId, {
      type: 'start-draft', entryId, operationId: editOperationId(entryId),
      expectedEntryRevision: entry.entryRevision,
    }))
    if (!carried.ok) return carried
    if (generation !== this.editorGeneration) return { ok: false, error: { code: 'cancelled', message: '' } }
    this.publish({ ...this.view, editor: Object.freeze({ entryId }), editConflict: false })
    return { ok: true }
  }

  /**
   * Create one new entry whose first draft holds the given text. The Host
   * owns the entry identity check; the id is minted here only because the
   * wire command requires the caller to name one. On success the editor
   * stays open on the created entry and the detail pane selects it.
   * @param title - draft title.
   * @param body - draft body.
   */
  async createEntry(title: string, body: string): Promise<EditOutcome> {
    if (this.disposed) return DISPOSED_EDIT
    const generation = this.editorGeneration
    const entryId = newEntryId()
    return this.editLane('create', async () => {
      const carried = await this.command(entryId, {
        type: 'create', entryId, operationId: editOperationId(entryId), title, body,
      })
      if (!carried.ok) return carried
      if (generation !== this.editorGeneration) return { ok: false, error: { code: 'cancelled', message: '' } }
      this.publish({ ...this.view, editor: Object.freeze({ entryId }), editConflict: false })
      this.select(entryId)
      return { ok: true }
    })
  }

  /**
   * Save the editor's local text as the entry's draft. Revisions come from
   * the committed view, never from the editor, so a stale base is rejected
   * by the Host rather than predicted here. A revision conflict re-reads
   * exactly this entry and marks the editor conflicted instead of touching
   * the local text. When the draft vanished (another window committed), the
   * save re-opens one through start-draft before writing, which is the
   * "keep my side" path after a conflict.
   * @param title - editor-local title.
   * @param body - editor-local body.
   */
  async saveDraft(title: string, body: string): Promise<EditOutcome> {
    if (this.disposed) return DISPOSED_EDIT
    if (this.view.editConflict) return { ok: false, error: { code: 'revision_conflict', message: '' } }
    const entryId = this.requireEditorEntry()
    return this.editLane(entryId, () => this.saveDraftText(entryId, title, body))
  }

  /**
   * Commit the editor's local text as a new immutable version. The text is
   * first saved into the draft (re-creating one through start-draft when
   * the base has none), then one commit-version command carries the
   * Host-recorded draft into the version list. Both steps run on the
   * entry's edit lane and the view refresh between them settles before the
   * next command reads its guards, so the pair cannot interleave with a
   * stale base.
   * @param title - editor-local title.
   * @param body - editor-local body.
   */
  async commitVersion(title: string, body: string): Promise<EditOutcome> {
    if (this.disposed) return DISPOSED_EDIT
    if (this.view.editConflict) return { ok: false, error: { code: 'revision_conflict', message: '' } }
    const entryId = this.requireEditorEntry()
    const generation = this.editorGeneration
    return this.editLane(entryId, async () => {
      const entry = this.view.entries.find(item => item.id === entryId)
      const draft = entry?.draft ?? null
      const upToDate = entry !== undefined && draft !== null
        && draft.title === title && draft.body === body
      if (!upToDate) {
        const saved = await this.saveDraftText(entryId, title, body)
        if (!saved.ok) return saved
      }
      const fresh = this.view.entries.find(item => item.id === entryId)
      const freshDraft = fresh?.draft ?? null
      if (fresh === undefined || freshDraft === null) return { ok: false, error: DRAFT_GONE }
      const carried = await this.command(entryId, {
        type: 'commit-version', entryId, operationId: editOperationId(entryId),
        expectedDraftRevision: freshDraft.draftRevision, basedOnVersionId: freshDraft.basedOnVersionId,
        expectedHeadVersionId: fresh.headVersionId,
      })
      if (carried.ok && generation === this.editorGeneration) {
        // A committed version closes the editor: the draft it edited is gone.
        this.publish({ ...this.view, editor: null, editConflict: false })
      }
      return carried
    })
  }

  /**
   * Apply one metadata intent (favorite, archive, or project reference).
   * The revision comes from the committed view. A conflict re-reads the
   * entry and returns failure without retrying the user's intent.
   * @param entryId - entry to change.
   * @param patch - the metadata intent, at least one field.
   */
  async setMetadata(entryId: string, patch: MetadataPatch): Promise<EditOutcome> {
    if (this.disposed) return DISPOSED_EDIT
    return this.editLane(entryId, () => this.metadataCommand(entryId, patch))
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
    if (this.view.pendingCapture !== null) return { ok: false, error: { code: 'busy', message: '' } }
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
    this.editAbort.abort()
    this.listeners.clear()
  }

  /** The entry the open editor addresses; editing without a seat is a bug. */
  private requireEditorEntry(): string {
    const entryId = this.view.editor?.entryId ?? null
    if (entryId === null) throw new Error('ui-content: no open editor session')
    return entryId
  }

  /** Refuse overlapping writes rather than return another action's receipt. */
  private async editLane(key: string, run: () => Promise<EditOutcome>): Promise<EditOutcome> {
    if (this.disposed) return DISPOSED_EDIT
    const pending = this.editPromises.get(key)
    if (pending !== undefined) return { ok: false, error: { code: 'busy', message: '' } }
    const attempt = run()
    this.editPromises.set(key, attempt)
    try {
      return await attempt
    } finally {
      this.editPromises.delete(key)
    }
  }

  /**
   * One save with whatever draft base exists; missing bases are re-opened.
   * The caller owns the entry's edit lane, so this core never nests one.
   */
  private async saveDraftText(entryId: string, title: string, body: string): Promise<EditOutcome> {
    if (this.disposed) return DISPOSED_EDIT
    const entry = this.view.entries.find(item => item.id === entryId)
    if (entry === undefined) return { ok: false, error: ENTRY_GONE }
    let draftRevision: number
    let basedOnVersionId: string | null
    if (entry.draft === null) {
      // Another window committed the draft; "keep my side" re-opens one
      // from the current head and writes the local text over it.
      const opened = await this.command(entryId, {
        type: 'start-draft', entryId, operationId: editOperationId(entryId),
        expectedEntryRevision: entry.entryRevision,
      })
      if (!opened.ok) return opened
      const fresh = this.view.entries.find(item => item.id === entryId)
      const freshDraft = fresh?.draft ?? null
      if (freshDraft === null) return { ok: false, error: DRAFT_GONE }
      draftRevision = freshDraft.draftRevision
      basedOnVersionId = freshDraft.basedOnVersionId
    } else {
      draftRevision = entry.draft.draftRevision
      basedOnVersionId = entry.draft.basedOnVersionId
    }
    return this.command(entryId, {
      type: 'save-draft', entryId, operationId: editOperationId(entryId),
      expectedDraftRevision: draftRevision, basedOnVersionId, title, body,
    })
  }

  /** One metadata command against the currently committed revision. */
  private async metadataCommand(entryId: string, patch: MetadataPatch): Promise<EditOutcome> {
    const entry = this.view.entries.find(item => item.id === entryId)
    if (entry === undefined) return { ok: false, error: ENTRY_GONE }
    return this.command(entryId, {
      type: 'metadata', entryId, operationId: editOperationId(entryId),
      expectedEntryRevision: entry.entryRevision, ...patch,
    })
  }

  /**
   * Submit one strict content command and settle its outcome. A revision
   * conflict re-reads the contested entry, refreshes it into the view, and
   * marks the open editor conflicted; a transport loss asks the Host
   * whether the command already committed before reporting failure.
   */
  private async command(entryId: string, input: ContentCommand): Promise<EditOutcome> {
    try {
      const carried = await this.remote.execute(input, this.editAbort.signal)
      if (this.disposed) return DISPOSED_EDIT
      if (!carried.ok) {
        if (carried.error.code === 'revision_conflict') {
          await this.reloadEntry(entryId)
          if (!this.editAbort.signal.aborted && this.view.editor?.entryId === entryId) {
            this.publish({ ...this.view, editConflict: true })
          }
        }
        return { ok: false, error: { code: carried.error.code, message: carried.error.message } }
      }
      // The command is committed. The view refresh settles before the lane
      // returns, so a following command on the same entry reads fresh guards.
      return await this.settleCommittedWrite()
    } catch (error) {
      if (this.disposed) return DISPOSED_EDIT
      // A thrown transport error leaves the commit unknown. The receipt
      // channel answers for this exact operation before failure is shown.
      try {
        const reconciled = await this.remote.receipt(entryId, input.operationId, this.editAbort.signal)
        // dispose() aborts this signal, including while the receipt lookup is in flight.
        if (this.editAbort.signal.aborted) return DISPOSED_EDIT
        if (reconciled.ok && reconciled.value !== null) {
          return await this.settleCommittedWrite()
        }
      } catch {
        // The receipt query itself failed; the original transport loss stands.
      }
      return {
        ok: false,
        error: { code: 'transport', message: error instanceof Error ? error.message : String(error) },
      }
    }
  }

  /**
   * Re-read exactly one entry and splice it into the view; a vanished entry
   * falls back to a whole-library refresh, which also clears it from the
   * list.
   * @param entryId - entry to re-read.
   * @returns true when the fresh entry landed in the view.
   */
  private async reloadEntry(entryId: string): Promise<boolean> {
    this.loadGeneration += 1
    this.loadAbort?.abort()
    this.loadLane = null
    try {
      const carried = await this.remote.get(entryId, this.editAbort.signal)
      if (this.disposed || !carried.ok) return false
      if (carried.value === null) {
        void this.refresh()
        return false
      }
      const entries = this.view.entries.filter(item => item.id !== entryId)
      entries.push(carried.value)
      this.publish({ ...this.view, entries: Object.freeze(entries) })
      return true
    } catch {
      return false
    }
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
      void this.refreshAfterWrite()
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

  /** A committed write or new connection invalidates every earlier read. */
  private refreshAfterWrite(): Promise<void> {
    this.loadAbort?.abort()
    this.loadLane = null
    return this.refresh()
  }

  /** Do not release a successful edit on an unreadable or closed baseline. */
  private async settleCommittedWrite(): Promise<EditOutcome> {
    await this.refreshAfterWrite()
    while (!this.disposed && this.loadLane !== null && this.view.loadState === 'loading') await this.loadLane
    if (this.disposed) return DISPOSED_EDIT
    if (this.view.error !== null) return { ok: false, error: this.view.error }
    if (this.view.status?.phase !== 'ready') {
      return { ok: false, error: { code: this.view.status?.phase ?? 'unavailable', message: '' } }
    }
    return { ok: true }
  }

  /** Replace the view and contain subscriber failures at the observable boundary. */
  private publish(view: ContentLibraryView): void {
    if (this.disposed) return
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
