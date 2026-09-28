import { expect, it } from 'vitest'
import type { PlanningCommand } from '@changanhua/dsh-planning/types'
import { bootPlanningBundle } from './harness.ts'

function planning(world: Awaited<ReturnType<typeof bootPlanningBundle>>) {
  const entry = [...world.ctx.loader.entries()].find(value => value.options.id === 'planning-local')
  const service = entry?.ctx.get('planning')
  if (service === undefined) throw new Error('planning service did not activate in its Host realm')
  return service
}

it('retains one draft across turns and restart, then atomically accepts its exact generation', async () => {
  let world = await bootPlanningBundle()
  const signal = new AbortController().signal
  const snapshot = () => planning(world).snapshot({ workspaceId: world.workspaceId, actorId: 'inspector', kind: 'human', authorize() {} })
  try {
    const seed = world.create('seed')
    if (seed.kind !== 'create') throw new Error('invalid fixture')
    const { title, intent, scope, acceptance, sources, estimate, reviewAt } = seed
    const command: Extract<PlanningCommand, { kind: 'propose' }> = {
      kind: 'propose', requestId: 'conversation-one', expectedBoardVersion: 0,
      proposalId: 'stable-conversation-draft', expectedProposalVersion: null,
      targetItemId: null, baseRevisionId: null, suggestedLane: 'next', assumptions: ['Implementation details remain open.'],
      draft: { title, intent, scope, acceptance, sources, estimate, reviewAt },
    }
    const agent = { workspaceId: world.workspaceId, actorId: 'agent-one', kind: 'agent' as const, authorize() {} }
    await planning(world).execute(agent, command)
    await planning(world).execute(agent, {
      ...command, requestId: 'conversation-two', expectedBoardVersion: 1, expectedProposalVersion: 1,
      draft: { ...command.draft, acceptance: ['No structured fields are typed by the user.'] },
    })
    const before = await snapshot()
    expect(before.items).toHaveLength(0)
    expect(before.proposals).toHaveLength(1)
    expect(before.proposals[0]?.generations.map(value => value.version)).toEqual([1, 2])
    expect(before.proposals[0]?.generations[0]?.draft.acceptance).toEqual([])
    expect(before.proposals[0]?.generations[1]?.actor).toEqual({ kind: 'agent', id: 'agent-one' })
    await world.close()
    world = await world.reopen()
    expect(await snapshot()).toEqual(before)

    const accept: PlanningCommand = {
      kind: 'accept-proposal', requestId: 'accept-exact-draft', expectedBoardVersion: 2,
      proposalId: command.proposalId, expectedProposalVersion: 2,
    }
    await expect(world.remote.execute({ workspaceId: world.workspaceId, command: { ...accept, expectedProposalVersion: 1 } }, signal))
      .rejects.toMatchObject({ failure: { code: 'conflict' } })
    expect(await snapshot()).toEqual(before)
    const accepted = await world.remote.execute({ workspaceId: world.workspaceId, command: accept }, signal)
    await world.close()
    world = await world.reopen()
    await expect(world.remote.execute({ workspaceId: world.workspaceId, command: accept }, signal)).resolves.toEqual(accepted)
    const after = await snapshot()
    expect(after.items).toHaveLength(1)
    expect(after.lanes.next).toEqual([accepted.itemId])
    expect(after.proposals[0]).toMatchObject({ status: 'accepted', headVersion: 2, settlement: { itemId: accepted.itemId, revisionId: accepted.revisionId } })
    expect(after.items[0]?.revisions[0]?.acceptance).toEqual(['No structured fields are typed by the user.'])
    expect(after.events.filter(event => event.kind === 'proposal-accepted')).toHaveLength(1)
  } finally { await world.dispose() }
})

it('refuses a stale target head without discarding either the proposal or its historical base', async () => {
  const world = await bootPlanningBundle()
  const signal = new AbortController().signal
  const snapshot = () => planning(world).snapshot({ workspaceId: world.workspaceId, actorId: 'inspector', kind: 'human', authorize() {} })
  try {
    const create = world.create('create')
    if (create.kind !== 'create') throw new Error('invalid fixture')
    const result = await world.remote.execute({ workspaceId: world.workspaceId, command: create }, signal)
    const { title, intent, scope, acceptance, sources, estimate, reviewAt } = create
    await world.remote.execute({ workspaceId: world.workspaceId, command: {
      kind: 'propose', requestId: 'suggest', expectedBoardVersion: 1,
      proposalId: 'suggestion', expectedProposalVersion: null, targetItemId: result.itemId!, baseRevisionId: result.revisionId!,
      draft: { title: 'Agent suggestion', intent, scope, acceptance, sources, estimate, reviewAt }, suggestedLane: 'now', assumptions: [],
    } }, signal)
    await world.remote.execute({ workspaceId: world.workspaceId, command: {
      kind: 'revise', requestId: 'human-new-head', expectedBoardVersion: 2, itemId: result.itemId!, expectedRevisionId: result.revisionId!,
      title, intent: 'The user chose a different scope.', scope, acceptance, sources, estimate, reviewAt,
    } }, signal)
    const before = await snapshot()
    expect(before.items[0]?.revisions).toHaveLength(2)
    await expect(world.remote.execute({ workspaceId: world.workspaceId, command: {
      kind: 'accept-proposal', requestId: 'accept-stale-base', expectedBoardVersion: 3, proposalId: 'suggestion', expectedProposalVersion: 1,
    } }, signal)).rejects.toMatchObject({ failure: { code: 'conflict' } })
    expect(await snapshot()).toEqual(before)
  } finally { await world.dispose() }
})
