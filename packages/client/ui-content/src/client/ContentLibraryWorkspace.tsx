/**
 * The content library workspace: a read-only view over the committed
 * library. Load state, Host medium phase, emptiness, and failures each render
 * their own controlled surface; entry bodies and sources are read from the
 * snapshot's immutable entries. Revision and idempotency judgments stay on
 * the Host — this view restates nothing.
 * @module @changanhua/dsh-client-ui-content/client/ContentLibraryWorkspace
 */

import { useEffect } from 'react'
import { IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContentEntry } from '@changanhua/dsh-content/types'
import type { LibraryWorkspaceProps } from './contract.ts'
import { contentErrorKey } from './locales.ts'
import css from './ContentLibraryWorkspace.module.css'

/** New entries first, matching how a person reviews recent captures. */
function byCreationDesc(left: ContentEntry, right: ContentEntry): number {
  return right.createdAt.localeCompare(left.createdAt)
}

/**
 * Read-only content library over the shared library store.
 * @param props - the injected store hooks and verbs, and the copy.
 * @returns the workspace surface for the current load state and phase.
 */
export function ContentLibraryWorkspace({ useLibrary, refresh, select, t }: LibraryWorkspaceProps) {
  // Load the library on mount: the workspace is the one seat that always
  // wants current data, so it never renders from a cold store.
  useEffect(() => { refresh() }, [refresh])
  const loadState = useLibrary(view => view.loadState)
  const phase = useLibrary(view => view.status?.phase ?? null)
  const reason = useLibrary(view => view.status?.reason ?? null)
  const entries = useLibrary(view => view.entries)
  const selectedEntryId = useLibrary(view => view.selectedEntryId)
  const error = useLibrary(view => view.error)

  const selected = selectedEntryId === null
    ? undefined
    : entries.find(entry => entry.id === selectedEntryId)
  const ordered = [...entries].sort(byCreationDesc)

  return (
    <div className={css.root}>
      <header className={css.head}>
        <div>
          <h1 className={css.title}>{t('view.title')}</h1>
          <p className={css.subtitle}>{t('view.subtitle')}</p>
        </div>
        <button
          type="button"
          className={css.refresh}
          aria-label={t('action.refresh')}
          disabled={loadState === 'loading'}
          onClick={refresh}
        >
          <IconRefreshOutline16 />
        </button>
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

      {loadState === 'ready' && phase === 'ready' && entries.length === 0 && (
        <div className={css.empty}>
          <p>{t('library.empty')}</p>
          <p className={css.emptyHint}>{t('library.emptyHint')}</p>
        </div>
      )}

      {entries.length > 0 && (
        <ul className={css.list}>
          {ordered.map(entry => (
            <li key={entry.id}>
              <EntryRow
                entry={entry}
                selected={entry.id === selectedEntryId}
                onSelect={select}
                t={t}
              />
              {selected !== undefined && entry.id === selected.id && <EntryDetail entry={selected} t={t} />}
            </li>
          ))}
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
  readonly t: LibraryWorkspaceProps['t']
}

/** The committed head body and source of one opened entry. */
function EntryDetail({ entry, t }: EntryDetailProps) {
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
    </div>
  )
}
