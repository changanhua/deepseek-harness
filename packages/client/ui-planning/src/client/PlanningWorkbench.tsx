import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button, ReferenceIcon, IconChevronRightOutline14, IconChevronLeftOutline14, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PlanningCommand, PlanningSubjectRef } from '@changanhua/dsh-planning/types'
import type { DesignCaseSummary } from '@changanhua/dsh-planning-remote/types'
import { initialPlanningNavigation, type CreateIdeaInput, type PlanningNavigation, type PlanningRuntimeState } from './runtime-controller.ts'
import type { PlanningKey } from './locales.ts'
import { PlanningObject } from './PlanningObject.tsx'
import { PlanningPanels } from './PlanningPanels.tsx'
import { planningReviewState, planningPriorityScore } from './projections.ts'
import css from './PlanningWorkbench.module.css'

export interface PlanningWorkbenchProps {
  readonly renderSlot?: PropsRenderSlots<'planning.subject.actions'>['renderSlot']
  readonly usePlanning: <T>(selector: (state: PlanningRuntimeState) => T) => T
  readonly navigate?: (patch: Partial<PlanningNavigation>) => void
  readonly selectWorkspace: (workspaceId: string) => void
  readonly selectItem: (itemId: string | undefined) => void
  readonly startPlanningSession?: (subject: PlanningSubjectRef, revision: string, mode?: 'steward') => Promise<void>
  readonly continuePlanningSession?: (subject: PlanningSubjectRef, revision: string) => Promise<void>
  readonly continuePlan?: (planId: string) => Promise<void>
  readonly openDesignCase?: (summary: DesignCaseSummary) => void
  readonly refreshDesignCases?: () => void
  readonly create: (input: CreateIdeaInput) => Promise<boolean>
  readonly execute: (command: PlanningCommand) => Promise<boolean>
  readonly retry: () => Promise<boolean>
  readonly refresh?: () => void
  readonly handoff?: () => Promise<boolean>
  readonly readEvidence: (evidenceId: string) => void
  readonly openSessionSource?: (sessionId: string) => void
  readonly readImageSource?: (workspaceId: string, attachmentId: string) => Promise<string>
  readonly readContentSource?: (
    entryId: string, version: string, workspaceId: string, sha256: string,
  ) => Promise<{ title: string; body: string }>
  readonly t: (key: PlanningKey) => string
}
const sameSubject = (a: PlanningSubjectRef, b: PlanningSubjectRef) => a.kind === b.kind && a.id === b.id
const workspaceViewIds = ['current', 'work', 'thinking', 'history'] as const
const overviewFilterIds = ['active', 'inbox', 'pending', 'archived'] as const
function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number, count: number) {
  const next = event.key === 'ArrowRight' ? (index + 1) % count : event.key === 'ArrowLeft' ? (index + count - 1) % count : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : -1
  if (next < 0) return
  event.preventDefault()
  const button = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]
  button?.focus(); button?.click()
}

