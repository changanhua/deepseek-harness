import { Context } from '@deepseek-ai/cordis'
import {
  AcceptanceDecisionId,
  ContractRevisionId,
  DELIVERY_SCHEMA_VERSION,
  DispatchBindingId,
  QueueWorkIdRef,
  VerificationVerdictId,
  WorkPacketId,
  canonicalDigest,
  dispatchBindingSchema,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  acceptedDecisionFixture,
  boundBindingFixture,
  completedClaimFixture,
  contractRevisionFixture,
  passedVerdictFixture,
  readyWorkPacketFixture,
  submittingBindingFixture,
} from '@deepseek-ai/dsh-delivery-testkit'
import {
  AttemptId,
  ResultId,
  WorkId,
  type OperatorWorkQueue,
  type WorkView,
} from '@deepseek-ai/dsh-task-queue'
import { describe, expect, it, vi } from 'vitest'
import { DeliveryRemoteService } from '../src/index.ts'
import { projectDeliverySnapshot } from '../src/projection.ts'

const TIME = '2026-08-29T00:00:00.000Z'
const signal = new AbortController().signal

function queueView(input: {
  id: string
  kind: 'code.change@1' | 'code.verify@1'
  packetId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown'
  output?: unknown
  failure?: { category: string; message: string }
}): WorkView {
  const id = WorkId(input.id)
  const attemptId = AttemptId(`${input.id}-attempt`)
  const terminal = input.status === 'succeeded' || input.status === 'failed'
  const failure = input.failure === undefined
    ? null
    : {
      category: input.failure.category,
      message: input.failure.message,
      sideEffect: 'started' as const,
      retriable: false,
    }
  return {
    work: {
      id,
      kind: input.kind,
      title: input.id,
      intent: input.kind === 'code.change@1'
        ? { packetId: WorkPacketId(input.packetId) }
        : {
          packetId: WorkPacketId(input.packetId),
          targetCommit: '2222222222222222222222222222222222222222',
          verificationPlanDigest: 'sha256:20cd74a4560bc768b95325e9c9777483b3658368746f74884db9602d3a024bce',
        },
      intentDigest: `sha256:${'1'.repeat(64)}`,
      resolved: input.kind === 'code.change@1'
        ? {
          packetId: WorkPacketId(input.packetId),
          contractRevisionId: ContractRevisionId(`contract-${input.packetId}`),
          repositoryId: 'repository-fixture',
          baseCommit: '1111111111111111111111111111111111111111',
          executorId: 'codex-fixture',
          policyDigest: `sha256:${'2'.repeat(64)}`,
        }
        : {
          packetId: WorkPacketId(input.packetId),
          contractRevisionId: ContractRevisionId(`contract-${input.packetId}`),
          repositoryId: 'repository-fixture',
          baseCommit: '1111111111111111111111111111111111111111',
          targetCommit: '2222222222222222222222222222222222222222',
          trustedPlan: readyWorkPacketFixture().verificationPlan,
        },
      policy: { maxAttempts: 1 },
      resources: [],
      tags: [],
      batchId: null,
      ownerSessionId: null,
      createdAt: TIME,
    },
    state: {
      workId: id,
      status: input.status,
      attemptCount: input.status === 'queued' ? 0 : 1,
      activeAttemptId: input.status === 'running' || input.status === 'unknown' ? attemptId : null,
      resultId: input.status === 'succeeded' ? ResultId(`${input.id}-result`) : null,
      failure,
      cancelRequestedAt: null,
      updatedAt: TIME,
    },
    attempts: input.status === 'queued'
      ? []
      : [{
        id: attemptId,
        workId: id,
        ordinal: 1,
        status: input.status === 'running' ? 'running' : input.status,
        startedAt: TIME,
        runningAt: TIME,
        finishedAt: terminal ? TIME : null,
        failure,
      }],
    result: input.status === 'succeeded'
      ? {
        id: ResultId(`${input.id}-result`),
        workId: id,
        attemptId,
        kind: input.kind,
        output: input.output as never,
        createdAt: TIME,
      }
      : null,
  } as unknown as WorkView
}

