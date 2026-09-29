import type { PlanningBoardSnapshot, PlanningSource } from './types.ts'

export type PlanningEvolutionNodeKind =
  | 'item'
  | 'related-item'
  | 'source'
  | 'proposal-generation'
  | 'revision'
  | 'review'
  | 'handoff'

export type PlanningEvolutionNodeState =
  | 'current'
  | 'historical'
  | 'pending'
  | 'accepted'
  | 'dismissed'
  | 'completed'
  | 'abandoned'
  | 'learned'
  | 'prepared'
  | 'linked'
  | 'active'
  | 'archived'

export interface PlanningEvolutionNode {
  readonly id: string
  readonly kind: PlanningEvolutionNodeKind
  readonly label: string
  readonly detail?: string | undefined
  readonly at?: string | undefined
  readonly state?: PlanningEvolutionNodeState | undefined
  /** Exact retained locator, for the owning UI's existing source reader. */
  readonly source?: PlanningSource | undefined
}

export type PlanningEvolutionEdgeKind =
  | 'has-revision'
  | 'source-of'
  | 'supersedes'
  | 'proposes-change'
  | 'accepted-as'
  | 'reviewed-by'
  | 'follow-up'
  | 'depends-on'
  | 'handed-off-as'

export interface PlanningEvolutionEdge {
  readonly kind: PlanningEvolutionEdgeKind
  readonly from: string
  readonly to: string
}

export interface PlanningEvolutionView {
  readonly itemId: string
  readonly nodes: readonly PlanningEvolutionNode[]
  readonly edges: readonly PlanningEvolutionEdge[]
  /** Accepted object lineage only; dismissed and pending alternatives remain visible outside this spine. */
  readonly spineNodeIds: readonly string[]
}

const sourceLabel = (source: PlanningSource): string => {
  if (source.kind === 'manual') return source.text
  if (source.kind === 'link') return source.label
  if (source.kind === 'session-event') return source.excerpt || `${source.sessionId} #${source.seq}`
  return `${source.entryId} @ ${source.version}`
}

const itemLabel = (board: PlanningBoardSnapshot, itemId: string): string => {
  const item = board.items.find(candidate => candidate.id === itemId)
  const head = item?.revisions.find(revision => revision.id === item.headRevisionId)
  return head?.title ?? itemId
}

const byTimeAndId = <T extends { readonly id: string; readonly at?: string | undefined }>(left: T, right: T): number =>
  (left.at ?? '').localeCompare(right.at ?? '') || left.id.localeCompare(right.id)

const edgeOrder = (left: PlanningEvolutionEdge, right: PlanningEvolutionEdge): number =>
  left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.kind.localeCompare(right.kind)

/**
 * Derive one deterministic, token-free evolution view from a detached Board snapshot.
 * The projection never mutates the snapshot and does not claim event history that the Board does not retain.
 */
