/**
 * The editor over one content entry or a brand-new one: title and body
 * inputs, a create/save-draft/commit-version action row, and a conflict
 * surface when a save or commit hit a stale revision. The component owns
 * only its local text and in-flight state; revisions and idempotency stay
 * on the Host, and the conflict re-read already landed in the view. Choosing
 * "keep my edit" clears the mark and lets the next save retry on the fresh
 * base; "use library content" resets the local text to the re-read entry.
 * @module @changanhua/dsh-client-ui-content/client/EntryEditor
 */

import { useEffect, useRef, useState } from 'react'
import type { ContentEntry } from '@changanhua/dsh-content/types'
import { contentErrorKey } from './locales.ts'
import type { EditOutcome } from './controller.ts'
import type { LibraryWorkspaceProps } from './contract.ts'
import css from './EntryEditor.module.css'

/** The entry's current editable text: its draft, else its head version. */
function textOf(entry: ContentEntry | null): { title: string; body: string } {
  const draft = entry?.draft ?? null
  const head = entry?.versions.at(-1) ?? null
  return { title: draft?.title ?? head?.title ?? '', body: draft?.body ?? head?.body ?? '' }
}

interface EntryEditorProps {
  /** The entry being edited, or null for a brand-new entry. */
  readonly entry: ContentEntry | null
  /** True when the last save/commit hit a revision conflict and re-read. */
  readonly conflict: boolean
  /** Create one new entry with the given text (new-entry mode only). */
  readonly onCreate: (title: string, body: string) => Promise<EditOutcome>
  /** Save the text as the draft. */
  readonly onSave: (title: string, body: string) => Promise<EditOutcome>
  /** Commit the text as a new version. */
  readonly onCommit: (title: string, body: string) => Promise<EditOutcome>
  /** Close the editor seat. */
  readonly onClose: () => void
  /** Clear the conflict mark, keeping the local text. */
  readonly onKeepLocal: () => void
  /** Reset the local text to the re-read entry and clear the conflict. */
  readonly onUseRemote: () => void
  readonly t: LibraryWorkspaceProps['t']
}

/**
 * The content editor. {@link entry} is stable for a given seat because the
 * workspace keyed the mount by the entry id; switching entries remounts and
 * re-seeds the local text from the fresh base.
 */
export function EntryEditor({
  entry, conflict, onCreate, onSave, onCommit, onClose, onKeepLocal, onUseRemote, t,
}: EntryEditorProps) {
  const [title, setTitle] = useState(() => textOf(entry).title)
  const [body, setBody] = useState(() => textOf(entry).body)
  const [inFlight, setInFlight] = useState<'save' | 'commit' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [settled, setSettled] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const isNew = entry === null
  const remote = conflict ? textOf(entry) : null

  const run = async (action: 'save' | 'commit'): Promise<void> => {
    setFailure(null)
    setSettled(null)
    setInFlight(action)
    const outcome = action === 'save'
      ? await (isNew ? onCreate(title, body) : onSave(title, body))
      : await onCommit(title, body)
    if (!alive.current) return
    setInFlight(null)
    if (!outcome.ok) setFailure(t(contentErrorKey(outcome.error.code)))
    else if (action === 'save') setSettled(t('editor.draftSaved'))
  }

  return (
    <div className={css.editor} data-new={isNew || undefined}>
      <input
        className={css.titleInput}
        value={title}
        placeholder={t('editor.titlePlaceholder')}
        aria-label={t('editor.titlePlaceholder')}
        disabled={inFlight !== null}
        onChange={(event) => { setTitle(event.target.value); setFailure(null) }}
      />
      <textarea
        className={css.bodyInput}
        value={body}
        placeholder={t('editor.bodyPlaceholder')}
        aria-label={t('editor.bodyPlaceholder')}
        disabled={inFlight !== null}
        onChange={(event) => { setBody(event.target.value); setFailure(null) }}
      />
      {conflict && remote !== null && (
        <div className={css.conflict} role="alert">
          <p className={css.conflictTitle}>{t('editor.conflict')}</p>
          <p className={css.conflictHint}>{t('editor.conflict.hint')}</p>
          <div className={css.sides}>
            <div className={css.side}>
              <span className={css.sideLabel}>{t('editor.conflict.local')}</span>
              <pre className={css.sideBody}>{body}</pre>
            </div>
            <div className={css.side}>
              <span className={css.sideLabel}>{t('editor.conflict.remote')}</span>
              <pre className={css.sideBody}>{remote.body}</pre>
            </div>
          </div>
          <div className={css.conflictActions}>
            <button type="button" className={css.button} onClick={onKeepLocal}>
              {t('editor.conflict.keepLocal')}
            </button>
            <button
              type="button"
              className={css.button}
              onClick={() => {
                onUseRemote()
                setTitle(remote.title)
                setBody(remote.body)
                setFailure(null)
              }}
            >
              {t('editor.conflict.useRemote')}
            </button>
          </div>
        </div>
      )}
      <div className={css.actions}>
        <div className={css.actionsLeft}>
          {isNew
            ? (
              <button
                type="button"
                className={css.buttonPrimary}
                disabled={inFlight !== null}
                onClick={() => { void run('save') }}
              >
                {inFlight === 'save' ? t('editor.saving') : t('editor.create')}
              </button>
            )
            : (
              <>
                <button
                  type="button"
                  className={css.buttonPrimary}
                  disabled={inFlight !== null}
                  onClick={() => { void run('save') }}
                >
                  {inFlight === 'save' ? t('editor.saving') : t('action.saveDraft')}
                </button>
                <button
                  type="button"
                  className={css.button}
                  disabled={inFlight !== null}
                  onClick={() => { void run('commit') }}
                >
                  {inFlight === 'commit' ? t('editor.committing') : t('action.commit')}
                </button>
              </>
            )}
        </div>
        <div className={css.actionsRight}>
          <button type="button" className={css.buttonQuiet} disabled={inFlight !== null} onClick={onClose}>
            {t('action.cancel')}
          </button>
        </div>
      </div>
      {failure !== null && <p className={css.failure} role="status">{failure}</p>}
      {settled !== null && <p className={css.settled} role="status">{settled}</p>}
    </div>
  )
}
