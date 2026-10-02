import { useState, type ReactNode } from 'react'
import type { PlanningBoardSnapshot, PlanningCommand, PlanningDeltaOperation, PlanningRevision, PlanningSubjectRef } from '@changanhua/dsh-planning/types'
import type { PlanningKey } from './locales.ts'
import { nextPlanningRequestId } from './request-id.ts'
import css from './PlanningWorkbench.module.css'

export interface PlanningObjectProps {
  board: PlanningBoardSnapshot
  planId: string
  renderSubjectActions?: (subject: PlanningSubjectRef) => ReactNode
  revision: PlanningRevision
  pending: boolean
  execute: (command: PlanningCommand) => Promise<boolean>
  startSession?: ((subject: PlanningSubjectRef, revision: string, mode?: 'steward') => Promise<void>) | undefined
  openSession?: ((id: string) => void) | undefined
  focusId?: string | undefined
  mode?: 'current' | 'work'
  t: (key: PlanningKey) => string
}

/** Object workspace projects canonical revisions and refers users to resource owners. */
export function PlanningObject({ board, planId, revision, pending, execute, startSession, openSession, renderSubjectActions, focusId, mode = 'current', t }: PlanningObjectProps) {
  const [starting, setStarting] = useState(false)
  const [sessionError, setSessionError] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [entryKind, setEntryKind] = useState<'objective' | 'accepted' | 'open'>('open')
  const focuses = (board.focuses ?? []).filter(value => value.planId === planId)
  const focus = focuses.find(value => value.id === focusId)
  const subject: PlanningSubjectRef = focus === undefined ? { kind: 'plan', id: planId } : { kind: 'focus', id: focus.id }
  const sameSubject = (value: PlanningSubjectRef) => value.kind === subject.kind && value.id === subject.id
  const change = (operations: PlanningDeltaOperation[]) => execute({ kind: 'workspace-change',
    requestId: nextPlanningRequestId(), expectedBoardVersion: board.version, subject,
    baseRevision: revision.id, operations })
  const start = (mode?: 'steward') => {
    setStarting(true)
    setSessionError('')
    void Promise.resolve(mode === undefined ? startSession?.(subject, revision.id) : startSession?.(subject, revision.id, mode))
      .catch((error: unknown) => { setSessionError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { setStarting(false) })
  }
  return <section className={css.objectWorkspace} aria-label={t('workspace.title')}>
    {renderSubjectActions?.(subject)}
    {mode === 'current' && <>
      <div className={css.stateEntries}>{(['objective', 'accepted', 'open'] as const).map(kind => <section key={kind} className={kind === 'objective' ? css.objective : undefined} data-kind={kind}>
        <h4>{t(`workspace.${kind}`)}</h4>
        <ul>{(revision.stateEntries ?? []).filter(value => value.kind === kind).map(entry =>
          <li key={entry.id}>{entry.content}</li>)}</ul>
        {!(revision.stateEntries ?? []).some(value => value.kind === kind) && <p className={css.meta}>{t('detail.unfilled')}</p>}
      </section>)}</div>
      {focus && <p>{t('workspace.progress')}: {focus.title} · {t(`workspace.status.${focus.status}`)}</p>}
      <details><summary>{t('workspace.edit')}</summary>
        <p className={css.meta}>{t('workspace.revision')}: {revision.id}</p>
        <form onSubmit={(event) => {
          event.preventDefault()
          if (content.trim()) void change([{ kind: 'add-state-entry', entry: {
            id: nextPlanningRequestId(), kind: entryKind, content: content.trim(),
          } }]).then((saved) => { if (saved) setContent('') })
        }}>
          <select aria-label={t('workspace.entryKind')} value={entryKind} onChange={(event) => { setEntryKind(event.target.value as typeof entryKind) }}>
            {(['objective', 'accepted', 'open'] as const).map(kind => <option key={kind} value={kind}>{t(`workspace.${kind}`)}</option>)}
          </select>
          <input aria-label={t('workspace.entry')} placeholder={t('workspace.entry')} value={content} onChange={(event) => { setContent(event.target.value) }} />
          <button disabled={pending || !content.trim()}>{t('workspace.add')}</button>
        </form>
        <h3>{t('workspace.focus')}</h3>
        <p>{focus?.title ?? t('workspace.wholePlan')}</p>
        {focus && <div><p>{focus.objective}</p><select aria-label={t('workspace.status')} value={focus.status} disabled={pending}
          onChange={(event) => { void change([{ kind: 'update-focus', id: focus.id, expectedVersion: focus.version,
            status: event.target.value as typeof focus.status }]) }}>
          {(['open', 'active', 'blocked', 'done'] as const).map(status => <option key={status} value={status}>{t(`workspace.status.${status}`)}</option>)}
        </select></div>}
        <form onSubmit={(event) => {
          event.preventDefault()
          if (title.trim()) void execute({ kind: 'workspace-change', requestId: nextPlanningRequestId(),
            expectedBoardVersion: board.version, subject: { kind: 'plan', id: planId }, baseRevision: revision.id,
            operations: [{ kind: 'create-focus', id: nextPlanningRequestId(), title: title.trim() }],
          }).then((saved) => { if (saved) setTitle('') })
        }}>
          <input aria-label={t('workspace.focusTitle')} placeholder={t('workspace.focusTitle')} value={title} onChange={(event) => { setTitle(event.target.value) }} />
          <button disabled={pending || !title.trim()}>{t('workspace.createFocus')}</button>
        </form>
      </details>
    </>}
    {mode === 'work' && <>
      <h3>{t('workspace.sessions')}</h3>
      <p>{t('workspace.workingOn')}: {focus?.title ?? revision.title}</p>
      <p>{t('workspace.stewardDescription')}</p>
      <button disabled={pending || starting || startSession === undefined} onClick={() =>{  start('steward') }}>{t('workspace.delegate')}</button>
      <button disabled={pending || starting || startSession === undefined} onClick={() =>{  start() }}>{t('workspace.startSession')}</button>
      {sessionError && <p role="alert">{sessionError}</p>}
      <ul>{(board.sessionBindings ?? []).filter(binding => sameSubject(binding.subject)).map(binding =>
        <li key={binding.sessionId}><button onClick={() => openSession?.(binding.sessionId)}>{binding.sessionId}</button>
          {' · '}{t('workspace.baseRevision')}: {binding.baseRevision}
          {binding.baseRevision !== revision.id && <span> · {t('workspace.olderBinding')}</span>}</li>)}</ul>
    </>}
    {(board.resourceLinks ?? []).some(link => sameSubject(link.subject) || (link.subject.kind === 'plan' && link.subject.id === planId)) && <><h3>{t('workspace.resources')}</h3>
      <ul>{(board.resourceLinks ?? []).filter(link => sameSubject(link.subject) || (link.subject.kind === 'plan' && link.subject.id === planId)).map(link =>
        <li key={link.id}>{link.resource.kind}: {' '}{link.resource.kind === 'session'
          ? <button onClick={() => openSession?.(link.resource.id)}>{link.resource.label ?? link.resource.id}</button>
          : /^https?:\/\//u.test(link.resource.id)
            ? <a href={link.resource.id} target="_blank" rel="noopener noreferrer">{link.resource.label ?? link.resource.id}</a>
            : <span>{link.resource.label ?? link.resource.id}</span>}</li>)}</ul></>}
  </section>
}
