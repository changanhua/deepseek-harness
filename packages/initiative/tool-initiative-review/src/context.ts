import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PlanningAccess, PlanningBoardSnapshot, PlanningRevision } from '@changanhua/dsh-planning'
import { InitiativeError, initiativeQuerySchema } from '@changanhua/dsh-initiative'
import type { InitiativePage, InitiativeView } from '@changanhua/dsh-initiative'
import type { z } from 'zod'
import type { readSchema } from './spec.ts'

interface PlanningContext {
  review: PlanningBoardSnapshot['reviews'][number]
  revision: PlanningRevision
  followUps: Array<{ id: string; revision: PlanningRevision | null }>
}
interface DecisionContext extends PlanningContext {
  planningDigest: string
  candidateSnapshotDigest: string
  contextDigest: string
  candidates: Omit<InitiativePage, 'entries'> & { entries: Array<Omit<InitiativeView, 'rir'>> }
}

/** Fingerprint an ordered, owner-derived JSON projection.
 * @param value - Detached context projection with deterministic field ordering.
 * @returns SHA-256 comparison identity, not evidence verification.
 */
export const contextHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Select exactly the Planning facts exposed to the decision-maker.
 * @param board - Authorized detached Planning snapshot.
 * @param reviewId - Selected Review identity.
 * @returns Review, reviewed revision and referenced follow-up heads, including missing-head markers.
 */
export function planningContext(board: PlanningBoardSnapshot, reviewId: string): PlanningContext {
  const review = board.reviews.find(value => value.id === reviewId)
  if (!review) throw new InitiativeError('not-found', 'Review is unavailable in this Workspace')
  const revision = board.items.find(item => item.id === review.itemId)?.revisions.find(value => value.id === review.revisionId)
  if (!revision) throw new InitiativeError('not-found', 'Reviewed revision is unavailable in this Workspace')
  const followUps = review.followUpItemIds.map(id => ({ id, revision: board.items.find(item => item.id === id)?.revisions.at(-1) ?? null }))
  return { review, revision, followUps }
}

/** Capture an optimistic decision context and reject a Planning change during Candidate lookup.
 * @param ctx - Existing Planning and Candidate owners.
 * @param agent - Authorized live caller.
 * @param access - Revalidated Planning access.
 * @param query - Exact Review plus bounded Candidate comparison page.
 * @param signal - Caller lifetime.
 * @returns Context token shared by every page from the same Candidate set and Planning inputs.
 */
export async function captureContext(ctx: Context, agent: Agent, access: PlanningAccess,
  query: z.infer<typeof readSchema>, signal: AbortSignal): Promise<DecisionContext> {
  const planning = planningContext(await ctx.planning.snapshot(access, signal), query.reviewId)
  const planningDigest = contextHash(planning)
  const page = await ctx.initiative.read(agent, initiativeQuerySchema.parse({ action: 'read',
    id: query.candidateId, offset: query.offset, limit: query.limit }), {}, signal)
  if (planningDigest !== contextHash(planningContext(await ctx.planning.snapshot(access, signal), query.reviewId)))
    throw new InitiativeError('conflict', 'Planning decision context changed during read; read it again')
  const contextDigest = contextHash({ workspaceId: access.workspaceId, planningDigest, candidateSnapshotDigest: page.snapshotDigest })
  if (query.expectedContextDigest !== undefined && query.expectedContextDigest !== contextDigest)
    throw new InitiativeError('conflict', 'Decision context changed between comparison pages; restart the comparison')
  // External RIR relations are independently owned and are not part of this comparison snapshot.
  const candidates = { ...page, entries: page.entries.map(({ rir: _rir, ...entry }) => entry) }
  return { ...planning, planningDigest, candidateSnapshotDigest: page.snapshotDigest, contextDigest, candidates }
}
