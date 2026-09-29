import { projectPlanningEvolution } from '@changanhua/dsh-planning/evolution'
import { useState, type ReactNode } from 'react'
import type { PlanningSource } from '@changanhua/dsh-planning'
import type {
  PlanningEvolutionEdgeKind,
  PlanningEvolutionNodeKind,
  PlanningEvolutionNodeState,
} from '@changanhua/dsh-planning/evolution'
import type { PlanningBoardView } from '@changanhua/dsh-planning-remote/types'
import type { PlanningKey } from './locales.ts'
import css from './PlanningWorkbench.module.css'

const kindKey: Record<PlanningEvolutionNodeKind, PlanningKey> = {
  item: 'evolution.kind.item',
  'related-item': 'evolution.kind.relatedItem',
  source: 'evolution.kind.source',
  'proposal-generation': 'evolution.kind.proposal',
  revision: 'evolution.kind.revision',
  review: 'evolution.kind.review',
  handoff: 'evolution.kind.handoff',
}
const stateKey: Record<PlanningEvolutionNodeState, PlanningKey> = {
  current: 'evolution.state.current',
  historical: 'evolution.state.historical',
  pending: 'evolution.state.pending',
  accepted: 'evolution.state.accepted',
  dismissed: 'evolution.state.dismissed',
  completed: 'evolution.state.completed',
  abandoned: 'evolution.state.abandoned',
  learned: 'evolution.state.learned',
  prepared: 'evolution.state.prepared',
  linked: 'evolution.state.linked',
  active: 'evolution.state.active',
  archived: 'evolution.state.archived',
}
const edgeKey: Record<PlanningEvolutionEdgeKind, PlanningKey> = {
  'has-revision': 'evolution.edge.hasRevision',
  'source-of': 'evolution.edge.sourceOf',
  supersedes: 'evolution.edge.supersedes',
  'proposes-change': 'evolution.edge.proposesChange',
  'accepted-as': 'evolution.edge.acceptedAs',
  'reviewed-by': 'evolution.edge.reviewedBy',
  'follow-up': 'evolution.edge.followUp',
  'depends-on': 'evolution.edge.dependsOn',
  'handed-off-as': 'evolution.edge.handedOffAs',
}
const xByKind: Record<PlanningEvolutionNodeKind, number> = {
  source: 80,
  'related-item': 80,
  'proposal-generation': 250,
  item: 430,
  revision: 430,
  review: 610,
  handoff: 780,
}
const shorten = (value: string): string => value.length > 22 ? `${value.slice(0, 21)}…` : value

export interface PlanningEvolutionProps {
  readonly board: PlanningBoardView
  readonly itemId: string
  readonly t: (key: PlanningKey) => string
  readonly renderSource: (source: PlanningSource, owner: string, at: string) => ReactNode
}

/** Deterministic Board projection; rendering and refresh do not invoke a model. */
export function PlanningEvolution({ board, itemId, t, renderSource }: PlanningEvolutionProps) {
  const [selectedSourceId, setSelectedSourceId] = useState<string>()
  const view = projectPlanningEvolution(board, itemId)
  if (view === undefined) return null
  const height = Math.max(220, view.nodes.length * 76)
  const positions = new Map(view.nodes.map((node, index) => [
    node.id,
    { x: xByKind[node.kind], y: 42 + index * 76 },
  ]))
  const spine = new Set(view.spineNodeIds)
  const selectedSource = view.nodes.find(node => node.id === selectedSourceId && node.source !== undefined)
  return (
    <section className={css.evolution} aria-label={t('evolution.title')}>
      <h3>{t('evolution.title')}</h3>
      <div className={css.evolutionLegend}>
        <span className={css.spineLegend}>{t('evolution.spine')}</span>
        <span className={css.branchLegend}>{t('evolution.branch')}</span>
        <span className={css.contextLegend}>{t('evolution.context')}</span>
      </div>
      <div className={css.evolutionCanvas}>
        <svg
          aria-label={t('evolution.graph')}
          className={css.evolutionSvg}
          role="group"
          viewBox={`0 0 860 ${height}`}
        >
          {view.edges.map((edge) => {
            const from = positions.get(edge.from)
            const to = positions.get(edge.to)
            if (from === undefined || to === undefined) return null
            const accepted = spine.has(edge.from) && spine.has(edge.to)
            return (
              <path
                className={accepted ? css.evolutionSpineEdge : css.evolutionEdge}
                d={`M ${from.x} ${from.y} C ${from.x} ${to.y}, ${to.x} ${from.y}, ${to.x} ${to.y}`}
                fill="none"
                key={`${edge.kind}:${edge.from}:${edge.to}`}
              >
                <title>{t(edgeKey[edge.kind])}</title>
              </path>
            )
          })}
          {view.nodes.map((node) => {
            const position = positions.get(node.id)
            if (position === undefined) return null
            const accepted = spine.has(node.id)
            return (
              <g
                className={accepted ? css.evolutionSpineNode : node.kind === 'proposal-generation' ? css.evolutionBranchNode : css.evolutionContextNode}
                key={node.id}
                role={node.source === undefined ? undefined : 'button'}
                tabIndex={node.source === undefined ? undefined : 0}
                aria-label={node.source === undefined ? undefined : node.label}
                onClick={node.source === undefined ? undefined : () => setSelectedSourceId(node.id)}
                onKeyDown={node.source === undefined ? undefined : (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setSelectedSourceId(node.id)
                  }
                }}
                transform={`translate(${position.x - 68} ${position.y - 26})`}
              >
                <rect height="52" rx="9" width="136" />
                <text className={css.evolutionKind} x="10" y="17">
                  {t(kindKey[node.kind])}
                  {node.state === undefined ? '' : ` · ${t(stateKey[node.state])}`}
                </text>
                <text className={css.evolutionLabel} x="10" y="38">
                  {shorten(node.label)}
                </text>
                <title>{node.detail === undefined ? node.label : `${node.label}\n${node.detail}`}</title>
              </g>
            )
          })}
        </svg>
      </div>
      {selectedSource?.source !== undefined && renderSource(selectedSource.source, selectedSource.id, selectedSource.at ?? '')}
      <p className={css.evolutionNote}>{t('evolution.note')}</p>
    </section>
  )
}
