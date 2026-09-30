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
const optional = (value: string | undefined): string => value ?? '未设置'

function EntryView({ entry, label }: { entry: PlanningStateEntry; label: string }) {
  return <div><strong>{label}</strong><p>类别：{entryKind(entry.kind)}</p><p>正文：{entry.content}</p>
    <p>来源：{entry.sourceRefs?.map(resource).join('；') || '无'}</p></div>
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
export function PlanningDeltaDiff(props: PlanningDeltaDiffProps) {
  const { delta, baseRevision } = props
  const snapshot = exactSnapshot(props)
  const entryById = new Map(baseRevision?.id === delta.baseRevision ? baseRevision.stateEntries?.map(value => [value.id, value]) : [])
  const incomplete = !isPlanningDeltaReviewComplete(props)
  return <section aria-label="完整 delta 差异">
    <h4>完整 delta 差异</h4>
    <p>对象：{subject(delta.subject.kind, delta.subject.id)}</p>
    <p>基线 revision：{delta.baseRevision}</p>
    <p>来源：{resource(delta.originRef)}</p>
    {delta.evidenceRefs?.length ? <p>证据：{delta.evidenceRefs.map(resource).join('；')}</p> : <p>证据：无</p>}
    {incomplete && <p role="alert">缺少该精确代次的前值，完整审阅不可用；不可采纳。</p>}
    <ol>
      {delta.operations.map((operation, index) => {
        if (operation.kind === 'add-state-entry') return <li key={index}><strong>新增 state entry</strong><EntryView label="后" entry={operation.entry} /></li>
        if (operation.kind === 'update-state-entry') {
          const before = entryById.get(operation.entry.id)
          return <li key={index}><strong>更新 state entry</strong>{before && <EntryView label="前" entry={before} />}<EntryView label="后" entry={operation.entry} />
            {before && <p>类别变化：{entryKind(before.kind)} → {entryKind(operation.entry.kind)}</p>}</li>
        }
        if (operation.kind === 'remove-state-entry') {
          const before = entryById.get(operation.id)
          return <li key={index}><strong>删除 state entry</strong>{before && <><EntryView label="前" entry={before} /><p>类别变化：{entryKind(before.kind)} → 已删除</p></>}</li>
        }
        if (operation.kind === 'create-focus') return <li key={index}><strong>新建 Focus</strong><p>标题：{operation.title}</p><p>目标：{optional(operation.objective)}</p><p>状态：open</p></li>
        if (operation.kind === 'update-focus') {
          const before = snapshot?.focuses.find(value => value.id === operation.id)
          return <li key={index}><strong>更新 Focus</strong>{before && <><p>标题：{before.title} → {operation.title ?? before.title}</p>
            <p>目标：{optional(before.objective)} → {optional(operation.objective ?? before.objective)}</p>
            <p>状态：{before.status} → {operation.status ?? before.status}</p></>}<p>expectedVersion: {operation.expectedVersion}</p></li>
        }
        if (operation.kind === 'add-resource-link') return <li key={index}><strong>新增资源关系</strong><p>对象：{subject(delta.subject.kind,
          delta.subject.id)}</p><p>资源：{resource(operation.resource)}</p><p>角色：{optional(operation.role)}</p></li>
        const before = snapshot?.resourceLinks.find(link =>
          link.id === operation.id && link.subject.kind === delta.subject.kind && link.subject.id === delta.subject.id,
        )
        return <li key={index}><strong>删除资源关系</strong>{before && <><p>对象：{subject(before.subject.kind,
          before.subject.id)}</p><p>资源：{resource(before.resource)}</p><p>角色：{optional(before.role)}</p></>}</li>
      })}
    </ol>
  </section>
}
