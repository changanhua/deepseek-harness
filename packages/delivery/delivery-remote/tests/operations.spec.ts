import { Context } from '@deepseek-ai/cordis'
import {
  DispatchBindingId,
  EvidenceId,
  ExecutorId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryRelativePath,
  RepositoryId,
  VerificationVerdictId,
  canonicalDigest,
  dispatchBindingSchema,
  type DispatchBinding,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  acceptedDecisionFixture,
  boundBindingFixture,
  completedClaimFixture,
  contractRevisionFixture,
  evidenceRefFixture,
  passedVerdictFixture,
  readyWorkPacketFixture,
} from '@deepseek-ai/dsh-delivery-testkit'
import {
  AttemptId,
  ResultId,
  WorkId,
  type OperatorWorkQueue,
  type WorkView,
} from '@deepseek-ai/dsh-task-queue'
import { describe, expect, it, vi } from 'vitest'
import { DeliveryRemoteService, type Config } from '../src/index.ts'

/* oxlint-disable typescript/no-unsafe-assignment -- Vitest matchers return any. */

const TIME = '2026-08-29T00:00:00.000Z'
const TARGET = '2222222222222222222222222222222222222222'

interface TestInternals {
  readonly fetch: typeof globalThis.fetch
  readonly importIssue: (...args: readonly unknown[]) => Promise<unknown>
  readonly startCodeChange: (...args: readonly unknown[]) => Promise<unknown>
  readonly startVerification: (...args: readonly unknown[]) => Promise<unknown>
}

const ServiceWithInternals = DeliveryRemoteService as unknown as new (
  ctx: Context,
  config: Config,
  internals: TestInternals,
) => DeliveryRemoteService

function verificationBinding(
  packet = readyWorkPacketFixture(),
): Extract<DispatchBinding, { readonly phase: 'bound' }> {
  const intent = {
    packetId: packet.id,
    targetCommit: TARGET,
    verificationPlanDigest: packet.verificationPlan.digest,
  }
  return dispatchBindingSchema.parse({
    schemaVersion: 1,
    id: DispatchBindingId('binding-verify'),
    packetId: packet.id,
    inputDigest: canonicalDigest(intent),
    idempotencyKey: 'host-only-verification-key',
    kind: 'code.verify@1',
    phase: 'bound',
    queueWorkId: QueueWorkIdRef('work-verify'),
    executorId: null,
    createdAt: TIME,
    updatedAt: TIME,
  }) as Extract<DispatchBinding, { readonly phase: 'bound' }>
}

function succeededWork(input: {
  id: string
  kind: 'code.change@1' | 'code.verify@1'
  intent: unknown
  output: unknown
}): WorkView {
  const id = WorkId(input.id)
  const attemptId = AttemptId(`${input.id}-attempt`)
  const resultId = ResultId(`${input.id}-result`)
  return {
    work: {
      id,
      kind: input.kind,
      title: input.id,
      intent: input.intent as never,
      intentDigest: canonicalDigest(input.intent),
      resolved: {},
      policy: { maxAttempts: 1 },
      resources: [],
      tags: [],
      batchId: null,
      ownerSessionId: null,
      createdAt: TIME,
    },
    state: {
      workId: id,
      status: 'succeeded',
      attemptCount: 1,
      activeAttemptId: null,
      resultId,
      failure: null,
      cancelRequestedAt: null,
      updatedAt: TIME,
    },
    attempts: [{
      id: attemptId,
      workId: id,
      ordinal: 1,
      status: 'succeeded',
      startedAt: TIME,
      runningAt: TIME,
      finishedAt: TIME,
      failure: null,
    }],
    result: {
      id: resultId,
      workId: id,
      attemptId,
      kind: input.kind,
      output: input.output as never,
      createdAt: TIME,
    },
  } as unknown as WorkView
}

