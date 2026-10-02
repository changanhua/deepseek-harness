import { useEffect, useMemo, useRef, useState } from 'react'
import type { PlanningCommand, PlanningLane, PlanningSource, PlanningSourceInput } from '@changanhua/dsh-planning/types'
import { planningPriorityScore } from './projections.ts'
import css from './PlanningWorkbench.module.css'
import { PlanningExecution } from './PlanningExecution.tsx'
import { nextPlanningRequestId } from './request-id.ts'
import { PlanningImage } from './PlanningImage.tsx'
import { PlanningEvolution } from './PlanningEvolution.tsx'
import { isPlanningDeltaReviewComplete, PlanningDeltaDiff, type PlanningDeltaReviewSnapshot } from './PlanningDeltaDiff.tsx'

const lanes: readonly PlanningLane[] = ['inbox', 'now', 'next', 'later', 'parking']
const splitLines = (value: string): string[] =>
  value
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)
const localDateTime = (iso: string): string => {
  const value = new Date(iso)
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 16)
}
const textField = (data: FormData, name: string): string => {
  const value = data.get(name)
  return typeof value === 'string' ? value : ''
}
const editableSources = (sources: readonly PlanningSource[]): PlanningSourceInput[] => sources.map((source) => {
  if (source.kind === 'manual') return { kind: 'manual', text: source.text }
  if (source.kind === 'link') return { kind: 'link', url: source.url, label: source.label }
  if (source.kind === 'session-event') return { kind: 'session-event', sessionId: source.sessionId, seq: source.seq }
  return { kind: 'content', entryId: source.entryId, version: source.version }
})
const estimateFactors = [
  ['value', 'detail.value', '+'],
  ['urgency', 'detail.urgency', '+'],
  ['reuse', 'detail.reuse', '+'],
  ['compounding', 'detail.compounding', '+'],
  ['timeCost', 'detail.timeCost', '−'],
  ['tokenCost', 'detail.tokenCost', '−'],
  ['risk', 'detail.risk', '−'],
  ['cognitiveCost', 'detail.cognitiveCost', '−'],
] as const

import type { PlanningWorkbenchProps } from './PlanningWorkbench.tsx'
type CommandDraft<T> = T extends unknown ? Omit<T, 'requestId' | 'expectedBoardVersion'> : never

