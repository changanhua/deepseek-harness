import type { ThinkingRunRecord } from '@changanhua/dsh-planning-remote/types'
import type { PlanningDeltaOperation } from '@changanhua/dsh-planning/types'
import { useEffect, useState } from 'react'
import type { PlanningKey } from './locales.ts'

export interface ThinkingResultPanelProps {
  readonly runs: readonly ThinkingRunRecord[]
  readonly currentCaseVersion: number
  readonly currentPlanningRevision: string | null
  readonly pending: boolean
  readonly error: string | null
  readonly apply: (runId: string, resultId: string, resultVersion: number, kind: 'notes' | 'context', acknowledgeStale?: boolean) => Promise<boolean>
  readonly submitProposal: (runId: string, resultId: string, resultVersion: number) => Promise<boolean>
  readonly openSession: (sessionId: string) => void
  readonly resume: (runId: string) => Promise<boolean>
  readonly t: (key: PlanningKey) => string
}

/** Result review keeps candidate output separate from canonical Planning until a human submits it. */
export function ThinkingResultPanel(props: ThinkingResultPanelProps) {
  const run = props.runs.at(-1)
  const [acknowledgedStale, setAcknowledgedStale] = useState(false)
  useEffect(() => { setAcknowledgedStale(false) }, [run?.id, run?.version])
  if (run === undefined) return <section aria-label={props.t('thinking.result')}><h3>{props.t('thinking.result')}</h3><p>{props.t('thinking.none')}</p></section>
  const result = run.results.at(-1)
  const caseStale = run.caseVersionAtStart !== props.currentCaseVersion
  const planningStale = props.currentPlanningRevision !== null && run.planningRevisionAtStart !== props.currentPlanningRevision
  const needsAcknowledgement = caseStale || planningStale
  const needsResume = run.startup.phase !== 'prompt-accepted' && run.startup.phase !== 'blocked'
  const operationPreview = (operation: PlanningDeltaOperation): string => {
    if ('entry' in operation) return `${operation.kind}: ${operation.entry.kind} · ${operation.entry.content}`
    if (operation.kind === 'create-focus') return `${operation.kind}: ${operation.title}`
    if (operation.kind === 'add-resource-link') return `${operation.kind}: ${operation.resource.label ?? operation.resource.id}`
    return `${operation.kind}: ${operation.id}`
  }
  return <section aria-label={props.t('thinking.result')}>
    <h3>{props.t('thinking.result')}</h3>
    <p>{props.t('thinking.questionLabel')}：{run.question}</p>
    <p>{props.t('thinking.startup')}：{run.startup.phase}</p>
    <button type="button" onClick={() => { props.openSession(run.sessionId) }}>{props.t('thinking.openSession')}</button>
    {needsResume && <button type="button" disabled={props.pending} onClick={() => { void props.resume(run.id) }}>{props.t('thinking.resume')}</button>}
    {props.error && <p role="alert">{props.error}</p>}
    {caseStale && <p role="alert">{props.t('thinking.staleCase')}</p>}
    {planningStale && <p role="alert">{props.t('thinking.stalePlanning')}</p>}
    {needsAcknowledgement && <label><input type="checkbox" checked={acknowledgedStale} onChange={(event) => { setAcknowledgedStale(event.target.checked) }} />{props.t('thinking.acknowledgeStale')}</label>}
    {result === undefined ? <p>{props.t('thinking.none')}</p> : <article>
      <h4>{props.t('thinking.summary')}</h4><p>{result.draft.summary}</p>
      <h4>{props.t('thinking.findings')}</h4><ul>{result.draft.findings.map((finding, index) => <li key={index}>{finding}</li>)}</ul>
      <h4>{props.t('thinking.openQuestions')}</h4><ul>{result.draft.openQuestions.map((question, index) => <li key={index}>{question}</li>)}</ul>
      {result.draft.explorationNotes?.length ? <section><h4>{props.t('thinking.explorationCandidates')}</h4>{result.draft.explorationNotes.map((note, index) => <div key={index}><strong>{note.title}</strong>{note.body && <p>{note.body}</p>}</div>)}</section> : null}
      {result.draft.designContext && <section><h4>{props.t('thinking.designContextCandidate')}</h4><strong>{result.draft.designContext.title}</strong><p>{result.draft.designContext.body}</p></section>}
      {result.draft.planningDelta && <section><h4>{props.t('thinking.planningCandidate')}</h4><ul>{result.draft.planningDelta.operations.map((operation, index) => <li key={index}>{operationPreview(operation)}</li>)}</ul>{result.draft.planningDelta.rationale && <p>{result.draft.planningDelta.rationale}</p>}</section>}
      <button type="button" disabled={props.pending || !result.draft.explorationNotes?.length || result.applied.explorationNoteIds.length > 0 || (needsAcknowledgement && !acknowledgedStale)}
        onClick={() => { void props.apply(run.id, result.id, result.version, 'notes', needsAcknowledgement ? acknowledgedStale : undefined) }}>{props.t('thinking.applyNotes')}</button>
      {result.applied.explorationNoteIds.length > 0 && <p>{props.t('thinking.savedNotes')}</p>}
      <button type="button" disabled={props.pending || result.draft.designContext === undefined || result.applied.designContextId !== undefined || (needsAcknowledgement && !acknowledgedStale)}
        onClick={() => { void props.apply(run.id, result.id, result.version, 'context', needsAcknowledgement ? acknowledgedStale : undefined) }}>{props.t('thinking.saveContext')}</button>
      {result.applied.designContextId !== undefined && <p>{props.t('thinking.savedContext')}</p>}
      <button type="button" disabled={props.pending || result.draft.planningDelta === undefined || result.applied.planningProposalId !== undefined || planningStale || (caseStale && !acknowledgedStale)}
        onClick={() => { void props.submitProposal(run.id, result.id, result.version) }}>{props.t('thinking.submitProposal')}</button>
      {result.applied.planningProposalId !== undefined && <p>{props.t('thinking.submittedProposal')}</p>}
    </article>}
  </section>
}
