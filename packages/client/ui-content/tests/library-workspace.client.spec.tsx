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
  ContentEntry, ContentReceipt, ContentSnapshot, ContentStatus,
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
  get?: (entryId: string) => Promise<RemoteResult<ContentEntry | null>>
  execute?: (input: Record<string, unknown>) => Promise<RemoteResult<ContentReceipt>>
  receipt?: (entryId: string, operationId: string) => Promise<RemoteResult<ContentReceipt | null>>
}

/** A remote double publishing the scripted replies to a real store. */
function remote(script: RemoteScript = {}) {
  const face: ContentLibraryRemote = {
    status: script.status ?? (() => Promise.resolve({
      ok: true as const,
      value: { phase: 'ready', reason: null, limits: { bodyBytes: 1, entryBytes: 1, libraryBytes: 1 } },
    })),
    snapshot: script.snapshot ?? (() => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [] } })),
    get: entryId => script.get?.(entryId) ?? Promise.resolve({ ok: true as const, value: null }),
    capture: () => Promise.resolve({
      ok: true as const,
      value: { operationId: 'op', entryId: 'source_x', entryRevision: 1, draftRevision: null, versionId: 'v1' },
    }),
    execute: input => script.execute?.(input) ?? Promise.resolve({
      ok: true as const,
      value: { operationId: 'op', entryId: 'source_x', entryRevision: 2, draftRevision: 2, versionId: null },
    }),
    receipt: (entryId, operationId) =>
      script.receipt?.(entryId, operationId) ?? Promise.resolve({ ok: true as const, value: null }),
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
  const props = {
    useLibrary, refresh, select, t,
    beginCreate: () => { store.beginCreate() },
    beginEdit: (entryId: string) => store.beginEdit(entryId),
    closeEditor: () => { store.closeEditor() },
    clearConflict: () => { store.clearConflict() },
    createEntry: (title: string, body: string) => store.createEntry(title, body),
    saveDraft: (title: string, body: string) => store.saveDraft(title, body),
    commitVersion: (title: string, body: string) => store.commitVersion(title, body),
    setMetadata: (entryId: string, patch: { favorite?: boolean; archived?: boolean; addProjectRef?: string; removeProjectRef?: string }) =>
      store.setMetadata(entryId, patch),
  } as unknown as LibraryWorkspaceProps
  const ui = render(<ContentLibraryWorkspace {...props} />)
  return { ui, store, refresh: options.refresh, select: options.select }
}