/** Planning pool with explicit loading, failure, conflict, and retry states. */
export function PlanningPanels(props: PlanningWorkbenchProps & {
  panel: 'current' | 'history' | 'review'
  proposalId?: string
  /** Proposal-keyed snapshots are captured by the submitting owner, never reconstructed after drift. */
  reviewSnapshots?: ReadonlyMap<string, PlanningDeltaReviewSnapshot>
}) {
  const state = props.usePlanning(value => value)
  const { board } = state
  const { t } = props
  const [quickNote, setQuickNote] = useState('')
  const [targetLane, setTargetLane] = useState<PlanningLane>('now')
  const [followUpItemId, setFollowUpItemId] = useState('')
  const [reviewRevisionId, setReviewRevisionId] = useState<string | undefined>()
  const [actionNotice, setActionNotice] = useState('')
  const [sourceError, setSourceError] = useState('')
  const [contentPreview, setContentPreview] = useState<{ key: string; title: string; body: string }>()
  const sourceReadToken = useRef(0)
  const selected = useMemo(
    () => board?.items.find(item => item.id === state.selectedItemId),
    [board, state.selectedItemId],
  )
  const revision = selected?.revisions.find(item => item.id === selected.headRevisionId)
  useEffect(() => {
    setQuickNote('')
    setSourceError('')
    setContentPreview(undefined)
    sourceReadToken.current++
    return () => { sourceReadToken.current++ }
  }, [selected?.id, board?.workspaceId])
  const pendingProposals = board?.proposals.filter(proposal => proposal.status === 'pending') ?? []
  const selectedLane =
    board === undefined || selected === undefined
      ? undefined
      : lanes.find(lane => board.lanes[lane].includes(selected.id))
  const selectedIndex =
    board === undefined || selectedLane === undefined || selected === undefined
      ? -1
      : board.lanes[selectedLane].indexOf(selected.id)
  const reviewRevision = selected?.revisions.find(candidate => candidate.id === reviewRevisionId) ?? revision
  const visibleProposals = pendingProposals.filter(value => props.proposalId ? value.id === props.proposalId :
    selected ? value.targetItemId === selected.id : true)
  const send = (command: CommandDraft<PlanningCommand>, onSaved?: () => void): void => {
    if (board === undefined) return
    setActionNotice('')
    void props
      .execute({
        ...command,
        requestId: nextPlanningRequestId(),
        expectedBoardVersion: board.version,
      })
      .then((saved) => {
        if (saved) {
          setActionNotice(t('view.saved'))
          onSaved?.()
        }
      })
  }
  const readImageSource = props.readImageSource
  const renderSources = (
    sources: readonly PlanningSource[],
    sourceOwnerKey: string,
    recordedAt: string,
  ) => (
    <ul className={css.sourceList}>
      {sources.map((source, index) => {
        const contentKey = `${sourceOwnerKey}:${source.kind === 'content' ? `${source.entryId}:${source.version}` : index}`
        return (
          <li key={`${source.kind}:${index}`}>
            <strong>{t(`source.${source.kind}`)}</strong>
            {' · '}
            {t('detail.recordedAt')} {recordedAt.slice(0, 10)}
            {source.kind === 'manual' && <p>{source.text}</p>}
            {source.kind === 'link' && (
              <p>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.label}
                </a>
              </p>
            )}
            {source.kind === 'session-event' && (
              <>
                <p>{source.excerpt || t('detail.sourceNoText')}</p>
                {board !== undefined && readImageSource !== undefined && source.images?.map(image => (
                  <PlanningImage key={image.attachmentId} workspaceId={board.workspaceId} image={image}
                    read={readImageSource} t={t} />
                ))}
                <div className={css.sourceActions}>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        setSourceError('')
                        if (props.openSessionSource === undefined)
                          throw new Error(t('detail.sourceUnavailable'))
                        props.openSessionSource(source.sessionId)
                      } catch (error) {
                        setSourceError(error instanceof Error ? error.message : String(error))
                      }
                    }}
                  >
                    {t('detail.openSession')}
                  </button>
                  <small>
                    {source.sessionId} · #{source.seq}
                  </small>
                </div>
              </>
            )}
            {source.kind === 'content' && (
              <>
                <p>
                  {source.entryId} · {source.version}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const token = ++sourceReadToken.current
                    setSourceError('')
                    setContentPreview(undefined)
                    if (props.readContentSource === undefined || board === undefined) {
                      setSourceError(t('detail.sourceUnavailable'))
                      return
                    }
                    void props
                      .readContentSource(source.entryId, source.version, board.workspaceId, source.sha256)
                      .then(
                        (value) => {
                          if (token === sourceReadToken.current) setContentPreview({ key: contentKey, ...value })
                        },
                        (error: unknown) => {
                          if (token === sourceReadToken.current)
                            setSourceError(error instanceof Error ? error.message : String(error))
                        },
                      )
                  }}
                >
                  {t('detail.openContent')}
                </button>
                {contentPreview?.key === contentKey && (
                  <section aria-label={contentPreview.title}>
                    <h4>{contentPreview.title}</h4>
                    <p>{contentPreview.body}</p>
                  </section>
                )}
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
  return <section className={css.panel}>
    {state.actionError && <p role="alert">{state.actionError}</p>}
    {actionNotice && <p role="status">{actionNotice}</p>}
    {props.panel === 'review' && <>          {visibleProposals.length > 0 && (
      <section className={css.proposals}>
        <h2>{t('proposal.title')}</h2>
        {visibleProposals.map((proposal) => {
          const generation = proposal.generations.find(value => value.version === proposal.headVersion)
          if (generation === undefined)
            return (
              <p key={proposal.id} role="alert">
                {t('view.loadFailed')}
              </p>
            )
          const previous =
            generation.previousVersion === null
              ? undefined
              : proposal.generations.find(value => value.version === generation.previousVersion)
          const target =
            proposal.targetItemId === null
              ? undefined
              : board?.items.find(item => item.id === proposal.targetItemId)
          const current = target?.revisions.find(value => value.id === generation.baseRevisionId)
          const baseline = current ?? previous?.draft
          const stale =
            proposal.targetItemId !== null &&
                  (target === undefined || target.headRevisionId !== generation.baseRevisionId)
          const sourceReview =
            proposal.fromReviewId === undefined
              ? undefined
              : board?.reviews.find(review => review.id === proposal.fromReviewId)
          const delta = generation.delta
          const deltaBaseRevision = delta === undefined
            ? undefined
            : target?.revisions.find(value => value.id === delta.baseRevision)
          const currentReviewSnapshot = delta === undefined || stale || board === undefined
            ? undefined
            : { planRevision: delta.baseRevision, focuses: board.focuses ?? [], resourceLinks: board.resourceLinks ?? [] }
          const reviewSnapshot = props.reviewSnapshots?.get(proposal.id)
          const deltaReviewProps = delta === undefined ? undefined : {
            delta,
            ...(deltaBaseRevision === undefined ? {} : { baseRevision: deltaBaseRevision }),
            ...(reviewSnapshot === undefined ? {} : { reviewSnapshot }),
            ...(currentReviewSnapshot === undefined ? {} : { currentReviewSnapshot }),
            stale,
          }
          const deltaReviewComplete = deltaReviewProps === undefined || isPlanningDeltaReviewComplete(deltaReviewProps)
          return (
            <article key={proposal.id} className={css.proposal}>
              {sourceReview !== undefined && (
                <p>
                  {t('detail.agentDraft')}：{sourceReview.summary}
                </p>
              )}
              <h3>{generation.draft.title}</h3>
              <p>{generation.draft.intent}</p>
              {deltaReviewProps !== undefined && <PlanningDeltaDiff {...deltaReviewProps} t={t} />}
              <p>
                {t('detail.scope')}
                {generation.draft.scope.join('、') || t('detail.unfilled')}
              </p>
              <p>
                {t('detail.acceptance')}
                {generation.draft.acceptance.join('、') || t('detail.unfilled')}
              </p>
              {baseline !== undefined && (
                <>
                  <p>
                    {t('proposal.current')}: {baseline.title} → {t('proposal.suggested')}:{' '}
                    {generation.draft.title}
                  </p>
                  <p>
                    {baseline.intent} → {generation.draft.intent}
                  </p>
                  <p>
                    {baseline.scope.join('、')} → {generation.draft.scope.join('、')}
                  </p>
                  <p>
                    {baseline.acceptance.join('、')} → {generation.draft.acceptance.join('、')}
                  </p>
                </>
              )}
              <section>
                <h4>{t('detail.source')}</h4>
                {renderSources(generation.draft.sources, `${proposal.id}:${generation.version}`, generation.createdAt)}
                {sourceError !== '' && <p role="alert">{sourceError}</p>}
              </section>
              <p>
                {t('proposal.assumptions')}: {generation.assumptions.join('、') || t('detail.unfilled')}
              </p>
              {stale && <p role="alert">{t('proposal.stale')}</p>}
              <button
                disabled={state.pending || stale || !deltaReviewComplete}
                type="button"
                onClick={() => {
                  send({
                    kind: 'accept-proposal',
                    proposalId: proposal.id,
                    expectedProposalVersion: proposal.headVersion,
                  })
                }}
              >
                {t('proposal.accept')}
              </button>
              <button
                disabled={state.pending}
                type="button"
                onClick={() => {
                  send({
                    kind: 'dismiss-proposal',
                    proposalId: proposal.id,
                    expectedProposalVersion: proposal.headVersion,
                  })
                }}
              >
                {t('proposal.dismiss')}
              </button>
            </article>
          )
        })}
      </section>
    )}
    </>}
    {selected && revision && board && <>
      {props.panel === 'current' && <>                  <form
        className={css.compactForm}
        onSubmit={(event) => {
          event.preventDefault()
          const note = quickNote.trim()
          if (note === '') return
          send({
            kind: 'revise',
            itemId: selected.id,
            expectedRevisionId: revision.id,
            title: revision.title,
            intent: revision.intent,
            scope: revision.scope,
            acceptance: revision.acceptance,
            sources: [...editableSources(revision.sources), { kind: 'manual', text: note }],
            estimate: revision.estimate,
            reviewAt: revision.reviewAt,
          }, () => { setQuickNote('') })
        }}
      >
        <label>
          {t('detail.quickNote')}
          <textarea
            required
            maxLength={4000}
            value={quickNote}
            onChange={(event) => { setQuickNote(event.target.value) }}
          />
        </label>
        <button disabled={state.pending || quickNote.trim() === ''} type="submit">
          {t('detail.saveQuickNote')}
        </button>
      </form>
      <details className={css.management}>
        <summary>{t('workspace.manage')}</summary>
        <details>
          <summary>
            {t('detail.estimate')}
            {planningPriorityScore(revision.estimate) ?? t('detail.unknown')}
          </summary>
          <ul>
            {estimateFactors.map(([key, label, direction]) => (
              <li key={key}>
                {direction}
                {t(label)}：{revision.estimate[key] ?? t('insight.unknown')}
              </li>
            ))}
          </ul>
        </details>
        <p>
          {t('detail.scope')}
          {revision.scope.join('、') || t('detail.unfilled')}
        </p>
        <p>
          {t('detail.acceptance')}: {revision.acceptance.join('、') || t('detail.unfilled')}
        </p>
        <div className={css.actions}>
          {props.handoff !== undefined &&
                      state.execution?.available &&
                      !state.execution.handoffs.some(
                        entry => entry.handoff.revisionId === revision.id && entry.handoff.phase === 'linked',
                      ) && (
            <button
              type="button"
              disabled={state.pending || selected.disposition !== 'active'}
              onClick={() => {
                void props.handoff?.()
              }}
            >
              {t('execution.handoff')}
            </button>
          )}{' '}
          <label>
            {t('detail.moveTo')}
            <select
              value={targetLane}
              onChange={(event) => {
                setTargetLane(event.target.value as PlanningLane)
              }}
            >
              {lanes.map(lane => (
                <option value={lane} key={lane}>
                  {t(`lane.${lane}`)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={state.pending}
            onClick={() => {
              send({ kind: 'move', itemId: selected.id, lane: targetLane, beforeItemId: null })
            }}
          >
            {t('detail.move')}
          </button>{' '}
          {selectedLane !== undefined && selectedIndex > 0 && (
            <button
              type="button"
              disabled={state.pending}
              onClick={() => {
                const beforeItemId = board.lanes[selectedLane][selectedIndex - 1]
                if (beforeItemId === undefined) return
                send({
                  kind: 'move',
                  itemId: selected.id,
                  lane: selectedLane,
                  beforeItemId,
                })
              }}
            >
              {t('detail.up')}
            </button>
          )}{' '}
          {selectedLane !== undefined && selectedIndex >= 0 && (
            <button
              type="button"
              disabled={state.pending}
              onClick={() => {
                send({
                  kind: 'move',
                  itemId: selected.id,
                  lane: selectedLane,
                  beforeItemId: board.lanes[selectedLane][selectedIndex + 2] ?? null,
                })
              }}
            >
              {t('detail.down')}
            </button>
          )}{' '}
          <button
            type="button"
            disabled={state.pending}
            onClick={() => {
              send({ kind: 'archive', itemId: selected.id })
            }}
          >
            {t('detail.archive')}
          </button>
        </div>
        <details>
          <summary>{t('detail.revise')}</summary>
          <form
            className={css.form}
            key={`${selected.id}:${revision.id}`}
            onSubmit={(event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              const number = (name: string): number | null => {
                const raw = textField(data, name)
                return raw === '' ? null : Number(raw)
              }
              const sources = editableSources(revision.sources)
              const note = textField(data, 'note').trim()
              if (note) sources.push({ kind: 'manual', text: note })
              const reviewInput = textField(data, 'reviewAt')
              const reviewAt =
                reviewInput === ''
                  ? null
                  : revision.reviewAt !== null && reviewInput === localDateTime(revision.reviewAt)
                    ? revision.reviewAt
                    : new Date(reviewInput).toISOString()
              send({
                kind: 'revise',
                itemId: selected.id,
                expectedRevisionId: revision.id,
                title: textField(data, 'revision-title'),
                intent: textField(data, 'revision-intent'),
                scope: splitLines(textField(data, 'scope')),
                acceptance: splitLines(textField(data, 'acceptance')),
                sources,
                estimate: {
                  value: number('value'),
                  urgency: number('urgency'),
                  reuse: number('reuse'),
                  compounding: number('compounding'),
                  timeCost: number('timeCost'),
                  tokenCost: number('tokenCost'),
                  risk: number('risk'),
                  cognitiveCost: number('cognitiveCost'),
                  rationale: textField(data, 'rationale'),
                },
                reviewAt,
              })
            }}
          >
            <h3>{t('detail.revise')}</h3>
            <label>
              {t('detail.revisionTitle')}
              <input name="revision-title" required defaultValue={revision.title} />
            </label>
            <label>
              {t('detail.revisionIntent')}
              <input name="revision-intent" required defaultValue={revision.intent} />
            </label>
            <label>
              {t('detail.scopeInput')}
              <textarea name="scope" defaultValue={revision.scope.join('\n')} />
            </label>
            <label>
              {t('detail.acceptance')}
              <textarea name="acceptance" defaultValue={revision.acceptance.join('\n')} />
            </label>
            <label>
              {t('capture.note')}
              <textarea name="note" />
            </label>
            <label>
              {t('detail.reviewAt')}
              <input
                name="reviewAt"
                type="datetime-local"
                defaultValue={revision.reviewAt === null ? '' : localDateTime(revision.reviewAt)}
              />
            </label>
            <details className={css.estimateEditor}>
              <summary>
                {t('detail.estimate')}
                {planningPriorityScore(revision.estimate) ?? t('detail.unknown')}
              </summary>
              <div className={css.estimateGrid}>
                <label>
                  {t('detail.value')}
                  <input
                    name="value"
                    type="number"
                    min="0"
                    max="5"
                    defaultValue={revision.estimate.value ?? ''}
                  />
                </label>
                <label>
                  {t('detail.urgency')}
                  <input
                    name="urgency"
                    type="number"
                    min="0"
                    max="5"
                    defaultValue={revision.estimate.urgency ?? ''}
                  />
                </label>
                <label>
                  {t('detail.reuse')}
                  <input
                    name="reuse"
                    type="number"
                    min="0"
                    max="5"
                    defaultValue={revision.estimate.reuse ?? ''}
                  />
                </label>
                <label>
                  {t('detail.compounding')}
                  <input
                    name="compounding"
                    type="number"
                    min="0"
                    max="5"
                    defaultValue={revision.estimate.compounding ?? ''}
                  />
                </label>
                <label>
                  {t('detail.timeCost')}
                  <input
                    name="timeCost"
                    type="number"
                    min="0"
                    max="5"
                    defaultValue={revision.estimate.timeCost ?? ''}
                  />
                </label>
                <label>
                  {t('detail.tokenCost')}
                  <input
                    name="tokenCost"
                    type="number"
                    min="0"
                    max="5"
                    defaultValue={revision.estimate.tokenCost ?? ''}
                  />
                </label>
                <label>
                  {t('detail.risk')}
                  <input
                    name="risk"
                    type="number"
                    min="0"
                    max="5"
                    defaultValue={revision.estimate.risk ?? ''}
                  />
                </label>
                <label>
                  {t('detail.cognitiveCost')}
                  <input
                    name="cognitiveCost"
                    type="number"
                    min="0"
                    max="5"
                    defaultValue={revision.estimate.cognitiveCost ?? ''}
                  />
                </label>
                <label>
                  {t('detail.rationale')}
                  <textarea name="rationale" defaultValue={revision.estimate.rationale} />
                </label>
              </div>
            </details>
            <button disabled={state.pending} type="submit">
              {t('detail.saveRevision')}
            </button>
          </form>
        </details>
      </details>
      </>}
      {props.panel === 'history' && <>                  <section>
        <h3>{t('detail.source')}</h3>
        {renderSources(revision.sources, revision.id, revision.createdAt)}
        {sourceError !== '' && <p role="alert">{sourceError}</p>}
      </section>
      <PlanningEvolution board={board} itemId={selected.id} t={t}
        renderSource={(source, owner, at) => renderSources([source], owner, at)} />
      {state.execution !== undefined && (
        <PlanningExecution
          view={state.execution}
          revisionId={revision.id}
          evidence={state.evidence}
          evidenceError={state.evidenceError}
          evidencePending={state.evidencePending}
          onReadEvidence={props.readEvidence}
          t={t}
        />
      )}
      {state.executionError && (
        <p role="alert">
          {state.executionError}{' '}
          <button type="button" onClick={() => props.refresh?.()}>
            {t('view.retry')}
          </button>
        </p>
      )}
      <form
        className={css.compactForm}
        onSubmit={(event) => {
          event.preventDefault()
          const ids = Array.from(new FormData(event.currentTarget).getAll('dependency'), String)
          send({ kind: 'dependencies', itemId: selected.id, dependsOnItemIds: ids })
        }}
      >
        <label>
          {t('detail.dependencies')}
          <select name="dependency" multiple defaultValue={board.dependencies[selected.id] ?? []}>
            {board.items
              .filter(item => item.id !== selected.id)
              .map(item => (
                <option key={item.id} value={item.id}>
                  {item.revisions.find(value => value.id === item.headRevisionId)?.title}
                </option>
              ))}
          </select>
        </label>
        <button disabled={state.pending} type="submit">
          {t('detail.saveDependencies')}
        </button>
      </form>
      {(board.dependencies[selected.id] ?? []).length > 0 && (
        <ul>
          {(board.dependencies[selected.id] ?? []).map((id) => {
            const item = board.items.find(value => value.id === id)
            const head = item?.revisions.find(value => value.id === item.headRevisionId)
            const completed =
              head !== undefined &&
                          board.reviews.some(
                            review =>
                              review.itemId === id && review.revisionId === head.id && review.outcome === 'completed',
                          )
            const accepted =
              head !== undefined &&
                          board.executions.some(
                            execution =>
                              execution.itemId === id &&
                              execution.revisionId === head.id &&
                              execution.stage === 'accepted',
                          )
            return (
              <li key={id}>
                {head?.title ?? id}：
                {accepted
                  ? t('insight.acceptanceLinked')
                  : completed
                    ? t('insight.completedReview')
                    : t('insight.dependencyCheck')}
              </li>
            )
          })}
        </ul>
      )}
      <details>
        <summary>{t('detail.saveReview')}</summary>
        <form
          className={css.compactForm}
          key={`${selected.id}:${reviewRevision?.id ?? ''}`}
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            if (reviewRevision === undefined) return
            send({
              kind: 'review',
              itemId: selected.id,
              expectedRevisionId: reviewRevision.id,
              outcome: textField(data, 'outcome') as 'completed' | 'abandoned' | 'learned',
              summary: textField(data, 'summary'),
              lessons: splitLines(textField(data, 'lessons')),
              followUpItemIds: [],
              acceptanceRef: null,
            })
          }}
        >
          <label>
            {t('detail.reviewTargetVersion')}
            <select
              value={reviewRevision?.id ?? ''}
              onChange={(event) => {
                setReviewRevisionId(event.target.value)
              }}
            >
              {selected.revisions.map(candidate => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('detail.reviewOutcome')}
            <select name="outcome">
              <option value="learned">{t('detail.learned')}</option>
              <option value="completed">{t('detail.completed')}</option>
              <option value="abandoned">{t('detail.abandoned')}</option>
            </select>
          </label>
          <label>
            {t('detail.reviewSummary')}
            <textarea name="summary" required />
          </label>
          <label>
            {t('detail.lessons')}
            <textarea name="lessons" />
          </label>
          <button disabled={state.pending} type="submit">
            {t('detail.saveReview')}
          </button>
        </form>
      </details>
      {board.reviews
        .filter(review => review.itemId === selected.id)
        .map(review => (
          <section key={review.id}>
            <h3>{t('detail.reviewHistory')}</h3>
            <p>{review.summary}</p>
            <p>{review.lessons.join('、') || t('detail.unfilled')}</p>
            <p>
              {review.followUpItemIds
                .map(
                  id =>
                    board.items
                      .find(item => item.id === id)
                      ?.revisions.find(
                        item => item.id === board.items.find(value => value.id === id)?.headRevisionId,
                      )?.title ?? id,
                )
                .join('、') || t('detail.unfilled')}
            </p>
            <label>
              {t('detail.followUpTarget')}
              <select
                value={followUpItemId}
                onChange={(event) => {
                  setFollowUpItemId(event.target.value)
                }}
              >
                <option value="">{t('detail.unfilled')}</option>
                {board.items
                  .filter(item => item.id !== selected.id)
                  .map(item => (
                    <option key={item.id} value={item.id}>
                      {item.revisions.find(value => value.id === item.headRevisionId)?.title}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              disabled={state.pending || followUpItemId === ''}
              onClick={() => {
                send({ kind: 'follow-up', reviewId: review.id, itemId: followUpItemId })
              }}
            >
              {t('detail.linkFollowUp')}
            </button>
          </section>
        ))}
      </>}
    </>}
  </section>
}
