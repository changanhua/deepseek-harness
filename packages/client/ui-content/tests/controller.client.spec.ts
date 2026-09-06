/**
 * The library store's single state machine: one load lane with superseded
 * results discarded, Host phases rendered verbatim, per-message capture
 * attempts deduplicated in flight and re-minted per attempt, and a disposed
 * store refusing further work.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ContentEntry, ContentReceipt, ContentStatus } from '@changanhua/dsh-content/types'
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
    get: () => Promise.resolve({ ok: true as const, value: null }),
    capture: (input, signal) => {
      calls.push({ method: 'capture', args: { ...input, aborted: signal?.aborted } })
      return script.capture?.(input, signal) ?? Promise.resolve({ ok: true as const, value: receipt() })
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
