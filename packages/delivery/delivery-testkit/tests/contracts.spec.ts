import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type {
  AdoptContractRevisionRequest,
  ContractRevisionDraft,
  ResolveVerificationSourceRequest,
  SourceRefDraft,
  WorkPacketDraft,
} from '@deepseek-ai/dsh-delivery'
import {
  ExecutorId,
  DispatchBindingId,
  EvidenceId,
  GitBlobId,
  GitCommitId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryId,
  RepositoryRelativePath,
  WorkPacketId,
  acceptanceDecisionSchema,
  canonicalDigest,
  completionClaimSchema,
  contractRevisionSchema,
  dispatchBindingSchema,
  evidenceRefSchema,
  resumeCapsuleContentSchema,
  sourceRefSchema,
  verificationPlanSchema,
  verificationVerdictSchema,
  workPacketSchema,
  type ContractRevision,
  type WorkPacket,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  FakeChangeWorkspaceLease,
  FakeDelivery,
  FakeDeliveryEvidence,
  FakeRepositoryWorkspace,
  acceptedDecisionFixture,
  boundBindingFixture,
  completedClaimFixture,
  contractRevisionFixture,
  evidenceRefFixture,
  mountDeliveryTestkit,
  passedVerdictFixture,
  readyWorkPacketFixture,
  resumeCapsuleFixture,
  sourceRefFixture,
  submittingBindingFixture,
  verificationPlanFixture,
  type MountedDeliveryTestkit,
} from '../src/index.ts'

const BASE_COMMIT = GitCommitId('1111111111111111111111111111111111111111')
const TARGET_COMMIT = GitCommitId('2222222222222222222222222222222222222222')
const OTHER_COMMIT = GitCommitId('3333333333333333333333333333333333333333')
const BLOB_ID = GitBlobId('4444444444444444444444444444444444444444')
const REPOSITORY_ID = RepositoryId('repository-fixture')
const PLAN_PATH = RepositoryRelativePath('.dsh/delivery-verification.json')

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function adoptionRequest(
  contract: ContractRevision,
  idempotencyKey = 'adopt-contract-fixture-v1',
): AdoptContractRevisionRequest {
  const source: SourceRefDraft = {
    repository: contract.sourceRef.repository,
    issueNumber: contract.sourceRef.issueNumber,
    canonicalUrl: contract.sourceRef.canonicalUrl,
    updatedAt: contract.sourceRef.updatedAt,
    title: contract.sourceRef.title,
    body: contract.sourceRef.body,
    contentDigest: contract.sourceRef.contentDigest,
  }
  const revision: ContractRevisionDraft = {
    previousRevisionId: contract.previousRevisionId,
    repositoryId: contract.repositoryId,
    outcome: contract.outcome,
    context: contract.context,
    allowedScope: contract.allowedScope,
    forbiddenScope: contract.forbiddenScope,
    acceptanceClauses: contract.acceptanceClauses,
    openDecisions: contract.openDecisions,
    baseSelectionRule: contract.baseSelectionRule,
    verificationSource: contract.verificationSource,
    referenceLinks: contract.referenceLinks,
  }
  return { idempotencyKey, source, revision }
}

function packetDraft(packet: WorkPacket): WorkPacketDraft {
  return {
    objective: packet.objective,
    allowedPaths: packet.allowedPaths,
    forbiddenPaths: packet.forbiddenPaths,
    acceptanceClauseIds: packet.acceptanceClauseIds,
    stopConditions: packet.stopConditions,
    executorPreference: packet.executorPreference,
  }
}

async function createStoredPacket(harness: MountedDeliveryTestkit): Promise<{
  readonly contract: ContractRevision
  readonly packet: WorkPacket
}> {
  const contract = await harness.delivery.adoptContractRevision(adoptionRequest(contractRevisionFixture()))
  if (contract.repositoryId === null || contract.baseSelectionRule?.kind !== 'commit') {
    throw new Error('delivery-testkit test fixture unexpectedly produced a not-ready Contract')
  }
  harness.repoWorkspace.allowRevision(contract.repositoryId, contract.baseSelectionRule.commit)
  const repository = await harness.repoWorkspace.resolveBase({
    repositoryId: contract.repositoryId,
    selectionRule: contract.baseSelectionRule,
  })
  const fixture = readyWorkPacketFixture({
    contractRevisionId: contract.id,
    repositoryId: contract.repositoryId,
    baseCommit: contract.baseSelectionRule.commit,
    acceptanceClauseIds: contract.acceptanceClauses.map(clause => clause.id),
  })
  const packet = await harness.delivery.createWorkPacket({
    idempotencyKey: 'create-packet-fixture-v1',
    contractRevisionId: contract.id,
    repository,
    packet: packetDraft(fixture),
  })
  return { contract, packet }
}

