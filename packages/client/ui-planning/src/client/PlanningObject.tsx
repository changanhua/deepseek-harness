import { useState, type ReactNode } from 'react'
import type { PlanningBoardSnapshot, PlanningCommand, PlanningDeltaOperation, PlanningRevision, PlanningSubjectRef } from '@changanhua/dsh-planning/types'
import type { PlanningKey } from './locales.ts'
import { nextPlanningRequestId } from './request-id.ts'
import css from './PlanningWorkbench.module.css'

export interface PlanningObjectProps {
  board: PlanningBoardSnapshot
  planId: string
  revision: PlanningRevision
  renderSubjectActions?: (subject: PlanningSubjectRef) => ReactNode
  pending: boolean
  execute: (command: PlanningCommand) => Promise<boolean>
  startSession?: (subject: PlanningSubjectRef, revision: string) => Promise<void>
  openSession?: (id: string) => void
  t: (key: PlanningKey) => string
}

/** Object workspace projects canonical revisions and refers users to resource owners. */
export function PlanningObject({
  board, planId, revision, pending, execute, startSession, openSession, renderSubjectActions, t,
}: PlanningObjectProps) {
  const [focusId, setFocusId] = useState<string>()
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
  return <section className={css.objectWorkspace} aria-label={t('workspace.title')}>
    <h3>{t('workspace.current')}</h3>
    <p>{t('workspace.revision')}: {revision.id}</p>
    {(['objective', 'accepted', 'open'] as const).map(kind => <section key={kind}>
      <h4>{t(`workspace.${kind}`)}</h4>
      <ul>{(revision.stateEntries ?? []).filter(value => value.kind === kind).map(entry =>
        <li key={entry.id}>{entry.content}</li>)}</ul>
    </section>)}
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
    <select aria-label={t('workspace.focus')} value={focus?.id ?? ''} onChange={(event) => { setFocusId(event.target.value || undefined) }}>
      <option value="">{t('workspace.wholePlan')}</option>
      {focuses.map(value => <option key={value.id} value={value.id}>{value.title}</option>)}
    </select>
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
    {renderSubjectActions?.(subject)}
    <h3>{t('workspace.sessions')}</h3>
    <p>{t('workspace.workingOn')}: {focus?.title ?? revision.title}</p>
    <button disabled={pending || starting || startSession === undefined} onClick={() => {
      setStarting(true)
      setSessionError('')
      void Promise.resolve(startSession?.(subject, revision.id)).catch((error: unknown) => {
        setSessionError(error instanceof Error ? error.message : String(error))
      }).finally(() => { setStarting(false) })
    }}>{t('workspace.startSession')}</button>
    {sessionError && <p role="alert">{sessionError}</p>}
    <ul>{(board.sessionBindings ?? []).filter(binding => sameSubject(binding.subject)).map(binding =>
      <li key={binding.sessionId}><button onClick={() => openSession?.(binding.sessionId)}>{binding.sessionId}</button>
        {' · '}{t('workspace.baseRevision')}: {binding.baseRevision}</li>)}</ul>
    <h3>{t('workspace.resources')}</h3>
    <ul>{(board.resourceLinks ?? []).filter(link => sameSubject(link.subject) || (link.subject.kind === 'plan' && link.subject.id === planId)).map(link =>
      <li key={link.id}>{link.resource.kind}: {' '}{link.resource.kind === 'session'
        ? <button onClick={() => openSession?.(link.resource.id)}>{link.resource.label ?? link.resource.id}</button>
        : /^https?:\/\//u.test(link.resource.id)
          ? <a href={link.resource.id} target="_blank" rel="noopener noreferrer">{link.resource.label ?? link.resource.id}</a>
          : <span>{link.resource.label ?? link.resource.id}</span>}</li>)}</ul>
  </section>
}
