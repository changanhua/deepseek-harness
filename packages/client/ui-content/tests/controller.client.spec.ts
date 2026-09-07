/**
 * The library store's single state machine: one load lane with superseded
 * results discarded, Host phases rendered verbatim, per-message capture
 * attempts deduplicated in flight and re-minted per attempt, and a disposed
 * store refusing further work.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ContentDraft, ContentEntry, ContentReceipt, ContentStatus } from '@changanhua/dsh-content/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ContentLibraryRemote } from '../src/client/controller.ts'
import { ContentLibraryStore } from '../src/client/controller.ts'
import type { CaptureTarget } from '../src/client/capture-target.ts'

const TARGET: CaptureTarget = { seq: 34, messageId: 'm-1' }
const SESSION = 's1' as SessionId

function receipt(overrides: Partial<ContentReceipt> = {}): ContentReceipt {
  return { operationId: 'op-1', entryId: 'source_x', entryRevision: 1, draftRevision: null, versionId: 'v1', ...overrides }
}

function status(phase: ContentStatus['phase'] = 'ready'): ContentStatus {
  return { phase, reason: null, limits: { bodyBytes: 64, entryBytes: 64, libraryBytes: 64 } }
}

function entry(id = 'source_x'): ContentEntry {
  const operation = {
    operationId: `op-${id}`, requestDigest: 'a'.repeat(64),
    result: receipt({ operationId: `op-${id}`, entryId: id }),
  }
  return {
    id, kind: 'original', createdAt: '2026-09-06T00:00:00.000Z', entryRevision: 1,
    source: {
      type: 'session-message', sessionId: SESSION, messageId: '34', captureId: 'c1',
      scope: 'full-message', verification: 'host-verified', boundary: 'completed-text',
    },
    versions: [{
      id: 'v1', number: 1, title: 'T', body: 'BODY', bodySha256: 'b'.repeat(64),
      createdAt: '2026-09-06T00:00:00.000Z', operation,
    }],
    headVersionId: 'v1', draft: null, projectRefs: [], favorite: false, archived: false,
    creation: operation, receipts: [operation],
  }
}

/** The snapshot reply shape the store reads. */
interface ContentSnapshotLike {
  formatVersion: 1
  entries: ContentEntry[]
}

