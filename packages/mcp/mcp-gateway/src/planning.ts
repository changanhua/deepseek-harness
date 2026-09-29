import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { PlanningAccess, PlanningBoardSnapshot, PlanningLane } from '@changanhua/dsh-planning'

const lanes = new Set<PlanningLane>(['inbox', 'now', 'next', 'later', 'parking'])
const emptyEstimate = { value: null, urgency: null, reuse: null, compounding: null, timeCost: null, tokenCost: null, risk: null, cognitiveCost: null, rationale: '' }
function invalid(message: string): Error { return Object.assign(new Error(message), { code: 'DSH_GATEWAY_INVALID_INPUT' }) }
function access(ctx: Context, workspaceId: string, signal: AbortSignal): PlanningAccess {
  const authorize = (): void => {
    signal.throwIfAborted()
    if (ctx.workspaceRegistry.get(WorkspaceId(workspaceId)) === undefined) throw Object.assign(new Error('configured Planning Workspace is unavailable'), { code: 'DSH_GATEWAY_PLANNING_WORKSPACE_UNAVAILABLE' })
  }
  authorize()
  return { workspaceId, actorId: 'dsh-gateway-mcp', kind: 'agent', authorize }
}
function laneOf(board: PlanningBoardSnapshot, itemId: string): PlanningLane | null {
  for (const lane of lanes) if (board.lanes[lane].includes(itemId)) return lane
  return null
}
function listView(board: PlanningBoardSnapshot) {
  return {
    boardVersion: board.version,
    items: board.items.map((item) => {
      const head = item.revisions.find(revision => revision.id === item.headRevisionId)
      return {
        id: item.id, headRevisionId: item.headRevisionId, disposition: item.disposition,
        lane: laneOf(board, item.id), title: head?.title ?? null, intent: head?.intent ?? null,
      }
    }),
    proposals: board.proposals.map((proposal) => {
      const head = proposal.generations.find(generation => generation.version === proposal.headVersion)
      return {
        id: proposal.id, targetItemId: proposal.targetItemId, status: proposal.status,
        headVersion: proposal.headVersion, title: head?.draft.title ?? null,
        intent: head?.draft.intent ?? null, suggestedLane: head?.suggestedLane ?? null,
      }
    }),
  }
}
function readView(board: PlanningBoardSnapshot, id: string): unknown {
  const item = board.items.find(candidate => candidate.id === id)
  if (item !== undefined) return { kind: 'item', item, lane: laneOf(board, item.id), dependencies: board.dependencies[item.id] ?? [], reviews: board.reviews.filter(review => review.itemId === item.id), proposals: board.proposals.filter(proposal => proposal.targetItemId === item.id || proposal.settlement?.itemId === item.id), handoffs: board.handoffs.filter(handoff => handoff.itemId === item.id) }
  const proposal = board.proposals.find(candidate => candidate.id === id)
  if (proposal !== undefined) return { kind: 'proposal', proposal }
  throw Object.assign(new Error(`Planning object '${id}' was not found`), { code: 'DSH_GATEWAY_PLANNING_NOT_FOUND' })
}
export interface PlanningOperations {
  list(signal: AbortSignal): Promise<unknown>
  read(id: string, signal: AbortSignal): Promise<unknown>
  propose(input: {
    requestId: string
    expectedBoardVersion: number
    idea: string
    suggestedLane?: PlanningLane | undefined
  }, signal: AbortSignal): Promise<unknown>
}
/** The only external write creates a raw, pending proposal in one fixed Workspace. */
export function planningOperations(ctx: Context, workspaceId: string): PlanningOperations {
  return {
    async list(signal) { return listView(await ctx.planning.snapshot(access(ctx, workspaceId, signal), signal)) },
    async read(id, signal) { return readView(await ctx.planning.snapshot(access(ctx, workspaceId, signal), signal), id) },
    async propose(input, signal) {
      const idea = input.idea
      const title = idea.split(/\r?\n/u).map(line => line.trim()).find(Boolean)?.slice(0, 256)
      if (!title) throw invalid('idea must contain a non-empty line')
      const suggestedLane = input.suggestedLane ?? 'inbox'
      if (!lanes.has(suggestedLane)) throw invalid('suggestedLane must be one of inbox, now, next, later, or parking')
      return ctx.planning.execute(access(ctx, workspaceId, signal), { kind: 'propose', requestId: input.requestId, expectedBoardVersion: input.expectedBoardVersion, proposalId: `gateway-proposal-${createHash('sha256').update(input.requestId).digest('hex').slice(0, 32)}`, expectedProposalVersion: null, targetItemId: null, baseRevisionId: null, draft: { title, intent: idea, scope: [], acceptance: [], sources: [{ kind: 'manual', text: idea }], estimate: emptyEstimate, reviewAt: null }, suggestedLane, assumptions: [] }, signal)
    },
  }
}
