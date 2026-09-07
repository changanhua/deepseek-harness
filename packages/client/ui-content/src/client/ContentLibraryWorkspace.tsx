/**
 * The content library workspace: a read-only list over the committed library
 * plus the editor entry points (new entry, edit, favorite, archive). Load
 * state, Host medium phase, emptiness, and failures each render their own
 * controlled surface; entry bodies and sources are read from the snapshot's
 * immutable entries. Revision and idempotency judgments stay on the Host —
 * this view restates nothing and never predicts a conflict.
 * @module @changanhua/dsh-client-ui-content/client/ContentLibraryWorkspace
 */

import { useEffect, useRef, useState } from 'react'
import { IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContentEntry } from '@changanhua/dsh-content/types'
import type { LibraryWorkspaceProps } from './contract.ts'
import type { EditOutcome, MetadataPatch } from './controller.ts'
import { EntryEditor } from './EntryEditor.tsx'
import { contentErrorKey } from './locales.ts'
import css from './ContentLibraryWorkspace.module.css'

/** New entries first, matching how a person reviews recent captures. */
function byCreationDesc(left: ContentEntry, right: ContentEntry): number {
  return right.createdAt.localeCompare(left.createdAt)
}

/**
 * Read-only content library over the shared library store, with the editor
 * seat for new and existing entries.
 * @param props - the injected store hooks and verbs, and the copy.
 * @returns the workspace surface for the current load state and phase.
 */
