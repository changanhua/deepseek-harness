// @vitest-environment jsdom
/**
 * The library workspace's visible states: it loads on mount, renders
 * failure/phase/empty surfaces each with their own copy, lists committed
 * entries with their badges, opens a detail pane through the select verb,
 * and disables the refresh control while a load is running.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  ContentEntry, ContentSnapshot, ContentStatus,
} from '@changanhua/dsh-content/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ContentLibraryStore, type ContentLibraryRemote } from '../src/client/controller.ts'
import { ContentLibraryWorkspace } from '../src/client/ContentLibraryWorkspace.tsx'
import type { LibraryWorkspaceProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh, commonZh)

const READY_STATUS = {
  ok: true as const,
  value: { phase: 'ready' as const, reason: null, limits: { bodyBytes: 1, entryBytes: 1, libraryBytes: 1 } },
}

afterEach(cleanup)

/** A committed capture entry with one head version. */
function entry(id = 'source_x', overrides: Partial<ContentEntry> = {}): ContentEntry {
  const operation = {
    operationId: `op-${id}`, requestDigest: 'a'.repeat(64),
    result: { operationId: `op-${id}`, entryId: id, entryRevision: 1, draftRevision: null, versionId: 'v1' },
  }
  return {
    id, kind: 'original', createdAt: '2026-09-06T00:00:00.000Z', entryRevision: 1,
    source: {
      type: 'session-message', sessionId: 's1', messageId: '34', captureId: 'c1',
      scope: 'full-message', verification: 'host-verified', boundary: 'completed-text',
    },
    versions: [{
      id: 'v1', number: 1, title: 'Captured reply', body: 'BODY TEXT', bodySha256: 'b'.repeat(64),
      createdAt: '2026-09-06T00:00:00.000Z', operation,
    }],
    headVersionId: 'v1', draft: null, projectRefs: [], favorite: false, archived: false,
    creation: operation, receipts: [operation],
    ...overrides,
  }
}

interface RemoteScript {
  status?: () => Promise<RemoteResult<ContentStatus>>
  snapshot?: () => Promise<RemoteResult<ContentSnapshot>>
}

/** A remote double publishing the scripted replies to a real store. */
function remote(script: RemoteScript = {}) {
  const face: ContentLibraryRemote = {
    status: script.status ?? (() => Promise.resolve({
      ok: true as const,
      value: { phase: 'ready', reason: null, limits: { bodyBytes: 1, entryBytes: 1, libraryBytes: 1 } },
    })),
    snapshot: script.snapshot ?? (() => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [] } })),
    get: () => Promise.resolve({ ok: true as const, value: null }),
    capture: () => Promise.resolve({
      ok: true as const,
      value: { operationId: 'op', entryId: 'source_x', entryRevision: 1, draftRevision: null, versionId: 'v1' },
    }),
  }
  return face
}

interface MountOptions {
  readonly remote?: ContentLibraryRemote
  readonly refresh?: () => void
  readonly select?: (entryId: string | null) => void
}

/** Mount the workspace over a real store; the verbs default to the store's. */
function mount(options: MountOptions = {}) {
  const store = new ContentLibraryStore(options.remote ?? remote())
  const useLibrary = bindSnapshotSelector(store)
  const refresh = options.refresh ?? (() => { void store.refresh() })
  const select = options.select ?? ((entryId: string | null) => { store.select(entryId) })
  const props = { useLibrary, refresh, select, t } as unknown as LibraryWorkspaceProps
  const ui = render(<ContentLibraryWorkspace {...props} />)
  return { ui, store, refresh: options.refresh, select: options.select }
}

