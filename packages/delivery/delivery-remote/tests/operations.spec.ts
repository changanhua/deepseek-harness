import { Context } from '@deepseek-ai/cordis'
import {
  DispatchBindingId,
  EvidenceId,
  ExecutorId,
  GitCommitId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryRelativePath,
  RepositoryId,
  Sha256Digest,
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
  submittingBindingFixture,
} from '@deepseek-ai/dsh-delivery-testkit'
import {
  startCodeChange as bridgeStartCodeChange,
  startVerification as bridgeStartVerification,
} from '@deepseek-ai/dsh-delivery-task-queue'
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
  resolved?: unknown
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
      resolved: input.resolved ?? {},
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
        delivery: expect.objectContaining({
          getWorkPacket: expect.any(Function),
          beginDispatch: expect.any(Function),
          bindDispatch: expect.any(Function),
        }),
        queue: expect.objectContaining({ get: expect.any(Function), enqueue: expect.any(Function) }),
        repoWorkspace: expect.objectContaining({
          inspectRevision: expect.any(Function),
          inspectRange: expect.any(Function),
        }),
      }),
      { packetId: packet.id, executorId: ExecutorId('codex-fixture') },
    )
    expect(harness.internals.startVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: expect.objectContaining({ get: expect.any(Function), enqueue: expect.any(Function) }),
      }),
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

  it('stops code-change admission after cancellation before Queue enqueue', async () => {
    const packet = readyWorkPacketFixture()
    const submitting = submittingBindingFixture({ packetId: packet.id })
    let settleBegin!: (binding: DispatchBinding) => void
    const beginDispatch = vi.fn(() => new Promise<DispatchBinding>((resolve) => {
      settleBegin = resolve
    }))
    const enqueue = vi.fn(async () => WorkId('work-must-not-admit'))
    const bindDispatch = vi.fn(async () => boundBindingFixture({ packetId: packet.id }))
    const harness = makeHarness({
      delivery: { getWorkPacket: () => packet, beginDispatch, bindDispatch },
      operator: { enqueue },
      internals: {
        startCodeChange: bridgeStartCodeChange as unknown as TestInternals['startCodeChange'],
      },
    })
    const controller = new AbortController()

    const operation = harness.service.startChange({
      packetId: String(packet.id), executorId: 'codex-fixture',
    }, controller.signal)
    await vi.waitFor(() => { expect(beginDispatch).toHaveBeenCalledOnce() })
    controller.abort('operator-cancelled')
    settleBegin(submitting)

    await expect(operation).rejects.toMatchObject({
      failure: expect.objectContaining({ code: 'cancelled' }),
    })
    expect(enqueue).not.toHaveBeenCalled()
    expect(bindDispatch).not.toHaveBeenCalled()
  })

  it('stops verification admission after cancellation during repository proof', async () => {
    const packet = readyWorkPacketFixture()
    const changeBinding = boundBindingFixture({
      id: DispatchBindingId('binding-cancel-change'),
      packetId: packet.id,
      queueWorkId: QueueWorkIdRef('work-cancel-change'),
    })
    const claim = completedClaimFixture({
      packetId: packet.id,
      queueWorkId: changeBinding.queueWorkId,
      queueAttemptId: QueueAttemptIdRef('work-cancel-change-attempt'),
    })
    const work = succeededWork({
      id: 'work-cancel-change',
      kind: 'code.change@1',
      intent: { packetId: packet.id },
      resolved: {
        packetId: packet.id,
        contractRevisionId: packet.contractRevisionId,
        repositoryId: packet.repositoryId,
        baseCommit: packet.baseCommit,
        executorId: changeBinding.executorId,
        policyDigest: Sha256Digest(`sha256:${'9'.repeat(64)}`),
      },
      output: { completionClaim: claim },
    })
    let settleBase!: (revision: { repositoryId: typeof packet.repositoryId; commit: typeof packet.baseCommit }) => void
    let revisionReads = 0
    const inspectRevision = vi.fn((request: {
      repositoryId: typeof packet.repositoryId
      commit: typeof packet.baseCommit
      signal?: AbortSignal
    }) => {
      revisionReads += 1
      if (revisionReads === 1) {
        return new Promise<typeof request>((resolve) => { settleBase = resolve })
      }
      return Promise.resolve(request)
    })
    const inspectRange = vi.fn(async () => ({
      repositoryId: packet.repositoryId,
      baseCommit: packet.baseCommit,
      targetCommit: claim.checkpointCommit,
      descendsFromBase: true,
      changedPaths: [],
    }))
    const beginDispatch = vi.fn(async () => ({
      ...verificationBinding(packet),
      phase: 'submitting' as const,
      queueWorkId: null,
    }))
    const enqueue = vi.fn(async () => WorkId('verification-must-not-admit'))
    const harness = makeHarness({
      delivery: {
        getWorkPacket: () => packet,
        getDispatchBinding: () => changeBinding,
        beginDispatch,
        bindDispatch: vi.fn(async () => verificationBinding(packet)),
      },
      operator: { get: vi.fn(() => work), enqueue },
      repository: { inspectRevision, inspectRange },
      internals: {
        startVerification: bridgeStartVerification as unknown as TestInternals['startVerification'],
      },
    })
    const controller = new AbortController()

    const operation = harness.service.startVerification({
      packetId: String(packet.id), changeBindingId: String(changeBinding.id),
    }, controller.signal)
    await vi.waitFor(() => { expect(inspectRevision).toHaveBeenCalledOnce() })
    controller.abort('operator-cancelled')
    settleBase({ repositoryId: packet.repositoryId, commit: GitCommitId(String(packet.baseCommit)) })

    await expect(operation).rejects.toMatchObject({
      failure: expect.objectContaining({ code: 'cancelled' }),
    })
    expect(beginDispatch).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('passes an active signal through successful change and verification admission commits', async () => {
    const packet = readyWorkPacketFixture()
    const changeSubmitting = submittingBindingFixture({
      id: DispatchBindingId('binding-guarded-change'),
      packetId: packet.id,
    })
    const changeBound = boundBindingFixture({
      ...changeSubmitting,
      phase: 'bound',
      queueWorkId: QueueWorkIdRef('work-guarded-change'),
    })
    const changeHarness = makeHarness({
      delivery: {
        getWorkPacket: vi.fn(() => packet),
        beginDispatch: vi.fn(async () => changeSubmitting),
        bindDispatch: vi.fn(async () => changeBound),
      },
      operator: {
        enqueue: vi.fn(async () => WorkId('work-guarded-change')),
      },
      internals: {
        startCodeChange: bridgeStartCodeChange as unknown as TestInternals['startCodeChange'],
      },
    })

    await expect(changeHarness.service.startChange({
      packetId: String(packet.id), executorId: String(changeBound.executorId),
    }, new AbortController().signal)).resolves.toMatchObject({
      id: changeBound.id,
      queueWorkId: changeBound.queueWorkId,
    })

    const claim = completedClaimFixture({
      packetId: packet.id,
      queueWorkId: changeBound.queueWorkId,
      queueAttemptId: QueueAttemptIdRef('work-guarded-change-attempt'),
    })
    const work = succeededWork({
      id: String(changeBound.queueWorkId),
      kind: 'code.change@1',
      intent: { packetId: packet.id },
      resolved: {
        packetId: packet.id,
        contractRevisionId: packet.contractRevisionId,
        repositoryId: packet.repositoryId,
        baseCommit: packet.baseCommit,
        executorId: changeBound.executorId,
        policyDigest: Sha256Digest(`sha256:${'9'.repeat(64)}`),
      },
      output: { completionClaim: claim },
    })
    const verifySubmitting = {
      ...verificationBinding(packet),
      phase: 'submitting' as const,
      queueWorkId: null,
    }
    const verifyBound = verificationBinding(packet)
    const inspectRevision = vi.fn(async (request: {
      repositoryId: typeof packet.repositoryId
      commit: typeof packet.baseCommit
      signal?: AbortSignal
    }) => ({ repositoryId: request.repositoryId, commit: request.commit }))
    const inspectRange = vi.fn(async () => ({
      repositoryId: packet.repositoryId,
      baseCommit: packet.baseCommit,
      targetCommit: claim.checkpointCommit,
      descendsFromBase: true,
      changedPaths: claim.changedPaths,
    }))
    const verifyHarness = makeHarness({
      delivery: {
        getWorkPacket: vi.fn(() => packet),
        getDispatchBinding: vi.fn(() => changeBound),
        beginDispatch: vi.fn(async () => verifySubmitting),
        bindDispatch: vi.fn(async () => verifyBound),
      },
      operator: {
        get: vi.fn(() => work),
        enqueue: vi.fn(async () => WorkId('work-verify')),
      },
      repository: { inspectRevision, inspectRange },
      internals: {
        startVerification: bridgeStartVerification as unknown as TestInternals['startVerification'],
      },
    })
    const signal = new AbortController().signal

    await expect(verifyHarness.service.startVerification({
      packetId: String(packet.id), changeBindingId: String(changeBound.id),
    }, signal)).resolves.toMatchObject({ id: verifyBound.id, queueWorkId: verifyBound.queueWorkId })
    expect(inspectRevision).toHaveBeenCalledWith(expect.objectContaining({ signal }))
    expect(inspectRange).toHaveBeenCalledWith(expect.objectContaining({ signal }))
  })

  it('reads one selected evidence object without exposing its provider URI', async () => {
    const data = new TextEncoder().encode('delivery evidence\n')
    const reference = evidenceRefFixture({
      uri: 'file:///private/delivery/evidence.json',
      byteLength: data.byteLength,
    })
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
    const wrongLength = makeHarness({
      evidence: {
        resolve: vi.fn(async () => reference),
        read: vi.fn(async () => ({ ref: reference, data: new Uint8Array() })),
      },
    })
    const storedOversized = makeHarness({
      evidence: {
        resolve: vi.fn(async () => reference),
        read: vi.fn(async () => ({
          ref: { ...reference, byteLength: 256 * 1024 + 1 },
          data: new Uint8Array(),
        })),
      },
    })

    await expect(absent.service.readEvidence({ evidenceId: reference.id }, signal))
      .rejects.toMatchObject({ failure: expect.objectContaining({ code: 'not-found' }) })
    await expect(mismatched.service.readEvidence({ evidenceId: reference.id }, signal))
      .rejects.toMatchObject({ failure: expect.objectContaining({ code: 'denied' }) })
    await expect(failed.service.readEvidence({ evidenceId: reference.id }, signal))
      .rejects.toMatchObject({ failure: expect.objectContaining({ code: 'internal' }) })
    await expect(wrongLength.service.readEvidence({ evidenceId: reference.id }, signal))
      .rejects.toMatchObject({ failure: expect.objectContaining({ code: 'denied' }) })
    await expect(storedOversized.service.readEvidence({ evidenceId: reference.id }, signal))
      .rejects.toMatchObject({ failure: expect.objectContaining({ code: 'denied' }) })
  })

  it('rejects oversized evidence before reading provider bytes', async () => {
    const reference = evidenceRefFixture({ byteLength: 256 * 1024 + 1 })
    const read = vi.fn()
    const harness = makeHarness({
      evidence: {
        resolve: vi.fn(async () => reference),
        read,
      },
    })

    await expect(harness.service.readEvidence(
      { evidenceId: reference.id },
      new AbortController().signal,
    )).rejects.toMatchObject({
      failure: expect.objectContaining({ code: 'denied' }),
    })
    expect(read).not.toHaveBeenCalled()
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

    const decisionView = await harness.service.recordDecision({
      packetId: String(packet.id),
      changeBindingId: String(changeBinding.id),
      verificationBindingId: String(verifyBinding.id),
      decision: 'accepted',
      reason: 'Verified evidence is sufficient.',
      decisionNonce: 'operator-choice-1',
    }, signal)

    expect(JSON.stringify(decisionView)).not.toContain('actorId')
    expect(JSON.stringify(decisionView)).not.toContain('decisionNonce')
    expect(decisionView).not.toHaveProperty('actor')

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