function makeService(deliverySnapshot: ReturnType<typeof deliveryFacts>, works: readonly WorkView[]) {
  const ctx = new Context()
  const operator = {
    list: () => works,
    pendingAttentions: () => [],
  } as unknown as OperatorWorkQueue
  ctx.provide('delivery', { snapshot: () => deliverySnapshot } as never)
  ctx.provide('deliveryEvidence', {} as never)
  ctx.provide('repoWorkspace', {} as never)
  ctx.provide('taskQueue', { forOperator: () => operator } as never)
  return new DeliveryRemoteService(ctx)
}

function deliveryFacts() {
  const names = ['ready', 'running', 'review', 'blocked', 'accepted'] as const
  const contracts = names.map((name, index) => contractRevisionFixture({
    id: ContractRevisionId(`contract-${name}`),
    createdAt: `2026-08-29T00:00:0${String(index)}.000Z`,
  }))
  const packets = names.map((name, index) => readyWorkPacketFixture({
    id: WorkPacketId(`packet-${name}`),
    contractRevisionId: ContractRevisionId(`contract-${name}`),
    createdAt: `2026-08-29T00:00:0${String(index)}.000Z`,
  }))
  const running = submittingBindingFixture({
    id: DispatchBindingId('binding-running'),
    packetId: WorkPacketId('packet-running'),
  })
  const review = boundBindingFixture({
    id: DispatchBindingId('binding-review'),
    packetId: WorkPacketId('packet-review'),
    queueWorkId: QueueWorkIdRef('work-review'),
  })
  const blocked = boundBindingFixture({
    id: DispatchBindingId('binding-blocked'),
    packetId: WorkPacketId('packet-blocked'),
    queueWorkId: QueueWorkIdRef('work-blocked'),
  })
  const acceptedChange = boundBindingFixture({
    id: DispatchBindingId('binding-accepted-change'),
    packetId: WorkPacketId('packet-accepted'),
    queueWorkId: QueueWorkIdRef('work-accepted-change'),
  })
  const verifyIntent = {
    packetId: WorkPacketId('packet-accepted'),
    targetCommit: '2222222222222222222222222222222222222222',
    verificationPlanDigest: packets[4]!.verificationPlan.digest,
  }
  const acceptedVerify = dispatchBindingSchema.parse({
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    id: DispatchBindingId('binding-accepted-verify'),
    packetId: WorkPacketId('packet-accepted'),
    inputDigest: canonicalDigest(verifyIntent),
    idempotencyKey: 'verify-accepted',
    kind: 'code.verify@1',
    phase: 'bound',
    queueWorkId: QueueWorkIdRef('work-accepted-verify'),
    executorId: null,
    createdAt: TIME,
    updatedAt: TIME,
  })
  const decision = acceptedDecisionFixture({
    id: AcceptanceDecisionId('decision-accepted'),
    packetId: WorkPacketId('packet-accepted'),
    verdictId: VerificationVerdictId('verdict-accepted'),
  })
  return {
    contractRevisions: contracts,
    workPackets: packets,
    dispatchBindings: [acceptedVerify, running, blocked, review, acceptedChange],
    acceptanceDecisions: [decision],
  }
}