async function createAcceptanceChain(harness: MountedDeliveryTestkit, packet: WorkPacket) {
  const changeIntent = { packetId: packet.id }
  const changeSubmitting = await harness.delivery.beginDispatch({
    idempotencyKey: `dispatch-change:${packet.id}`,
    packetId: packet.id,
    inputDigest: canonicalDigest(changeIntent),
    kind: 'code.change@1',
    executorId: ExecutorId('codex-fixture'),
  })
  const changeQueueWorkId = QueueWorkIdRef('queue-work-change-live')
  const changeBinding = await harness.delivery.bindDispatch({
    bindingId: changeSubmitting.id,
    queueWorkId: changeQueueWorkId,
  })

  const verificationIntent = {
    packetId: packet.id,
    targetCommit: TARGET_COMMIT,
    verificationPlanDigest: packet.verificationPlan.digest,
  }
  const verificationSubmitting = await harness.delivery.beginDispatch({
    idempotencyKey: `dispatch-verification:${packet.id}:${TARGET_COMMIT}`,
    packetId: packet.id,
    inputDigest: canonicalDigest(verificationIntent),
    kind: 'code.verify@1',
  })
  const verificationQueueWorkId = QueueWorkIdRef('queue-work-verification-live')
  const verificationBinding = await harness.delivery.bindDispatch({
    bindingId: verificationSubmitting.id,
    queueWorkId: verificationQueueWorkId,
  })
  const changeQueueAttemptId = QueueAttemptIdRef('queue-attempt-change-live')
  const verificationQueueAttemptId = QueueAttemptIdRef('queue-attempt-verification-live')
  const check = packet.verificationPlan.checks[0]
  if (check === undefined) throw new Error('delivery-testkit fixture unexpectedly has no verification check')
  const changeEvidence = await harness.deliveryEvidence.bind({
    kind: 'change-attempt',
    packetId: packet.id,
    queueWorkId: changeQueueWorkId,
    queueAttemptId: changeQueueAttemptId,
  }).save({
    kind: 'git-diff-metadata',
    mediaType: 'application/json',
    data: new TextEncoder().encode('{"changedPaths":["packages/delivery/example.ts"]}'),
  })
  const verificationEvidence = await harness.deliveryEvidence.bind({
    kind: 'verification-check',
    packetId: packet.id,
    queueWorkId: verificationQueueWorkId,
    queueAttemptId: verificationQueueAttemptId,
    checkId: check.id,
  }).save({
    kind: 'verification-output',
    mediaType: 'text/plain',
    data: new TextEncoder().encode('focused verification passed\n'),
  })
  const completionClaim = completedClaimFixture({
    packetId: packet.id,
    queueWorkId: changeQueueWorkId,
    queueAttemptId: changeQueueAttemptId,
    checkpointCommit: TARGET_COMMIT,
    evidenceIds: [changeEvidence.id],
  })
  const initialVerdict = passedVerdictFixture({
    packetId: packet.id,
    baseCommit: packet.baseCommit,
    targetCommit: TARGET_COMMIT,
    verificationPlanDigest: packet.verificationPlan.digest,
    evidenceIds: [changeEvidence.id, verificationEvidence.id],
  })
  const verificationVerdict = passedVerdictFixture({
    ...initialVerdict,
    checkResults: initialVerdict.checkResults.map(result => ({
      ...result,
      evidenceIds: [verificationEvidence.id],
    })),
    evidenceIntegrityFindings: [changeEvidence.id, verificationEvidence.id].map(evidenceId => ({
      evidenceId,
      required: true,
      status: 'verified' as const,
    })),
  })
  const evidenceRefs = [changeEvidence, verificationEvidence]
  return {
    changeBinding,
    changeQueueWorkId,
    changeQueueAttemptId,
    completionClaim,
    evidenceRefs,
    verificationBinding,
    verificationIntent,
    verificationQueueWorkId,
    verificationQueueAttemptId,
    verificationVerdict,
  }
}

async function resolveStoredEvidence(harness: MountedDeliveryTestkit, evidenceId: EvidenceId) {
  const reference = await harness.deliveryEvidence.resolve(evidenceId)
  if (reference === undefined) return undefined
  await harness.deliveryEvidence.read(reference)
  return reference
}

describe('schema-validated Delivery fixtures', () => {
  it('builds every durable fixture through its production schema', () => {
    expect(sourceRefSchema.parse(sourceRefFixture())).toEqual(sourceRefFixture())
    expect(contractRevisionSchema.parse(contractRevisionFixture())).toEqual(contractRevisionFixture())
    expect(verificationPlanSchema.parse(verificationPlanFixture())).toEqual(verificationPlanFixture())
    expect(workPacketSchema.parse(readyWorkPacketFixture())).toEqual(readyWorkPacketFixture())
    expect(dispatchBindingSchema.parse(submittingBindingFixture())).toEqual(submittingBindingFixture())
    expect(dispatchBindingSchema.parse(boundBindingFixture())).toEqual(boundBindingFixture())
    expect(completionClaimSchema.parse(completedClaimFixture())).toEqual(completedClaimFixture())
    expect(verificationVerdictSchema.parse(passedVerdictFixture())).toEqual(passedVerdictFixture())
    expect(acceptanceDecisionSchema.parse(acceptedDecisionFixture())).toEqual(acceptedDecisionFixture())
    expect(evidenceRefSchema.parse(evidenceRefFixture())).toEqual(evidenceRefFixture())
    expect(resumeCapsuleContentSchema.parse(resumeCapsuleFixture())).toEqual(resumeCapsuleFixture())
  })

  it('returns fresh nested values and does not normalize invalid overrides', () => {
    const first = contractRevisionFixture()
    const second = contractRevisionFixture()
    expect(first).not.toBe(second)
    expect(first.sourceRef).not.toBe(second.sourceRef)
    expect(first.acceptanceClauses).not.toBe(second.acceptanceClauses)
    expect(first.acceptanceClauses[0]).not.toBe(second.acceptanceClauses[0])
    expect(() => sourceRefFixture({ title: '' })).toThrow(/non-blank/)
    expect(() => readyWorkPacketFixture({ acceptanceClauseIds: [] })).toThrow()
  })
})

describe('Delivery testkit topology', () => {
  it('mounts concrete services and removes all three with an idempotent disposer', async () => {
    const ctx = new Context()
    const harness = await mountDeliveryTestkit(ctx)
    expect(ctx.delivery instanceof FakeDelivery).toBe(true)
    expect(ctx.repoWorkspace instanceof FakeRepositoryWorkspace).toBe(true)
    expect(ctx.deliveryEvidence instanceof FakeDeliveryEvidence).toBe(true)
    expect(harness.delivery).toBe(ctx.delivery)
    expect(harness.repoWorkspace).toBe(ctx.repoWorkspace)
    expect(harness.deliveryEvidence).toBe(ctx.deliveryEvidence)

    await harness.dispose()
    await harness.dispose()
    expect(ctx.get('delivery')).toBeUndefined()
    expect(ctx.get('repoWorkspace')).toBeUndefined()
    expect(ctx.get('deliveryEvidence')).toBeUndefined()
  })
})