function makeHarness(options: {
  readonly delivery?: Record<string, unknown>
  readonly evidence?: Record<string, unknown>
  readonly repository?: Record<string, unknown>
  readonly operator?: Partial<OperatorWorkQueue>
  readonly internals?: Partial<TestInternals>
  readonly config?: Config
} = {}) {
  const delivery = {
    snapshot: () => ({
      contractRevisions: [], workPackets: [], dispatchBindings: [], acceptanceDecisions: [],
    }),
    ...options.delivery,
  }
  const evidence = { ...options.evidence }
  const repository = { ...options.repository }
  const operator = {
    list: () => [],
    pendingAttentions: () => [],
    ...options.operator,
  } as unknown as OperatorWorkQueue
  const taskQueue = { forOperator: vi.fn(() => operator) }
  const internals: TestInternals = {
    fetch: vi.fn(),
    importIssue: vi.fn(async () => contractRevisionFixture()),
    startCodeChange: vi.fn(async () => boundBindingFixture()),
    startVerification: vi.fn(async () => verificationBinding()),
    ...options.internals,
  }
  const ctx = new Context()
  ctx.provide('delivery', delivery as never)
  ctx.provide('deliveryEvidence', evidence as never)
  ctx.provide('repoWorkspace', repository as never)
  ctx.provide('taskQueue', taskQueue as never)
  const service = new ServiceWithInternals(
    ctx,
    options.config ?? {},
    internals,
  )
  return { service, delivery, evidence, repository, operator, taskQueue, internals }
}