/** Object-centred navigation over one canonical Board and owner-supplied case summaries. */
export function PlanningWorkbench(props: PlanningWorkbenchProps) {
  const state = props.usePlanning(value => value)
  const { board } = state; const { t } = props
  const [localView, setLocalView] = useState<PlanningNavigation>(() => ({ ...initialPlanningNavigation(), screen: state.selectedItemId ? 'plan' : 'overview' }))
  const view = state.navigation ?? localView
  const navigate = (patch: Partial<PlanningNavigation>) => {
    if (props.navigate) props.navigate(patch)
    else setLocalView(value => ({ ...value, ...patch }))
  }
  const [idea, setIdea] = useState(''); const [notice, setNotice] = useState('')
  const [error, setError] = useState(''); const [continuing, setContinuing] = useState(false)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null); const reviewTrigger = useRef<HTMLElement | null>(null)
  const [clock, tick] = useState(0)
  useEffect(() => {
    const instants = board?.items.filter(item => item.disposition === 'active').flatMap((item) => {
      const date = item.revisions.find(value => value.id === item.headRevisionId)?.reviewAt
      const at = date ? Date.parse(date) : NaN
      return at > Date.now() ? [at] : []
    }) ?? []
    if (!instants.length) return
    const timer = setTimeout(() => { tick(value => value + 1) }, Math.min(2147483647, Math.max(1, Math.min(...instants) - Date.now())))
    return () => { clearTimeout(timer) }
  }, [board, clock])
  useEffect(() => { setReviewId(null); setError(''); setNotice('') }, [state.workspaceId, state.selectedItemId])
  useEffect(() => {
    if (reviewId !== null && dialog.current && !dialog.current.open) {
      if (typeof dialog.current.showModal === 'function') dialog.current.showModal()
      else dialog.current.setAttribute('open', '')
    }
  }, [reviewId])
  const selected = board?.items.find(value => value.id === state.selectedItemId)
  const revision = selected?.revisions.find(value => value.id === selected.headRevisionId)
  const focuses = board?.focuses?.filter(value => value.planId === selected?.id) ?? []
  const focus = focuses.find(value => value.id === view.focusId)
  const subject: PlanningSubjectRef | undefined = selected ? focus ? { kind: 'focus', id: focus.id } : { kind: 'plan', id: selected.id } : undefined
  const plans = board?.items.flatMap((item) => {
    const head = item.revisions.find(value => value.id === item.headRevisionId)
    const lane = (Object.keys(board.lanes) as (keyof typeof board.lanes)[]).find(value => board.lanes[value].includes(item.id))
    return head ? [{ item, head, lane }] : []
  }) ?? []
  const terms = view.search.trim().toLowerCase().split(/\s+/u).filter(Boolean)
  const matches = (values: string[]) => terms.every(term => values.join(' ').toLowerCase().includes(term))
  const sourceText = (sources: NonNullable<typeof revision>['sources']) => sources.map((source) => {
    if (source.kind === 'manual') return source.text
    if (source.kind === 'link') return `${source.label} ${source.url}`
    if (source.kind === 'session-event') return source.excerpt
    return `${source.entryId} ${source.version}`
  })
  const pending = board?.proposals.filter(value => value.status === 'pending') ?? []
  const visiblePending = pending.filter((proposal) => {
    const generation = proposal.generations.find(value => value.version === proposal.headVersion)
    return generation && matches([generation.draft.title, generation.draft.intent,
      ...generation.draft.scope, ...generation.draft.acceptance, ...sourceText(generation.draft.sources)])
  })
  const selectedPending = pending.filter(value => value.targetItemId === selected?.id)
  const recent = plans.find(value => value.item.id === view.recentPlanId && value.item.disposition === 'active')
  const progressTitle = (planId: string) => {
    const active = board?.focuses?.filter(value => value.planId === planId && value.status === 'active') ?? []
    return active.length === 1 ? active[0]?.title : undefined
  }
  const lane = plans.find(value => value.item.id === selected?.id)?.lane
  const visible = plans.filter(({ item, head, lane }) =>
    (view.filter === 'archived' ? item.disposition === 'archived' : item.disposition === 'active') &&
    (view.filter !== 'inbox' || lane === 'inbox') && matches([head.title, head.intent, ...head.scope, ...head.acceptance, ...sourceText(head.sources)]))
  const activeHeads = plans.filter(value => value.item.disposition === 'active')
  const dueItems = activeHeads.filter(({ head }) => planningReviewState(head.reviewAt) === 'due')
  const linkedUnreviewed =
    board === undefined
      ? []
      : board.executions.flatMap((execution) => {
        if (
          !execution.reviewSuggested ||
            board.reviews.some(
              review => review.itemId === execution.itemId && review.revisionId === execution.revisionId,
            )
        )
          return []
        const item = board.items.find(candidate => candidate.id === execution.itemId)
        const revision = item?.revisions.find(candidate => candidate.id === execution.revisionId)
        return item === undefined || revision === undefined ? [] : [{ item, revision }]
      })
  const suggestedOrder = [...activeHeads]
    .flatMap((entry) => {
      const score = planningPriorityScore(entry.head.estimate)
      return score === null ? [] : [{ ...entry, score }]
    })
    .sort((left, right) => right.score - left.score)
  const start = async (target: PlanningSubjectRef, base: string) => {
    setContinuing(true); setError('')
    try {
      if (props.continuePlanningSession) await props.continuePlanningSession(target, base)
      else {
        const binding = [...(board?.sessionBindings ?? [])].filter(value => sameSubject(value.subject, target))
          .sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0]
        if (binding && props.openSessionSource) props.openSessionSource(binding.sessionId)
        else await props.startPlanningSession?.(target, base)
      }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setContinuing(false) }
  }
  const openReview = (id: string) => { reviewTrigger.current = document.activeElement as HTMLElement; setReviewId(id) }
  const closeReview = () => { dialog.current?.close(); setReviewId(null); reviewTrigger.current?.focus() }
  const revisionLabel = (id: string) => {
    const index = selected?.revisions.findIndex(value => value.id === id) ?? -1
    return index >= 0 ? `${t('thinking.revisionShort')}${index + 1}` : t('thinking.previous')
  }
  if (state.status === 'loading' && !board) return <p role="status">{t('view.loading')}</p>
  return <section className={css.root} aria-label={t('view.title')}>
    <header className={css.header}>
      {view.screen === 'overview' ? <h1>{t('overview.title')}</h1> : <nav className={css.breadcrumb} aria-label={t('workspace.breadcrumb')}><Button onClick={() => { navigate({ screen: 'overview' }) }} icon={<IconChevronLeftOutline14 />}>{t('workspace.allPlans')}</Button><span aria-hidden>/</span><span>{revision?.title}</span></nav>}
      <div className={css.headerTools}>
        <label>{t('view.workspace')}<select value={state.workspaceId ?? ''} disabled={state.pending} onChange={(event) =>{  props.selectWorkspace(event.target.value) }}>
          <option value="">{t('view.chooseWorkspace')}</option>{state.workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.title}</option>)}
        </select></label>
        {view.screen === 'overview' && <label>{t('view.search')}<input type="search" value={view.search} placeholder={t('view.searchHint')} onChange={(event) =>{  navigate({ search: event.target.value }) }} /></label>}
        <Button aria-label={t('view.refresh')} title={t('view.refresh')} disabled={state.pending} onClick={() => props.refresh?.()} icon={<IconRefreshOutline16 />} />
      </div>
    </header>
    {state.status === 'error' && <p role="alert">{t('view.loadFailed')}{state.error}<button onClick={() => props.refresh?.()}>{t('view.retry')}</button></p>}
    {state.actionError && <p role="alert">{state.actionError}{state.retry && <button onClick={() => { void props.retry() }}>{t('view.retry')}</button>}</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{state.pending && <p role="status">{t('view.saving')}</p>}
    {!state.workspaceId ? <p>{t('view.choosePrompt')}</p> : !board ? <p>{t('view.notLoaded')}</p> : view.screen === 'overview' ? <>
      {recent && <section className={css.resume} aria-label={t('overview.resume')}><h2>{t('overview.resume')}</h2><div className={css.resumeBody}><span className={css.planIcon}><ReferenceIcon kind="file" size={26} /></span><div className={css.resumeText}><h3>{recent.head.title}</h3><p>{progressTitle(recent.item.id) ?? t('overview.explicitRecent')}</p></div>
        <Button variant="primary" className={css.primary} disabled={continuing || state.pending} onClick={() => {
          if (props.continuePlan) {
            setContinuing(true); setError('')
            void props.continuePlan(recent.item.id).catch((error: unknown) => { setError(String(error)) })
              .finally(() => { setContinuing(false) })
          } else { props.selectItem(recent.item.id); navigate({ screen: 'plan' }) }
        }}>{t('overview.continue')}<IconChevronRightOutline14 /></Button></div></section>}
      <div className={css.tabs} role="tablist" aria-label={t('overview.title')}>
        {overviewFilterIds.map((filter,index) => <button key={filter} id={`overview-${filter}`} role="tab" aria-selected={view.filter === filter} aria-controls="overview-panel" tabIndex={view.filter === filter ? 0 : -1}
          onKeyDown={(event) =>{  tabKey(event,index,overviewFilterIds.length) }} onClick={() =>{  navigate({ filter }) }}>{t(`overview.${filter}`)}{filter === 'pending' ? <> <span className={css.count}>{pending.length}</span></> : null}</button>)}
      </div>
      <section id="overview-panel" role="tabpanel" aria-labelledby={`overview-${view.filter}`} className={css.planList}>
        {(view.filter === 'pending' || view.filter === 'inbox') && visiblePending.filter(value => view.filter === 'pending' || value.targetItemId === null).map((proposal) => {
          const generation = proposal.generations.find(value => value.version === proposal.headVersion)
          if (!generation) return <p key={proposal.id} role="alert">{t('view.loadFailed')}</p>
          const target = board.items.find(value => value.id === proposal.targetItemId)
          const stale = proposal.targetItemId !== null && target?.headRevisionId !== generation.baseRevisionId
          return <article className={css.planCard} key={proposal.id}><h3>{generation.draft.title}</h3><p>{t('overview.candidate')}</p>{stale && <p role="status">{t('proposal.stale')}</p>}
            <button onClick={() =>{  openReview(proposal.id) }}>{t('overview.review')}</button></article>
        })}
        {view.filter !== 'pending' && visible.map(({ item, head, lane }) => <article className={css.planCard} key={item.id}><span className={css.planIcon}><ReferenceIcon kind="file" size={24} /></span><div className={css.planCardText}><div className={css.cardTitle}><h3>{head.title}</h3><span className={css.badge} data-lane={lane}>{lane && t(`lane.${lane}`)}{view.filter === 'inbox' && ` · ${t('overview.adopted')}`}</span></div>{head.intent && head.intent !== head.title && <p className={css.cardExcerpt}>{head.intent}</p>}
          {progressTitle(item.id) && <p>{t('workspace.progress')}: {progressTitle(item.id)}</p>}
        </div>
        <Button className={css.openAction} aria-label={head.title} onClick={() => { props.selectItem(item.id); navigate({ screen: 'plan', recentPlanId: item.id }) }}>{t('overview.open')}<IconChevronRightOutline14 /></Button></article>)}
        {(view.filter === 'pending' ? !visiblePending.length : !visible.length && !(view.filter === 'inbox' && visiblePending.some(value => value.targetItemId === null))) && <p>{t('view.empty')}</p>}
      </section>
      {terms.length > 0 && <p role="status">{t('view.searchCount')}: {view.filter === 'pending' ? visiblePending.length : visible.length + visiblePending.length}</p>}
      <details className={css.capture} open={view.filter === 'inbox'}><summary>{t('capture.title')}</summary><form className={css.form} onSubmit={(event) => {
        event.preventDefault(); void props.create({ idea, lane: 'inbox' }).then((saved) => { if (saved) { setIdea(''); setNotice(t('capture.saved')) } })
      }}><label>{t('capture.idea')}<textarea required value={idea} onChange={(event) =>{  setIdea(event.target.value) }} /></label><button disabled={state.pending || !idea.trim()}>{t('capture.submit')}</button></form></details>
    </> : selected && revision && subject ? <>
      <div className={css.planHeading}><div><h1>{revision.title}</h1>
        {revision.intent && revision.intent !== revision.title && <p className={css.intent}>{revision.intent}</p>}</div>
      <Button variant="primary" className={css.primary} disabled={state.pending || continuing || (!props.startPlanningSession && !props.openSessionSource && !props.continuePlanningSession)} onClick={() => { void start(subject, revision.id) }}>{t('workspace.continue')}<IconChevronRightOutline14 /></Button></div>
      <div className={css.workspaceActions}>
        {props.renderSlot?.('planning.subject.actions', { workspaceId: board.workspaceId, planId: selected.id, subject })}
        {selectedPending.length > 0 && <button onClick={() =>{  openReview('plan') }}>{t('overview.pending')} {selectedPending.length}</button>}
        <span className={css.badge} data-lane={lane}>{t('detail.arrangement')}: {lane && t(`lane.${lane}`)}</span>
        <label>{t('workspace.progress')}<select aria-label={t('workspace.focus')} value={focus?.id ?? ''} onChange={(event) => { navigate({ focusId: event.target.value || undefined }) }}><option value="">{t('workspace.wholePlan')}</option>{focuses.map(value => <option key={value.id} value={value.id}>{value.title}</option>)}</select></label>
      </div>
      <div className={css.tabs} role="tablist" aria-label={t('workspace.views')}>
        {workspaceViewIds.map((tab,index) => <button key={tab} id={`plan-${tab}`} role="tab" aria-selected={view.tab === tab} aria-controls="plan-panel" tabIndex={view.tab === tab ? 0 : -1}
          onKeyDown={(event) =>{  tabKey(event,index,workspaceViewIds.length) }} onClick={() => { navigate({ tab }); if (tab === 'thinking') props.refreshDesignCases?.() }}>{t(`tab.${tab}`)}</button>)}
      </div>
      <section id="plan-panel" role="tabpanel" aria-labelledby={`plan-${view.tab}`} className={css.planWorkspace}>
        {(view.tab === 'current' || view.tab === 'work') && <PlanningObject key={`${board.workspaceId}:${selected.id}:${view.tab}`} board={board} planId={selected.id} revision={revision} pending={state.pending} execute={props.execute} t={t}
          focusId={focus?.id} mode={view.tab} openSession={props.openSessionSource} startSession={props.startPlanningSession} />}
        {(view.tab === 'current' || view.tab === 'history') && <PlanningPanels {...props} panel={view.tab}
          reviewSnapshots={new Map(Object.entries(board.thinkingReviewSnapshots ?? {}))} />}
        {view.tab === 'thinking' && <section className={css.thinkingDesk}>
          <div className={css.stateEntries}>{(['objective', 'accepted', 'open'] as const).map(kind => <section key={kind} className={kind === 'objective' ? css.objective : undefined} data-kind={kind}><h3>{t(`workspace.${kind}`)}</h3><ul>{(revision.stateEntries ?? []).filter(entry => entry.kind === kind).map(entry => <li key={entry.id}>{entry.content}</li>)}</ul>{!(revision.stateEntries ?? []).some(entry => entry.kind === kind) && <p className={css.meta}>{t('detail.unfilled')}</p>}</section>)}</div>
          <section className={css.caseCollection}><h2>{t('thinking.cases')}</h2><div className={css.boundaryStrip}>
            <div className={css.baseline}><ReferenceIcon kind="file" size={20} /><div><h3>{t('thinking.baseline')}</h3><p>{t('thinking.canonical')}</p></div></div>
            <div className={css.exploration}><ReferenceIcon kind="folder" size={20} /><div><h3>{t('thinking.exploration')}</h3><p>{t('thinking.boundary')}</p></div></div>
          </div>
          {state.designCases?.status === 'loading' ? <p role="status">{t('thinking.loading')}</p> : state.designCases?.status === 'error' ? <p role="alert">{t('thinking.unavailable')} {state.designCases.error}<button onClick={() => props.refreshDesignCases?.()}>{t('view.retry')}</button></p> : <>
            {(state.designCases?.summaries ?? []).filter(value => value.subjectRef.kind === 'plan' || sameSubject(value.subjectRef, subject)).map(value => <article key={`${value.resource.provider}:${value.resource.id}`} className={css.caseCard}>
              <div className={css.caseHeading}><span className={css.planIcon}><ReferenceIcon kind="file" size={24} /></span><div><h3>{value.title}</h3><p className={css.meta}>{value.preview}</p></div><Button variant="outline" className={css.openAction} disabled={!props.openDesignCase} onClick={() => props.openDesignCase?.(value)}>{t('thinking.open')}<IconChevronRightOutline14 /></Button></div>
              <div className={css.revisionTrail}><div><span className={css.meta}>{t('thinking.base')}</span><strong title={value.baseRevision}>{revisionLabel(value.baseRevision)}</strong></div><span className={css.trailLine} aria-hidden /><div><span className={css.meta}>{t('thinking.exploration')}</span><strong>{value.title}</strong></div><span className={css.trailLine} aria-hidden /><div><span className={css.meta}>{t('thinking.current')}</span><strong title={value.currentRevision ?? undefined}>{value.currentRevision ? revisionLabel(value.currentRevision) : t('thinking.missing')}</strong></div></div>
              <p className={css.drift} data-drift={value.drift || value.currentRevision === null} role="status">{value.currentRevision === null ? t('thinking.missing') : value.drift ? t('thinking.drift') : t('thinking.aligned')}</p>
              <details className={css.revisionDetails}><summary>{t('thinking.revisions')}</summary><p>{t('thinking.base')}: {value.baseRevision}</p><p>{t('thinking.current')}: {value.currentRevision ?? t('thinking.missing')}</p></details></article>)}
            {!(state.designCases?.summaries ?? []).some(value => value.subjectRef.kind === 'plan' || sameSubject(value.subjectRef, subject)) && <p>{t('thinking.empty')}</p>}
          </>}
          </section>
        </section>}
      </section>
    </> : <p>{t('detail.select')}</p>}
    {(dueItems.length > 0 || linkedUnreviewed.length > 0 || suggestedOrder.length > 0) && (
      <section className={css.insights}>
        <h2>{t('insight.title')}</h2>
        {dueItems.length > 0 && (
          <p>
            <strong>{t('insight.due')}：</strong>
            {dueItems.map(({ head }) => head.title).join('、')}
          </p>
        )}
        {linkedUnreviewed.length > 0 && (
          <p>
            <strong>{t('insight.followupReview')}：</strong>
            {linkedUnreviewed.map(({ revision }) => revision.title).join('、')}
          </p>
        )}
        <h3>{t('insight.suggestedOrder')}</h3>
        <p>{t('insight.manualOrder')}</p>
        {suggestedOrder.length === 0 ? (
          <p>{t('insight.unknown')}</p>
        ) : (
          <ol>
            {suggestedOrder.map(({ item, head }) => (
              <li key={item.id}>
                {head.title}（{planningPriorityScore(head.estimate)}）
              </li>
            ))}
          </ol>
        )}
      </section>
    )}

    {reviewId !== null && <dialog ref={dialog} className={css.reviewDialog} aria-label={t('overview.review')} onCancel={(event) => { event.preventDefault(); closeReview() }}><button onClick={closeReview}>{t('view.close')}</button>
      <PlanningPanels {...props} panel="review" reviewSnapshots={new Map(Object.entries(board?.thinkingReviewSnapshots ?? {}))}
        {...(reviewId === 'plan' ? {} : { proposalId: reviewId })} /></dialog>}
  </section>
}