describe('FakeDelivery contract', () => {
  it('enforces exact idempotency and Contract readiness before Packet creation', async () => {
    const harness = await mountDeliveryTestkit(new Context())
    const request = adoptionRequest(contractRevisionFixture())
    const first = await harness.delivery.adoptContractRevision(request)
    const repeated = await harness.delivery.adoptContractRevision(request)
    expect(repeated).toEqual(first)
    expect(repeated).not.toBe(first)
    expect(harness.delivery.snapshot().contractRevisions).toHaveLength(1)

    const changed = adoptionRequest(contractRevisionFixture({
      sourceRef: sourceRefFixture({ title: 'A different source snapshot' }),
    }))
    await expect(harness.delivery.adoptContractRevision(changed)).rejects.toMatchObject({
      code: 'idempotency-conflict',
    })

    if (first.repositoryId === null || first.baseSelectionRule?.kind !== 'commit') {
      throw new Error('ready fixture lost the repository facts needed by this test')
    }
    harness.repoWorkspace.allowRevision(first.repositoryId, first.baseSelectionRule.commit)
    const readyRepository = await harness.repoWorkspace.resolveBase({
      repositoryId: first.repositoryId,
      selectionRule: first.baseSelectionRule,
    })
    const packetFixture = readyWorkPacketFixture({
      contractRevisionId: first.id,
      repositoryId: first.repositoryId,
      baseCommit: first.baseSelectionRule.commit,
      acceptanceClauseIds: first.acceptanceClauses.map(clause => clause.id),
    })
    const created = await harness.delivery.createWorkPacket({
      idempotencyKey: 'derived-contract-plan-v1',
      contractRevisionId: first.id,
      repository: readyRepository,
      packet: packetDraft(packetFixture),
    }, async () => { throw new Error('contract-field plan must not consult a blob resolver') })
    expect(created.verificationPlan).toMatchObject({
      checks: first.verificationSource?.kind === 'contract-field'
        ? first.verificationSource.checks
        : [],
      provenance: {
        kind: 'contract-field',
        contractRevisionId: first.id,
        field: 'verificationSource',
      },
    })
    expect(harness.delivery.snapshot().workPackets).toHaveLength(1)

    const blocked = await harness.delivery.adoptContractRevision(adoptionRequest(
      contractRevisionFixture({ outcome: null }),
      'adopt-blocked-contract-v1',
    ))
    if (blocked.repositoryId === null || blocked.baseSelectionRule?.kind !== 'commit') {
      throw new Error('blocked fixture lost the repository facts needed by this test')
    }
    harness.repoWorkspace.allowRevision(blocked.repositoryId, blocked.baseSelectionRule.commit)
    const repository = await harness.repoWorkspace.resolveBase({
      repositoryId: blocked.repositoryId,
      selectionRule: blocked.baseSelectionRule,
    })
    const candidate = readyWorkPacketFixture({
      contractRevisionId: blocked.id,
      repositoryId: blocked.repositoryId,
      baseCommit: blocked.baseSelectionRule.commit,
      acceptanceClauseIds: blocked.acceptanceClauses.map(clause => clause.id),
    })
    await expect(harness.delivery.createWorkPacket({
      idempotencyKey: 'blocked-packet-v1',
      contractRevisionId: blocked.id,
      repository,
      packet: packetDraft(candidate),
    })).rejects.toMatchObject({ code: 'invalid-reference' })
    await harness.dispose()
  })

  it('rejects a previous revision from another GitHub Issue lineage', async () => {
    const harness = await mountDeliveryTestkit(new Context())
    const first = await harness.delivery.adoptContractRevision(adoptionRequest(
      contractRevisionFixture(),
      'adopt-lineage-first-v1',
    ))
    const second = await harness.delivery.adoptContractRevision(adoptionRequest(
      contractRevisionFixture({
        previousRevisionId: first.id,
        sourceRef: sourceRefFixture({
          updatedAt: '2026-08-29T00:01:00.000Z',
          title: 'Deliver the next bounded revision',
        }),
      }),
      'adopt-lineage-second-v1',
    ))
    expect(second.previousRevisionId).toBe(first.id)

    const mismatches = [
      {
        name: 'owner',
        repository: { owner: 'other-owner', name: 'deepseek-harness' },
        issueNumber: 101,
      },
      {
        name: 'repository',
        repository: { owner: 'deepseek-ai', name: 'other-repository' },
        issueNumber: 101,
      },
      {
        name: 'Issue number',
        repository: { owner: 'deepseek-ai', name: 'deepseek-harness' },
        issueNumber: 102,
      },
    ]
    for (const [index, mismatch] of mismatches.entries()) {
      await expect(harness.delivery.adoptContractRevision(adoptionRequest(
        contractRevisionFixture({
          previousRevisionId: second.id,
          sourceRef: sourceRefFixture({
            repository: mismatch.repository,
            issueNumber: mismatch.issueNumber,
            title: `Cross-lineage ${mismatch.name}`,
          }),
        }),
        `adopt-lineage-mismatch-${String(index)}-v1`,
      ))).rejects.toMatchObject({ code: 'invalid-reference' })
    }
    expect(harness.delivery.snapshot().contractRevisions).toHaveLength(2)
    await harness.dispose()
  })

  it('derives a git-blob plan only from the exact verified Contract base and strict source document', async () => {
    const harness = await mountDeliveryTestkit(new Context())
    const sourceChecks = verificationPlanFixture().checks
    const contract = await harness.delivery.adoptContractRevision(adoptionRequest(
      contractRevisionFixture({
        verificationSource: {
          kind: 'git-blob',
          path: PLAN_PATH,
          format: 'delivery-verification-plan@1',
        },
      }),
      'adopt-git-plan-contract-v1',
    ))
    if (contract.repositoryId === null || contract.baseSelectionRule === null) {
      throw new Error('git-plan fixture unexpectedly produced a not-ready Contract')
    }
    if (contract.baseSelectionRule.kind !== 'commit') throw new Error('git-plan fixture requires a commit base')
    harness.repoWorkspace.allowRevision(contract.repositoryId, contract.baseSelectionRule.commit)
    const repository = await harness.repoWorkspace.resolveBase({
      repositoryId: contract.repositoryId,
      selectionRule: contract.baseSelectionRule,
    })
    const encodeDocument = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
    const validBytes = encodeDocument({
      format: 'delivery-verification-plan@1',
      checks: sourceChecks,
    })
    harness.repoWorkspace.allowBlob({
      repositoryId: repository.repositoryId,
      commit: repository.commit,
      path: PLAN_PATH,
      blobId: BLOB_ID,
      bytes: validBytes,
    })
    const fixture = readyWorkPacketFixture({
      contractRevisionId: contract.id,
      repositoryId: repository.repositoryId,
      baseCommit: repository.commit,
      acceptanceClauseIds: contract.acceptanceClauses.map(clause => clause.id),
    })
    const packetRequest = {
      idempotencyKey: 'create-git-plan-packet-v1',
      contractRevisionId: contract.id,
      repository,
      packet: packetDraft(fixture),
    }
    const sourceEntered = deferred()
    const sourceGate = deferred()
    const resolveSource = vi.fn(async ({
      repository: selected,
      path,
      maxBytes,
    }: ResolveVerificationSourceRequest) => {
      expect(selected).toBe(repository)
      expect(path).toBe(PLAN_PATH)
      expect(maxBytes).toBe(64 * 1024)
      sourceEntered.resolve()
      await sourceGate.promise
      return harness.repoWorkspace.readBlob({ base: selected, path, maxBytes })
    })
    const firstPacket = harness.delivery.createWorkPacket(packetRequest, resolveSource)
    await sourceEntered.promise
    const replaySourceResolver = vi.fn(async () => {
      throw new Error('a concurrent exact replay must not reread Git')
    })
    const replayedPacket = harness.delivery.createWorkPacket(packetRequest, replaySourceResolver)
    sourceGate.resolve()
    const [packet, replay] = await Promise.all([firstPacket, replayedPacket])
    expect(replay).toEqual(packet)
    expect(replaySourceResolver).not.toHaveBeenCalled()
    expect(harness.delivery.snapshot().workPackets).toEqual([packet])
    expect(packet.verificationPlan).toMatchObject({
      checks: sourceChecks,
      provenance: {
        kind: 'git-blob',
        baseCommit: repository.commit,
        path: PLAN_PATH,
        blobId: BLOB_ID,
      },
    })
    expect(resolveSource).toHaveBeenCalledTimes(1)
    expect(await harness.delivery.createWorkPacket(
      packetRequest,
      async () => { throw new Error('an exact idempotent replay must not reread Git') },
    )).toEqual(packet)
    const conflictingSourceResolver = vi.fn(async () => { throw new Error('conflict must fail before Git') })
    await expect(harness.delivery.createWorkPacket({
      ...packetRequest,
      packet: { ...packetRequest.packet, objective: 'A conflicting Packet objective.' },
    }, conflictingSourceResolver)).rejects.toMatchObject({ code: 'idempotency-conflict' })
    expect(conflictingSourceResolver).not.toHaveBeenCalled()

    const conflictEntered = deferred()
    const conflictGate = deferred()
    const concurrentConflictRequest = {
      ...packetRequest,
      idempotencyKey: 'git-plan-concurrent-conflict-v1',
    }
    const winningConflictResolver = vi.fn(async (input: ResolveVerificationSourceRequest) => {
      conflictEntered.resolve()
      await conflictGate.promise
      return harness.repoWorkspace.readBlob({
        base: input.repository,
        path: input.path,
        maxBytes: input.maxBytes,
      })
    })
    const winningConflict = harness.delivery.createWorkPacket(
      concurrentConflictRequest,
      winningConflictResolver,
    )
    await conflictEntered.promise
    const losingConflictResolver = vi.fn(async () => {
      throw new Error('a concurrent conflict must not reread Git')
    })
    const losingConflict = harness.delivery.createWorkPacket({
      ...concurrentConflictRequest,
      packet: { ...concurrentConflictRequest.packet, objective: 'Concurrent conflicting objective.' },
    }, losingConflictResolver)
    const losingConflictExpectation = expect(losingConflict)
      .rejects.toMatchObject({ code: 'idempotency-conflict' })
    conflictGate.resolve()
    await Promise.all([
      expect(winningConflict).resolves.toMatchObject({ objective: concurrentConflictRequest.packet.objective }),
      losingConflictExpectation,
    ])
    expect(winningConflictResolver).toHaveBeenCalledTimes(1)
    expect(losingConflictResolver).not.toHaveBeenCalled()

    const retryRequest = {
      ...packetRequest,
      idempotencyKey: 'git-plan-missing-resolver-v1',
    }
    const failingSourceResolver = vi.fn(async () => {
      await Promise.resolve()
      throw new Error('scripted repository read failure')
    })
    await expect(harness.delivery.createWorkPacket(retryRequest, failingSourceResolver))
      .rejects.toThrow('scripted repository read failure')
    expect(failingSourceResolver).toHaveBeenCalledTimes(1)
    await expect(harness.delivery.createWorkPacket(retryRequest, resolveSource))
      .resolves.toMatchObject({ objective: retryRequest.packet.objective })

    const otherRepositoryId = RepositoryId('repository-other')
    harness.repoWorkspace.allowRevision(otherRepositoryId, repository.commit)
    const otherRepository = await harness.repoWorkspace.resolveBase({
      repositoryId: otherRepositoryId,
      selectionRule: repository.selectionRule,
    })
    harness.repoWorkspace.allowBlob({
      repositoryId: otherRepository.repositoryId,
      commit: otherRepository.commit,
      path: PLAN_PATH,
      blobId: BLOB_ID,
      bytes: validBytes,
    })
    await expect(harness.delivery.createWorkPacket({
      ...packetRequest,
      idempotencyKey: 'git-plan-wrong-repository-v1',
    }, async () => harness.repoWorkspace.readBlob({
      base: otherRepository,
      path: PLAN_PATH,
      maxBytes: 64 * 1024,
    }))).rejects.toMatchObject({ code: 'invalid-reference' })

    harness.repoWorkspace.allowRevision(repository.repositoryId, OTHER_COMMIT)
    const otherBase = await harness.repoWorkspace.resolveBase({
      repositoryId: repository.repositoryId,
      selectionRule: { kind: 'commit', commit: OTHER_COMMIT },
    })
    harness.repoWorkspace.allowBlob({
      repositoryId: otherBase.repositoryId,
      commit: otherBase.commit,
      path: PLAN_PATH,
      blobId: BLOB_ID,
      bytes: validBytes,
    })
    await expect(harness.delivery.createWorkPacket({
      ...packetRequest,
      idempotencyKey: 'git-plan-wrong-base-v1',
    }, async () => harness.repoWorkspace.readBlob({
      base: otherBase,
      path: PLAN_PATH,
      maxBytes: 64 * 1024,
    }))).rejects.toMatchObject({ code: 'invalid-reference' })

    const otherPath = RepositoryRelativePath('.dsh/other-plan.json')
    harness.repoWorkspace.allowBlob({
      repositoryId: repository.repositoryId,
      commit: repository.commit,
      path: otherPath,
      blobId: BLOB_ID,
      bytes: validBytes,
    })
    await expect(harness.delivery.createWorkPacket({
      ...packetRequest,
      idempotencyKey: 'git-plan-wrong-path-v1',
    }, async () => harness.repoWorkspace.readBlob({
      base: repository,
      path: otherPath,
      maxBytes: 64 * 1024,
    }))).rejects.toMatchObject({ code: 'invalid-reference' })

    const validWithoutBom = encodeDocument({
      format: 'delivery-verification-plan@1',
      checks: sourceChecks,
    })
    const withBom = new Uint8Array(validWithoutBom.byteLength + 3)
    withBom.set([0xef, 0xbb, 0xbf])
    withBom.set(validWithoutBom, 3)
    const malformedDocuments = [
      encodeDocument({ format: 'delivery-verification-plan@1', checks: sourceChecks, extra: true }),
      encodeDocument({
        format: 'delivery-verification-plan@1',
        checks: sourceChecks.map(check => ({ ...check, name: '' })),
      }),
      withBom,
    ]
    for (const [index, bytes] of malformedDocuments.entries()) {
      harness.repoWorkspace.allowBlob({
        repositoryId: repository.repositoryId,
        commit: repository.commit,
        path: PLAN_PATH,
        blobId: BLOB_ID,
        bytes,
      })
      await expect(harness.delivery.createWorkPacket({
        ...packetRequest,
        idempotencyKey: `git-plan-malformed-${String(index)}`,
      }, async ({ repository: selected, path, maxBytes }) => harness.repoWorkspace.readBlob({
        base: selected,
        path,
        maxBytes,
      }))).rejects.toMatchObject({ code: 'invalid-reference' })
    }
    await harness.dispose()
  })

  it('uses compare-and-set binding and resolves the exact bound Queue chain before acceptance', async () => {
    const harness = await mountDeliveryTestkit(new Context())
    const { packet } = await createStoredPacket(harness)
    const begin = {
      idempotencyKey: 'dispatch-packet-fixture-v1',
      packetId: packet.id,
      inputDigest: canonicalDigest({ packetId: packet.id }),
      kind: 'code.change@1' as const,
      executorId: ExecutorId('codex-fixture'),
    }
    const submitting = await harness.delivery.beginDispatch(begin)
    expect(await harness.delivery.beginDispatch(begin)).toEqual(submitting)
    const queueWorkId = QueueWorkIdRef('queue-work-live')
    const bound = await harness.delivery.bindDispatch({ bindingId: submitting.id, queueWorkId })
    expect(bound).toMatchObject({ phase: 'bound', queueWorkId })
    expect(await harness.delivery.bindDispatch({ bindingId: submitting.id, queueWorkId })).toEqual(bound)
    await expect(harness.delivery.bindDispatch({
      bindingId: submitting.id,
      queueWorkId: QueueWorkIdRef('queue-work-other'),
    })).rejects.toMatchObject({ code: 'invalid-transition' })

    const chain = await createAcceptanceChain(harness, packet)
    const resolvedCandidate = {
      completionClaim: chain.completionClaim,
      changeQueueAttemptId: chain.changeQueueAttemptId,
      verificationIntent: chain.verificationIntent,
      verificationVerdict: chain.verificationVerdict,
      verificationQueueAttemptId: chain.verificationQueueAttemptId,
    }
    const candidateEntered = deferred()
    const candidateGate = deferred()
    const resolveCandidate = vi.fn(async (changeQueueWorkId, verificationQueueWorkId) => {
      expect(changeQueueWorkId).toBe(chain.changeQueueWorkId)
      expect(verificationQueueWorkId).toBe(chain.verificationQueueWorkId)
      candidateEntered.resolve()
      await candidateGate.promise
      return resolvedCandidate
    })
    const resolveEvidence = vi.fn(async (evidenceId: EvidenceId) => resolveStoredEvidence(harness, evidenceId))
    const decisionRequest = {
      idempotencyKey: 'accept-packet-fixture-v1',
      packetId: packet.id,
      changeBindingId: chain.changeBinding.id,
      verificationBindingId: chain.verificationBinding.id,
      decision: 'accepted' as const,
      reason: 'The verified outcome is acceptable.',
      actorId: 'developer-fixture',
      decisionNonce: 'accept-packet-fixture-v1',
    }
    const firstDecision = harness.delivery.recordAcceptanceDecision(
      decisionRequest,
      resolveCandidate,
      resolveEvidence,
    )
    await candidateEntered.promise
    const replayCandidateResolver = vi.fn(async () => {
      throw new Error('a concurrent exact replay must not resolve Queue again')
    })
    const replayEvidenceResolver = vi.fn(async () => {
      throw new Error('a concurrent exact replay must not reread evidence')
    })
    const replayedDecision = harness.delivery.recordAcceptanceDecision(
      decisionRequest,
      replayCandidateResolver,
      replayEvidenceResolver,
    )
    candidateGate.resolve()
    const [decision, decisionReplay] = await Promise.all([firstDecision, replayedDecision])
    expect(decisionReplay).toEqual(decision)
    expect(replayCandidateResolver).not.toHaveBeenCalled()
    expect(replayEvidenceResolver).not.toHaveBeenCalled()
    expect(resolveCandidate).toHaveBeenCalledTimes(1)
    expect(resolveEvidence).toHaveBeenCalledTimes(chain.evidenceRefs.length)
    expect(harness.delivery.snapshot().acceptanceDecisions).toEqual([decision])
    const conflictingCandidateResolver = vi.fn(async () => { throw new Error('conflict must fail before Queue') })
    const conflictingEvidenceResolver = vi.fn(async () => { throw new Error('conflict must fail before evidence') })
    await expect(harness.delivery.recordAcceptanceDecision({
      ...decisionRequest,
      reason: 'A conflicting human reason.',
    }, conflictingCandidateResolver, conflictingEvidenceResolver))
      .rejects.toMatchObject({ code: 'idempotency-conflict' })
    expect(conflictingCandidateResolver).not.toHaveBeenCalled()
    expect(conflictingEvidenceResolver).not.toHaveBeenCalled()

    const conflictEntered = deferred()
    const conflictGate = deferred()
    const concurrentDecisionRequest = {
      ...decisionRequest,
      idempotencyKey: 'accept-concurrent-conflict-v1',
      decisionNonce: 'accept-concurrent-conflict-v1',
    }
    const winningCandidateResolver = vi.fn(async () => {
      conflictEntered.resolve()
      await conflictGate.promise
      return resolvedCandidate
    })
    const winningDecision = harness.delivery.recordAcceptanceDecision(
      concurrentDecisionRequest,
      winningCandidateResolver,
      resolveEvidence,
    )
    await conflictEntered.promise
    const losingCandidateResolver = vi.fn(async () => {
      throw new Error('a concurrent conflict must not resolve Queue')
    })
    const losingEvidenceResolver = vi.fn(async () => {
      throw new Error('a concurrent conflict must not read evidence')
    })
    const losingDecision = harness.delivery.recordAcceptanceDecision({
      ...concurrentDecisionRequest,
      reason: 'A concurrently conflicting human reason.',
    }, losingCandidateResolver, losingEvidenceResolver)
    const losingDecisionExpectation = expect(losingDecision)
      .rejects.toMatchObject({ code: 'idempotency-conflict' })
    conflictGate.resolve()
    await Promise.all([
      expect(winningDecision).resolves.toMatchObject({ reason: concurrentDecisionRequest.reason }),
      losingDecisionExpectation,
    ])
    expect(winningCandidateResolver).toHaveBeenCalledTimes(1)
    expect(losingCandidateResolver).not.toHaveBeenCalled()
    expect(losingEvidenceResolver).not.toHaveBeenCalled()

    const retryDecisionRequest = {
      ...decisionRequest,
      idempotencyKey: 'accept-resolver-retry-v1',
      decisionNonce: 'accept-resolver-retry-v1',
    }
    const failingCandidateResolver = vi.fn(async () => {
      await Promise.resolve()
      throw new Error('scripted Queue result failure')
    })
    await expect(harness.delivery.recordAcceptanceDecision(
      retryDecisionRequest,
      failingCandidateResolver,
      resolveEvidence,
    )).rejects.toThrow('scripted Queue result failure')
    expect(failingCandidateResolver).toHaveBeenCalledTimes(1)
    await expect(harness.delivery.recordAcceptanceDecision(
      retryDecisionRequest,
      async () => resolvedCandidate,
      resolveEvidence,
    )).resolves.toMatchObject({ reason: retryDecisionRequest.reason })

    await expect(harness.delivery.recordAcceptanceDecision({
      ...decisionRequest,
      idempotencyKey: 'reject-unpassed-fixture-v1',
    }, async () => ({
      completionClaim: chain.completionClaim,
      changeQueueAttemptId: chain.changeQueueAttemptId,
      verificationIntent: chain.verificationIntent,
      verificationVerdict: passedVerdictFixture({
        packetId: packet.id,
        baseCommit: packet.baseCommit,
        targetCommit: TARGET_COMMIT,
        verificationPlanDigest: packet.verificationPlan.digest,
        status: 'failed',
      }),
      verificationQueueAttemptId: chain.verificationQueueAttemptId,
    }), resolveEvidence)).rejects.toMatchObject({ code: 'acceptance-denied' })
    await harness.dispose()
  })

  it('rejects every broken link in the bound change-to-verification authority chain', async () => {
    const harness = await mountDeliveryTestkit(new Context())
    const { packet } = await createStoredPacket(harness)
    const chain = await createAcceptanceChain(harness, packet)
    const request = {
      idempotencyKey: 'candidate-case',
      packetId: packet.id,
      changeBindingId: chain.changeBinding.id,
      verificationBindingId: chain.verificationBinding.id,
      decision: 'accepted' as const,
      reason: 'Only the exact independently verified checkpoint may be accepted.',
      actorId: 'developer-fixture',
      decisionNonce: 'candidate-case',
    }
    const candidate = {
      completionClaim: chain.completionClaim,
      changeQueueAttemptId: chain.changeQueueAttemptId,
      verificationIntent: chain.verificationIntent,
      verificationVerdict: chain.verificationVerdict,
      verificationQueueAttemptId: chain.verificationQueueAttemptId,
    }
    const resolveEvidence = async (evidenceId: EvidenceId) => resolveStoredEvidence(harness, evidenceId)
    const verificationCheck = chain.verificationVerdict.checkResults[0]
    if (verificationCheck === undefined) throw new Error('acceptance chain has no verification check')
    const cases = [
      {
        name: 'claim Queue Work',
        candidate: { ...candidate, completionClaim: completedClaimFixture({
          packetId: packet.id,
          queueWorkId: QueueWorkIdRef('queue-work-unbound-change'),
          checkpointCommit: TARGET_COMMIT,
        }) },
        code: 'invalid-reference',
      },
      {
        name: 'claim disposition',
        candidate: { ...candidate, completionClaim: completionClaimSchema.parse({
          ...chain.completionClaim,
          disposition: 'blocked',
          blocker: 'The executor stopped.',
          nextSmallestAction: 'Resume the change.',
          checkpointCommit: null,
        }) },
        code: 'acceptance-denied',
      },
      {
        name: 'change Attempt',
        candidate: {
          ...candidate,
          changeQueueAttemptId: QueueAttemptIdRef('queue-attempt-unbound-change'),
        },
        code: 'invalid-reference',
      },
      {
        name: 'verification target',
        candidate: { ...candidate, verificationIntent: {
          ...chain.verificationIntent,
          targetCommit: OTHER_COMMIT,
        } },
        code: 'invalid-reference',
      },
      {
        name: 'verification plan',
        candidate: { ...candidate, verificationIntent: {
          ...chain.verificationIntent,
          verificationPlanDigest: canonicalDigest('untrusted-plan'),
        } },
        code: 'invalid-reference',
      },
      {
        name: 'verdict target',
        candidate: { ...candidate, verificationVerdict: passedVerdictFixture({
          packetId: packet.id,
          baseCommit: packet.baseCommit,
          targetCommit: OTHER_COMMIT,
          verificationPlanDigest: packet.verificationPlan.digest,
        }) },
        code: 'invalid-reference',
      },
      {
        name: 'verdict base',
        candidate: { ...candidate, verificationVerdict: passedVerdictFixture({
          packetId: packet.id,
          baseCommit: OTHER_COMMIT,
          targetCommit: TARGET_COMMIT,
          verificationPlanDigest: packet.verificationPlan.digest,
        }) },
        code: 'invalid-reference',
      },
    ] as const

    for (const [index, testCase] of cases.entries()) {
      await expect(harness.delivery.recordAcceptanceDecision({
        ...request,
        idempotencyKey: `candidate-case-${String(index)}`,
        decisionNonce: `candidate-case-${String(index)}`,
      }, async () => testCase.candidate, resolveEvidence)).rejects.toMatchObject({ code: testCase.code })
    }

    await expect(harness.delivery.recordAcceptanceDecision({
      ...request,
      idempotencyKey: 'candidate-missing-evidence',
      decisionNonce: 'candidate-missing-evidence',
    }, async () => candidate, async () => undefined)).rejects.toMatchObject({ code: 'acceptance-denied' })

    await expect(harness.delivery.recordAcceptanceDecision({
      ...request,
      idempotencyKey: 'candidate-wrong-verification-attempt',
      decisionNonce: 'candidate-wrong-verification-attempt',
    }, async () => ({
      ...candidate,
      verificationQueueAttemptId: QueueAttemptIdRef('queue-attempt-unbound-verification'),
    }), resolveEvidence)).rejects.toMatchObject({ code: 'acceptance-denied' })

    const wrongEvidenceById = new Map(chain.evidenceRefs.map((reference, index) => [
      reference.id,
      index === 0
        ? reference
        : evidenceRefFixture({
          ...reference,
          provenance: {
            kind: 'verification-check',
            packetId: packet.id,
            queueWorkId: QueueWorkIdRef('queue-work-unbound-verification'),
            queueAttemptId: QueueAttemptIdRef('queue-attempt-unbound-verification'),
            checkId: verificationCheck.checkId,
          },
        }),
    ]))
    await expect(harness.delivery.recordAcceptanceDecision({
      ...request,
      idempotencyKey: 'candidate-wrong-evidence-provenance',
      decisionNonce: 'candidate-wrong-evidence-provenance',
    }, async () => candidate, async evidenceId => wrongEvidenceById.get(evidenceId)))
      .rejects.toMatchObject({ code: 'acceptance-denied' })

    await expect(harness.delivery.recordAcceptanceDecision({
      ...request,
      idempotencyKey: 'candidate-unbound-id',
      decisionNonce: 'candidate-unbound-id',
      verificationBindingId: DispatchBindingId('binding-not-present'),
    }, async () => candidate, resolveEvidence)).rejects.toMatchObject({ code: 'not-found' })
    await expect(harness.delivery.recordAcceptanceDecision({
      ...request,
      idempotencyKey: 'candidate-wrong-kind',
      decisionNonce: 'candidate-wrong-kind',
      verificationBindingId: chain.changeBinding.id,
    }, async () => candidate, resolveEvidence)).rejects.toMatchObject({ code: 'invalid-reference' })

    const corruptibleEvidence = chain.evidenceRefs[1]
    if (corruptibleEvidence === undefined) throw new Error('acceptance chain has no verification evidence')
    harness.deliveryEvidence.corrupt(
      corruptibleEvidence.id,
      new Uint8Array(corruptibleEvidence.byteLength).fill(0),
    )
    await expect(harness.delivery.recordAcceptanceDecision({
      ...request,
      idempotencyKey: 'candidate-corrupt-evidence',
      decisionNonce: 'candidate-corrupt-evidence',
    }, async () => candidate, resolveEvidence)).rejects.toMatchObject({ code: 'digest-mismatch' })
    expect(harness.delivery.snapshot().acceptanceDecisions).toEqual([])
    await harness.dispose()
  })
})