export function projectPlanningEvolution(
  board: PlanningBoardSnapshot,
  itemId: string,
): PlanningEvolutionView | undefined {
  const item = board.items.find(candidate => candidate.id === itemId)
  if (item === undefined) return undefined

  const nodes = new Map<string, PlanningEvolutionNode>()
  const edges: PlanningEvolutionEdge[] = []
  const addNode = (node: PlanningEvolutionNode): void => {
    if (!nodes.has(node.id)) nodes.set(node.id, node)
  }
  const addEdge = (edge: PlanningEvolutionEdge): void => {
    if (!edges.some(candidate =>
      candidate.kind === edge.kind && candidate.from === edge.from && candidate.to === edge.to,
    )) edges.push(edge)
  }
  const addRelatedItem = (relatedItemId: string): string => {
    const related = board.items.find(candidate => candidate.id === relatedItemId)
    const id = `related-item:${relatedItemId}`
    addNode({
      id,
      kind: 'related-item',
      label: itemLabel(board, relatedItemId),
      at: related?.createdAt,
      state: related?.disposition,
    })
    return id
  }
  const addSources = (
    ownerId: string,
    ownerKey: string,
    sources: readonly PlanningSource[],
    at: string,
  ): void => {
    sources.forEach((source, index) => {
      const id = `source:${ownerKey}:${index}`
      addNode({ id, kind: 'source', label: sourceLabel(source), detail: source.kind, source, at })
      addEdge({ kind: 'source-of', from: id, to: ownerId })
    })
  }

  const itemNodeId = `item:${item.id}`
  addNode({
    id: itemNodeId,
    kind: 'item',
    label: itemLabel(board, item.id),
    at: item.createdAt,
    state: 'current',
  })

  const revisions = [...item.revisions].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  )
  for (const revision of revisions) {
    const id = `revision:${revision.id}`
    addNode({
      id,
      kind: 'revision',
      label: revision.title,
      detail: revision.intent,
      at: revision.createdAt,
      state: revision.id === item.headRevisionId ? 'current' : 'historical',
    })
    addSources(id, `revision:${revision.id}`, revision.sources, revision.createdAt)
    if (revision.previousRevisionId === null) addEdge({ kind: 'has-revision', from: itemNodeId, to: id })
    else addEdge({ kind: 'supersedes', from: `revision:${revision.previousRevisionId}`, to: id })
  }

  const proposals = board.proposals
    .filter(proposal => proposal.targetItemId === itemId || proposal.settlement?.itemId === itemId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  for (const proposal of proposals) {
    const generations = [...proposal.generations].sort((left, right) => left.version - right.version)
    for (const generation of generations) {
      const id = `proposal:${proposal.id}:${generation.version}`
      const isHead = generation.version === proposal.headVersion
      addNode({
        id,
        kind: 'proposal-generation',
        label: generation.draft.title,
        detail: generation.draft.intent,
        at: generation.createdAt,
        state: isHead ? proposal.status : 'historical',
      })
      addSources(id, `proposal:${proposal.id}:${generation.version}`, generation.draft.sources, generation.createdAt)
      if (generation.previousVersion !== null) {
        addEdge({
          kind: 'supersedes',
          from: `proposal:${proposal.id}:${generation.previousVersion}`,
          to: id,
        })
      }
      if (generation.baseRevisionId !== null) {
        addEdge({ kind: 'proposes-change', from: `revision:${generation.baseRevisionId}`, to: id })
      }
    }
    if (proposal.status === 'accepted' && proposal.settlement?.revisionId !== undefined) {
      addEdge({
        kind: 'accepted-as',
        from: `proposal:${proposal.id}:${proposal.headVersion}`,
        to: `revision:${proposal.settlement.revisionId}`,
      })
    }
  }

  for (const review of [...board.reviews].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  )) {
    if (review.itemId !== itemId && !review.followUpItemIds.includes(itemId)) continue
    const id = `review:${review.id}`
    addNode({
      id,
      kind: 'review',
      label: review.summary,
      detail: review.lessons.join('\n'),
      at: review.createdAt,
      state: review.outcome,
    })
    if (review.itemId === itemId) addEdge({ kind: 'reviewed-by', from: `revision:${review.revisionId}`, to: id })
    else addEdge({ kind: 'reviewed-by', from: addRelatedItem(review.itemId), to: id })
    for (const followUpItemId of review.followUpItemIds) {
      const target = followUpItemId === itemId ? itemNodeId : addRelatedItem(followUpItemId)
      addEdge({ kind: 'follow-up', from: id, to: target })
    }
  }

  for (const dependencyId of board.dependencies[itemId] ?? []) {
    addEdge({ kind: 'depends-on', from: itemNodeId, to: addRelatedItem(dependencyId) })
  }
  for (const [dependentId, dependencies] of Object.entries(board.dependencies)) {
    if (dependentId !== itemId && dependencies.includes(itemId)) {
      addEdge({ kind: 'depends-on', from: addRelatedItem(dependentId), to: itemNodeId })
    }
  }

  for (const handoff of [...board.handoffs]
    .filter(candidate => candidate.itemId === itemId)
    .sort((left, right) => left.preparedAt.localeCompare(right.preparedAt) || left.key.localeCompare(right.key))) {
    const id = `handoff:${handoff.key}`
    addNode({
      id,
      kind: 'handoff',
      label: handoff.phase === 'linked' ? handoff.caseId ?? handoff.key : handoff.repositoryId,
      detail: handoff.phase,
      at: handoff.linkedAt ?? handoff.preparedAt,
      state: handoff.phase,
    })
    addEdge({ kind: 'handed-off-as', from: `revision:${handoff.revisionId}`, to: id })
  }

  const acceptedByRevision = new Map<string, string>()
  for (const proposal of proposals) {
    if (proposal.status === 'accepted' && proposal.settlement?.revisionId !== undefined) {
      acceptedByRevision.set(proposal.settlement.revisionId, `proposal:${proposal.id}:${proposal.headVersion}`)
    }
  }
  const revisionById = new Map(item.revisions.map(revision => [revision.id, revision] as const))
  const lineage = [] as typeof revisions
  const seenRevisions = new Set<string>()
  let lineageRevision = revisionById.get(item.headRevisionId)
  while (lineageRevision !== undefined && !seenRevisions.has(lineageRevision.id)) {
    lineage.unshift(lineageRevision)
    seenRevisions.add(lineageRevision.id)
    lineageRevision = lineageRevision.previousRevisionId === null
      ? undefined
      : revisionById.get(lineageRevision.previousRevisionId)
  }
  const spineNodeIds = [itemNodeId]
  for (const revision of lineage) {
    const proposalId = acceptedByRevision.get(revision.id)
    if (proposalId !== undefined) spineNodeIds.push(proposalId)
    spineNodeIds.push(`revision:${revision.id}`)
  }

  return {
    itemId,
    nodes: [...nodes.values()].sort(byTimeAndId),
    edges: edges.sort(edgeOrder),
    spineNodeIds,
  }
}