export function ContentLibraryWorkspace({
  useLibrary, refresh, select, beginCreate, beginEdit, closeEditor, clearConflict,
  createEntry, saveDraft, commitVersion, setMetadata, t,
}: LibraryWorkspaceProps) {
  // Load the library on mount: the workspace is the one seat that always
  // wants current data, so it never renders from a cold store.
  useEffect(() => { refresh() }, [refresh])
  const loadState = useLibrary(view => view.loadState)
  const phase = useLibrary(view => view.status?.phase ?? null)
  const reason = useLibrary(view => view.status?.reason ?? null)
  const entries = useLibrary(view => view.entries)
  const selectedEntryId = useLibrary(view => view.selectedEntryId)
  const editor = useLibrary(view => view.editor)
  const editConflict = useLibrary(view => view.editConflict)
  const error = useLibrary(view => view.error)

  const selected = selectedEntryId === null
    ? undefined
    : entries.find(entry => entry.id === selectedEntryId)
  const ordered = [...entries].sort(byCreationDesc)
  const editing = editor ?? null
  const editingEntry = editing === null
    ? null
    : editing.entryId === null
      ? null
      : entries.find(entry => entry.id === editing.entryId) ?? null

  return (
    <div className={css.root}>
      <header className={css.head}>
        <div>
          <h1 className={css.title}>{t('view.title')}</h1>
          <p className={css.subtitle}>{t('view.subtitle')}</p>
        </div>
        <div className={css.headActions}>
          <button
            type="button"
            className={css.newEntry}
            disabled={editing !== null || loadState !== 'ready' || phase !== 'ready'}
            onClick={beginCreate}
          >
            {t('action.new')}
          </button>
          <button
            type="button"
            className={css.refresh}
            aria-label={t('action.refresh')}
            disabled={loadState === 'loading'}
            onClick={refresh}
          >
            <IconRefreshOutline16 />
          </button>
        </div>
      </header>

      {loadState === 'error' && (
        <div className={css.banner} role="alert">
          <span>{error === null ? t('error.load') : t(contentErrorKey(error.code))}</span>
          <button type="button" className={css.retry} onClick={refresh}>{t('action.retry')}</button>
        </div>
      )}

      {loadState !== 'error' && phase !== null && phase !== 'ready' && (
        <div className={css.banner} role="status">
          {phase === 'opening' ? t('status.opening') : phase === 'closed' ? t('status.closed') : t('status.unavailable')}
          {phase === 'unavailable' && reason !== null ? ` · ${t(contentErrorKey(reason))}` : ''}
        </div>
      )}

      {loadState === 'loading' && entries.length === 0 && (
        <div className={css.empty} role="status">
          <span className={css.spinner} aria-hidden="true" />
        </div>
      )}

      {loadState === 'ready' && phase === 'ready' && entries.length === 0 && editing === null && (
        <div className={css.empty}>
          <p>{t('library.empty')}</p>
          <p className={css.emptyHint}>{t('library.emptyHint')}</p>
        </div>
      )}

      {editing !== null && editing.entryId === null && (
        <EntryEditor
          entry={null}
          conflict={false}
          onCreate={createEntry}
          onSave={saveDraft}
          onCommit={commitVersion}
          onClose={closeEditor}
          onKeepLocal={clearConflict}
          onUseRemote={clearConflict}
          t={t}
        />
      )}

      {entries.length > 0 && (
        <ul className={css.list}>
          {ordered.map((entry) => {
            const isEditing = editing !== null && editing.entryId === entry.id
            return (
              <li key={entry.id}>
                <EntryRow
                  entry={entry}
                  selected={entry.id === selectedEntryId}
                  onSelect={select}
                  t={t}
                />
                {selected !== undefined && entry.id === selected.id && (
                  isEditing
                    ? (
                      <EntryEditor
                        entry={editingEntry}
                        conflict={editConflict}
                        onCreate={createEntry}
                        onSave={saveDraft}
                        onCommit={commitVersion}
                        onClose={closeEditor}
                        onKeepLocal={clearConflict}
                        onUseRemote={clearConflict}
                        t={t}
                      />
                    )
                    : (
                      <EntryDetail
                        entry={selected}
                        onEdit={() => beginEdit(entry.id)}
                        onMetadata={patch => setMetadata(entry.id, patch)}
                        onReload={refresh}
                        t={t}
                      />
                    )
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

interface EntryRowProps {
  readonly entry: ContentEntry
  readonly selected: boolean
  readonly onSelect: (entryId: string | null) => void
  readonly t: LibraryWorkspaceProps['t']
}

/** One library row: title, badges, and the meta line. */
function EntryRow({ entry, selected, onSelect, t }: EntryRowProps) {
  // The committed head title; a draft's working title wins while one exists.
  const title = entry.draft?.title ?? entry.versions.at(-1)?.title ?? entry.id
  const versionCount = `${entry.versions.length} ${t('entry.versions')}`
  return (
    <button
      type="button"
      className={css.row}
      data-selected={selected || undefined}
      aria-expanded={selected}
      onClick={() => { onSelect(selected ? null : entry.id) }}
    >
      <span className={css.rowTitle}>{title}</span>
      <span className={css.badges}>
        <span className={css.badge}>{t(entry.kind === 'original' ? 'entry.kind.original' : 'entry.kind.idea')}</span>
        {entry.draft !== null && <span className={css.badge}>{t('entry.draft')}</span>}
        {entry.favorite && <span className={css.badge}>{t('entry.favorite')}</span>}
        {entry.archived && <span className={css.badge}>{t('entry.archived')}</span>}
        <span className={css.meta}>{versionCount}</span>
      </span>
      <span className={css.meta}>{new Date(entry.createdAt).toLocaleString()}</span>
    </button>
  )
}

interface EntryDetailProps {
  readonly entry: ContentEntry
  readonly onEdit: () => Promise<EditOutcome>
  readonly onMetadata: (patch: MetadataPatch) => Promise<EditOutcome>
  readonly onReload: () => void
  readonly t: LibraryWorkspaceProps['t']
}

/** The committed head body, source, and the edit/metadata action row. */
function EntryDetail({ entry, onEdit, onMetadata, onReload, t }: EntryDetailProps) {
  const [actionState, setActionState] = useState<'ready' | 'pending' | 'stale'>('ready')
  const [failure, setFailure] = useState<string | null>(null)
  const [projectRef, setProjectRef] = useState('')
  const running = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  const run = async (action: () => Promise<EditOutcome>): Promise<void> => {
    if (running.current || actionState === 'stale') return
    running.current = true
    setActionState('pending')
    setFailure(null)
    const result = await action()
    running.current = false
    if (!alive.current) return
    setActionState(!result.ok && result.error.code === 'revision_conflict' ? 'stale' : 'ready')
    if (!result.ok) setFailure(t(contentErrorKey(result.error.code)))
  }
  const disabled = actionState !== 'ready'
  const head = entry.versions.at(-1)
  const source = entry.source?.type === 'session-message'
    ? t('detail.source.session')
    : entry.source?.type === 'user-provided'
      ? t('detail.source.provided')
      : null
  return (
    <div className={css.detail}>
      {source !== null && (
        <p className={css.detailMeta}>{`${t('detail.source')}: ${source}`}</p>
      )}
      {head !== undefined && (
        <>
          <p className={css.detailMeta}>{t('detail.body')}</p>
          <pre className={css.body}>{head.body}</pre>
        </>
      )}
      <div className={css.detailActions}>
        <button type="button" className={css.detailAction} disabled={disabled} onClick={() => { void run(onEdit) }}>{t('action.edit')}</button>
        <button type="button" className={css.detailAction} disabled={disabled} onClick={() => { void run(() => onMetadata({ favorite: !entry.favorite })) }}>
          {t(entry.favorite ? 'action.unfavorite' : 'action.favorite')}
        </button>
        <button type="button" className={css.detailAction} disabled={disabled} onClick={() => { void run(() => onMetadata({ archived: !entry.archived })) }}>
          {t(entry.archived ? 'action.unarchive' : 'action.archive')}
        </button>
      </div>
      <div className={css.detailActions}>
        <input className={css.projectInput} aria-label={t('detail.projectRef')} value={projectRef}
          disabled={disabled} onChange={(event) => { setProjectRef(event.target.value) }} />
        <button type="button" className={css.detailAction}
          disabled={disabled || projectRef.trim() === '' || entry.projectRefs.includes(projectRef.trim())}
          onClick={() => { void run(() => onMetadata({ addProjectRef: projectRef.trim() })) }}>
          {t('action.addProjectRef')}
        </button>
      </div>
      {entry.projectRefs.map(ref => (
        <div key={ref} className={css.detailActions}>
          <span>{ref}</span>
          <button type="button" className={css.detailAction} disabled={disabled}
            aria-label={`${t('action.removeProjectRef')} ${ref}`}
            onClick={() => { void run(() => onMetadata({ removeProjectRef: ref })) }}>
            {t('action.removeProjectRef')}
          </button>
        </div>
      ))}
      {failure !== null && <p role="status">{failure}</p>}
      {actionState === 'stale' && (
        <button type="button" className={css.detailAction} onClick={() => {
          onReload()
          setActionState('ready')
          setFailure(null)
        }}>{t('action.reloadEntry')}</button>
      )}
    </div>
  )
}
