import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlanningHarness } from './harness.ts'
import { acquirePlanningOwnership } from '../src/ownership.ts'

const active: Awaited<ReturnType<typeof createPlanningHarness>>[] = []
afterEach(async () => {
  await Promise.all(active.splice(0).map(value => value.dispose()))
})
describe('LocalPlanning provider', () => {
  it('refuses a new handoff after archival but can recover an already prepared handoff', async () => {
    const local = await createPlanningHarness()
    active.push(local)
    const created = await local.ctx.planning.execute(local.access(), local.create('archive-handoff'))
    const input = {
      itemId: created.itemId!,
      expectedRevisionId: created.revisionId!,
      repositoryId: 'repo',
      key: 'a'.repeat(64),
      mapperVersion: 1 as const,
      operatorId: 'operator',
      deliveryRequestDigest: 'b'.repeat(64),
    }
    const prepared = await local.ctx.planning.prepareDeliveryHandoff(local.access(), input)
    const board = await local.ctx.planning.snapshot(local.access())
    await local.ctx.planning.execute(local.access(), {
      kind: 'archive',
      requestId: 'archive',
      expectedBoardVersion: board.version,
      itemId: created.itemId!,
    })
    await expect(local.ctx.planning.prepareDeliveryHandoff(local.access(), input)).resolves.toEqual(prepared)
    await expect(
      local.ctx.planning.prepareDeliveryHandoff(local.access(), {
        ...input,
        repositoryId: 'other',
        key: 'c'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect((await local.ctx.planning.snapshot(local.access())).handoffs).toHaveLength(1)
  })
  it('replays a committed request after its source event disappears', async () => {
    const local = await createPlanningHarness()
    active.push(local)
    const first = await local.ctx.planning.execute(local.access(), local.create('replay-source'))
    vi.spyOn(local.ctx.sessionQuery, 'readEvent').mockRejectedValueOnce(new Error('source disappeared'))
    await expect(local.ctx.planning.execute(local.access(), local.create('replay-source'))).resolves.toEqual(first)
  })
  it('captures proposal sources through the Provider before persisting review provenance', async () => {
    const local = await createPlanningHarness()
    active.push(local)
    const created = await local.ctx.planning.execute(local.access(), local.create('proposal-review-source'))
    const review = await local.ctx.planning.execute(local.access(), {
      kind: 'review',
      requestId: 'proposal-review',
      expectedBoardVersion: 1,
      itemId: created.itemId!,
      expectedRevisionId: created.revisionId!,
      outcome: 'learned',
      summary: 'Review.',
      lessons: [],
      followUpItemIds: [],
      acceptanceRef: null,
    })
    await local.ctx.planning.execute(local.access(), {
      kind: 'propose',
      requestId: 'proposal-capture',
      expectedBoardVersion: 2,
      proposalId: 'proposal-capture',
      expectedProposalVersion: null,
      targetItemId: null,
      baseRevisionId: null,
      fromReviewId: review.reviewId!,
      draft: {
        title: 'Captured proposal',
        intent: 'Keep the source.',
        scope: [],
        acceptance: [],
        sources: [{ kind: 'session-event', sessionId: local.session.id, seq: local.event.seq }],
        estimate: {
          value: 1,
          urgency: 1,
          reuse: 1,
          compounding: 1,
          timeCost: 1,
          tokenCost: 1,
          risk: 1,
          cognitiveCost: 1,
          rationale: 'test',
        },
        reviewAt: null,
      },
      suggestedLane: 'next',
      assumptions: [],
    })
    expect((await local.ctx.planning.snapshot(local.access())).proposals[0]).toMatchObject({
      fromReviewId: review.reviewId,
      targetItemId: null,
      generations: [{ draft: { sources: [{ kind: 'session-event', verification: 'verified' }] } }],
    })
  })
  it('refuses a second local Host owner for the same ownership root', async () => {
    const local = await createPlanningHarness()
    active.push(local)
    await expect(acquirePlanningOwnership(`${local.root}/owner`)).rejects.toMatchObject({ code: 'conflict' })
  })
  it('checks authorization again immediately before the queued commit', async () => {
    const local = await createPlanningHarness()
    active.push(local)
    let checks = 0
    await expect(
      local.ctx.planning.execute(
        local.access(() => {
          if (++checks >= 3) throw new Error('revoked')
        }),
        local.create('revoked'),
      ),
    ).rejects.toThrow('revoked')
    expect(await local.ctx.planning.snapshot(local.access())).toMatchObject({ version: 0, items: [] })
  })
  it('cancels before source capture without creating a Board', async () => {
    const local = await createPlanningHarness()
    active.push(local)
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(
      local.ctx.planning.execute(local.access(), local.create('cancelled'), controller.signal),
    ).rejects.toThrow('cancelled')
    expect(await local.ctx.planning.snapshot(local.access())).toMatchObject({ version: 0, items: [] })
  })
  it('rejects an agent direct command without a trusted current user message', async () => {
    const local = await createPlanningHarness()
    active.push(local)
    await expect(
      local.ctx.planning.execute({ ...local.access(), kind: 'agent' }, local.create('agent-without-user')),
    ).rejects.toMatchObject({ code: 'unauthorized' })
  })
  it('replays an agent direct command after its original user message can no longer be read', async () => {
    const local = await createPlanningHarness()
    active.push(local)
    const access = {
      ...local.access(),
      kind: 'agent' as const,
      userMessage: { sessionId: local.session.id, seq: local.event.seq },
    }
    const first = await local.ctx.planning.execute(access, local.create('agent-replay'))
    vi.spyOn(local.ctx.sessionQuery, 'readEvent').mockRejectedValueOnce(new Error('source disappeared'))
    await expect(local.ctx.planning.execute(access, local.create('agent-replay'))).resolves.toEqual(first)
    expect((await local.ctx.planning.snapshot(local.access())).items).toHaveLength(1)
  })
  it('adds the trusted agent user message to create and revise sources', async () => {
    const local = await createPlanningHarness()
    active.push(local)
    const access = {
      ...local.access(),
      kind: 'agent' as const,
      userMessage: { sessionId: local.session.id, seq: local.event.seq },
    }
    const create = local.create('agent-provenance-create')
    if (create.kind !== 'create') throw new Error('invalid test fixture')
    const created = await local.ctx.planning.execute(access, {
      ...create,
      sources: [{ kind: 'manual', text: 'The agent kept this existing source.' }],
    })
    await local.ctx.planning.execute(access, {
      kind: 'revise',
      requestId: 'agent-provenance-revise',
      expectedBoardVersion: 1,
      itemId: created.itemId!,
      expectedRevisionId: created.revisionId!,
      title: 'Revised provider plan',
      intent: 'Preserve the current user message on every direct agent revision.',
      scope: [],
      acceptance: [],
      sources: [{ kind: 'manual', text: 'The revision has its own source.' }],
      estimate: {
        value: 1,
        urgency: 1,
        reuse: 1,
        compounding: 1,
        timeCost: 1,
        tokenCost: 1,
        risk: 1,
        cognitiveCost: 1,
        rationale: 'test',
      },
      reviewAt: null,
    })
    const revisions = (await local.ctx.planning.snapshot(local.access())).items[0]!.revisions
    expect(revisions.map(revision => revision.sources)).toEqual([
      expect.arrayContaining([
        expect.objectContaining({ kind: 'manual' }),
        expect.objectContaining({ kind: 'session-event', sessionId: local.session.id, seq: local.event.seq }),
      ]),
      expect.arrayContaining([
        expect.objectContaining({ kind: 'manual' }),
        expect.objectContaining({ kind: 'session-event', sessionId: local.session.id, seq: local.event.seq }),
      ]),
    ])
  })
  it('does not duplicate an agent user message already supplied as a source', async () => {
    const local = await createPlanningHarness()
    active.push(local)
    const access = {
      ...local.access(),
      kind: 'agent' as const,
      userMessage: { sessionId: local.session.id, seq: local.event.seq },
    }
    await local.ctx.planning.execute(access, local.create('agent-provenance-deduplicated'))
    const sources = (await local.ctx.planning.snapshot(local.access())).items[0]!.revisions[0]!.sources
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ kind: 'session-event', sessionId: local.session.id, seq: local.event.seq })
  })
  it('rejects agent provenance when a command already has twenty different sources', async () => {
    const local = await createPlanningHarness()
    active.push(local)
    const access = {
      ...local.access(),
      kind: 'agent' as const,
      userMessage: { sessionId: local.session.id, seq: local.event.seq },
    }
    const create = local.create('agent-provenance-capacity')
    if (create.kind !== 'create') throw new Error('invalid test fixture')
    await expect(
      local.ctx.planning.execute(access, {
        ...create,
        sources: Array.from({ length: 20 }, (_, index) => ({ kind: 'manual' as const, text: `source ${index}` })),
      }),
    ).rejects.toMatchObject({ code: 'capacity-exceeded' })
    expect((await local.ctx.planning.snapshot(local.access())).items).toHaveLength(0)
  })
  it('replays an agent request without changing its receipt or provenance for a later user message', async () => {
    const local = await createPlanningHarness()
    active.push(local)
    const command = {
      ...local.create('agent-provenance-replay'),
      sources: [{ kind: 'manual' as const, text: 'The command source is stable.' }],
    }
    const firstAccess = {
      ...local.access(),
      kind: 'agent' as const,
      userMessage: { sessionId: local.session.id, seq: local.event.seq },
    }
    const first = await local.ctx.planning.execute(firstAccess, command)
    const replay = await local.ctx.planning.execute(
      {
        ...firstAccess,
        userMessage: { sessionId: local.session.id, seq: local.event.seq + 1 },
      },
      command,
    )
    expect(replay).toEqual(first)
    const board = await local.ctx.planning.snapshot(local.access())
    expect(board.version).toBe(1)
    expect(board.items[0]!.revisions[0]!.sources).toContainEqual(
      expect.objectContaining({ kind: 'session-event', sessionId: local.session.id, seq: local.event.seq }),
    )
    expect(board.items[0]!.revisions[0]!.sources).not.toContainEqual(
      expect.objectContaining({ kind: 'session-event', sessionId: local.session.id, seq: local.event.seq + 1 }),
    )
  })
  it('rejects bridge direct commands and fabricated non-user message references', async () => {
    const local = await createPlanningHarness()
    active.push(local)
    await expect(
      local.ctx.planning.execute({ ...local.access(), kind: 'bridge' }, local.create('bridge-direct')),
    ).rejects.toMatchObject({ code: 'unauthorized' })
    const nonUser = local.session.append('turn/start', { turn: 1 })
    await expect(
      local.ctx.planning.execute(
        { ...local.access(), kind: 'agent', userMessage: { sessionId: local.session.id, seq: nonUser.seq } },
        local.create('fabricated-message'),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized' })
    expect((await local.ctx.planning.snapshot(local.access())).items).toHaveLength(0)
  })
  it('refuses bridge prepare and an agent prepare without a user message', async () => {
    const local = await createPlanningHarness()
    active.push(local)
    const input = {
      itemId: 'missing',
      expectedRevisionId: 'missing',
      repositoryId: 'repo',
      key: 'a'.repeat(16),
      mapperVersion: 1 as const,
      operatorId: 'operator',
      deliveryRequestDigest: 'b'.repeat(64),
    }
    await expect(
      local.ctx.planning.prepareDeliveryHandoff({ ...local.access(), kind: 'bridge' }, input),
    ).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(
      local.ctx.planning.prepareDeliveryHandoff({ ...local.access(), kind: 'agent' }, input),
    ).rejects.toMatchObject({ code: 'unauthorized' })
  })
  it('verifies the actual user message when preparing a handoff', async () => {
    const local = await createPlanningHarness()
    active.push(local)
    const created = await local.ctx.planning.execute(local.access(), local.create('handoff-user-check'))
    const input = {
      itemId: created.itemId!,
      expectedRevisionId: created.revisionId!,
      repositoryId: 'repo',
      key: 'a'.repeat(64),
      mapperVersion: 1 as const,
      operatorId: 'operator',
      deliveryRequestDigest: 'b'.repeat(64),
    }
    const nonUser = local.session.append('turn/start', { turn: 1 })
    await expect(
      local.ctx.planning.prepareDeliveryHandoff(
        { ...local.access(), kind: 'agent', userMessage: { sessionId: local.session.id, seq: nonUser.seq } },
        input,
      ),
    ).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(
      local.ctx.planning.prepareDeliveryHandoff(
        { ...local.access(), kind: 'agent', userMessage: { sessionId: 'foreign-session', seq: 0 } },
        input,
      ),
    ).rejects.toMatchObject({ code: 'unauthorized' })
    expect((await local.ctx.planning.snapshot(local.access())).handoffs).toHaveLength(0)
  })
  it('rejects malformed handoff inputs and changed frozen operator on retry', async () => {
    const local = await createPlanningHarness()
    active.push(local)
    const created = await local.ctx.planning.execute(local.access(), local.create('handoff-input-check'))
    const input = {
      itemId: created.itemId!,
      expectedRevisionId: created.revisionId!,
      repositoryId: 'repo',
      key: 'a'.repeat(64),
      mapperVersion: 1 as const,
      operatorId: 'operator',
      deliveryRequestDigest: 'b'.repeat(64),
    }
    await expect(
      local.ctx.planning.prepareDeliveryHandoff(local.access(), { ...input, mapperVersion: 2 } as never),
    ).rejects.toMatchObject({ code: 'invalid-reference' })
    await local.ctx.planning.prepareDeliveryHandoff(local.access(), input)
    await expect(
      local.ctx.planning.prepareDeliveryHandoff(local.access(), { ...input, operatorId: 'different-operator' }),
    ).rejects.toMatchObject({ code: 'idempotency-conflict' })
    await expect(
      local.ctx.planning.linkDeliveryHandoff(
        { ...local.access(), kind: 'bridge' },
        { key: input.key, caseId: '', contractRevisionId: 'contract' },
      ),
    ).rejects.toMatchObject({ code: 'invalid-reference' })
    expect((await local.ctx.planning.snapshot(local.access())).handoffs[0]?.phase).toBe('prepared')
  })
  it('drains an admitted source read before dispose releases the provider', async () => {
    const local = await createPlanningHarness()
    active.push(local)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const original = local.ctx.sessionQuery.readEvent.bind(local.ctx.sessionQuery)
    vi.spyOn(local.ctx.sessionQuery, 'readEvent').mockImplementation(async (request) => {
      await gate
      return original(request)
    })
    const pending = local.ctx.planning.execute(local.access(), local.create('dispose-drain'))
    await Promise.resolve()
    let disposed = false
    const disposing = local.planningFiber.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)
    release()
    await expect(pending).resolves.toMatchObject({ boardVersion: 1 })
    await disposing
  })
})