describe('ContentLibraryWorkspace', () => {
  it('shows a website capture and its safe source link separately from Session provenance', async () => {
    const source = {
      type: 'web-page' as const, scope: 'single-reply' as const, verification: 'unverified' as const,
      url: 'https://chatgpt.com/c/example', pageTitle: 'A conversation', site: 'ChatGPT',
      capturedAt: '2026-09-07T01:00:00.000Z',
    }
    const { store } = mount({ remote: remote({ snapshot: async () => ({ ok: true, value: { formatVersion: 1, entries: [entry('web:one', { source })] } }) }) })
    await waitFor(() => { expect(screen.getByText('Captured reply')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /Captured reply/u }))
    expect(screen.getByText(zh['entry.kind.web'])).toBeTruthy()
    const link = screen.getByRole('link', { name: 'A conversation' })
    expect(link.getAttribute('href')).toBe(source.url)
    expect(screen.getByText(zh['detail.source.unverified'])).toBeTruthy()
    store.dispose()
  })
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

describe('ContentLibraryWorkspace editing', () => {
  /** A drafted idea entry the edit tests operate on. */
  function drafted(id = 'idea_x'): ContentEntry {
    const operation = {
      operationId: `op-${id}`, requestDigest: 'a'.repeat(64),
      result: { operationId: `op-${id}`, entryId: id, entryRevision: 1, draftRevision: 1, versionId: null },
    }
    return {
      id, kind: 'idea', createdAt: '2026-09-06T00:00:00.000Z', entryRevision: 1,
      source: null, versions: [], headVersionId: null,
      draft: { title: 'Drafted', body: 'DRAFT BODY', draftRevision: 1, basedOnVersionId: null },
      projectRefs: [], favorite: false, archived: false, creation: operation, receipts: [operation],
    }
  }

  it('opens the new-entry editor through the header button and creates through it', async () => {
    const { store } = mount({
      remote: remote({
        execute: input => Promise.resolve({
          ok: true as const,
          value: {
            operationId: (input as { operationId: string }).operationId,
            entryId: 'idea-ui:1', entryRevision: 1, draftRevision: 1, versionId: null,
          },
        }),
      }),
    })
    await waitFor(() => { expect(screen.getByText(zh['library.empty'])).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: zh['action.new'] }))
    expect(screen.getByLabelText(zh['editor.titlePlaceholder'])).toBeTruthy()
    fireEvent.change(screen.getByLabelText(zh['editor.titlePlaceholder']), { target: { value: 'My title' } })
    fireEvent.change(screen.getByLabelText(zh['editor.bodyPlaceholder']), { target: { value: 'My body' } })
    fireEvent.click(screen.getByRole('button', { name: zh['editor.create'] }))

    await waitFor(() => { expect(store.getSnapshot().editor?.entryId).toMatch(/^idea-ui:/u) })
    expect(store.getSnapshot().selectedEntryId).toBe(store.getSnapshot().editor?.entryId)
    store.dispose()
  })

  it('opens the editor from the detail action row and saves the draft', async () => {
    const { store } = mount({
      remote: remote({
        snapshot: () => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [drafted()] } }),
        execute: () => Promise.resolve({
          ok: true as const,
          value: { operationId: 'op-2', entryId: 'idea_x', entryRevision: 2, draftRevision: 2, versionId: null },
        }),
      }),
    })
    await waitFor(() => { expect(screen.getByText('Drafted')).toBeTruthy() })
    fireEvent.click(screen.getByText('Drafted'))

    fireEvent.click(screen.getByRole('button', { name: zh['action.edit'] }))
    await waitFor(() => { expect(store.getSnapshot().editor?.entryId).toBe('idea_x') })
    const editorTitle = screen.getByLabelText(zh['editor.titlePlaceholder']) as HTMLInputElement
    expect(editorTitle.value).toBe('Drafted')

    expect(screen.getByRole('button', { name: zh['action.saveDraft'] }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(editorTitle, { target: { value: 'Updated title' } })
    fireEvent.click(screen.getByRole('button', { name: zh['action.saveDraft'] }))
    await waitFor(() => { expect(screen.getByText(zh['editor.draftSaved'])).toBeTruthy() })
    store.dispose()
  })

  it('toggles favorite and archive through the detail action row', async () => {
    const commands: string[] = []
    const { store } = mount({
      remote: remote({
        snapshot: () => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [drafted()] } }),
        execute: (input) => {
          commands.push((input as { type: string }).type)
          return Promise.resolve({
            ok: true as const,
            value: { operationId: 'op-3', entryId: 'idea_x', entryRevision: 2, draftRevision: 1, versionId: null },
          })
        },
      }),
    })
    await waitFor(() => { expect(screen.getByText('Drafted')).toBeTruthy() })
    fireEvent.click(screen.getByText('Drafted'))

    fireEvent.click(screen.getByRole('button', { name: zh['action.favorite'] }))
    await waitFor(() => { expect(commands).toEqual(['metadata']) })
    expect(store.getSnapshot().editConflict).toBe(false)
    store.dispose()
  })

  it('renders the conflict surface with both sides and resolves either way', async () => {
    let conflict = true
    const reloaded = drafted('idea_x')
    const { store } = mount({
      remote: remote({
        snapshot: () => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [drafted()] } }),
        get: () => Promise.resolve({ ok: true as const, value: reloaded }),
        execute: input => conflict
          ? Promise.resolve({ ok: false as const, error: { code: 'revision_conflict', message: 'stale', details: {} } })
          : Promise.resolve({
            ok: true as const,
            value: {
              operationId: (input as { operationId: string }).operationId,
              entryId: 'idea_x', entryRevision: 2, draftRevision: 2, versionId: null,
            },
          }),
      }),
    })
    await waitFor(() => { expect(screen.getByText('Drafted')).toBeTruthy() })
    fireEvent.click(screen.getByText('Drafted'))
    fireEvent.click(screen.getByRole('button', { name: zh['action.edit'] }))
    await waitFor(() => { expect(store.getSnapshot().editor?.entryId).toBe('idea_x') })

    // Save into a conflict: the editor keeps the local text and shows both.
    fireEvent.change(screen.getByLabelText(zh['editor.titlePlaceholder']), { target: { value: 'My side' } })
    fireEvent.click(screen.getByRole('button', { name: zh['action.saveDraft'] }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(zh['editor.conflict'])
    expect(screen.getByText(zh['editor.conflict.local'])).toBeTruthy()
    expect(screen.getByText(zh['editor.conflict.remote'])).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['action.saveDraft'] }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: zh['action.commit'] }).hasAttribute('disabled')).toBe(true)

    // "Keep my edit" clears the mark; the next save retries on the fresh base.
    fireEvent.click(screen.getByRole('button', { name: zh['editor.conflict.keepLocal'] }))
    await waitFor(() => { expect(store.getSnapshot().editConflict).toBe(false) })
    conflict = false
    fireEvent.click(screen.getByRole('button', { name: zh['action.saveDraft'] }))
    await waitFor(() => { expect(screen.getByText(zh['editor.draftSaved'])).toBeTruthy() })
    store.dispose()
  })

  it.each(['forbidden', 'closed', 'operation_conflict', 'source_conflict'])(
    'shows a localized metadata failure for %s without leaking server details', async (code) => {
      const { store } = mount({ remote: remote({
        snapshot: () => Promise.resolve({ ok: true, value: { formatVersion: 1, entries: [drafted()] } }),
        execute: () => Promise.resolve({ ok: false, error: { code, message: 'PRIVATE /secret/path', details: {} } }),
      }) })
      fireEvent.click(await screen.findByText('Drafted'))
      fireEvent.click(screen.getByRole('button', { name: zh['action.favorite'] }))
      const status = await screen.findByRole('status')
      expect(status.textContent).toBe(zh[`error.${code}` as keyof typeof zh])
      expect(screen.queryByText(/PRIVATE/u)).toBeNull()
      expect(screen.getByRole('button', { name: zh['action.favorite'] })).toBeTruthy()
      store.dispose()
    },
  )

  it('adds and removes a project reference through metadata', async () => {
    let current = drafted()
    const commands: Record<string, unknown>[] = []
    const { store } = mount({ remote: remote({
      snapshot: () => Promise.resolve({ ok: true, value: { formatVersion: 1, entries: [current] } }),
      execute: (input) => {
        commands.push(input)
        current = { ...current, entryRevision: current.entryRevision + 1,
          projectRefs: typeof input.addProjectRef === 'string' ? [input.addProjectRef] : [] }
        return Promise.resolve({ ok: true, value: {
          operationId: String(input.operationId), entryId: current.id,
          entryRevision: current.entryRevision, draftRevision: 1, versionId: null,
        } })
      },
    }) })
    fireEvent.click(await screen.findByText('Drafted'))
    const project = screen.getByLabelText('项目引用')
    fireEvent.change(project, { target: { value: 'project-a' } })
    fireEvent.click(screen.getByRole('button', { name: '添加项目引用' }))
    await screen.findByText('project-a')
    expect(commands[0]).toMatchObject({ type: 'metadata', expectedEntryRevision: 1, addProjectRef: 'project-a' })
    fireEvent.click(screen.getByRole('button', { name: '移除项目引用 project-a' }))
    await waitFor(() => { expect(screen.queryByText('project-a')).toBeNull() })
    expect(commands[1]).toMatchObject({ type: 'metadata', expectedEntryRevision: 2, removeProjectRef: 'project-a' })
    store.dispose()
  })
})
