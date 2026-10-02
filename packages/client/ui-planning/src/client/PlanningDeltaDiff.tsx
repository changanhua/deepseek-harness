import type { PlanningKey } from './locales.ts'
import type {
  PlanningFocus,
  PlanningProposedDelta,
  PlanningResourceLink,
  PlanningRevision,
  PlanningStateEntry,
  ResourceRef,
} from '@changanhua/dsh-planning/types'

/** Bounded material captured with one proposal generation for an exact delta review. */
export interface PlanningDeltaReviewSnapshot {
  readonly planRevision: string
  readonly focuses: readonly PlanningFocus[]
  readonly resourceLinks: readonly PlanningResourceLink[]
}

export interface PlanningDeltaDiffProps {
  readonly delta: PlanningProposedDelta
  /** Immutable item revision selected by the delta's exact base revision. */
  readonly baseRevision?: Pick<PlanningRevision, 'id' | 'stateEntries'>
  /** Authoritative material preserved for this generation. */
  readonly reviewSnapshot?: PlanningDeltaReviewSnapshot
  /** A fresh board may only fill a gap when it still represents this exact generation. */
  readonly currentReviewSnapshot?: PlanningDeltaReviewSnapshot
  readonly stale?: boolean
}

const entryKind = (value: PlanningStateEntry['kind']): string => value
const resource = (value: ResourceRef): string => `${value.kind} / ${value.label ?? value.id}${value.label ? ` (${value.id})` : ''}`
const subject = (kind: string, id: string): string => `${kind} / ${id}`
const optional = (value: string | undefined, t: (key: PlanningKey) => string): string => value ?? t('delta.unfilled')

function EntryView({ entry, label, t }: { entry: PlanningStateEntry; label: string; t: (key: PlanningKey) => string }) {
  return <div><strong>{label}</strong><p>{t('delta.kind')}{entryKind(entry.kind)}</p><p>{t('delta.body')}{entry.content}</p>
    <p>{t('delta.sources')}{entry.sourceRefs?.map(resource).join('；') || t('delta.none')}</p></div>
}

function exactSnapshot(props: PlanningDeltaDiffProps): PlanningDeltaReviewSnapshot | undefined {
  const matches = (value: PlanningDeltaReviewSnapshot | undefined) =>
    value?.planRevision === props.delta.baseRevision
  if (matches(props.reviewSnapshot)) return props.reviewSnapshot
  if (!props.stale && matches(props.currentReviewSnapshot)) return props.currentReviewSnapshot
  return undefined
}

/** Whether every operation has the immutable or generation-bound material needed for adoption. */
export function isPlanningDeltaReviewComplete(props: PlanningDeltaDiffProps): boolean {
  const { delta, baseRevision } = props
  const snapshot = exactSnapshot(props)
  const entryById = new Map(baseRevision?.id === delta.baseRevision ? baseRevision.stateEntries?.map(value => [value.id, value]) : [])
  return !delta.operations.some((operation) => {
    if (operation.kind === 'remove-state-entry' || operation.kind === 'update-state-entry') return !entryById.has(operation.kind === 'remove-state-entry' ? operation.id : operation.entry.id)
    if (operation.kind === 'update-focus') {
      const focus = snapshot?.focuses.find(value => value.id === operation.id)
      return focus?.version !== operation.expectedVersion
    }
    if (operation.kind === 'remove-resource-link') return !snapshot?.resourceLinks.some(link => link.id === operation.id && link.subject.kind === delta.subject.kind && link.subject.id === delta.subject.id)
    return false
  })
}

/** Renders review material without deriving an old value from a stale current Planning board. */
export function PlanningDeltaDiff(props: PlanningDeltaDiffProps & { t: (key: PlanningKey) => string }) {
  const { delta, baseRevision, t } = props
  const snapshot = exactSnapshot(props)
  const entryById = new Map(baseRevision?.id === delta.baseRevision ? baseRevision.stateEntries?.map(value => [value.id, value]) : [])
  const incomplete = !isPlanningDeltaReviewComplete(props)
  return <section aria-label={t('delta.title')}>
    <h4>{t('delta.title')}</h4>
    <p>{t('delta.subject')}{subject(delta.subject.kind, delta.subject.id)}</p>
    <p>{t('delta.base')}{delta.baseRevision}</p>
    <p>{t('delta.sources')}{resource(delta.originRef)}</p>
    {delta.evidenceRefs?.length ? <p>{t('delta.evidence')}{delta.evidenceRefs.map(resource).join('；')}</p> : <p>{t('delta.noEvidence')}</p>}
    {incomplete && <p role="alert">{t('delta.incomplete')}</p>}
    <ol>
      {delta.operations.map((operation, index) => {
        if (operation.kind === 'add-state-entry') return <li key={index}><strong>{t('delta.addEntry')}</strong><EntryView t={t} label={t('delta.after')} entry={operation.entry} /></li>
        if (operation.kind === 'update-state-entry') {
          const before = entryById.get(operation.entry.id)
          return <li key={index}><strong>{t('delta.updateEntry')}</strong>{before && <EntryView t={t} label={t('delta.before')} entry={before} />}<EntryView t={t} label={t('delta.after')} entry={operation.entry} />
            {before && <p>{t('delta.kindChange')}{entryKind(before.kind)} → {entryKind(operation.entry.kind)}</p>}</li>
        }
        if (operation.kind === 'remove-state-entry') {
          const before = entryById.get(operation.id)
          return <li key={index}><strong>{t('delta.removeEntry')}</strong>{before && <><EntryView t={t} label={t('delta.before')} entry={before} /><p>{t('delta.kindChange')}{entryKind(before.kind)} → {t('delta.deleted')}</p></>}</li>
        }
        if (operation.kind === 'create-focus') return <li key={index}><strong>{t('delta.createFocus')}</strong><p>{t('delta.focusTitle')}{operation.title}</p><p>{t('delta.objective')}{optional(operation.objective, t)}</p><p>{t('delta.openStatus')}</p></li>
        if (operation.kind === 'update-focus') {
          const before = snapshot?.focuses.find(value => value.id === operation.id)
          return <li key={index}><strong>{t('delta.updateFocus')}</strong>{before && <><p>{t('delta.focusTitle')}{before.title} → {operation.title ?? before.title}</p>
            <p>{t('delta.objective')}{optional(before.objective, t)} → {optional(operation.objective ?? before.objective, t)}</p>
            <p>{t('delta.status')}{before.status} → {operation.status ?? before.status}</p></>}<p>{t('delta.expectedVersion')}{operation.expectedVersion}</p></li>
        }
        if (operation.kind === 'add-resource-link') return <li key={index}><strong>{t('delta.addResource')}</strong><p>{t('delta.subject')}{subject(delta.subject.kind,
          delta.subject.id)}</p><p>{t('delta.resource')}{resource(operation.resource)}</p><p>{t('delta.role')}{optional(operation.role, t)}</p></li>
        const before = snapshot?.resourceLinks.find(link =>
          link.id === operation.id && link.subject.kind === delta.subject.kind && link.subject.id === delta.subject.id,
        )
        return <li key={index}><strong>{t('delta.removeResource')}</strong>{before && <><p>{t('delta.subject')}{subject(before.subject.kind,
          before.subject.id)}</p><p>{t('delta.resource')}{resource(before.resource)}</p><p>{t('delta.role')}{optional(before.role, t)}</p></>}</li>
      })}
    </ol>
  </section>
}