describe('FakeRepositoryWorkspace contract', () => {
  it('resolves point-in-time Contract bases and reads exact bounded Git blobs with fresh bytes', async () => {
    const harness = await mountDeliveryTestkit(new Context())
    const repo = harness.repoWorkspace
    repo.allowRevision(REPOSITORY_ID, BASE_COMMIT)
    const commitBase = await repo.resolveBase({
      repositoryId: REPOSITORY_ID,
      selectionRule: { kind: 'commit', commit: BASE_COMMIT },
    })
    expect(commitBase).toMatchObject({
      repositoryId: REPOSITORY_ID,
      commit: BASE_COMMIT,
      selectionRule: { kind: 'commit', commit: BASE_COMMIT },
    })
    expect(Object.isFrozen(commitBase)).toBe(true)
    expect(Object.isFrozen(commitBase.selectionRule)).toBe(true)

    const ref = 'refs/heads/delivery-ready'
    repo.allowBaseRef(REPOSITORY_ID, ref, TARGET_COMMIT)
    const refBase = await repo.resolveBase({
      repositoryId: REPOSITORY_ID,
      selectionRule: { kind: 'ref-head', ref },
    })
    repo.allowBaseRef(REPOSITORY_ID, ref, OTHER_COMMIT)
    expect(refBase).toMatchObject({
      repositoryId: REPOSITORY_ID,
      commit: TARGET_COMMIT,
      selectionRule: { kind: 'ref-head', ref },
    })
    expect((await repo.resolveBase({
      repositoryId: REPOSITORY_ID,
      selectionRule: { kind: 'ref-head', ref },
    })).commit).toBe(OTHER_COMMIT)

    const authoritativeBytes = new Uint8Array([1, 2, 3])
    repo.allowBlob({
      repositoryId: REPOSITORY_ID,
      commit: TARGET_COMMIT,
      path: PLAN_PATH,
      blobId: BLOB_ID,
      bytes: authoritativeBytes,
    })
    authoritativeBytes[0] = 9
    const first = await repo.readBlob({ base: refBase, path: PLAN_PATH, maxBytes: 3 })
    expect(first).toMatchObject({
      repositoryId: REPOSITORY_ID,
      commit: TARGET_COMMIT,
      path: PLAN_PATH,
      blobId: BLOB_ID,
    })
    expect([...first.bytes]).toEqual([1, 2, 3])
    expect(Object.isFrozen(first)).toBe(true)
    first.bytes[1] = 9
    expect([...(await repo.readBlob({ base: refBase, path: PLAN_PATH, maxBytes: 3 })).bytes])
      .toEqual([1, 2, 3])

    await expect(repo.readBlob({ base: refBase, path: PLAN_PATH, maxBytes: 2 }))
      .rejects.toMatchObject({ code: 'blob-too-large' })
    await expect(repo.readBlob({ base: refBase, path: PLAN_PATH, maxBytes: 0 }))
      .rejects.toThrow(/positive safe integer/u)
    await expect(repo.readBlob({
      base: refBase,
      path: RepositoryRelativePath('.dsh/missing.json'),
      maxBytes: 3,
    })).rejects.toMatchObject({ code: 'blob-not-found' })
    await expect(repo.resolveBase({
      repositoryId: REPOSITORY_ID,
      selectionRule: { kind: 'ref-head', ref: 'refs/heads/missing' },
    })).rejects.toMatchObject({ code: 'reference-not-found' })

    const controller = new AbortController()
    controller.abort()
    await expect(repo.resolveBase({
      repositoryId: REPOSITORY_ID,
      selectionRule: { kind: 'commit', commit: BASE_COMMIT },
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(repo.readBlob({
      base: refBase,
      path: PLAN_PATH,
      maxBytes: 3,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    await harness.dispose()
  })

  it('opens from an exact inspected revision and isolates one workspace purpose per Attempt owner', async () => {
    const harness = await mountDeliveryTestkit(new Context())
    const repo = harness.repoWorkspace
    repo.allowRevision(REPOSITORY_ID, BASE_COMMIT)
    repo.allowRevision(REPOSITORY_ID, TARGET_COMMIT)
    const base = await repo.inspectRevision({ repositoryId: REPOSITORY_ID, commit: BASE_COMMIT })
    const target = await repo.inspectRevision({ repositoryId: REPOSITORY_ID, commit: TARGET_COMMIT })
    const owner = QueueAttemptIdRef('change-owner-fixture')
    repo.queueChangeWorkspace({
      cwd: '/tmp/delivery-change-fixture',
      checkpoint: {
        repositoryId: REPOSITORY_ID,
        baseCommit: BASE_COMMIT,
        checkpointCommit: TARGET_COMMIT,
        changedPaths: [RepositoryRelativePath('packages/delivery/example.ts')],
        clean: true,
        descendsFromBase: true,
      },
    })
    const lease = await repo.openChange({ ownerAttemptId: owner, base })
    expect(await repo.openChange({ ownerAttemptId: owner, base })).toBe(lease)
    expect(lease).toBeInstanceOf(FakeChangeWorkspaceLease)
    await expect(lease.checkpoint({ message: 'test: governed checkpoint' })).resolves.toMatchObject({
      checkpointCommit: TARGET_COMMIT,
      clean: true,
    })
    await expect(repo.openVerification({ ownerAttemptId: owner, base, target })).rejects.toMatchObject({
      code: 'owner-conflict',
    })
    await lease.close('remove')
    await lease.close('remove')
    if (!(lease instanceof FakeChangeWorkspaceLease)) throw new Error('expected a fake change lease')
    expect(lease.closeCalls).toEqual(['remove'])

    const cleanupError = new Error('scripted cleanup failure')
    repo.queueChangeWorkspace({
      cwd: '/tmp/delivery-cleanup-failure',
      checkpoint: {
        repositoryId: REPOSITORY_ID,
        baseCommit: BASE_COMMIT,
        checkpointCommit: OTHER_COMMIT,
        changedPaths: [],
        clean: true,
        descendsFromBase: true,
      },
      closeError: cleanupError,
    })
    const failing = await repo.openChange({
      ownerAttemptId: QueueAttemptIdRef('cleanup-owner-fixture'),
      base,
    })
    await expect(failing.close('preserve')).rejects.toBe(cleanupError)
    if (!(failing instanceof FakeChangeWorkspaceLease)) throw new Error('expected a fake change lease')
    expect(failing.closeCalls).toEqual(['preserve'])
    await harness.dispose()
  })
})

describe('FakeDeliveryEvidence contract', () => {
  it('binds provenance, detaches bytes, deduplicates exact envelopes, and detects corruption', async () => {
    const harness = await mountDeliveryTestkit(new Context())
    const evidence = harness.deliveryEvidence
    const provenance = {
      kind: 'change-attempt' as const,
      packetId: readyWorkPacketFixture().id,
      queueWorkId: QueueWorkIdRef('queue-work-evidence'),
      queueAttemptId: QueueAttemptIdRef('queue-attempt-evidence'),
    }
    const boundPacketId = provenance.packetId
    const writer = evidence.bind(provenance)
    provenance.packetId = WorkPacketId('mutated-after-bind')
    const input = new Uint8Array([1, 2, 3])
    const ref = await writer.save({ kind: 'log', mediaType: 'text/plain', data: input })
    input[0] = 9
    expect(ref.provenance).toMatchObject({ packetId: boundPacketId })
    expect(ref.provenance).not.toMatchObject({ packetId: provenance.packetId })
    expect(await writer.save({
      kind: 'log',
      mediaType: 'text/plain',
      data: new Uint8Array([1, 2, 3]),
    })).toEqual(ref)

    const resolved = await evidence.resolve(ref.id)
    expect(resolved).toEqual(ref)
    expect(resolved).not.toBe(ref)
    if (resolved === undefined) throw new Error('saved evidence did not resolve')
    expect(resolved.provenance).not.toBe(ref.provenance)
    expect(Reflect.set(resolved.provenance, 'packetId', WorkPacketId('mutated-resolved-ref'))).toBe(true)
    const resolvedAgain = await evidence.resolve(ref.id)
    expect(resolvedAgain).toEqual(ref)
    expect(resolvedAgain?.provenance).not.toBe(resolved.provenance)

    const firstRead = await evidence.read(ref)
    expect([...firstRead.data]).toEqual([1, 2, 3])
    firstRead.data[1] = 9
    expect([...(await evidence.read(ref)).data]).toEqual([1, 2, 3])

    evidence.corrupt(ref.id, new Uint8Array([1, 8, 3]))
    await expect(evidence.read(ref)).rejects.toMatchObject({ code: 'digest-mismatch' })

    const controller = new AbortController()
    controller.abort()
    await expect(evidence.resolve(ref.id, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    evidence.remove(ref.id)
    await expect(evidence.resolve(ref.id)).resolves.toBeUndefined()
    await harness.dispose()
  })
})
