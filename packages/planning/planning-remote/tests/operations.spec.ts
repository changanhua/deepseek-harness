import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { createMemoryHarness } from '../../../memory/memory-local/tests/harness.ts'
import { PlanningRemoteService } from '../src/index.ts'
import LocalPlanning from '../../planning-local/src/index.ts'
import { join } from 'node:path'
import type { PlanningCommand } from '../../planning/src/types.ts'
import { createPlanningHarness } from '../../planning-local/tests/harness.ts'
import LocalDelivery from '@changanhua/dsh-delivery-local'
import PlanningDelivery from '../../planning-delivery-bridge/src/index.ts'
import { projectDeliverySnapshot } from '../../../delivery/delivery-remote/src/projection.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(dispose => dispose()))
})

describe('planning Remote project selection', () => {
  it('hands off one exact revision and reuses the linked Case on retry', async () => {
    const harness = await createPlanningHarness()
    cleanups.push(harness.dispose)
    await harness.ctx.plugin(LocalDelivery)
    await harness.ctx.plugin(PlanningDelivery, {
      routes: [{ workspacePath: harness.workspace.path, repositoryId: 'planning-repo' }],
    })
    const remote = new PlanningRemoteService(harness.ctx)
    const signal = new AbortController().signal
    const created = await harness.ctx.planning.execute(harness.access(), harness.create('for-delivery'))
    const input = {
      workspaceId: harness.workspace.id,
      itemId: created.itemId!,
      expectedRevisionId: created.revisionId!,
    }
    const linked = await remote.handoff(input, signal)
    expect(linked).toMatchObject({ phase: 'linked', revisionId: created.revisionId })
    await expect(remote.handoff(input, signal)).resolves.toEqual(linked)
    expect(harness.ctx.delivery.snapshot().deliveryCases).toHaveLength(1)
    const spoof = { ...input, actorId: 'spoof' }
    await expect(remote.handoff(spoof, signal)).rejects.toMatchObject({ failure: { code: 'bad-request' } })
  })

  it('joins only persisted handoff Case ids and leaves live Delivery failures visible', async () => {
    const harness = await createPlanningHarness()
    cleanups.push(harness.dispose)
    await harness.ctx.plugin(LocalDelivery)
    await harness.ctx.plugin(PlanningDelivery, {
      routes: [{ workspacePath: harness.workspace.path, repositoryId: 'planning-repo' }],
    })
    const deliverySnapshot = vi.fn(() => projectDeliverySnapshot(harness.ctx.delivery.snapshot(), [], []))
    harness.ctx.provide('deliveryRemote', { snapshot: deliverySnapshot })
    const remote = new PlanningRemoteService(harness.ctx)
    const signal = new AbortController().signal
    const created = await harness.ctx.planning.execute(harness.access(), harness.create('join-case'))
    const linked = await remote.handoff(
      { workspaceId: harness.workspace.id, itemId: created.itemId!, expectedRevisionId: created.revisionId! },
      signal,
    )
    await expect(remote.snapshot(harness.workspace.id, signal)).resolves.toMatchObject({
      executions: [
        {
          itemId: created.itemId,
          revisionId: created.revisionId,
          caseId: linked.caseId,
          stage: 'shaping',
          reviewSuggested: false,
        },
      ],
    })
    const view = await remote.execution({ workspaceId: harness.workspace.id, itemId: created.itemId! }, signal)
    expect(view).toMatchObject({
      available: true,
      handoffs: [{ handoff: { key: linked.key }, case: { case: { id: linked.caseId }, lane: 'shaping' } }],
    })
    expect(view.handoffs[0]!.case!.readiness.ready).toBe(false)
    const foreignPath = join(harness.root, 'foreign')
    await mkdir(foreignPath)
    const foreign = await harness.ctx.workspaceRegistry.create(foreignPath)
    const seed = harness.create('foreign')
    if (seed.kind !== 'create') throw new Error('invalid test fixture')
    await harness.ctx.planning.execute(
      { ...harness.access(), workspaceId: foreign.id },
      { ...seed, sources: [{ kind: 'manual', text: 'foreign' }] },
    )
    expect((await remote.execution({ workspaceId: foreign.id, itemId: created.itemId! }, signal)).handoffs).toEqual([])
    deliverySnapshot.mockImplementationOnce(() => {
      throw new Error('PRIVATE_HOST_DETAIL')
    })
    await expect(remote.snapshot(harness.workspace.id, signal)).resolves.toMatchObject({
      items: [{ id: created.itemId }],
      executions: [{ itemId: created.itemId, stage: 'unavailable', reviewSuggested: false }],
    })
    expect((await harness.ctx.planning.snapshot(harness.access())).handoffs[0]?.caseId).toBe(linked.caseId)
  })

  it('reads only packet-declared evidence for the selected linked Plan', async () => {
    const harness = await createPlanningHarness()
    cleanups.push(harness.dispose)
    await harness.ctx.plugin(LocalDelivery)
    await harness.ctx.plugin(PlanningDelivery, {
      routes: [{ workspacePath: harness.workspace.path, repositoryId: 'planning-repo' }],
    })
    const signal = new AbortController().signal
    const remote = new PlanningRemoteService(harness.ctx)
    const first = await harness.ctx.planning.execute(harness.access(), harness.create('evidence-first'))
    const linked = await remote.handoff(
      { workspaceId: harness.workspace.id, itemId: first.itemId!, expectedRevisionId: first.revisionId! },
      signal,
    )
    const board = await harness.ctx.planning.snapshot(harness.access())
    const createSecond = harness.create('evidence-second', board.version)
    if (createSecond.kind !== 'create') throw new Error('invalid test fixture')
    const second = await harness.ctx.planning.execute(harness.access(), {
      ...createSecond,
      itemId: 'other-plan',
    })
    await remote.handoff(
      { workspaceId: harness.workspace.id, itemId: second.itemId!, expectedRevisionId: second.revisionId! },
      signal,
    )
    const readEvidence = vi.fn(async () => ({
      id: 'evidence-linked',
      kind: 'log',
      mediaType: 'text/plain',
      byteLength: 4,
      digest: 'sha256:test',
      createdAt: '2026-09-27T00:00:00.000Z',
      provenance: { kind: 'runner-output' },
      contentBase64: 'dGVzdA==',
    }))
    const snapshot = vi.fn(() => {
      const canonical = projectDeliverySnapshot(harness.ctx.delivery.snapshot(), [], [])
      const linkedCase = canonical.cases.find(card => String(card.case.id) === linked.caseId)!
      return {
        ...canonical,
        cards: [
          ...canonical.cards,
          {
            contractRevision: linkedCase.headRevision,
            packet: { id: 'packet-linked', contractRevisionId: linked.contractRevisionId },

            lane: 'review',
            dispatches: [],
            completionClaim: { evidenceIds: ['evidence-linked'] },

            verificationVerdict: null,
            acceptanceDecision: null,
            attentionReasons: [],
          },
        ],
      } as never
    })
    harness.ctx.provide('deliveryRemote', { snapshot, readEvidence })
    await expect(
      remote.evidence(
        { workspaceId: harness.workspace.id, itemId: first.itemId!, evidenceId: 'evidence-linked' },
        signal,
      ),
    ).resolves.toMatchObject({ id: 'evidence-linked', contentBase64: 'dGVzdA==' })
    await expect(
      remote.evidence(
        {
          workspaceId: harness.workspace.id,
          itemId: first.itemId!,
          evidenceId: 'evidence-linked',
          uri: 'file:///private',
        } as never,
        signal,
      ),
    ).rejects.toMatchObject({ failure: { code: 'bad-request' } })
    await expect(
      remote.evidence(
        { workspaceId: harness.workspace.id, itemId: first.itemId!, evidenceId: 'evidence-missing' },
        signal,
      ),
    ).rejects.toMatchObject({ failure: { code: 'not-found' } })
    await expect(
      remote.evidence(
        { workspaceId: harness.workspace.id, itemId: second.itemId!, evidenceId: 'evidence-linked' },
        signal,
      ),
    ).rejects.toMatchObject({ failure: { code: 'not-found' } })
    expect(readEvidence).toHaveBeenCalledTimes(1)
    expect(readEvidence).toHaveBeenCalledWith({ evidenceId: 'evidence-linked' }, signal)
  })

  it('keeps a frozen handoff revision attached to its historical Packet after the Case head advances', async () => {
    const harness = await createPlanningHarness()
    cleanups.push(harness.dispose)
    await harness.ctx.plugin(LocalDelivery)
    await harness.ctx.plugin(PlanningDelivery, {
      routes: [{ workspacePath: harness.workspace.path, repositoryId: 'planning-repo' }],
    })
    const signal = new AbortController().signal
    const remote = new PlanningRemoteService(harness.ctx)
    const created = await harness.ctx.planning.execute(harness.access(), harness.create('historical-packet'))
    const linked = await remote.handoff(
      { workspaceId: harness.workspace.id, itemId: created.itemId!, expectedRevisionId: created.revisionId! },
      signal,
    )
    const original = harness.ctx.delivery.getContractRevision(linked.contractRevisionId as never)!
    await harness.ctx.delivery.reviseCase({
      idempotencyKey: 'advance-linked-case',
      caseId: linked.caseId as never,
      expectedHeadRevisionId: linked.contractRevisionId as never,
      origin: { kind: 'human', actorId: 'operator' },
      title: 'Later Case head',
      revision: {
        outcome: original.outcome,
        context: original.context,
        allowedScope: original.allowedScope,

        forbiddenScope: original.forbiddenScope,
        acceptanceClauses: original.acceptanceClauses,

        openDecisions: original.openDecisions,
        baseSelectionRule: original.baseSelectionRule,

        verificationSource: original.verificationSource,
        referenceLinks: original.referenceLinks,
      },
    })
    const canonical = projectDeliverySnapshot(harness.ctx.delivery.snapshot(), [], [])
    const current = canonical.cases.find(value => String(value.case.id) === linked.caseId)!
    expect(current.case.headRevisionId).not.toBe(linked.contractRevisionId)
    const historicalPacket = {
      contractRevision: original,
      packet: { id: 'packet-before-case-revision', contractRevisionId: linked.contractRevisionId },

      lane: 'accepted',
      dispatches: [],
      completionClaim: { evidenceIds: ['evidence-before-case-revision'] },
      verificationVerdict: { evidenceIds: ['evidence-before-case-revision'] },
      acceptanceDecision: { decision: 'accepted' },
      attentionReasons: [],
    }
    const snapshot = vi.fn(
      () =>
        ({
          ...canonical,
          cases: [
            {
              ...current,
              case: { ...current.case, headRevisionId: 'later-contract-revision' },
              headRevision: { ...current.headRevision, id: 'later-contract-revision' },
              packets: [],
              lane: 'shaping',
            },
          ],
          cards: [historicalPacket],
        }) as never,
    )
    const readEvidence = vi.fn(async () => ({
      id: 'evidence-before-case-revision',
      kind: 'log',
      mediaType: 'text/plain',
      byteLength: 4,
      digest: 'sha256:test',
      createdAt: '2026-09-27T00:00:00.000Z',
      provenance: { kind: 'runner-output' },
      contentBase64: 'dGVzdA==',
    }))
    harness.ctx.provide('deliveryRemote', { snapshot, readEvidence })

    await expect(
      remote.execution({ workspaceId: harness.workspace.id, itemId: created.itemId! }, signal),
    ).resolves.toMatchObject({
      handoffs: [
        {
          handoff: { contractRevisionId: linked.contractRevisionId },
          case: {
            lane: 'shaping',
            packets: [{ packet: { id: 'packet-before-case-revision', contractRevisionId: linked.contractRevisionId } }],
          },
        },
      ],
    })
    await expect(
      remote.evidence(
        { workspaceId: harness.workspace.id, itemId: created.itemId!, evidenceId: 'evidence-before-case-revision' },
        signal,
      ),
    ).resolves.toMatchObject({ id: 'evidence-before-case-revision' })
  })

  it('keeps planning usable without an execution composition and refuses missing plans', async () => {
    const harness = await createPlanningHarness()
    cleanups.push(harness.dispose)
    const remote = new PlanningRemoteService(harness.ctx)
    const signal = new AbortController().signal
    const created = await harness.ctx.planning.execute(harness.access(), harness.create('planning-only'))
    await expect(remote.snapshot(harness.workspace.id, signal)).resolves.toMatchObject({ executions: [] })
    await expect(
      remote.execution({ workspaceId: harness.workspace.id, itemId: created.itemId! }, signal),
    ).resolves.toEqual({ available: false, handoffs: [] })
    await expect(
      remote.execution({ workspaceId: harness.workspace.id, itemId: 'unknown' }, signal),
    ).rejects.toMatchObject({ failure: { code: 'not-found' } })
    await expect(
      remote.handoff(
        { workspaceId: harness.workspace.id, itemId: created.itemId!, expectedRevisionId: created.revisionId! },
        signal,
      ),
    ).rejects.toMatchObject({ failure: { code: 'not-found' } })
    expect((await harness.ctx.planning.snapshot(harness.access())).handoffs).toHaveLength(0)
  })
  it('returns registered project labels without filesystem paths', async () => {
    const harness = await createMemoryHarness()
    cleanups.push(harness.dispose)
    const remote = new PlanningRemoteService(harness.ctx)
    const choices = await remote.workspaces(new AbortController().signal)
    expect(choices).toEqual(harness.ctx.workspaceRegistry.list().map(({ id, title }) => ({ id, title })))
    expect(JSON.stringify(choices)).not.toContain(harness.root)
  })

  it('refuses a pre-cancelled request before exposing the project list', async () => {
    const harness = await createMemoryHarness()
    cleanups.push(harness.dispose)
    const remote = new PlanningRemoteService(harness.ctx)
    const controller = new AbortController()
    controller.abort('PRIVATE_ABORT_REASON')
    await expect(remote.workspaces(controller.signal)).rejects.toMatchObject({ failure: { code: 'cancelled' } })
  })

  it('commits a project card through the real provider and returns an idempotent retry', async () => {
    const harness = await createMemoryHarness()
    cleanups.push(harness.dispose)
    await harness.ctx.plugin(LocalPlanning, { ownershipRoot: join(harness.root, 'planning-owner') })
    const remote = new PlanningRemoteService(harness.ctx)
    const workspaceId = harness.ctx.workspaceRegistry.list()[0]!.id
    const signal = new AbortController().signal
    const command: PlanningCommand = {
      kind: 'create',
      requestId: 'remote-create',
      expectedBoardVersion: 0,
      title: '跨天继续的计划',
      intent: '明天可以找到原来的目标和来源。',
      lane: 'next',
      scope: [],
      acceptance: ['新会话可查到'],
      reviewAt: null,
      sources: [{ kind: 'manual', text: '用户在工作台记录的想法。' }],
      estimate: {
        value: null,
        urgency: null,
        reuse: null,
        compounding: null,
        timeCost: null,
        tokenCost: null,
        risk: null,
        cognitiveCost: null,
        rationale: '',
      },
    }
    await expect(remote.execute({ workspaceId, command }, signal)).resolves.toMatchObject({ boardVersion: 1 })
    const first = await remote.snapshot(workspaceId, signal)
    await expect(remote.execute({ workspaceId, command }, signal)).resolves.toMatchObject({ boardVersion: 1 })
    const replay = await remote.snapshot(workspaceId, signal)
    expect(replay).toEqual(first)
    expect(replay.items).toHaveLength(1)
    expect(replay).not.toHaveProperty('receipts')
  })

  it('rejects an unknown project and a pre-cancelled mutation with stable failures', async () => {
    const harness = await createMemoryHarness()
    cleanups.push(harness.dispose)
    await harness.ctx.plugin(LocalPlanning, { ownershipRoot: join(harness.root, 'planning-owner') })
    const remote = new PlanningRemoteService(harness.ctx)
    await expect(remote.snapshot('missing-workspace', new AbortController().signal)).rejects.toMatchObject({
      failure: { code: 'not-found' },
    })
    const controller = new AbortController()
    controller.abort()
    await expect(remote.snapshot(harness.ctx.workspaceRegistry.list()[0]!.id, controller.signal)).rejects.toMatchObject(
      { failure: { code: 'cancelled' } },
    )
  })

  it('accepts the exact Agent draft from the browser and replays its committed receipt', async () => {
    const harness = await createPlanningHarness()
    cleanups.push(harness.dispose)
    const remote = new PlanningRemoteService(harness.ctx)
    const signal = new AbortController().signal
    const seed = harness.create('seed')
    if (seed.kind !== 'create') throw new Error('invalid fixture')
    const { title, intent, scope, acceptance, sources, estimate, reviewAt } = seed
    await harness.ctx.planning.execute(
      { ...harness.access(), kind: 'agent', actorId: 'assistant' },
      {
        kind: 'propose',
        requestId: 'proposal-first',
        expectedBoardVersion: 0,
        proposalId: 'conversation-plan',
        expectedProposalVersion: null,
        targetItemId: null,
        baseRevisionId: null,
        suggestedLane: 'next',
        assumptions: ['验收细节由助手建议。'],
        draft: { title, intent, scope, acceptance, sources, estimate, reviewAt },
      },
    )
    const before = await remote.snapshot(harness.workspace.id, signal)
    expect(before.items).toHaveLength(0)
    expect(before.proposals[0]?.status).toBe('pending')
    const command: PlanningCommand = {
      kind: 'accept-proposal',
      requestId: 'accept-from-browser',
      expectedBoardVersion: before.version,

      proposalId: 'conversation-plan',
      expectedProposalVersion: 1,
    }
    const accepted = await remote.execute({ workspaceId: harness.workspace.id, command }, signal)
    await expect(remote.execute({ workspaceId: harness.workspace.id, command }, signal)).resolves.toEqual(accepted)
    const after = await remote.snapshot(harness.workspace.id, signal)
    expect(after.items).toHaveLength(1)
    expect(after.lanes.next).toEqual([accepted.itemId])
    expect(after.proposals[0]).toMatchObject({ status: 'accepted', headVersion: 1 })
    expect(after).not.toHaveProperty('receipts')
  })

  it('refuses authority fields supplied through the browser boundary', async () => {
    const harness = await createPlanningHarness()
    cleanups.push(harness.dispose)
    const remote = new PlanningRemoteService(harness.ctx)
    const input = {
      workspaceId: harness.workspace.id,
      command: harness.create('spoof'),
      actorId: 'other-human',
      kind: 'human',
    }
    await expect(remote.execute(input, new AbortController().signal)).rejects.toMatchObject({
      failure: { code: 'bad-request' },
    })
    expect((await remote.snapshot(harness.workspace.id, new AbortController().signal)).version).toBe(0)
  })
})