interface RemoteScript {
  status?: (signal?: AbortSignal) => Promise<RemoteResult<ContentStatus>>
  snapshot?: (signal?: AbortSignal) => Promise<RemoteResult<ContentSnapshotLike>>
  capture?: (
    input: { operationId: string; sessionId: string; messageId: string },
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ContentReceipt>>
  get?: (entryId: string, signal?: AbortSignal) => Promise<RemoteResult<ContentEntry | null>>
  execute?: (input: Record<string, unknown>, signal?: AbortSignal) => Promise<RemoteResult<ContentReceipt>>
  receipt?: (entryId: string, operationId: string, signal?: AbortSignal) => Promise<RemoteResult<ContentReceipt | null>>
}

const EMPTY_SNAPSHOT: ContentSnapshotLike = { formatVersion: 1, entries: [] }

/** A recording remote double whose replies arrive through the given gates. */
function remote(script: RemoteScript = {}) {
  const calls: { method: string; args: unknown }[] = []
  const remote: ContentLibraryRemote = {
    status: (signal) => {
      calls.push({ method: 'status', args: { aborted: signal?.aborted } })
      return script.status?.() ?? Promise.resolve({ ok: true as const, value: status() })
    },
    snapshot: (signal) => {
      calls.push({ method: 'snapshot', args: { aborted: signal?.aborted } })
      return script.snapshot?.() ?? Promise.resolve({ ok: true as const, value: EMPTY_SNAPSHOT })
    },
    get: (entryId, signal) => {
      calls.push({ method: 'get', args: { entryId, aborted: signal?.aborted } })
      return script.get?.(entryId, signal) ?? Promise.resolve({ ok: true as const, value: null })
    },
    capture: (input, signal) => {
      calls.push({ method: 'capture', args: { ...input, aborted: signal?.aborted } })
      return script.capture?.(input, signal) ?? Promise.resolve({ ok: true as const, value: receipt() })
    },
    execute: (input, signal) => {
      calls.push({ method: 'execute', args: { ...(input as Record<string, unknown>), aborted: signal?.aborted } })
      return script.execute?.(input, signal) ?? Promise.resolve({ ok: true as const, value: receipt({ draftRevision: 1 }) })
    },
    receipt: (entryId, operationId, signal) => {
      calls.push({ method: 'receipt', args: { entryId, operationId, aborted: signal?.aborted } })
      return script.receipt?.(entryId, operationId, signal) ?? Promise.resolve({ ok: true as const, value: null })
    },
  }
  return { calls, remote }
}

function entryOf(value: unknown): ContentEntry {
  return value as ContentEntry
}

describe('ContentLibraryStore load lane', () => {
  it('loads once from idle and renders the snapshot entries', async () => {
    const { remote: face, calls } = remote({
      snapshot: () => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [entry()] } }),
    })
    const store = new ContentLibraryStore(face)

    await store.ensure()
    expect(store.getSnapshot()).toMatchObject({ loadState: 'ready', status: status() })
    expect(store.getSnapshot().entries.map(item => entryOf(item).id)).toEqual(['source_x'])
    expect(calls.map(call => call.method)).toEqual(['status', 'snapshot'])

    await store.ensure()
    expect(calls).toHaveLength(2)
    store.dispose()
  })

  it('publishes a non-ready Host phase verbatim without a snapshot read', async () => {
    const { remote: face, calls } = remote({ status: () => Promise.resolve({ ok: true as const, value: status('opening') }) })
    const store = new ContentLibraryStore(face)

    await store.refresh()
    const view = store.getSnapshot()
    expect(view.loadState).toBe('ready')
    expect(view.status?.phase).toBe('opening')
    expect(view.entries).toEqual([])
    expect(calls.map(call => call.method)).toEqual(['status'])
    store.dispose()
  })

  it('settles carrier failures into a retryable error state', async () => {
    const { remote: face } = remote({
      status: () => Promise.resolve({ ok: false as const, error: { code: 'forbidden', message: 'Content operation failed: forbidden', details: {} } }),
    })
    const store = new ContentLibraryStore(face)

    await store.refresh()
    expect(store.getSnapshot()).toMatchObject({
      loadState: 'error',
      error: { code: 'forbidden', message: 'Content operation failed: forbidden' },
    })
    store.dispose()
  })

  it('collapses concurrent refreshes onto one lane; nothing lands twice', async () => {
    let statusCalls = 0
    let release: (() => void) | undefined
    const { remote: face } = remote({
      status: () => new Promise((resolve) => {
        statusCalls += 1
        release = () => { resolve({ ok: true as const, value: status() }) }
      }),
    })
    const store = new ContentLibraryStore(face)
    const seen: string[] = []
    store.subscribe(() => { seen.push(`${store.getSnapshot().loadState}:${store.getSnapshot().status?.phase ?? '-'}`) })

    // The first refresh hangs; a second caller joins the same lane instead of
    // starting a competing load, so one response settles both callers.
    const first = store.refresh()
    const second = store.refresh()
    release?.()
    await Promise.all([first, second])

    expect(statusCalls).toBe(1)
    expect(store.getSnapshot()).toMatchObject({ loadState: 'ready', status: status() })
    expect(seen.filter(state => state === 'ready:ready')).toHaveLength(1)
    store.dispose()
  })

  it('resync after transport reset re-reads; an idle store stays idle', async () => {
    const { remote: face, calls } = remote()
    const store = new ContentLibraryStore(face)

    await store.resync()
    expect(calls).toEqual([])

    await store.refresh()
    await store.resync()
    expect(calls.length).toBeGreaterThanOrEqual(4)
    store.dispose()
  })
})