describe('ContentLibraryWorkspace', () => {
  it('loads the library on mount and renders the entries newest first', async () => {
    const older = entry('source_old', {
      createdAt: '2026-09-05T00:00:00.000Z',
      versions: [{
        id: 'v1', number: 1, title: 'Older capture', body: 'OLD BODY', bodySha256: 'b'.repeat(64),
        createdAt: '2026-09-05T00:00:00.000Z',
        operation: {
          operationId: 'op-source_old', requestDigest: 'a'.repeat(64),
          result: { operationId: 'op-source_old', entryId: 'source_old', entryRevision: 1, draftRevision: null, versionId: 'v1' },
        },
      }],
    })
    const { store } = mount({
      remote: remote({ snapshot: () => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [older, entry()] } }) }),
    })

    await waitFor(() => { expect(screen.getByText('Captured reply')).toBeTruthy() })
    expect(screen.getByText('Older capture')).toBeTruthy()
    // Newest first: the freshly created entry heads the list.
    const list = document.querySelector('ul')
    expect(list?.firstElementChild?.textContent).toContain('Captured reply')
    expect(list?.lastElementChild?.textContent).toContain('Older capture')
    store.dispose()
  })

  it('renders an empty library with its hint once the medium is ready', async () => {
    const { store } = mount()

    await waitFor(() => { expect(screen.getByText(zh['library.empty'])).toBeTruthy() })
    expect(screen.getByText(zh['library.emptyHint'])).toBeTruthy()
    store.dispose()
  })

  it('renders a Host opening/unavailable phase instead of a list', async () => {
    const { store } = mount({
      remote: remote({ status: () => Promise.resolve({
        ok: true as const,
        value: { phase: 'opening', reason: null, limits: { bodyBytes: 1, entryBytes: 1, libraryBytes: 1 } },
      }) }),
    })

    await waitFor(() => { expect(screen.getByText(zh['status.opening'])).toBeTruthy() })
    expect(screen.queryByText(zh['library.empty'])).toBeNull()
    store.dispose()
  })

  it('renders an unavailable phase with the Host reason', async () => {
    const { store } = mount({
      remote: remote({
        status: () => Promise.resolve({
          ok: true as const,
          value: { phase: 'unavailable', reason: 'storage_failed', limits: { bodyBytes: 1, entryBytes: 1, libraryBytes: 1 } },
        }),
      }),
    })

    await waitFor(() => { expect(screen.getByText(`${zh['status.unavailable']} · ${zh['error.storage_failed']}`)).toBeTruthy() })
    store.dispose()
  })

  it('surfaces load failures with a retry that re-reads', async () => {
    let failing = true
    const { store } = mount({
      remote: remote({
        status: () => failing
          ? Promise.resolve({ ok: false as const, error: { code: 'forbidden', message: 'denied', details: {} } })
          : Promise.resolve(READY_STATUS),
      }),
    })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(zh['error.forbidden'])
    failing = false
    fireEvent.click(screen.getByRole('button', { name: zh['action.retry'] }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    store.dispose()
  })

  it('opens a detail pane with the committed body through the select verb', async () => {
    const select = vi.fn()
    const { store } = mount({
      select,
      remote: remote({ snapshot: () => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [entry()] } }) }),
    })

    await waitFor(() => { expect(screen.getByText('Captured reply')).toBeTruthy() })
    fireEvent.click(screen.getByText('Captured reply'))
    expect(select).toHaveBeenCalledWith('source_x')

    act(() => { store.select('source_x') })
    expect(screen.getByText('BODY TEXT')).toBeTruthy()
    expect(screen.getByText(`${zh['detail.source']}: ${zh['detail.source.session']}`)).toBeTruthy()

    fireEvent.click(screen.getByText('Captured reply'))
    expect(select).toHaveBeenLastCalledWith(null)
    store.dispose()
  })

  it('disables the refresh control while a load runs', async () => {
    let release: (() => void) | undefined
    const { store } = mount({
      remote: remote({
        status: () => new Promise<RemoteResult<ContentStatus>>((resolve) => {
          release = () => {
            resolve({
              ok: true as const,
              value: { phase: 'ready', reason: null, limits: { bodyBytes: 1, entryBytes: 1, libraryBytes: 1 } },
            })
          }
        }),
      }),
    })

    const refreshButton = (): HTMLButtonElement => screen.getByRole('button', { name: zh['action.refresh'] })
    await waitFor(() => { expect(refreshButton().disabled).toBe(true) })
    release?.()
    await waitFor(() => { expect(refreshButton().disabled).toBe(false) })
    store.dispose()
  })

  it('reports the store progress through the loading state', async () => {
    let release: (() => void) | undefined
    mount({
      remote: remote({
        status: () => new Promise<RemoteResult<ContentStatus>>((resolve) => {
          release = () => {
            resolve({
              ok: true as const,
              value: { phase: 'ready', reason: null, limits: { bodyBytes: 1, entryBytes: 1, libraryBytes: 1 } },
            })
          }
        }),
      }),
    })

    expect(await screen.findByRole('status')).toBeTruthy()
    release?.()
    await waitFor(() => { expect(screen.getByText(zh['library.empty'])).toBeTruthy() })
  })
})