describe('Delivery Remote workbench projection', () => {
  it('derives every lane from Delivery and Queue facts in deterministic packet order', () => {
    const reviewClaim = completedClaimFixture({
      packetId: WorkPacketId('packet-review'),
      queueWorkId: QueueWorkIdRef('work-review'),
      queueAttemptId: 'work-review-attempt' as never,
    })
    const acceptedClaim = completedClaimFixture({
      packetId: WorkPacketId('packet-accepted'),
      queueWorkId: QueueWorkIdRef('work-accepted-change'),
      queueAttemptId: 'work-accepted-change-attempt' as never,
    })
    const verdict = passedVerdictFixture({
      id: VerificationVerdictId('verdict-accepted'),
      packetId: WorkPacketId('packet-accepted'),
    })
    const service = makeService(deliveryFacts(), [
      queueView({
        id: 'work-review',
        kind: 'code.change@1',
        packetId: 'packet-review',
        status: 'succeeded',
        output: { completionClaim: reviewClaim },
      }),
      queueView({
        id: 'work-blocked',
        kind: 'code.change@1',
        packetId: 'packet-blocked',
        status: 'failed',
        failure: { category: 'executor', message: 'Codex failed' },
      }),
      queueView({
        id: 'work-accepted-change',
        kind: 'code.change@1',
        packetId: 'packet-accepted',
        status: 'succeeded',
        output: { completionClaim: acceptedClaim },
      }),
      queueView({
        id: 'work-accepted-verify',
        kind: 'code.verify@1',
        packetId: 'packet-accepted',
        status: 'succeeded',
        output: { verificationVerdict: verdict },
      }),
    ])

    const snapshot = service.snapshot(signal)

    expect(snapshot.cards.map(card => [card.packet.id, card.lane])).toEqual([
      ['packet-accepted', 'accepted'],
      ['packet-blocked', 'blocked'],
      ['packet-review', 'review'],
      ['packet-running', 'running'],
      ['packet-ready', 'ready'],
    ])
    expect(snapshot.cards.find(card => card.packet.id === 'packet-blocked')?.attentionReasons)
      .toContain('Codex failed')
  })

  it('projects only browser-safe binding and Queue fields', () => {
    const service = makeService(deliveryFacts(), [])

    const json = JSON.stringify(service.snapshot(signal))

    expect(json).not.toContain('idempotencyKey')
    expect(json).not.toContain('inputDigest')
    expect(json).not.toContain('resolved')
    expect(json).not.toContain('intentDigest')
    expect(json).not.toContain('ownerSessionId')
  })

  it('fails closed when a Packet references an absent Contract revision', () => {
    const facts = deliveryFacts()
    facts.contractRevisions = facts.contractRevisions.filter(contract => contract.id !== 'contract-ready')
    const service = makeService(facts, [])

    expect(() => service.snapshot(signal)).toThrow('Packet references an unavailable Contract revision')
  })

  it('uses one Delivery read and one Queue read for a complete snapshot', () => {
    const facts = deliveryFacts()
    const deliverySnapshot = vi.fn(() => facts)
    const list = vi.fn(() => [])
    const ctx = new Context()
    ctx.provide('delivery', { snapshot: deliverySnapshot } as never)
    ctx.provide('deliveryEvidence', {} as never)
    ctx.provide('repoWorkspace', {} as never)
    ctx.provide('taskQueue', {
      forOperator: () => ({ list, pendingAttentions: () => [] }),
    } as never)
    const service = new DeliveryRemoteService(ctx)

    service.snapshot(signal)

    expect(deliverySnapshot).toHaveBeenCalledOnce()
    expect(list).toHaveBeenCalledOnce()
  })

  it('fails closed for invalid results and derives blocked reasons from claims, verdicts, decisions, and Attention', () => {
    const contract = contractRevisionFixture({ id: ContractRevisionId('contract-edge') })
    const packet = readyWorkPacketFixture({
      id: WorkPacketId('packet-edge'),
      contractRevisionId: contract.id,
    })
    const binding = boundBindingFixture({
      id: DispatchBindingId('binding-edge'),
      packetId: packet.id,
      queueWorkId: QueueWorkIdRef('work-edge'),
    })
    const completed = completedClaimFixture({
      packetId: packet.id,
      queueWorkId: binding.queueWorkId,
      queueAttemptId: 'work-edge-attempt' as never,
    })
    const blockedClaim = {
      ...completed,
      disposition: 'blocked' as const,
      checkpointCommit: null,
      evidenceIds: [],
      blocker: 'Dependency missing',
      nextSmallestAction: 'Install the dependency',
    }
    const base = {
      contractRevisions: [contract],
      workPackets: [packet],
      dispatchBindings: [binding],
      acceptanceDecisions: [],
    }
    const blocked = projectDeliverySnapshot(base, [queueView({
      id: 'work-edge', kind: 'code.change@1', packetId: packet.id,
      status: 'succeeded', output: { completionClaim: blockedClaim },
    })], [{
      id: 'attention-1' as never,
      workId: WorkId('work-edge'),
      kind: 'completion',
      status: 'pending',
      createdAt: TIME,
      resolvedAt: null,
    }, {
      id: 'attention-2' as never,
      workId: WorkId('work-edge'),
      kind: 'failure',
      status: 'pending',
      createdAt: TIME,
      resolvedAt: null,
    }])
    expect(blocked.cards[0]).toMatchObject({
      lane: 'blocked',
      attentionReasons: [
        'Change reported blocked',
        'Queue requires operator attention: completion',
        'Queue requires operator attention: failure',
      ],
    })

    const invalid = projectDeliverySnapshot(base, [queueView({
      id: 'work-edge', kind: 'code.change@1', packetId: packet.id,
      status: 'succeeded', output: {},
    })], [])
    expect(invalid.cards[0]?.attentionReasons).toContain('Code change result is invalid')

    const rejected = projectDeliverySnapshot({
      ...base,
      acceptanceDecisions: [
        acceptedDecisionFixture({
          id: AcceptanceDecisionId('decision-old'),
          packetId: packet.id,
          decision: 'accepted',
          decidedAt: '2026-08-28T00:00:00.000Z',
        }),
        acceptedDecisionFixture({
          id: AcceptanceDecisionId('decision-a'),
          packetId: packet.id,
          decision: 'accepted',
          decidedAt: '2026-08-29T00:00:00.000Z',
        }),
        acceptedDecisionFixture({
          id: AcceptanceDecisionId('decision-z'),
          packetId: packet.id,
          decision: 'rejected',
          reason: 'Needs another change',
          decidedAt: '2026-08-29T00:00:00.000Z',
        }),
      ],
    }, [], [])
    expect(rejected.cards[0]).toMatchObject({
      lane: 'blocked',
      attentionReasons: ['Bound code.change@1 work is unavailable', 'Human decision rejected the Packet'],
    })
  })

  it('projects a bound active Attempt, invalid verification, failed verdict, and deterministic ties', () => {
    const contract = contractRevisionFixture({ id: ContractRevisionId('contract-active'), createdAt: TIME })
    const spareA = contractRevisionFixture({ id: ContractRevisionId('contract-spare-a'), createdAt: TIME })
    const spareB = contractRevisionFixture({ id: ContractRevisionId('contract-spare-b'), createdAt: TIME })
    const packet = readyWorkPacketFixture({ id: WorkPacketId('packet-active'), contractRevisionId: contract.id })
    const change = boundBindingFixture({
      id: DispatchBindingId('binding-active'), packetId: packet.id, queueWorkId: QueueWorkIdRef('work-active'),
    })
    const active = projectDeliverySnapshot({
      contractRevisions: [spareA, contract, spareB],
      workPackets: [packet],
      dispatchBindings: [change],
      acceptanceDecisions: [],
    }, [queueView({
      id: 'work-active', kind: 'code.change@1', packetId: packet.id, status: 'running',
    })], [])
    expect(active.cards[0]).toMatchObject({
      lane: 'running',
      dispatches: [{ queue: { activeAttemptId: 'work-active-attempt' } }],
    })
    expect(active.contractsWithoutPacket.map(item => item.id)).toEqual([
      'contract-spare-b', 'contract-spare-a',
    ])

    const verify = dispatchBindingSchema.parse({
      schemaVersion: 1,
      id: DispatchBindingId('binding-verify-edge'), packetId: packet.id,
      inputDigest: canonicalDigest({ packetId: packet.id }), idempotencyKey: 'verify-edge',
      kind: 'code.verify@1', phase: 'bound', queueWorkId: QueueWorkIdRef('work-verify-edge'),
      executorId: null, createdAt: TIME, updatedAt: TIME,
    })
    const invalidVerify = projectDeliverySnapshot({
      contractRevisions: [contract], workPackets: [packet], dispatchBindings: [verify], acceptanceDecisions: [],
    }, [queueView({
      id: 'work-verify-edge', kind: 'code.verify@1', packetId: packet.id, status: 'succeeded', output: {},
    })], [])
    expect(invalidVerify.cards[0]?.attentionReasons).toContain('Verification result is invalid')

    const failedVerdict = passedVerdictFixture({
      packetId: packet.id,
      verificationPlanDigest: packet.verificationPlan.digest,
      status: 'failed',
      reviewReasons: ['Required check failed'],
    })
    const failed = projectDeliverySnapshot({
      contractRevisions: [contract], workPackets: [packet], dispatchBindings: [verify], acceptanceDecisions: [],
    }, [queueView({
      id: 'work-verify-edge', kind: 'code.verify@1', packetId: packet.id,
      status: 'succeeded', output: { verificationVerdict: failedVerdict },
    })], [])
    expect(failed.cards[0]).toMatchObject({
      lane: 'blocked', attentionReasons: ['Verification reported failed'],
    })
  })
})
