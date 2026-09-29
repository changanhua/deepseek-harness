import { describe, expect, it, vi } from 'vitest'
import { planningOperations } from '../src/planning.ts'

const signal = new AbortController().signal
const revision = (id: string, title: string, intent = '') => ({
  id, previousRevisionId: null, title, intent, scope: [], acceptance: [], sources: [{ kind: 'manual', text: intent }], estimate: { value: null, urgency: null, reuse: null, compounding: null, timeCost: null, tokenCost: null, risk: null, cognitiveCost: null, rationale: '' }, reviewAt: null,
})
function board(version = 3) {
  return {
    version, items: [{ id: 'item-a', disposition: 'active', headRevisionId: 'rev-a', revisions: [revision('rev-a', 'Browser', 'browser requirement')] }],
    proposals: [{ id: 'proposal-a', targetItemId: null, status: 'pending', headVersion: 1, generations: [{ version: 1, draft: { ...revision('draft', 'Idea', 'captured need'), sources: [{ kind: 'manual', text: 'captured need' }] }, suggestedLane: 'inbox', assumptions: [] }], settlement: null }],
    lanes: { inbox: ['item-a'], now: [], next: [], later: [], parking: [] }, dependencies: {}, reviews: [], handoffs: [],
  }
}
function harness(paths: readonly string[] | undefined = undefined, maxBytes = 2048) {
  const one = { id: 'one', path: 'C:/one', title: 'One' }, two = { id: 'two', path: 'C:/two', title: 'Two' }
  const snapshot = vi.fn(async () => board())
  const execute = vi.fn(async () => ({ boardVersion: 4, proposalId: 'gateway-proposal-test', proposalVersion: 1 }))
  const registry = { list: () => [one, two], get: (id: string) => [one, two].find(value => value.id === id) }
  const ctx = { workspaceRegistry: registry, planning: { snapshot, execute } }
  return {
    operations: planningOperations(ctx as never, { ...(paths === undefined ? {} : { workspacePaths: paths }) }, maxBytes),
    snapshot, execute, registry,
  }
}

describe('Planning MCP operations', () => {
  it('requires explicit selection across two projects and never exposes an unallowed one', async () => {
    const local = harness(['C:/one'], 420)
    await expect(local.operations.invoke('dsh_planning_list', {}, signal)).resolves.toMatchObject({ workspaceId: 'one' })
    await expect(local.operations.invoke('dsh_planning_list', { workspace: 'two' }, signal)).rejects.toMatchObject({ code: 'DSH_GATEWAY_PLANNING_WORKSPACE_UNAVAILABLE' })
    const all = harness()
    await expect(all.operations.invoke('dsh_planning_list', {}, signal)).rejects.toMatchObject({ code: 'WORKSPACE_REQUIRED' })
  })

  it('rejects authority-shaped or unknown proposal fields and preserves raw manual source', async () => {
    const local = harness(['C:/one'])
    await expect(local.operations.invoke('dsh_planning_propose', { workspace: 'one', requestId: 'r', expectedBoardVersion: 3, idea: 'raw idea', actor: 'forged' }, signal)).rejects.toMatchObject({ code: 'DSH_GATEWAY_INVALID_INPUT' })
    await local.operations.invoke('dsh_planning_propose', { workspace: 'C:/one', requestId: 'r', expectedBoardVersion: 3, idea: 'raw idea' }, signal)
    await local.operations.invoke('dsh_planning_propose', { workspace: 'C:/one', requestId: 'r', expectedBoardVersion: 3, idea: 'raw idea' }, signal)
    expect(local.execute).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'one', actorId: 'dsh-gateway-mcp', kind: 'agent' }), expect.objectContaining({ requestId: 'r', proposalId: expect.stringMatching(/^gateway-proposal-/), draft: expect.objectContaining({ intent: 'raw idea', sources: [{ kind: 'manual', text: 'raw idea' }] }) }), signal)
    expect(local.execute.mock.calls[0]?.[1]).toEqual(local.execute.mock.calls[1]?.[1])
  })

  it('searches sources, keeps a stable page contract, and rejects stale continuation', async () => {
    const local = harness(['C:/one'])
    await expect(local.operations.invoke('dsh_planning_list', { query: 'captured' }, signal)).resolves.toMatchObject({ proposals: [{ id: 'proposal-a' }], items: [], boardVersion: 3 })
    await expect(local.operations.invoke('dsh_planning_list', { cursor: 1 }, signal)).rejects.toMatchObject({ code: 'BOARD_VERSION_CHANGED' })
    await expect(local.operations.invoke('dsh_planning_list', { boardVersion: 2 }, signal)).rejects.toMatchObject({ code: 'BOARD_VERSION_CHANGED' })
  })

  it('rechecks registration before returning a read', async () => {
    const local = harness(['C:/one'])
    local.registry.get = () => undefined
    await expect(local.operations.invoke('dsh_planning_read', { workspace: 'one', id: 'item-a' }, signal)).rejects.toMatchObject({ code: 'DSH_GATEWAY_PLANNING_WORKSPACE_UNAVAILABLE' })
  })

  it('reads one selected immutable version and keeps a continuation on that version', async () => {
    const local = harness(['C:/one'], 420)
    const first = board()
    first.items[0]!.revisions.push({ ...revision('rev-b', 'New browser'), previousRevisionId: 'rev-a' })
    first.items[0]!.headRevisionId = 'rev-b'
    local.snapshot.mockResolvedValue(first)
    first.items[0]!.revisions[0]!.scope = Array.from({ length: 20 }, () => 'immutable browser evidence')
    const old = await local.operations.invoke('dsh_planning_read', { workspace: 'one', id: 'item-a', revisionId: 'rev-a', limit: 16000 }, signal) as Record<string, unknown>
    expect(old).toMatchObject({ revisionId: 'rev-a', objectVersion: 'rev-a', encoding: 'json' })
    const newer = structuredClone(first)
    newer.items[0]!.revisions.push({ ...revision('rev-c', 'Later browser'), previousRevisionId: 'rev-b' })
    newer.items[0]!.headRevisionId = 'rev-c'
    local.snapshot.mockResolvedValue(newer)
    const chunks = [String(old.chunk)]
    let cursor = old.nextCursor as number | null
    while (cursor !== null) {
      const next = await local.operations.invoke('dsh_planning_read', { workspace: 'one', id: 'item-a', revisionId: 'rev-a', cursor, limit: 16000 }, signal) as Record<string, unknown>
      expect(next).toMatchObject({ revisionId: 'rev-a', objectVersion: 'rev-a' })
      chunks.push(String(next.chunk))
      cursor = next.nextCursor as number | null
    }
    expect(JSON.parse(chunks.join(''))).toMatchObject({ kind: 'item', id: 'item-a', revision: { id: 'rev-a', title: 'Browser' } })
  })
})
