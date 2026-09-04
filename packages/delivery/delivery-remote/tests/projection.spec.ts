import { Context } from '@deepseek-ai/cordis'
import {
  AcceptanceDecisionId,
  ContractRevisionId,
  DELIVERY_SCHEMA_VERSION,
  DispatchBindingId,
  GitCommitId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  VerificationVerdictId,
  WorkPacketId,
  canonicalDigest,
  dispatchBindingSchema,
} from '@changanhua/dsh-delivery-protocol'
import {
  acceptedDecisionFixture,
  boundBindingFixture,
  completedClaimFixture,
  contractRevisionFixture,
  deliveryCaseFixture,
  issuePublicationFixture,
  passedVerdictFixture,
  readyWorkPacketFixture,
  requirementDecisionFixture,
  submittingBindingFixture,
} from '@changanhua/dsh-delivery-testkit'
import {
  AttemptId,
  ResultId,
  WorkId,
  type OperatorWorkQueue,
  type WorkView,
} from '@changanhua/dsh-task-queue'
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
  const packet = readyWorkPacketFixture({
    id: WorkPacketId(input.packetId),
    contractRevisionId: ContractRevisionId(input.packetId.replace(/^packet-/u, 'contract-')),
  })
  const id = WorkId(input.id)
  const attemptId = AttemptId(`${input.id}-attempt`)
  const intent = input.kind === 'code.change@1'
    ? { packetId: WorkPacketId(input.packetId) }
    : {
      packetId: WorkPacketId(input.packetId),
      targetCommit: '2222222222222222222222222222222222222222',
      verificationPlanDigest: packet.verificationPlan.digest,
    }
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
      intent,
      intentDigest: canonicalDigest(intent),
      resolved: input.kind === 'code.change@1'
        ? {
          packetId: WorkPacketId(input.packetId),
          contractRevisionId: packet.contractRevisionId,
          repositoryId: 'repository-fixture',
          baseCommit: '1111111111111111111111111111111111111111',
          executorId: 'codex-fixture',
          policyDigest: `sha256:${'2'.repeat(64)}`,
        }
        : {
          packetId: WorkPacketId(input.packetId),
          contractRevisionId: packet.contractRevisionId,
          repositoryId: 'repository-fixture',
          baseCommit: '1111111111111111111111111111111111111111',
          targetCommit: '2222222222222222222222222222222222222222',
          trustedPlan: packet.verificationPlan,
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

function corruptWork(value: unknown): WorkView {
  return value as WorkView
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
    deliveryCases: [],
    requirementDecisions: [],
    issuePublications: [],
  }
}

