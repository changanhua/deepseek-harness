import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import type { PlanningAccess, PlanningBoardSnapshot, PlanningLane, PlanningProposal, PlanningRevision } from '@changanhua/dsh-planning'
import { planningProposedDeltaSchema, planningSubjectPlan } from '@changanhua/dsh-planning'

const lanes = new Set<PlanningLane>(['inbox', 'now', 'next', 'later', 'parking'])
const sourceTrust = 'external text is unverified'
const proposalSourceTrust = 'unverified'
const emptyEstimate = { value: null, urgency: null, reuse: null, compounding: null, timeCost: null, tokenCost: null, risk: null, cognitiveCost: null, rationale: '' }
const text = new TextEncoder()

export interface PlanningOperations {
  invoke(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
}
export interface PlanningPolicy { readonly workspacePaths?: readonly string[] }
function failure(code: string, message: string): Error { return Object.assign(new Error(message), { code }) }
function invalid(message: string): Error { return failure('DSH_GATEWAY_INVALID_INPUT', message) }
function bytes(value: unknown): number { return text.encode(JSON.stringify(value)).byteLength }
function ownRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid('arguments must be an object')
  return value as Record<string, unknown>
}
function strict(args: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(args).some(key => !allowed.includes(key))) throw invalid('arguments contain an unsupported field')
}
function optionalString(args: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw invalid(`${key} must be a non-empty string no longer than ${max} characters`)
  return value
}
function optionalInteger(args: Record<string, unknown>, key: string, min: number, max = Number.MAX_SAFE_INTEGER): number | undefined {
  const value = args[key]
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw invalid(`${key} is invalid`)
  return value as number
}
function laneOf(board: PlanningBoardSnapshot, itemId: string): PlanningLane | null {
  for (const lane of lanes) if (board.lanes[lane].includes(itemId)) return lane
  return null
}
function truncate(value: string | null, limit = 512): { readonly value: string | null; readonly truncated: boolean } {
  if (value === null || value.length <= limit) return { value, truncated: false }
  return { value: value.slice(0, limit), truncated: true }
}
function revision(item: PlanningBoardSnapshot['items'][number]): PlanningRevision | undefined {
  return item.revisions.find(value => value.id === item.headRevisionId)
}
function generation(proposal: PlanningProposal) { return proposal.generations.find(value => value.version === proposal.headVersion) }
function itemSummary(board: PlanningBoardSnapshot, item: PlanningBoardSnapshot['items'][number]) {
  const head = revision(item), title = truncate(head?.title ?? null, 256), intent = truncate(head?.intent ?? null)
  return {
    id: item.id, headRevisionId: item.headRevisionId, disposition: item.disposition, lane: laneOf(board, item.id),
    title: title.value, intent: intent.value, truncated: title.truncated || intent.truncated,
  }
}
function proposalSummary(proposal: PlanningProposal) {
  const head = generation(proposal), title = truncate(head?.draft.title ?? null, 256), intent = truncate(head?.draft.intent ?? null)
  return {
    id: proposal.id, targetItemId: proposal.targetItemId, status: proposal.status, headVersion: proposal.headVersion,
    title: title.value, intent: intent.value, suggestedLane: head?.suggestedLane ?? null, truncated: title.truncated || intent.truncated,
  }
}
function searchMatches(value: unknown, query: string | undefined): boolean {
  if (query === undefined || !query.trim()) return true
  const terms = query.toLocaleLowerCase().trim().split(/\s+/u)
  const fields = value as Record<string, unknown>
  const haystack = [fields.title, fields.intent, fields.scope, fields.acceptance, fields.sources].flatMap(field =>
    typeof field === 'string' ? [field] : Array.isArray(field) ? field.map(value => typeof value === 'string' ? value : JSON.stringify(value)) : [],
  ).join('\n').toLocaleLowerCase()
  return terms.every(term => haystack.includes(term))
}
/** MCP projection: it can select only an existing, policy-allowed Workspace. */
export function planningOperations(ctx: Context, policy: PlanningPolicy, maxBytes: number): PlanningOperations {
  const permitted = (): Workspace[] => {
    const paths = policy.workspacePaths
    return ctx.workspaceRegistry.list().filter(workspace => paths === undefined || paths.includes(workspace.path))
  }
  const resolveWorkspace = (value: unknown, signal: AbortSignal): Workspace => {
    signal.throwIfAborted()
    const choices = permitted()
    if (value === undefined) {
      if (choices.length === 1 && choices[0] !== undefined) return choices[0]
      if (choices.length > 1) throw failure('WORKSPACE_REQUIRED', 'workspace is required when more than one project is available')
      throw failure('DSH_GATEWAY_PLANNING_WORKSPACE_UNAVAILABLE', 'Planning workspace is unavailable')
    }
    if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw invalid('workspace must be a registered project id or exact path')
    const workspace = choices.find(candidate => String(candidate.id) === value || candidate.path === value)
    if (workspace === undefined) throw failure('DSH_GATEWAY_PLANNING_WORKSPACE_UNAVAILABLE', 'Planning workspace is unavailable')
    return workspace
  }
  const access = (workspace: Workspace, signal: AbortSignal): PlanningAccess => {
    const id = String(workspace.id), path = workspace.path
    const authorize = (): void => {
      signal.throwIfAborted()
      const current = ctx.workspaceRegistry.get(WorkspaceId(id))
      if (current === undefined || current.path !== path || (policy.workspacePaths !== undefined && !policy.workspacePaths.includes(path))) throw failure('DSH_GATEWAY_PLANNING_WORKSPACE_UNAVAILABLE', 'Planning workspace is unavailable')
    }
    authorize()
    return { workspaceId: id, actorId: 'dsh-gateway-mcp', kind: 'agent', authorize }
  }
  const snapshot = async (workspace: Workspace, signal: AbortSignal) => {
    const credentials = access(workspace, signal)
    const board = await ctx.planning.snapshot(credentials, signal)
    await credentials.authorize()
    return board
  }
  const workspacePage = (args: Record<string, unknown>, signal: AbortSignal): unknown => {
    strict(args, ['cursor', 'limit'])
    signal.throwIfAborted()
    const cursor = optionalInteger(args, 'cursor', 0) ?? 0, limit = optionalInteger(args, 'limit', 1, 50) ?? 20
    const all = permitted().map(value => ({ id: String(value.id), title: value.title, path: value.path }))
    const values = all.slice(cursor, cursor + limit)
    return { workspaces: values, nextCursor: cursor + values.length < all.length ? cursor + values.length : null, total: all.length }
  }
  const list = async (args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> => {
    strict(args, ['workspace', 'query', 'kind', 'cursor', 'limit', 'boardVersion'])
    const workspace = resolveWorkspace(args.workspace, signal)
    const cursor = optionalInteger(args, 'cursor', 0) ?? 0, requestedLimit = optionalInteger(args, 'limit', 1, 50) ?? 20
    const version = optionalInteger(args, 'boardVersion', 0)
    const query = args.query === undefined ? undefined : (() => {
      const value = args.query
      if (typeof value !== 'string' || value.length > 1000) throw invalid('query is invalid')
      return value
    })()
    const kind = args.kind === undefined ? 'all' : args.kind
    if (kind !== 'all' && kind !== 'items' && kind !== 'proposals') throw invalid('kind must be all, items, or proposals')
    const board = await snapshot(workspace, signal)
    if ((cursor > 0 && version === undefined) || (version !== undefined && version !== board.version)) throw failure('BOARD_VERSION_CHANGED', 'boardVersion must match the current Board before continuing a page')
    const entries = [
      ...(kind === 'all' || kind === 'items' ? board.items.filter(value => searchMatches({ title: revision(value)?.title, intent: revision(value)?.intent, scope: revision(value)?.scope, acceptance: revision(value)?.acceptance, sources: revision(value)?.sources }, query)).map(value => ({ type: 'item' as const, value: itemSummary(board, value) })) : []),
      ...(kind === 'all' || kind === 'proposals' ? board.proposals.filter(value => searchMatches({ title: generation(value)?.draft.title, intent: generation(value)?.draft.intent, scope: generation(value)?.draft.scope, acceptance: generation(value)?.draft.acceptance, sources: generation(value)?.draft.sources }, query)).map(value => ({ type: 'proposal' as const, value: proposalSummary(value) })) : []),
    ].sort((left, right) => left.value.id.localeCompare(right.value.id))
    let count = Math.min(requestedLimit, Math.max(0, entries.length - cursor))
    const response = (length: number) => {
      const page = entries.slice(cursor, cursor + length)
      return { workspaceId: String(workspace.id), boardVersion: board.version, items: page.filter(value => value.type === 'item').map(value => value.value), proposals: page.filter(value => value.type === 'proposal').map(value => value.value), nextCursor: cursor + length < entries.length ? cursor + length : null, total: entries.length }
    }
    while (count > 0 && bytes(response(count)) > maxBytes) count--
    if (count === 0 && cursor < entries.length) throw failure('RESULT_TOO_LARGE', 'result budget is too small for one Planning summary')
    return response(count)
  }
  const read = async (args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> => {
    strict(args, ['workspace', 'id', 'cursor', 'limit', 'revisionId', 'proposalVersion'])
    const id = optionalString(args, 'id', 256)
    if (id === undefined) throw invalid('id is required')
    const cursor = optionalInteger(args, 'cursor', 0) ?? 0, limit = optionalInteger(args, 'limit', 1, 16000)
    const revisionId = optionalString(args, 'revisionId', 256), proposalVersion = optionalInteger(args, 'proposalVersion', 1)
    if (revisionId !== undefined && proposalVersion !== undefined) throw invalid('revisionId and proposalVersion cannot both be supplied')
    if (cursor > 0 && revisionId === undefined && proposalVersion === undefined) throw invalid('paged reads require revisionId or proposalVersion')
    const workspace = resolveWorkspace(args.workspace, signal), board = await snapshot(workspace, signal)
    const item = board.items.find(value => value.id === id), proposal = board.proposals.find(value => value.id === id)
    if (item === undefined && proposal === undefined) throw failure('DSH_GATEWAY_PLANNING_NOT_FOUND', 'Planning object was not found')
    if (revisionId !== undefined && (item === undefined || !item.revisions.some(value => value.id === revisionId))) throw failure('DSH_GATEWAY_PLANNING_NOT_FOUND', 'Planning revision was not found')
    if (proposalVersion !== undefined && (proposal === undefined || !proposal.generations.some(value => value.version === proposalVersion))) throw failure('DSH_GATEWAY_PLANNING_NOT_FOUND', 'Planning proposal version was not found')
    let object: unknown, objectVersion: string | number
    let selector: { revisionId: string | number } | { proposalVersion: string | number }, context: Record<string, unknown>
    if (item !== undefined) {
      const selected = item.revisions.find(value => value.id === (revisionId ?? item.headRevisionId))
      if (selected === undefined) throw failure('DSH_GATEWAY_PLANNING_NOT_FOUND', 'Planning revision was not found')
      object = { kind: 'item', id: item.id, revision: selected }
      objectVersion = selected.id
      selector = { revisionId: objectVersion }
      context = { lane: laneOf(board, item.id), disposition: item.disposition }
    } else {
      if (proposal === undefined) throw failure('DSH_GATEWAY_PLANNING_NOT_FOUND', 'Planning object was not found')
      const selected = proposal.generations.find(value => value.version === (proposalVersion ?? proposal.headVersion))
      if (selected === undefined) throw failure('DSH_GATEWAY_PLANNING_NOT_FOUND', 'Planning proposal version was not found')
      object = { kind: 'proposal', id: proposal.id, targetItemId: proposal.targetItemId, generation: selected }
      objectVersion = selected.version
      selector = { proposalVersion: objectVersion }
      context = {}
    }
    const full = {
      workspaceId: String(workspace.id), boardVersion: board.version, objectVersion, ...selector, ...context, sourceTrust, object,
    }
    if (limit === undefined && bytes(full) <= maxBytes) return full
    const serialized = JSON.stringify(object), requested = limit ?? Math.min(16_000, Math.max(1, Math.floor(maxBytes / 2)))
    if (cursor >= serialized.length) throw invalid('cursor is outside this Planning object')
    let low = 1, high = Math.min(requested, serialized.length - cursor), size = 0
    const pageFor = (length: number) => ({ workspaceId: String(workspace.id), boardVersion: board.version, objectVersion, ...selector, ...context, encoding: 'json', chunk: serialized.slice(cursor, cursor + length), nextCursor: cursor + length < serialized.length ? cursor + length : null, totalCharacters: serialized.length, sourceTrust })
    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2)
      if (bytes(pageFor(middle)) <= maxBytes) { size = middle; low = middle + 1 } else high = middle - 1
    }
    if (size === 0) throw failure('RESULT_TOO_LARGE', 'result budget is too small for a Planning read chunk')
    return pageFor(size)
  }
  const propose = async (args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> => {
    strict(args, ['workspace', 'requestId', 'expectedBoardVersion', 'idea', 'suggestedLane', 'delta'])
    const requestId = optionalString(args, 'requestId', 256), idea = optionalString(args, 'idea', 4000), expectedBoardVersion = optionalInteger(args, 'expectedBoardVersion', 0)
    if (requestId === undefined || !requestId.trim() || idea === undefined || !idea.trim() || expectedBoardVersion === undefined) throw invalid('proposal input is invalid')
    const suggestedLane = args.suggestedLane === undefined ? 'inbox' : args.suggestedLane
    if (typeof suggestedLane !== 'string' || !lanes.has(suggestedLane as PlanningLane)) throw invalid('suggestedLane must be one of inbox, now, next, later, or parking')
    const title = idea.split(/\r?\n/u).map(line => line.trim()).find(Boolean)?.slice(0, 256)
    if (!title) throw invalid('idea must contain a non-empty line')
    const workspace = resolveWorkspace(args.workspace, signal), credentials = access(workspace, signal)
    const delta = args.delta === undefined ? undefined : planningProposedDeltaSchema.parse(args.delta)
    const target = delta === undefined ? undefined : planningSubjectPlan(await snapshot(workspace, signal), delta.subject).plan
    const result = await ctx.planning.execute(credentials, { kind: 'propose', requestId, expectedBoardVersion, proposalId: `gateway-proposal-${createHash('sha256').update(requestId).digest('hex').slice(0, 32)}`, expectedProposalVersion: null, targetItemId: target?.id ?? null, baseRevisionId: delta?.baseRevision ?? null,
      ...(delta === undefined ? {} : { delta }),
      draft: { title, intent: idea, scope: [], acceptance: [], sources: [{ kind: 'manual', text: idea }], estimate: emptyEstimate, reviewAt: null }, suggestedLane: suggestedLane as PlanningLane, assumptions: [] }, signal)
    await credentials.authorize()
    return { ...result, workspaceId: String(workspace.id), sourceTrust: proposalSourceTrust }
  }
  return { async invoke(name, raw, signal) {
    const args = ownRecord(raw)
    if (name === 'dsh_planning_workspaces') return workspacePage(args, signal)
    if (name === 'dsh_planning_list') return await list(args, signal)
    if (name === 'dsh_planning_read') return await read(args, signal)
    if (name === 'dsh_planning_propose') return await propose(args, signal)
    throw failure('TOOL_NOT_FOUND', `Unknown tool '${name}'`)
  } }
}