describe('ContentLibraryStore capture', () => {
  it('sends only the operation id, session id, and event sequence', async () => {
    const { remote: face, calls } = remote()
    const store = new ContentLibraryStore(face)

    const outcome = await store.capture(SESSION, TARGET)
    expect(outcome).toMatchObject({ ok: true, entryId: 'source_x' })
    const args = calls.find(call => call.method === 'capture')?.args as {
      operationId: string
      sessionId: string
      messageId: string
      aborted: boolean
    }
    expect(Object.keys(args).sort()).toEqual(['aborted', 'messageId', 'operationId', 'sessionId'])
    expect(args).toMatchObject({ sessionId: SESSION, messageId: '34', aborted: false })
    expect(args.operationId).toMatch(/^capture-ui:s1:34:/u)
    store.dispose()
  })

  it('deduplicates concurrent clicks of one message onto a single attempt', async () => {
    let releaseCapture: (() => void) | undefined
    let wireCalls = 0
    const { remote: face } = remote({
      capture: () => new Promise((resolve) => {
        wireCalls += 1
        releaseCapture = () => { resolve({ ok: true as const, value: receipt() }) }
      }),
    })
    const store = new ContentLibraryStore(face)

    const first = store.capture(SESSION, TARGET)
    const second = store.capture(SESSION, TARGET)
    releaseCapture?.()
    await Promise.all([first, second])

    expect(wireCalls).toBe(1)
    store.dispose()
  })

  it('mints a fresh operation id for a later attempt after a failure', async () => {
    const operationIds: string[] = []
    let flip = false
    const { remote: face, calls } = remote({
      capture: () => {
        flip = !flip
        return flip
          ? Promise.resolve({ ok: false as const, error: { code: 'unavailable', message: 'down', details: {} } })
          : Promise.resolve({ ok: true as const, value: receipt() })
      },
    })
    const store = new ContentLibraryStore(face)

    const failed = await store.capture(SESSION, TARGET)
    expect(failed).toMatchObject({ ok: false, error: { code: 'unavailable' } })
    const retry = await store.capture(SESSION, TARGET)
    expect(retry).toMatchObject({ ok: true, entryId: 'source_x' })
    for (const call of calls.filter(item => item.method === 'capture')) {
      operationIds.push((call.args as { operationId: string }).operationId)
    }
    expect(new Set(operationIds).size).toBe(2)
    store.dispose()
  })

  it('reports the attempt as pending while it is in flight, then clears it', async () => {
    let releaseCapture: (() => void) | undefined
    const { remote: face } = remote({
      capture: () => new Promise((resolve) => {
        releaseCapture = () => { resolve({ ok: true as const, value: receipt() }) }
      }),
    })
    const store = new ContentLibraryStore(face)

    const pending = store.capture(SESSION, TARGET)
    expect(store.getSnapshot().pendingCapture).toMatchObject({ key: `${SESSION}:34`, sessionId: SESSION, seq: 34 })
    releaseCapture?.()
    await pending
    expect(store.getSnapshot().pendingCapture).toBeNull()
    expect(store.getSnapshot().captured.get(`${SESSION}:34`)).toBe('source_x')
    store.dispose()
  })

  it('re-reads the snapshot after a successful capture', async () => {
    const { remote: face, calls } = remote({
      snapshot: () => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [entry()] } }),
    })
    const store = new ContentLibraryStore(face)

    await store.capture(SESSION, TARGET)
    // status+snapshot for the post-capture refresh, on top of the capture call.
    await vi.waitFor(() => {
      expect(calls.filter(call => call.method === 'snapshot')).toHaveLength(1)
    })
    expect(store.getSnapshot().entries.map(item => entryOf(item).id)).toEqual(['source_x'])
    store.dispose()
  })
})

/** An entry holding a draft (an idea entry with draftRevision 1). */
function draftedEntry(id = 'idea_x', draft: Partial<ContentDraft> = {}): ContentEntry {
  const operation = {
    operationId: `op-${id}`, requestDigest: 'a'.repeat(64),
    result: { operationId: `op-${id}`, entryId: id, entryRevision: 1, draftRevision: 1, versionId: null },
  }
  return {
    id, kind: 'idea', createdAt: '2026-09-06T00:00:00.000Z', entryRevision: 1,
    source: null, versions: [], headVersionId: null,
    draft: { title: 'D', body: 'BODY', draftRevision: 1, basedOnVersionId: null, ...draft },
    projectRefs: [], favorite: false, archived: false, creation: operation, receipts: [operation],
  }
}