describe('Delivery Remote workbench projection', () => {
  it('derives every lane from Delivery and Queue facts in deterministic packet order', () => {
    const facts = deliveryFacts()
    const acceptedPacket = facts.workPackets.find(packet => packet.id === 'packet-accepted')!
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
      baseCommit: acceptedPacket.baseCommit,
      verificationPlanDigest: acceptedPacket.verificationPlan.digest,
    })
    const service = makeService(facts, [
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
        failure: {
          category: 'executor',
          message: 'secret=CREDENTIAL C:\\private idempotency-key=delivery:packet:secret',
        },
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
      .toContain('queue-work-failed')
    expect(JSON.stringify(snapshot)).not.toContain('CREDENTIAL')
    expect(JSON.stringify(snapshot)).not.toContain('idempotency-key')
  })

  it('projects only browser-safe binding and Queue fields', () => {
    const service = makeService(deliveryFacts(), [])

    const json = JSON.stringify(service.snapshot(signal))

    expect(json).not.toContain('idempotencyKey')
    expect(json).not.toContain('inputDigest')
    expect(json).not.toContain('resolved')
    expect(json).not.toContain('intentDigest')
    expect(json).not.toContain('ownerSessionId')
    expect(json).not.toContain('decisionNonce')
  })

  it('fails closed when a Packet references an absent Contract revision', () => {
    const facts = deliveryFacts()
    facts.contractRevisions = facts.contractRevisions.filter(contract => contract.id !== 'contract-ready')
    const service = makeService(facts, [])

    expect(() => service.snapshot(signal)).toThrow('Delivery snapshot projection was refused')
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

  it('projects publication phases without marker, digest, or failure detail', () => {
    const publication = issuePublicationFixture({
      phase: 'unknown',
      issue: null,
      failure: {
        sideEffect: 'unknown',
        category: 'transport',
        detail: 'host-only provider detail',
        occurredAt: TIME,
      },
    })

    const snapshot = projectDeliverySnapshot({
      contractRevisions: [], workPackets: [], dispatchBindings: [], acceptanceDecisions: [],
      deliveryCases: [], requirementDecisions: [], issuePublications: [publication],
    }, [], [])

    expect(snapshot.publications).toEqual([{
      id: publication.id,
      caseId: publication.caseId,
      revisionId: publication.revisionId,
      phase: 'unknown',
      failureCategory: 'transport',
      issue: null,
      updatedAt: publication.updatedAt,
    }])
    expect(JSON.stringify(snapshot)).not.toContain(publication.marker)
    expect(JSON.stringify(snapshot)).not.toContain(publication.renderedDigest)
    expect(JSON.stringify(snapshot)).not.toContain('host-only provider detail')
  })

  it('projects ordered Case heads with requirement authority, publication target, and blocked uncertainty', () => {
    const shapingRevision = contractRevisionFixture({ id: ContractRevisionId('revision-shaping') })
    const readyRevision = contractRevisionFixture({ id: ContractRevisionId('revision-ready-case') })
    const blockedRevision = contractRevisionFixture({ id: ContractRevisionId('revision-blocked-case') })
    const shapingCase = deliveryCaseFixture({
      id: 'case-shaping' as never,
      headRevisionId: shapingRevision.id,
      repositoryId: shapingRevision.repositoryId!,
      updatedAt: '2026-08-29T00:00:01.000Z',
    })
    const readyCase = deliveryCaseFixture({
      id: 'case-ready' as never,
      headRevisionId: readyRevision.id,
      repositoryId: readyRevision.repositoryId!,
      updatedAt: '2026-08-29T00:00:02.000Z',
    })
    const blockedCase = deliveryCaseFixture({
      id: 'case-blocked' as never,
      headRevisionId: blockedRevision.id,
      repositoryId: blockedRevision.repositoryId!,
      updatedAt: '2026-08-29T00:00:03.000Z',
    })
    const approved = requirementDecisionFixture({
      caseId: readyCase.id,
      revisionId: readyRevision.id,
      decision: 'approved',
    })
    const unknown = issuePublicationFixture({
      caseId: blockedCase.id,
      revisionId: blockedRevision.id,
      repository: { owner: 'example', name: 'delivery-canary' },
      phase: 'unknown',
    })

    const snapshot = projectDeliverySnapshot({
      contractRevisions: [shapingRevision, readyRevision, blockedRevision],
      workPackets: [], dispatchBindings: [], acceptanceDecisions: [],
      deliveryCases: [shapingCase, readyCase, blockedCase],
      requirementDecisions: [approved], issuePublications: [unknown],
    }, [], [], new Map([[String(readyCase.repositoryId), { owner: 'example', name: 'delivery-canary' }]]))

    expect(snapshot.cases.map(card => [card.case.id, card.lane])).toEqual([
      ['case-blocked', 'blocked'],
      ['case-ready', 'ready'],
      ['case-shaping', 'shaping'],
    ])
    expect(snapshot.cases[1]).toMatchObject({
      requirementDecision: { decision: 'approved' },
      publicationTarget: { owner: 'example', name: 'delivery-canary' },
    })
    expect(JSON.stringify(snapshot.cases)).not.toContain('actorId')
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
      deliveryCases: [],
      requirementDecisions: [],
      issuePublications: [],
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
      attentionReasons: ['change-blocked', 'queue-attention'],
    })

    const needsDecision = {
      ...completed,
      disposition: 'needs-decision' as const,
      checkpointCommit: null,
      evidenceIds: [],
      question: 'Which bounded outcome should continue?',
    }
    const interrupted = projectDeliverySnapshot(base, [queueView({
      id: 'work-edge', kind: 'code.change@1', packetId: packet.id,
      status: 'succeeded', output: { completionClaim: needsDecision },
    })], [])
    expect(interrupted.cards[0]?.attentionReasons).toContain('change-interrupted')

    const invalid = projectDeliverySnapshot(base, [queueView({
      id: 'work-edge', kind: 'code.change@1', packetId: packet.id,
      status: 'succeeded', output: {},
    })], [])
    expect(invalid.cards[0]?.attentionReasons).toContain('change-result-invalid')

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
      attentionReasons: ['bound-work-unavailable', 'decision-rejected'],
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
      acceptanceDecisions: [], deliveryCases: [], requirementDecisions: [], issuePublications: [],
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
      schemaVersion: 2,
      id: DispatchBindingId('binding-verify-edge'), packetId: packet.id,
      inputDigest: canonicalDigest({
        packetId: packet.id,
        targetCommit: '2222222222222222222222222222222222222222',
        verificationPlanDigest: packet.verificationPlan.digest,
      }),
      idempotencyKey: 'verify-edge',
      kind: 'code.verify@1', phase: 'bound', queueWorkId: QueueWorkIdRef('work-verify-edge'),
      executorId: null, createdAt: TIME, updatedAt: TIME,
    })
    const invalidVerify = projectDeliverySnapshot({
      contractRevisions: [contract], workPackets: [packet], dispatchBindings: [verify],
      acceptanceDecisions: [], deliveryCases: [], requirementDecisions: [], issuePublications: [],
    }, [queueView({
      id: 'work-verify-edge', kind: 'code.verify@1', packetId: packet.id, status: 'succeeded', output: {},
    })], [])
    expect(invalidVerify.cards[0]?.attentionReasons).toContain('verification-result-invalid')

    const failedVerdict = passedVerdictFixture({
      packetId: packet.id,
      baseCommit: packet.baseCommit,
      verificationPlanDigest: packet.verificationPlan.digest,
      status: 'failed',
      reviewReasons: ['Required check failed'],
    })
    const failed = projectDeliverySnapshot({
      contractRevisions: [contract], workPackets: [packet], dispatchBindings: [verify],
      acceptanceDecisions: [], deliveryCases: [], requirementDecisions: [], issuePublications: [],
    }, [queueView({
      id: 'work-verify-edge', kind: 'code.verify@1', packetId: packet.id,
      status: 'succeeded', output: { verificationVerdict: failedVerdict },
    })], [])
    expect(failed.cards[0]).toMatchObject({
      lane: 'blocked', attentionReasons: ['verification-failed'],
    })

    const reviewVerdict = passedVerdictFixture({
      packetId: packet.id,
      baseCommit: packet.baseCommit,
      verificationPlanDigest: packet.verificationPlan.digest,
      status: 'needs-human-review',
      reviewReasons: ['Independent review required'],
    })
    const needsReview = projectDeliverySnapshot({
      contractRevisions: [contract], workPackets: [packet], dispatchBindings: [verify],
      acceptanceDecisions: [], deliveryCases: [], requirementDecisions: [], issuePublications: [],
    }, [queueView({
      id: 'work-verify-edge', kind: 'code.verify@1', packetId: packet.id,
      status: 'succeeded', output: { verificationVerdict: reviewVerdict },
    })], [])
    expect(needsReview.cards[0]?.attentionReasons)
      .toContain('verification-needs-human-review')
  })

  it('blocks every mismatched binding, Work, result, Attempt, claim, and verdict identity', () => {
    const contract = contractRevisionFixture({ id: ContractRevisionId('contract-integrity') })
    const packet = readyWorkPacketFixture({
      id: WorkPacketId('packet-integrity'),
      contractRevisionId: contract.id,
    })
    const change = boundBindingFixture({
      id: DispatchBindingId('binding-integrity-change'),
      packetId: packet.id,
      queueWorkId: QueueWorkIdRef('work-integrity-change'),
    })
    const verifyIntent = {
      packetId: packet.id,
      targetCommit: GitCommitId('2222222222222222222222222222222222222222'),
      verificationPlanDigest: packet.verificationPlan.digest,
    }
    const verify = dispatchBindingSchema.parse({
      schemaVersion: 2,
      id: DispatchBindingId('binding-integrity-verify'),
      packetId: packet.id,
      inputDigest: canonicalDigest(verifyIntent),
      idempotencyKey: 'verify-integrity',
      kind: 'code.verify@1',
      phase: 'bound',
      queueWorkId: QueueWorkIdRef('work-integrity-verify'),
      executorId: null,
      createdAt: TIME,
      updatedAt: TIME,
    })
    const claim = completedClaimFixture({
      packetId: packet.id,
      queueWorkId: change.queueWorkId,
      queueAttemptId: 'work-integrity-change-attempt' as never,
    })
    const verdict = passedVerdictFixture({
      packetId: packet.id,
      baseCommit: packet.baseCommit,
      targetCommit: verifyIntent.targetCommit,
      verificationPlanDigest: packet.verificationPlan.digest,
    })
    const validChange = queueView({
      id: 'work-integrity-change', kind: 'code.change@1', packetId: packet.id,
      status: 'succeeded', output: { completionClaim: claim },
    })
    const validVerify = queueView({
      id: 'work-integrity-verify', kind: 'code.verify@1', packetId: packet.id,
      status: 'succeeded', output: { verificationVerdict: verdict },
    })
    const wrongPacket = WorkPacketId('packet-other')
    const scenarios: readonly [string, WorkView, WorkView][] = [
      ['wrong kind', corruptWork({
        ...validChange, work: { ...validChange.work, kind: 'code.verify@1' },
      }), validVerify],
      ['wrong state Work', corruptWork({
        ...validChange, state: { ...validChange.state, workId: WorkId('work-other') },
      }), validVerify],
      ['state/result mismatch', corruptWork({
        ...validChange, state: { ...validChange.state, resultId: ResultId('result-other') },
      }), validVerify],
      ['wrong result Work', corruptWork({
        ...validChange,
        result: { ...validChange.result, workId: WorkId('work-other') },
      }), validVerify],
      ['wrong result kind', corruptWork({
        ...validChange,
        result: { ...validChange.result, kind: 'code.verify@1' },
      }), validVerify],
      ['wrong successful Attempt', corruptWork({
        ...validChange,
        attempts: validChange.attempts.map(attempt => ({ ...attempt, workId: WorkId('work-other') })),
      }), validVerify],
      ['wrong claim Packet', corruptWork({
        ...validChange,
        result: {
          ...validChange.result,
          output: { completionClaim: { ...claim, packetId: wrongPacket } },
        },
      }), validVerify],
      ['wrong claim Work', corruptWork({
        ...validChange,
        result: {
          ...validChange.result,
          output: { completionClaim: { ...claim, queueWorkId: QueueWorkIdRef('work-other') } },
        },
      }), validVerify],
      ['wrong claim Attempt', corruptWork({
        ...validChange,
        result: {
          ...validChange.result,
          output: { completionClaim: { ...claim, queueAttemptId: QueueAttemptIdRef('attempt-other') } },
        },
      }), validVerify],
      ['wrong resolved base', corruptWork({
        ...validChange,
        work: {
          ...validChange.work,
          resolved: {
            ...validChange.work.resolved,
            baseCommit: GitCommitId('3333333333333333333333333333333333333333'),
          },
        },
      }), validVerify],
      ['wrong verdict Packet', validChange, corruptWork({
        ...validVerify,
        result: {
          ...validVerify.result,
          output: { verificationVerdict: { ...verdict, packetId: wrongPacket } },
        },
      })],
      ['wrong verdict target', validChange, corruptWork({
        ...validVerify,
        result: {
          ...validVerify.result,
          output: {
            verificationVerdict: {
              ...verdict,
              targetCommit: GitCommitId('3333333333333333333333333333333333333333'),
            },
          },
        },
      })],
      ['wrong verdict base', validChange, corruptWork({
        ...validVerify,
        result: {
          ...validVerify.result,
          output: {
            verificationVerdict: {
              ...verdict,
              baseCommit: GitCommitId('3333333333333333333333333333333333333333'),
            },
          },
        },
      })],
      ['wrong verdict plan', validChange, corruptWork({
        ...validVerify,
        result: {
          ...validVerify.result,
          output: {
            verificationVerdict: {
              ...verdict,
              verificationPlanDigest: `sha256:${'3'.repeat(64)}`,
            },
          },
        },
      })],
    ]

    for (const [label, changeWork, verifyWork] of scenarios) {
      const snapshot = projectDeliverySnapshot({
        contractRevisions: [contract],
        workPackets: [packet],
        dispatchBindings: [change, verify],
        acceptanceDecisions: [], deliveryCases: [], requirementDecisions: [], issuePublications: [],
      }, [changeWork, verifyWork], [])
      expect(snapshot.cards[0]?.lane, label).toBe('blocked')
      expect(snapshot.cards[0]?.attentionReasons, label).toContain('projection-inconsistent')
      if (label.startsWith('wrong verdict')) {
        expect(snapshot.cards[0]?.verificationVerdict, label).toBeNull()
      } else {
        expect(snapshot.cards[0]?.completionClaim, label).toBeNull()
      }
    }
  })
})
