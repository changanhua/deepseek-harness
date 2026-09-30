/** Bounded, detached model projections for planning Boards. */
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { PlanningError } from '@changanhua/dsh-planning'
import type { PlanningBoardSnapshot, PlanningRevision, PlanningSource } from '@changanhua/dsh-planning'
import type { PlanningMutationResult } from '@changanhua/dsh-planning'

const byteLength = (value: unknown) =>
  Buffer.byteLength(JSON.stringify([{ type: 'text', text: JSON.stringify(value) }]), 'utf8')
const clipped = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`
const sourceMarkers = (revision: Pick<PlanningRevision, 'sources'>, textLimit: number, sourceLimit: number) =>
  revision.sources.slice(0, sourceLimit).map((source) => {
    if (source.kind === 'manual')
      return { kind: source.kind, verification: source.verification, text: clipped(source.text, textLimit) }
    if (source.kind === 'link')
      return {
        kind: source.kind,
        verification: source.verification,
        url: clipped(source.url, textLimit),
        label: clipped(source.label, textLimit),
      }
    if (source.kind === 'content')
      return {
        kind: source.kind,
        verification: source.verification,
        entry_id: source.entryId,
        version: source.version,
        sha256: source.sha256,
      }
    return {
      kind: source.kind,
      verification: source.verification,
      session_id: source.sessionId,
      seq: source.seq,
      event_type: source.eventType,
      sha256: source.sha256,
      excerpt: clipped(source.excerpt, textLimit),
      ...(source.images === undefined ? {} : {
        images: source.images.map(image => ({
          attachment_id: image.attachmentId,
          name: image.name,
          width: image.width,
          height: image.height,
        })),
      }),
    }
  })
type ListMetadata = {
  readonly current_user_source?: {
    readonly kind: 'session-event'
    readonly sessionId: string
    readonly seq: number
  }
}

type CandidateMatch = {
  readonly field: 'title' | 'intent' | 'scope' | 'acceptance' | 'source'
  readonly excerpt: string
}

function sourceText(source: PlanningSource): string {
  if (source.kind === 'manual') return source.text
  if (source.kind === 'link') return `${source.label} ${source.url}`
  if (source.kind === 'content') return `${source.entryId} ${source.version}`
  return source.excerpt
}

function matchDraft(
  draft: Pick<PlanningRevision, 'title' | 'intent' | 'scope' | 'acceptance' | 'sources'>,
  query: string,
): CandidateMatch | null {
  const fields: readonly CandidateMatch[] = [
    { field: 'title', excerpt: draft.title },
    { field: 'intent', excerpt: draft.intent },
    ...draft.scope.map(excerpt => ({ field: 'scope' as const, excerpt })),
    ...draft.acceptance.map(excerpt => ({ field: 'acceptance' as const, excerpt })),
    ...draft.sources.map(source => ({ field: 'source' as const, excerpt: sourceText(source) })),
  ]
  const terms = query.toLowerCase().split(/\s+/u)
  const firstTerm = terms[0]
  if (firstTerm === undefined) return null
  if (!terms.every(term => fields.some(field => field.excerpt.toLowerCase().includes(term)))) return null
  const matched = fields.find(field => field.excerpt.toLowerCase().includes(firstTerm))
  return matched === undefined ? null : { field: matched.field, excerpt: clipped(matched.excerpt, 160) }
}

function summary(
  snapshot: PlanningBoardSnapshot,
  itemId: string,
  textLimit: number,
  dependencyLimit: number,
  sourceLimit: number,
  match?: CandidateMatch,
) {
  const item = snapshot.items.find(value => value.id === itemId)
  if (item === undefined) throw new PlanningError('not-found', 'planning item is not in this Board')
  const revision = item.revisions.find(value => value.id === item.headRevisionId)
  if (revision === undefined) throw new PlanningError('not-found', 'planning item head is unavailable')
  const dependencies = snapshot.dependencies[item.id] ?? []
  return {
    item_id: item.id,
    head_revision_id: item.headRevisionId,
    title: clipped(revision.title, textLimit),
    intent: clipped(revision.intent, textLimit),
    lane: Object.entries(snapshot.lanes).find(([, ids]) => ids.includes(item.id))?.[0] ?? null,
    disposition: item.disposition,
    blocked_by_item_ids: dependencies.slice(0, dependencyLimit),
    blocked_by_more: Math.max(0, dependencies.length - dependencyLimit),
    sources: sourceMarkers(revision, textLimit, sourceLimit),
    source_kinds: [...new Set(revision.sources.map(source => source.kind))],
    ...(match === undefined ? {} : { match: { field: match.field, excerpt: clipped(match.excerpt, textLimit) } }),
  }
}

export function renderPlanningResult(value: unknown, maxBytes: number): string {
  const text = JSON.stringify(value)
  if (Buffer.byteLength(JSON.stringify([{ type: 'text', text }]), 'utf8') > maxBytes) {
    throw new HarnessError(
      'Planning result exceeds the output limit; narrow the list or read one revision.',
      'PLANNING_OUTPUT_LIMIT',
    )
  }
  return text
}

/** Render the durable mutation receipt in the tool's snake-case wire vocabulary. */
export function renderPlanningMutation(value: PlanningMutationResult, maxBytes: number): string {
  return renderPlanningResult(
    {
      board_version: value.boardVersion,
      ...(value.itemId === undefined ? {} : { item_id: value.itemId }),
      ...(value.revisionId === undefined ? {} : { revision_id: value.revisionId }),
      ...(value.reviewId === undefined ? {} : { review_id: value.reviewId }),
      ...(value.proposalId === undefined ? {} : { proposal_id: value.proposalId }),
      ...(value.proposalVersion === undefined ? {} : { proposal_version: value.proposalVersion }),
    },
    maxBytes,
  )
}

/** Produce one complete list page, reducing only explanatory card fields when needed. */
export function renderPlanningList(
  snapshot: PlanningBoardSnapshot,
  cursor: number,
  limit: number,
  maxBytes: number,
  metadata: ListMetadata = {},
  query?: string,
): string {
  const allIds = Object.values(snapshot.lanes)
    .flat()
    .filter(id => snapshot.items.some(item => item.id === id))
  const matches = new Map<string, CandidateMatch>()
  const ids =
    query === undefined
      ? allIds
      : allIds.filter((id) => {
        const item = snapshot.items.find(value => value.id === id)
        const head = item?.revisions.find(value => value.id === item.headRevisionId)
        const match = head === undefined ? null : matchDraft(head, query)
        if (match === null) return false
        matches.set(id, match)
        return true
      })
  const page = ids.slice(cursor, cursor + limit)
  for (const shape of [
    { text: 320, dependencies: 20, sources: 10 },
    { text: 96, dependencies: 5, sources: 3 },
    { text: 32, dependencies: 0, sources: 1 },
  ]) {
    for (let count = page.length; count >= (page.length === 0 ? 0 : 1); count--) {
      const next = cursor + count < ids.length ? cursor + count : undefined
      const value = {
        board_version: snapshot.version,
        item_count: allIds.length,
        ...(query === undefined ? {} : { query, match_count: ids.length }),
        items: page
          .slice(0, count)
          .map(id => summary(snapshot, id, shape.text, shape.dependencies, shape.sources, matches.get(id))),
        ...(next === undefined ? {} : { next_cursor: next }),
        ...metadata,
      }
      if (byteLength(value) <= maxBytes) return JSON.stringify(value)
    }
  }
  throw new HarnessError('Planning list cannot fit the output limit.', 'PLANNING_OUTPUT_LIMIT')
}

export function renderPlanningProposals(
  snapshot: PlanningBoardSnapshot,
  cursor: number,
  limit: number,
  maxBytes: number,
  metadata: ListMetadata = {},
  query?: string,
): string {
  const matches = new Map<string, CandidateMatch>()
  const filtered =
    query === undefined
      ? snapshot.proposals
      : snapshot.proposals.filter((proposal) => {
        const generation = proposal.generations.find(value => value.version === proposal.headVersion)
        const match = generation === undefined ? null : matchDraft(generation.draft, query)
        if (match === null) return false
        matches.set(proposal.id, match)
        return true
      })
  const candidates = filtered.slice(cursor, cursor + limit)
  if (candidates.length === 0)
    return renderPlanningResult(
      {
        board_version: snapshot.version,
        proposal_count: snapshot.proposals.length,
        ...(query === undefined ? {} : { query, match_count: filtered.length }),
        proposals: [],
        ...metadata,
      },
      maxBytes,
    )
  for (const shape of [
    { text: 320, sources: 5 },
    { text: 80, sources: 2 },
    { text: 16, sources: 1 },
  ]) {
    for (let count = candidates.length; count >= 1; count--) {
      const proposals = candidates.slice(0, count).map((proposal) => {
        const generation = proposal.generations.at(-1)
        if (generation === undefined)
          throw new PlanningError('not-found', 'planning proposal generation is not in this Board')
        const match = matches.get(proposal.id)
        return {
          proposal_id: proposal.id,
          target_item_id: proposal.targetItemId,
          ...(proposal.fromReviewId === undefined ? {} : { from_review_id: proposal.fromReviewId }),
          status: proposal.status,
          head_version: proposal.headVersion,
          suggested_lane: generation.suggestedLane,
          title: clipped(generation.draft.title, shape.text),
          intent: clipped(generation.draft.intent, shape.text),
          sources: sourceMarkers(generation.draft, shape.text, shape.sources),
          source_kinds: [...new Set(generation.draft.sources.map(source => source.kind))],
          assumptions: generation.assumptions.slice(0, 3).map(value => clipped(value, shape.text)),
          truncated:
            generation.draft.title.length > shape.text ||
            generation.draft.intent.length > shape.text ||
            generation.draft.sources.length > shape.sources ||
            generation.assumptions.length > 3,
          ...(match === undefined
            ? {}
            : { match: { field: match.field, excerpt: clipped(match.excerpt, shape.text) } }),
        }
      })
      const value = {
        board_version: snapshot.version,
        proposal_count: snapshot.proposals.length,
        ...(query === undefined ? {} : { query, match_count: filtered.length }),
        proposals,
        ...(cursor + count < filtered.length ? { next_cursor: cursor + count } : {}),
        ...metadata,
      }
      if (byteLength(value) <= maxBytes) return JSON.stringify(value)
    }
  }
  throw new HarnessError('Planning proposal identity cannot fit the output limit.', 'PLANNING_OUTPUT_LIMIT')
}

export function renderPlanningProposal(
  snapshot: PlanningBoardSnapshot,
  proposalId: string,
  version: number | undefined,
  section: 'overview' | 'title' | 'intent' | 'scope' | 'acceptance' | 'sources' | 'assumptions',
  cursor: number,
  limit: number,
  maxBytes: number,
): string {
  const proposal = snapshot.proposals.find(value => value.id === proposalId)
  if (proposal === undefined) throw new PlanningError('not-found', 'planning proposal is not in this Board')
  const generation = proposal.generations.find(value => value.version === (version ?? proposal.headVersion))
  if (generation === undefined)
    throw new PlanningError('not-found', 'planning proposal generation is not in this Board')
  if (section === 'title' || section === 'intent')
    return renderPlanningResult(
      {
        board_version: snapshot.version,
        proposal: { proposal_id: proposal.id, generation_version: generation.version },
        section,
        value: generation.draft[section],
      },
      maxBytes,
    )
  const values =
    section === 'scope'
      ? generation.draft.scope
      : section === 'acceptance'
        ? generation.draft.acceptance
        : section === 'sources'
          ? generation.draft.sources
          : section === 'assumptions'
            ? generation.assumptions
            : undefined
  if (values !== undefined) {
    const candidates = values.slice(cursor, cursor + limit)
    if (candidates.length === 0)
      return renderPlanningResult(
        {
          board_version: snapshot.version,
          proposal: { proposal_id: proposal.id, generation_version: generation.version },
          section,
          cursor,
          values: [],
        },
        maxBytes,
      )
    for (let count = candidates.length; count >= 1; count--) {
      const page = candidates.slice(0, count)
      const value = {
        board_version: snapshot.version,
        proposal: { proposal_id: proposal.id, generation_version: generation.version },
        section,
        cursor,
        values: page,
        ...(cursor + count < values.length ? { next_cursor: cursor + count } : {}),
      }
      if (byteLength(value) <= maxBytes) return JSON.stringify(value)
    }
    throw new HarnessError('Planning proposal section entry cannot fit the output limit.', 'PLANNING_OUTPUT_LIMIT')
  }
  return renderPlanningResult(
    {
      board_version: snapshot.version,
      proposal: {
        proposal_id: proposal.id,
        target_item_id: proposal.targetItemId,
        ...(proposal.fromReviewId === undefined ? {} : { from_review_id: proposal.fromReviewId }),
        status: proposal.status,
        head_version: proposal.headVersion,
        generation: {
          version: generation.version,
          previous_version: generation.previousVersion,
          base_revision_id: generation.baseRevisionId,
          ...(generation.delta === undefined ? {} : { delta: generation.delta }),
          draft: {
            title: clipped(generation.draft.title, 320),
            intent: clipped(generation.draft.intent, 320),
            estimate: generation.draft.estimate,
            review_at: generation.draft.reviewAt,
          },
          suggested_lane: generation.suggestedLane,
          actor: generation.actor,
          created_at: generation.createdAt,
        },
        truncated:
          generation.draft.title.length > 320 ||
          generation.draft.intent.length > 320 ||
          generation.draft.scope.length > 0 ||
          generation.draft.acceptance.length > 0 ||
          generation.draft.sources.length > 0 ||
          generation.assumptions.length > 0,
        available_sections: ['title', 'intent', 'scope', 'acceptance', 'sources', 'assumptions'],
      },
    },
    maxBytes,
  )
}

/** Produce one card and exactly one immutable revision; no receipt history crosses this boundary. */
export function renderPlanningRead(
  snapshot: PlanningBoardSnapshot,
  itemId: string,
  revisionId: string | undefined,
  section: 'overview' | 'title' | 'intent' | 'scope' | 'acceptance' | 'sources' | 'reviews' | 'handoffs',
  cursor: number,
  limit: number,
  maxBytes: number,
): string {
  const item = snapshot.items.find(value => value.id === itemId)
  if (item === undefined) throw new PlanningError('not-found', 'planning item is not in this Board')
  const revision = item.revisions.find(value => value.id === (revisionId ?? item.headRevisionId))
  if (revision === undefined) throw new PlanningError('not-found', 'planning revision is not in this Board')
  if (section === 'title' || section === 'intent')
    return renderPlanningResult(
      {
        board_version: snapshot.version,
        item: { item_id: item.id, revision_id: revision.id },
        section,
        value: revision[section],
      },
      maxBytes,
    )
  const values =
    section === 'scope'
      ? revision.scope
      : section === 'acceptance'
        ? revision.acceptance
        : section === 'sources'
          ? revision.sources
          : section === 'reviews'
            ? snapshot.reviews
              .filter(
                review =>
                  review.itemId === itemId && (revisionId === undefined || review.revisionId === revisionId),
              )
              .map((review) => {
                const actor = snapshot.events.find(
                  event => event.kind === 'reviewed' && event.reviewId === review.id,
                )?.actor
                return {
                  ...review,
                  source: actor?.userMessage === undefined ? null : { kind: 'session-event', ...actor.userMessage },
                }
              })
            : section === 'handoffs'
              ? snapshot.handoffs
                .filter(
                  handoff =>
                    handoff.itemId === itemId && (revisionId === undefined || handoff.revisionId === revisionId),
                )
                .map(handoff => ({
                  revision_id: handoff.revisionId,
                  phase: handoff.phase,
                  case_id: handoff.caseId ?? null,
                  contract_revision_id: handoff.contractRevisionId ?? null,
                }))
              : undefined
  if (values !== undefined) {
    const candidates = values.slice(cursor, cursor + limit)
    if (candidates.length === 0)
      return renderPlanningResult(
        {
          board_version: snapshot.version,
          item: { item_id: item.id, revision_id: revision.id },
          section,
          cursor,
          values: [],
        },
        maxBytes,
      )
    for (let count = candidates.length; count >= 1; count--) {
      const page = candidates.slice(0, count)
      const value = {
        board_version: snapshot.version,
        item: { item_id: item.id, revision_id: revision.id },
        section,
        cursor,
        values: page,
        ...(cursor + count < values.length ? { next_cursor: cursor + count } : {}),
      }
      if (byteLength(value) <= maxBytes) return JSON.stringify(value)
    }
    throw new HarnessError('Planning item section entry cannot fit the output limit.', 'PLANNING_OUTPUT_LIMIT')
  }
  for (const shape of [
    { text: 800, entries: 30, sources: 15 },
    { text: 160, entries: 10, sources: 5 },
    { text: 40, entries: 3, sources: 1 },
  ]) {
    const value = {
      board_version: snapshot.version,
      item: {
        item_id: item.id,
        head_revision_id: item.headRevisionId,
        disposition: item.disposition,
        lane: Object.entries(snapshot.lanes).find(([, ids]) => ids.includes(item.id))?.[0] ?? null,

        revision: {
          id: revision.id,
          previous_revision_id: revision.previousRevisionId,
          title: clipped(revision.title, shape.text),
          intent: clipped(revision.intent, shape.text),
          estimate: revision.estimate,
          review_at: revision.reviewAt,
          actor_id: revision.actorId,
          created_at: revision.createdAt,
        },
        truncated:
          revision.title.length > shape.text ||
          revision.intent.length > shape.text ||
          revision.scope.length > 0 ||
          revision.acceptance.length > 0 ||
          revision.sources.length > 0,
        available_sections: [
          'title',
          'intent',
          'scope',
          'acceptance',
          'sources',
          ...(snapshot.reviews.some(review => review.itemId === itemId) ? ['reviews'] : []),
          ...(snapshot.handoffs.some(handoff => handoff.itemId === itemId) ? ['handoffs'] : []),
        ],
      },
    }
    if (byteLength(value) <= maxBytes) return JSON.stringify(value)
  }
  throw new HarnessError('Planning card cannot fit the output limit.', 'PLANNING_OUTPUT_LIMIT')
}