describe('ContentLibraryStore editor and edit commands', () => {
  it('opens the editor seat for a new entry and for an entry with a draft', async () => {
    const { remote: face } = remote({
      snapshot: () => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [draftedEntry()] } }),
    })
    const store = new ContentLibraryStore(face)
    await store.refresh()

    store.beginCreate()
    expect(store.getSnapshot().editor).toMatchObject({ entryId: null })
    store.closeEditor()
    expect(store.getSnapshot().editor).toBeNull()

    const outcome = await store.beginEdit('idea_x')
    expect(outcome).toMatchObject({ ok: true })
    expect(store.getSnapshot().editor).toMatchObject({ entryId: 'idea_x' })
    store.dispose()
  })

  it('opens a draft through a real start-draft command for an original without one', async () => {
    const { remote: face, calls } = remote({
      snapshot: () => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [entry()] } }),
      get: () => Promise.resolve({ ok: true as const, value: {
        ...entry(), entryRevision: 2,
        draft: { title: 'T', body: 'BODY', draftRevision: 2, basedOnVersionId: 'v1' },
        receipts: entry().receipts,
      } }),
      execute: input => Promise.resolve({
        ok: true as const,
        value: receipt({ operationId: (input as { operationId: string }).operationId, draftRevision: 2 }),
      }),
    })
    const store = new ContentLibraryStore(face)
    await store.refresh()

    const outcome = await store.beginEdit('source_x')
    expect(outcome).toMatchObject({ ok: true })
    const start = calls.find(call => call.method === 'execute')
    const command = start?.args as { type: string; expectedEntryRevision: number }
    expect(command.type).toBe('start-draft')
    expect(command.expectedEntryRevision).toBe(1)
    expect(store.getSnapshot().editor).toMatchObject({ entryId: 'source_x' })
    store.dispose()
  })

  it('creates a new entry with the editor text and opens the seat on it', async () => {
    const { remote: face, calls } = remote({
      execute: (input) => {
        const command = input as { type: string; entryId: string }
        return Promise.resolve({
          ok: true as const,
          value: receipt({ entryId: command.entryId, operationId: (input as { operationId: string }).operationId, draftRevision: 1 }),
        })
      },
    })
    const store = new ContentLibraryStore(face)
    store.beginCreate()

    const outcome = await store.createEntry('Title', 'Body text')
    expect(outcome).toMatchObject({ ok: true })
    const create = calls.find(call => call.method === 'execute')
    const command = create?.args as { type: string; title: string; body: string; entryId: string }
    expect(command.type).toBe('create')
    expect(command.title).toBe('Title')
    expect(command.body).toBe('Body text')
    expect(command.entryId).toMatch(/^idea-ui:/u)
    expect(store.getSnapshot().editor?.entryId).toMatch(/^idea-ui:/u)
    expect(store.getSnapshot().selectedEntryId).toBe(command.entryId)
    store.dispose()
  })

  it('saves the draft with the current draft guards, then updates the view', async () => {
    const { remote: face, calls } = remote({
      snapshot: () => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [draftedEntry()] } }),
      execute: input => Promise.resolve({
        ok: true as const,
        value: receipt({ operationId: (input as { operationId: string }).operationId, draftRevision: 2 }),
      }),
    })
    const store = new ContentLibraryStore(face)
    await store.refresh()
    await store.beginEdit('idea_x')

    const outcome = await store.saveDraft('New title', 'New body')
    expect(outcome).toMatchObject({ ok: true })
    const save = calls.find(call => call.method === 'execute')
    const command = save?.args as {
      type: string
      expectedDraftRevision: number
      basedOnVersionId: string | null
      title: string
      body: string
    }
    expect(command.type).toBe('save-draft')
    expect(command.expectedDraftRevision).toBe(1)
    expect(command.basedOnVersionId).toBeNull()
    expect(command.title).toBe('New title')
    expect(command.body).toBe('New body')
    store.dispose()
  })

  it('re-opens a vanished draft through start-draft and then saves the local text', async () => {
    let conflict = true
    const { remote: face, calls } = remote({
      snapshot: () => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [draftedEntry()] } }),
      // The conflict re-read returns an original whose draft another window
      // already committed, so the re-read view entry has no draft.
      get: () => Promise.resolve({ ok: true as const, value: entry('idea_x') }),
      execute: (input) => {
        const command = input as { type: string }
        if (command.type === 'save-draft' && conflict) {
          conflict = false
          return Promise.resolve({ ok: false as const, error: { code: 'revision_conflict', message: 'stale', details: {} } })
        }
        return Promise.resolve({
          ok: true as const,
          value: receipt({ operationId: (input as { operationId: string }).operationId, draftRevision: 2 }),
        })
      },
    })
    const store = new ContentLibraryStore(face)
    await store.refresh()
    await store.beginEdit('idea_x')

    // A save hits a conflict and re-reads; the re-read shows no draft.
    const conflicted = await store.saveDraft('Keep', 'Mine')
    expect(conflicted).toMatchObject({ ok: false, error: { code: 'revision_conflict' } })
    expect(store.getSnapshot().editConflict).toBe(true)
    store.clearConflict()

    // "Keep my side": the next save re-opens a draft, then writes the text.
    const retried = await store.saveDraft('Keep', 'Mine')
    expect(retried).toMatchObject({ ok: true })
    const executed = calls.filter(call => call.method === 'execute')
    expect(executed.map(call => (call.args as { type: string }).type)).toEqual(['save-draft', 'start-draft', 'save-draft'])
    store.dispose()
  })

  it('revision conflict re-reads the entry and marks the editor conflicted', async () => {
    let conflict = true
    const { remote: face, calls } = remote({
      snapshot: () => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [draftedEntry()] } }),
      get: () => Promise.resolve({ ok: true as const, value: draftedEntry('idea_x') }),
      execute: () => conflict
        ? Promise.resolve({ ok: false as const, error: { code: 'revision_conflict', message: 'stale', details: {} } })
        : Promise.resolve({ ok: true as const, value: receipt({ draftRevision: 2 }) }),
    })
    const store = new ContentLibraryStore(face)
    await store.refresh()
    await store.beginEdit('idea_x')

    const failed = await store.saveDraft('Mine', 'Text')
    expect(failed).toMatchObject({ ok: false, error: { code: 'revision_conflict' } })
    expect(store.getSnapshot().editConflict).toBe(true)
    expect(calls.filter(call => call.method === 'get')).toHaveLength(1)

    store.clearConflict()
    expect(store.getSnapshot().editConflict).toBe(false)
    conflict = false
    const retried = await store.saveDraft('Mine', 'Text')
    expect(retried).toMatchObject({ ok: true })
    store.dispose()
  })

  it('commits a version by saving then committing, and closes the editor', async () => {
    const { remote: face, calls } = remote({
      snapshot: () => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [draftedEntry()] } }),
      execute: (input) => {
        const command = input as { type: string }
        if (command.type === 'save-draft') {
          return Promise.resolve({
            ok: true as const,
            value: receipt({ operationId: (input as { operationId: string }).operationId, draftRevision: 2 }),
          })
        }
        return Promise.resolve({
          ok: true as const,
          value: receipt({ operationId: (input as { operationId: string }).operationId, draftRevision: null, versionId: 'v2' }),
        })
      },
    })
    const store = new ContentLibraryStore(face)
    await store.refresh()
    await store.beginEdit('idea_x')

    const outcome = await store.commitVersion('Final', 'Body')
    expect(outcome).toMatchObject({ ok: true })
    const executed = calls.filter(call => call.method === 'execute')
    expect(executed.map(call => (call.args as { type: string }).type)).toEqual(['save-draft', 'commit-version'])
    expect(store.getSnapshot().editor).toBeNull()
    store.dispose()
  })

  it('re-reads a metadata conflict without silently retrying the write', async () => {
    let conflict = true
    const { remote: face, calls } = remote({
      snapshot: () => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [draftedEntry()] } }),
      get: () => Promise.resolve({ ok: true as const, value: draftedEntry('idea_x') }),
      execute: (input) => {
        if (conflict) {
          conflict = false
          return Promise.resolve({ ok: false as const, error: { code: 'revision_conflict', message: 'stale', details: {} } })
        }
        return Promise.resolve({
          ok: true as const,
          value: receipt({ operationId: (input as { operationId: string }).operationId, draftRevision: 1 }),
        })
      },
    })
    const store = new ContentLibraryStore(face)
    await store.refresh()

    const outcome = await store.setMetadata('idea_x', { favorite: true })
    expect(outcome).toMatchObject({ ok: false, error: { code: 'revision_conflict' } })
    const executed = calls.filter(call => call.method === 'execute')
    expect(executed).toHaveLength(1)
    expect((executed[0]?.args as { type: string }).type).toBe('metadata')
    expect(calls.filter(call => call.method === 'get')).toHaveLength(1)
    store.dispose()
  })

  it('refuses a different write while a draft save owns the entry', async () => {
    let settle!: (value: RemoteResult<ContentReceipt>) => void
    const { remote: face, calls } = remote({
      snapshot: () => Promise.resolve({ ok: true, value: { formatVersion: 1, entries: [draftedEntry()] } }),
      execute: () => new Promise((resolve) => { settle = resolve }),
    })
    const store = new ContentLibraryStore(face)
    await store.refresh()
    await store.beginEdit('idea_x')
    const saving = store.saveDraft('New', 'Body')
    const metadata = store.setMetadata('idea_x', { favorite: true })
    expect(calls.filter(call => call.method === 'execute')).toHaveLength(1)
    settle({ ok: true, value: receipt() })
    await saving
    expect(await metadata).toMatchObject({ ok: false, error: { code: 'busy' } })
    store.dispose()
  })

  it('a completed write supersedes an older snapshot before returning', async () => {
    let settle!: (value: RemoteResult<ContentSnapshotLike>) => void
    let reads = 0
    const fresh = { ...draftedEntry(), entryRevision: 2, favorite: true }
    const { remote: face } = remote({
      snapshot: () => {
        reads += 1
        if (reads === 2) return new Promise((resolve) => { settle = resolve })
        return Promise.resolve({ ok: true, value: { formatVersion: 1, entries: [reads === 1 ? draftedEntry() : fresh] } })
      },
    })
    const store = new ContentLibraryStore(face)
    await store.refresh()
    const oldRead = store.refresh()
    await vi.waitFor(() => { expect(reads).toBe(2) })
    const writing = store.setMetadata('idea_x', { favorite: true })
    await vi.waitFor(() => { expect(reads).toBe(3) })
    expect(await writing).toEqual({ ok: true })
    settle({ ok: true, value: { formatVersion: 1, entries: [draftedEntry()] } })
    await oldRead
    expect(store.getSnapshot().entries[0]).toMatchObject({ entryRevision: 2, favorite: true })
    store.dispose()
  })

  it('does not report a write as ready when the following snapshot fails', async () => {
    let reads = 0
    const { remote: face } = remote({ snapshot: () => ++reads === 1
      ? Promise.resolve({ ok: true, value: { formatVersion: 1, entries: [draftedEntry()] } })
      : Promise.resolve({ ok: false, error: { code: 'closed', message: 'closed', details: {} } }),
    })
    const store = new ContentLibraryStore(face)
    await store.refresh()
    expect(await store.setMetadata('idea_x', { favorite: true })).toMatchObject({ ok: false, error: { code: 'closed' } })
    expect(store.getSnapshot().entries[0]?.favorite).toBe(false)
    store.dispose()
  })

  it('does not reopen an editor after navigation superseded start-draft', async () => {
    let settle!: (value: RemoteResult<ContentReceipt>) => void
    const { remote: face } = remote({
      snapshot: () => Promise.resolve({ ok: true, value: { formatVersion: 1, entries: [entry()] } }),
      execute: () => new Promise((resolve) => { settle = resolve }),
    })
    const store = new ContentLibraryStore(face)
    await store.refresh()
    const opening = store.beginEdit('source_x')
    store.beginCreate()
    settle({ ok: true, value: receipt() })
    await opening
    expect(store.getSnapshot().editor).toEqual({ entryId: null })
    store.dispose()
  })

  it('reconciles a lost transport via the receipt channel before reporting failure', async () => {
    const { remote: face, calls } = remote({
      snapshot: () => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [draftedEntry()] } }),
      execute: () => Promise.reject(new Error('wire dropped')),
      receipt: () => Promise.resolve({ ok: true as const, value: receipt({ draftRevision: 2 }) }),
    })
    const store = new ContentLibraryStore(face)
    await store.refresh()
    await store.beginEdit('idea_x')

    const outcome = await store.saveDraft('T', 'B')
    expect(outcome).toMatchObject({ ok: true })
    expect(calls.filter(call => call.method === 'receipt')).toHaveLength(1)
    store.dispose()
  })
})