describe('Delivery Remote explicit operations', () => {
  it('forwards Issue import, Packet creation, change start, and verification start through narrow host capabilities', async () => {
    const contract = contractRevisionFixture()
    const packet = readyWorkPacketFixture()
    const resolveBase = vi.fn(async () => ({
      repositoryId: contract.repositoryId,
      commit: packet.baseCommit,
      selectionRule: contract.baseSelectionRule,
    }))
    const createWorkPacket = vi.fn(async () => packet)
    const harness = makeHarness({
      delivery: {
        getContractRevision: vi.fn(() => contract),
        createWorkPacket,
      },
      repository: { resolveBase, readBlob: vi.fn() },
    })
    const signal = new AbortController().signal
    const draft = {
      objective: packet.objective,
      allowedPaths: packet.allowedPaths,
      forbiddenPaths: packet.forbiddenPaths,
      acceptanceClauseIds: packet.acceptanceClauseIds,
      stopConditions: packet.stopConditions,
      executorPreference: packet.executorPreference,
    }

    await expect(harness.service.importIssue({
      issueUrl: contract.sourceRef.canonicalUrl,
      repositoryId: String(contract.repositoryId),
    }, signal)).resolves.toEqual(contract)
    await expect(harness.service.createPacket({
      contractRevisionId: String(contract.id),
      packet: draft,
    }, signal)).resolves.toEqual(packet)
    await expect(harness.service.startChange({
      packetId: String(packet.id), executorId: 'codex-fixture',
    }, signal)).resolves.toMatchObject({ phase: 'bound' })
    await expect(harness.service.startVerification({
      packetId: String(packet.id), changeBindingId: 'binding-change',
    }, signal)).resolves.toMatchObject({ kind: 'code.verify@1' })

    expect(harness.internals.importIssue).toHaveBeenCalledWith({
      delivery: harness.delivery,
      fetch: harness.internals.fetch,
    }, {
      issueUrl: contract.sourceRef.canonicalUrl,
      repositoryId: contract.repositoryId,
      signal,
    })
    expect(resolveBase).toHaveBeenCalledWith({
      repositoryId: contract.repositoryId,
      selectionRule: contract.baseSelectionRule,
      signal,
    })
    expect(createWorkPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        contractRevisionId: contract.id,
        repository: expect.objectContaining({ commit: packet.baseCommit }),
        packet: draft,
        idempotencyKey: expect.stringMatching(/^delivery:contract-revision-fixture:packet:sha256:/),
      }),
      expect.any(Function),
    )
    expect(harness.internals.startCodeChange).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: harness.delivery,
        queue: harness.operator,
        repoWorkspace: harness.repository,
      }),
      { packetId: packet.id, executorId: ExecutorId('codex-fixture') },
    )
    expect(harness.internals.startVerification).toHaveBeenCalledWith(
      expect.objectContaining({ queue: harness.operator }),
      { packetId: packet.id, changeBindingId: DispatchBindingId('binding-change') },
    )
  })

  it('rejects absent or repository-unbound Contracts before Packet creation', async () => {
    const signal = new AbortController().signal
    const clauseId = contractRevisionFixture().acceptanceClauses[0]!.id
    const absent = makeHarness({
      delivery: { getContractRevision: vi.fn(() => undefined) },
    })
    const unbound = makeHarness({
      delivery: { getContractRevision: vi.fn(() => contractRevisionFixture({ repositoryId: null })) },
    })
    const input = {
      contractRevisionId: 'missing-contract',
      packet: {
        objective: 'Implement the bounded change.',
        allowedPaths: [{ kind: 'subtree' as const, path: RepositoryRelativePath('packages/example') }],
        forbiddenPaths: [],
        acceptanceClauseIds: [clauseId],
        stopConditions: [],
        executorPreference: { mode: 'any' as const },
      },
    }

    await expect(absent.service.createPacket(input, signal)).rejects.toMatchObject({
      failure: expect.objectContaining({ code: 'not-found' }),
    })
    await expect(unbound.service.createPacket(input, signal)).rejects.toMatchObject({
      failure: expect.objectContaining({ code: 'bad-request' }),
    })
  })

  it('lets Packet creation read only the Contract-selected verification blob', async () => {
    const path = RepositoryRelativePath('delivery/verification.json')
    const contract = contractRevisionFixture({
      verificationSource: { kind: 'git-blob', path, format: 'delivery-verification-plan@1' },
    })
    const packet = readyWorkPacketFixture({ contractRevisionId: contract.id })
    const repository = {
      repositoryId: contract.repositoryId,
      commit: packet.baseCommit,
      selectionRule: contract.baseSelectionRule,
    }
    const readBlob = vi.fn(async () => ({ repository, path, data: new Uint8Array() }))
    const createWorkPacket = vi.fn(async (
      _request: unknown,
      resolveBlob: (request: { repository: typeof repository; path: typeof path; maxBytes: number }) => Promise<unknown>,
    ) => {
      await resolveBlob({ repository, path, maxBytes: 4_096 })
      return packet
    })
    const harness = makeHarness({
      delivery: { getContractRevision: () => contract, createWorkPacket },
      repository: { resolveBase: vi.fn(async () => repository), readBlob },
    })

    await harness.service.createPacket({
      contractRevisionId: String(contract.id),
      packet: {
        objective: packet.objective,
        allowedPaths: packet.allowedPaths,
        forbiddenPaths: packet.forbiddenPaths,
        acceptanceClauseIds: packet.acceptanceClauseIds,
        stopConditions: packet.stopConditions,
        executorPreference: packet.executorPreference,
      },
    }, new AbortController().signal)

    expect(readBlob).toHaveBeenCalledWith({
      base: repository,
      path,
      maxBytes: 4_096,
      signal: expect.any(AbortSignal),
    })
  })

  it('normalizes unexpected failures for every mutation without exposing their text', async () => {
    const secret = 'secret infrastructure path'
    const signal = new AbortController().signal
    const contract = contractRevisionFixture()
    const packet = readyWorkPacketFixture()
    const harness = makeHarness({
      delivery: {
        getContractRevision: () => contract,
        getWorkPacket: () => packet,
      },
      repository: { resolveBase: vi.fn(async () => { throw new Error(secret) }) },
      internals: {
        startCodeChange: vi.fn(async () => { throw new Error(secret) }),
        startVerification: vi.fn(async () => { throw new Error(secret) }),
      },
    })

    await expect(harness.service.createPacket({
      contractRevisionId: String(contract.id),
      packet: {
        objective: packet.objective,
        allowedPaths: packet.allowedPaths,
        forbiddenPaths: packet.forbiddenPaths,
        acceptanceClauseIds: packet.acceptanceClauseIds,
        stopConditions: packet.stopConditions,
        executorPreference: packet.executorPreference,
      },
    }, signal)).rejects.toMatchObject({ failure: expect.objectContaining({ code: 'internal' }) })
    await expect(harness.service.startChange({
      packetId: String(packet.id), executorId: 'executor-1',
    }, signal)).rejects.toMatchObject({ failure: expect.objectContaining({ code: 'internal' }) })
    await expect(harness.service.startVerification({
      packetId: String(packet.id), changeBindingId: 'binding-change',
    }, signal)).rejects.toMatchObject({ failure: expect.objectContaining({ code: 'internal' }) })
  })

  it('reads one selected evidence object without exposing its provider URI', async () => {
    const reference = evidenceRefFixture({ uri: 'file:///private/delivery/evidence.json' })
    const data = new TextEncoder().encode('delivery evidence\n')
    const resolve = vi.fn(async () => reference)
    const read = vi.fn(async () => ({ ref: reference, data }))
    const harness = makeHarness({ evidence: { resolve, read } })
    const service = harness.service as unknown as {
      readEvidence(input: { evidenceId: string }, signal: AbortSignal): Promise<Record<string, unknown>>
    }
    const signal = new AbortController().signal

    const view = await service.readEvidence({ evidenceId: String(reference.id) }, signal)

    expect(resolve).toHaveBeenCalledWith(reference.id, signal)
    expect(read).toHaveBeenCalledWith(reference, signal)
    expect(view).toMatchObject({
      id: reference.id,
      digest: reference.digest,
      contentBase64: 'ZGVsaXZlcnkgZXZpZGVuY2UK',
    })
    expect(view).not.toHaveProperty('uri')
    expect(JSON.stringify(view)).not.toContain('/private/')
  })

  it('fails closed for absent, mismatched, and provider-failed evidence reads', async () => {
    const reference = evidenceRefFixture()
    const signal = new AbortController().signal
    const absent = makeHarness({ evidence: { resolve: vi.fn(async () => undefined) } })
    const mismatched = makeHarness({
      evidence: {
        resolve: vi.fn(async () => reference),
        read: vi.fn(async () => ({
          ref: evidenceRefFixture({ id: EvidenceId('different-evidence') }),
          data: new Uint8Array(),
        })),
      },
    })
    const failed = makeHarness({
      evidence: {
        resolve: vi.fn(async () => { throw new Error('private provider detail') }),
      },
    })

    await expect(absent.service.readEvidence({ evidenceId: reference.id }, signal))
      .rejects.toMatchObject({ failure: expect.objectContaining({ code: 'not-found' }) })
    await expect(mismatched.service.readEvidence({ evidenceId: reference.id }, signal))
      .rejects.toMatchObject({ failure: expect.objectContaining({ code: 'denied' }) })
    await expect(failed.service.readEvidence({ evidenceId: reference.id }, signal))
      .rejects.toMatchObject({ failure: expect.objectContaining({ code: 'internal' }) })
  })

  it('derives the acceptance target, candidate, evidence, idempotency, and actor from trusted Host facts', async () => {
    const packet = readyWorkPacketFixture()
    const changeBinding = boundBindingFixture({
      id: DispatchBindingId('binding-change'),
      packetId: packet.id,
      queueWorkId: QueueWorkIdRef('work-change'),
    })
    const verifyBinding = verificationBinding(packet)
    const claim = completedClaimFixture({
      packetId: packet.id,
      queueWorkId: QueueWorkIdRef('work-change'),
      queueAttemptId: QueueAttemptIdRef('work-change-attempt'),
    })
    const verdict = passedVerdictFixture({
      id: VerificationVerdictId('verdict-accept'),
      packetId: packet.id,
      verificationPlanDigest: packet.verificationPlan.digest,
    })
    const verificationIntent = {
      packetId: packet.id,
      targetCommit: claim.checkpointCommit,
      verificationPlanDigest: packet.verificationPlan.digest,
    }
    const works = new Map<string, WorkView>([
      ['work-change', succeededWork({
        id: 'work-change',
        kind: 'code.change@1',
        intent: { packetId: packet.id },
        output: { completionClaim: claim },
      })],
      ['work-verify', succeededWork({
        id: 'work-verify',
        kind: 'code.verify@1',
        intent: verificationIntent,
        output: { verificationVerdict: verdict },
      })],
    ])
    const reference = evidenceRefFixture()
    const recordAcceptanceDecision = vi.fn(async (
      request: Record<string, unknown>,
      resolveCandidate: (change: QueueWorkIdRef, verify: QueueWorkIdRef) => Promise<unknown>,
      resolveEvidence: (id: EvidenceId) => Promise<unknown>,
    ) => {
      expect(await resolveCandidate(changeBinding.queueWorkId, verifyBinding.queueWorkId)).toEqual({
        completionClaim: claim,
        changeQueueAttemptId: QueueAttemptIdRef('work-change-attempt'),
        verificationIntent,
        verificationVerdict: verdict,
        verificationQueueAttemptId: QueueAttemptIdRef('work-verify-attempt'),
      })
      expect(await resolveEvidence(reference.id)).toEqual(reference)
      return acceptedDecisionFixture({
        packetId: packet.id,
        verdictId: verdict.id,
        actor: { kind: 'human', actorId: String(request.actorId) },
      })
    })
    const harness = makeHarness({
      config: { operatorId: 'operator-A' },
      delivery: {
        getWorkPacket: vi.fn(() => packet),
        getDispatchBinding: vi.fn((id: string) =>
          id === changeBinding.id ? changeBinding : verifyBinding),
        recordAcceptanceDecision,
      },
      operator: { get: vi.fn(id => works.get(String(id)) as WorkView) },
      evidence: {
        resolve: vi.fn(async () => reference),
        read: vi.fn(async () => ({ ref: reference, data: new Uint8Array() })),
      },
    })
    const signal = new AbortController().signal

    await harness.service.recordDecision({
      packetId: String(packet.id),
      changeBindingId: String(changeBinding.id),
      verificationBindingId: String(verifyBinding.id),
      decision: 'accepted',
      reason: 'Verified evidence is sufficient.',
      decisionNonce: 'operator-choice-1',
    }, signal)

    expect(recordAcceptanceDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        packetId: packet.id,
        actorId: 'operator-A',
        idempotencyKey: `delivery:${String(packet.id)}:decision:${TARGET}:operator-choice-1`,
      }),
      expect.any(Function),
      expect.any(Function),
    )
  })

  it('rejects a decision for an absent Packet or a non-bound selected dispatch', async () => {
    const packet = readyWorkPacketFixture()
    const signal = new AbortController().signal
    const absent = makeHarness({ delivery: { getWorkPacket: vi.fn(() => undefined) } })
    const unbound = makeHarness({
      delivery: {
        getWorkPacket: vi.fn(() => packet),
        getDispatchBinding: vi.fn(() => undefined),
      },
    })
    const input = {
      packetId: String(packet.id),
      changeBindingId: 'binding-change',
      verificationBindingId: 'binding-verify',
      decision: 'rejected' as const,
      reason: 'The required evidence is incomplete.',
      decisionNonce: 'decision-1',
    }

    await expect(absent.service.recordDecision(input, signal)).rejects.toMatchObject({
      failure: expect.objectContaining({ code: 'not-found' }),
    })
    await expect(unbound.service.recordDecision(input, signal)).rejects.toMatchObject({
      failure: expect.objectContaining({ code: 'denied' }),
    })
  })

  it('fails closed when a decision resolver cannot reproduce trusted candidate or evidence facts', async () => {
    const packet = readyWorkPacketFixture()
    const changeBinding = boundBindingFixture({
      id: DispatchBindingId('binding-change'), packetId: packet.id, queueWorkId: QueueWorkIdRef('work-change'),
    })
    const verifyBinding = verificationBinding(packet)
    const claim = completedClaimFixture({
      packetId: packet.id,
      queueWorkId: changeBinding.queueWorkId,
      queueAttemptId: QueueAttemptIdRef('work-change-attempt'),
    })
    const verdict = passedVerdictFixture({ packetId: packet.id })
    const works = new Map<string, WorkView>([
      ['work-change', succeededWork({
        id: 'work-change', kind: 'code.change@1', intent: { packetId: packet.id },
        output: { completionClaim: claim },
      })],
      ['work-verify', succeededWork({
        id: 'work-verify', kind: 'code.verify@1',
        intent: {
          packetId: packet.id,
          targetCommit: claim.checkpointCommit,
          verificationPlanDigest: packet.verificationPlan.digest,
        },
        output: { verificationVerdict: verdict },
      })],
    ])
    const reference = evidenceRefFixture()
    const decisionInput = {
      packetId: String(packet.id),
      changeBindingId: String(changeBinding.id),
      verificationBindingId: String(verifyBinding.id),
      decision: 'accepted' as const,
      reason: 'Evidence reviewed.',
      decisionNonce: 'decision-2',
    }
    const baseDelivery = {
      getWorkPacket: () => packet,
      getDispatchBinding: (id: string) => id === changeBinding.id ? changeBinding : verifyBinding,
    }
    const operator = { get: vi.fn(id => works.get(String(id)) as WorkView) }
    const absentEvidence = makeHarness({
      delivery: {
        ...baseDelivery,
        recordAcceptanceDecision: async (
          _request: unknown,
          _candidate: unknown,
          resolveEvidence: (id: EvidenceId) => Promise<unknown>,
        ) => {
          if (await resolveEvidence(reference.id) === undefined) throw new Error('missing evidence')
          return acceptedDecisionFixture()
        },
      },
      operator,
      evidence: { resolve: vi.fn(async () => undefined) },
    })
    const mismatchedEvidence = makeHarness({
      delivery: {
        ...baseDelivery,
        recordAcceptanceDecision: async (
          _request: unknown,
          _candidate: unknown,
          resolveEvidence: (id: EvidenceId) => Promise<unknown>,
        ) => resolveEvidence(reference.id),
      },
      operator,
      evidence: {
        resolve: vi.fn(async () => reference),
        read: vi.fn(async () => ({
          ref: evidenceRefFixture({ id: EvidenceId('different-evidence') }), data: new Uint8Array(),
        })),
      },
    })
    const unexpectedCandidate = makeHarness({
      delivery: {
        ...baseDelivery,
        recordAcceptanceDecision: async (
          _request: unknown,
          resolveCandidate: (change: QueueWorkIdRef, verify: QueueWorkIdRef) => Promise<unknown>,
        ) => resolveCandidate(QueueWorkIdRef('unexpected-work'), verifyBinding.queueWorkId),
      },
      operator,
    })

    await expect(absentEvidence.service.recordDecision(decisionInput, new AbortController().signal))
      .rejects.toMatchObject({ failure: expect.objectContaining({ code: 'internal' }) })
    await expect(mismatchedEvidence.service.recordDecision(decisionInput, new AbortController().signal))
      .rejects.toMatchObject({ failure: expect.objectContaining({ code: 'denied' }) })
    await expect(unexpectedCandidate.service.recordDecision(decisionInput, new AbortController().signal))
      .rejects.toMatchObject({ failure: expect.objectContaining({ code: 'denied' }) })
  })

  it('rejects pre-aborted calls before any provider or admission operation starts', async () => {
    const importIssue = vi.fn(async () => contractRevisionFixture())
    const harness = makeHarness({ internals: { importIssue } })
    const controller = new AbortController()
    controller.abort('user-cancelled')

    await expect(harness.service.importIssue({
      issueUrl: 'https://github.com/deepseek-ai/deepseek-harness/issues/1',
      repositoryId: String(RepositoryId('repository-fixture')),
    }, controller.signal)).rejects.toMatchObject({
      failure: expect.objectContaining({ code: 'cancelled' }),
    })
    expect(importIssue).not.toHaveBeenCalled()
  })
})