describe('ContentLibraryStore selection and disposal', () => {
  it('opens and closes the detail pane', async () => {
    const { remote: face } = remote({
      snapshot: () => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [entry()] } }),
    })
    const store = new ContentLibraryStore(face)

    await store.refresh()
    store.select('source_x')
    expect(store.getSnapshot().selectedEntryId).toBe('source_x')
    store.select('source_x')
    store.select(null)
    expect(store.getSnapshot().selectedEntryId).toBeNull()
    store.dispose()
  })

  it('refuses work after disposal and aborts the in-flight request', async () => {
    let seenSignal: AbortSignal | undefined
    const { remote: face, calls } = remote({
      capture: (_input, signal) => new Promise<RemoteResult<ContentReceipt>>((_resolve, reject) => {
        seenSignal = signal
        // A real carrier rejects when its signal aborts; the double matches.
        signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
      }),
    })
    const store = new ContentLibraryStore(face)

    const inFlight = store.capture(SESSION, TARGET)
    store.dispose()
    // The in-flight attempt settles as refused, never as committed.
    const outcome = await inFlight
    expect(outcome).toMatchObject({ ok: false, error: { code: 'disposed' } })
    expect(seenSignal?.aborted).toBe(true)
    expect(await store.capture(SESSION, TARGET)).toMatchObject({ ok: false, error: { code: 'disposed' } })
    expect(calls.filter(call => call.method === 'capture')).toHaveLength(1)
  })
})
