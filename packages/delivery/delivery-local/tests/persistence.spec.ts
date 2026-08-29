import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AdoptContractRevisionRequest,
  ContractRevisionDraft,
  CreateWorkPacketRequest,
  SourceRefDraft,
  WorkPacketDraft,
} from '@deepseek-ai/dsh-delivery'
import { DELIVERY_VERIFICATION_SOURCE_MAX_BYTES } from '@deepseek-ai/dsh-delivery'
import {
  GitBlobId,
  ExecutorId,
  EvidenceId,
  GitCommitId,
  AcceptanceClauseId,
  ContractRevisionId,
  DispatchBindingId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryId,
  RepositoryRelativePath,
  canonicalDigest,
  type ContractRevision,
  type WorkPacket,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  contractRevisionFixture,
  completedClaimFixture,
  evidenceRefFixture,
  passedVerdictFixture,
  readyWorkPacketFixture,
  sourceRefFixture,
} from '../../delivery-testkit/src/fixtures.ts'
import {
  MemoryMediaPool,
  MemoryStorageBackend,
} from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import LocalDelivery from '../src/index.ts'

interface Harness {
  readonly ctx: Context
  dispose(): Promise<void>
}

const active: Harness[] = []

afterEach(async () => {
  await Promise.all(active.splice(0).map(harness => harness.dispose()))
})

async function harness(pool: MemoryMediaPool): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(LocalDelivery)
  const result = {
    ctx,
    dispose: async () => { await ctx.fiber.dispose() },
  }
  active.push(result)
  return result
}

function adoptionRequest(
  contract: ContractRevision,
  idempotencyKey = 'adopt-contract-local-v1',
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

async function storedPacket(local: Harness, suffix: string): Promise<WorkPacket> {
  const contract = await local.ctx.delivery.adoptContractRevision(
    adoptionRequest(contractRevisionFixture(), `adopt-${suffix}`),
  )
  if (contract.repositoryId === null || contract.baseSelectionRule?.kind !== 'commit') {
    throw new Error('ready Contract fixture unexpectedly lacks repository authority')
  }
  const fixture = readyWorkPacketFixture({
    contractRevisionId: contract.id,
    repositoryId: contract.repositoryId,
    baseCommit: contract.baseSelectionRule.commit,
    acceptanceClauseIds: contract.acceptanceClauses.map(clause => clause.id),
  })
  return await local.ctx.delivery.createWorkPacket({
    idempotencyKey: `packet-${suffix}`,
    contractRevisionId: contract.id,
    repository: {
      repositoryId: contract.repositoryId,
      selectionRule: contract.baseSelectionRule,
      commit: fixture.baseCommit,
    } as never,
    packet: packetDraft(fixture),
  })
}

async function acceptanceChain(local: Harness, suffix: string) {
  const packet = await storedPacket(local, suffix)
  const targetCommit = GitCommitId('2222222222222222222222222222222222222222')
  const changeQueueWorkId = QueueWorkIdRef(`queue-work-change-${suffix}`)
  const changeBinding = await local.ctx.delivery.bindDispatch({
    bindingId: (await local.ctx.delivery.beginDispatch({
      idempotencyKey: `change-${suffix}`,
      packetId: packet.id,
      kind: 'code.change@1',
      executorId: ExecutorId('codex'),
      inputDigest: canonicalDigest({ packetId: packet.id }),
    })).id,
    queueWorkId: changeQueueWorkId,
  })
  const verificationIntent = {
    packetId: packet.id,
    targetCommit,
    verificationPlanDigest: packet.verificationPlan.digest,
  }
  const verificationQueueWorkId = QueueWorkIdRef(`queue-work-verify-${suffix}`)
  const verificationBinding = await local.ctx.delivery.bindDispatch({
    bindingId: (await local.ctx.delivery.beginDispatch({
      idempotencyKey: `verify-${suffix}`,
      packetId: packet.id,
      kind: 'code.verify@1',
      inputDigest: canonicalDigest(verificationIntent),
    })).id,
    queueWorkId: verificationQueueWorkId,
  })
  const changeQueueAttemptId = QueueAttemptIdRef(`queue-attempt-change-${suffix}`)
  const verificationQueueAttemptId = QueueAttemptIdRef(`queue-attempt-verify-${suffix}`)
  const changeEvidenceId = EvidenceId(`evidence-change-${suffix}`)
  const verificationEvidenceId = EvidenceId(`evidence-verify-${suffix}`)
  const completionClaim = completedClaimFixture({
    packetId: packet.id,
    queueWorkId: changeQueueWorkId,
    queueAttemptId: changeQueueAttemptId,
    checkpointCommit: targetCommit,
    evidenceIds: [changeEvidenceId],
  })
  const initialVerdict = passedVerdictFixture({
    packetId: packet.id,
    baseCommit: packet.baseCommit,
    targetCommit,
    verificationPlanDigest: packet.verificationPlan.digest,
    evidenceIds: [changeEvidenceId, verificationEvidenceId],
  })
  const verificationVerdict = passedVerdictFixture({
    ...initialVerdict,
    checkResults: initialVerdict.checkResults.map(result => ({
      ...result,
      evidenceIds: [verificationEvidenceId],
    })),
    evidenceIntegrityFindings: [changeEvidenceId, verificationEvidenceId].map(evidenceId => ({
      evidenceId,
      required: true,
      status: 'verified' as const,
    })),
  })
  const evidence = new Map([
    [changeEvidenceId, evidenceRefFixture({
      id: changeEvidenceId,
      provenance: {
        kind: 'change-attempt',
        packetId: packet.id,
        queueWorkId: changeQueueWorkId,
        queueAttemptId: changeQueueAttemptId,
      },
    })],
    [verificationEvidenceId, evidenceRefFixture({
      id: verificationEvidenceId,
      kind: 'verification-output',
      provenance: {
        kind: 'verification-check',
        packetId: packet.id,
        queueWorkId: verificationQueueWorkId,
        queueAttemptId: verificationQueueAttemptId,
        checkId: packet.verificationPlan.checks[0]!.id,
      },
    })],
  ])
  return {
    packet,
    changeBinding,
    verificationBinding,
    candidate: {
      completionClaim,
      changeQueueAttemptId,
      verificationIntent,
      verificationVerdict,
      verificationQueueAttemptId,
    },
    evidence,
  }
}

describe('LocalDelivery persistence', () => {
  it('reopens an adopted Contract revision from durable storage', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    const request = adoptionRequest(contractRevisionFixture())
    const stored = await first.ctx.delivery.adoptContractRevision(request)
    await first.dispose()
    active.splice(active.indexOf(first), 1)

    const reopened = await harness(pool)
    expect(reopened.ctx.delivery.getContractRevision(stored.id)).toEqual(stored)
    await expect(reopened.ctx.delivery.adoptContractRevision(request)).resolves.toEqual(stored)
    await expect(reopened.ctx.delivery.adoptContractRevision({
      ...request,
      revision: { ...request.revision, context: 'conflicting context after restart' },
    })).rejects.toMatchObject({ code: 'idempotency-conflict' })
  })

  it('enforces durable adoption idempotency', async () => {
    const local = await harness(new MemoryMediaPool())
    const request = adoptionRequest(contractRevisionFixture())
    const first = await local.ctx.delivery.adoptContractRevision(request)

    await expect(local.ctx.delivery.adoptContractRevision(request)).resolves.toEqual(first)
    await expect(local.ctx.delivery.adoptContractRevision({
      ...request,
      revision: { ...request.revision, context: 'different contract context' },
    })).rejects.toMatchObject({
      code: 'idempotency-conflict',
      name: 'DeliveryError',
    })
  })

  it('serializes concurrent adoption replays on one idempotency key', async () => {
    const local = await harness(new MemoryMediaPool())
    const request = adoptionRequest(contractRevisionFixture(), 'adopt-concurrent-local-v1')

    const [first, replay] = await Promise.all([
      local.ctx.delivery.adoptContractRevision(request),
      local.ctx.delivery.adoptContractRevision(request),
    ])

    expect(replay).toEqual(first)
    expect(local.ctx.delivery.snapshot().contractRevisions).toEqual([first])
  })

  it('rejects invalid source digests and cross-Issue revision lineage', async () => {
    const local = await harness(new MemoryMediaPool())
    const firstFixture = contractRevisionFixture()
    const first = await local.ctx.delivery.adoptContractRevision(adoptionRequest(firstFixture, 'lineage-first'))
    const badDigest = adoptionRequest(firstFixture, 'lineage-bad-digest')
    await expect(local.ctx.delivery.adoptContractRevision({
      ...badDigest,
      source: { ...badDigest.source, contentDigest: canonicalDigest('wrong source') },
    })).rejects.toMatchObject({ code: 'invalid-reference' })
    const missingPrevious = adoptionRequest(contractRevisionFixture({
      previousRevisionId: ContractRevisionId('missing-contract-revision'),
    }), 'lineage-missing')
    await expect(local.ctx.delivery.adoptContractRevision(missingPrevious))
      .rejects.toMatchObject({ code: 'invalid-reference' })

    const sourceCases = [
      sourceRefFixture({ repository: { owner: 'other-owner', name: first.sourceRef.repository.name } }),
      sourceRefFixture({ repository: { owner: first.sourceRef.repository.owner, name: 'other-repository' } }),
      sourceRefFixture({ issueNumber: first.sourceRef.issueNumber + 1 }),
    ]
    for (const [index, sourceRef] of sourceCases.entries()) {
      const request = adoptionRequest(contractRevisionFixture({
        previousRevisionId: first.id,
        sourceRef,
      }), `lineage-other-${String(index)}`)
      await expect(local.ctx.delivery.adoptContractRevision(request))
        .rejects.toMatchObject({ code: 'invalid-reference' })
    }
    const sameIssue = sourceRefFixture({
      id: first.sourceRef.id,
      repository: first.sourceRef.repository,
      issueNumber: first.sourceRef.issueNumber,
      title: 'Updated delivery title',
      body: 'Updated delivery body',
    })
    await expect(local.ctx.delivery.adoptContractRevision(adoptionRequest(contractRevisionFixture({
      previousRevisionId: first.id,
      sourceRef: sameIssue,
    }), 'lineage-same-issue'))).resolves.toMatchObject({ previousRevisionId: first.id })
  })

  it('reopens a Packet with its Contract-derived verification plan', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    const contract = await first.ctx.delivery.adoptContractRevision(
      adoptionRequest(contractRevisionFixture()),
    )
    if (contract.repositoryId === null || contract.baseSelectionRule === null) {
      throw new Error('ready Contract fixture unexpectedly lacks repository authority')
    }
    const fixture = readyWorkPacketFixture({
      contractRevisionId: contract.id,
      repositoryId: contract.repositoryId,
      baseCommit: contract.baseSelectionRule.kind === 'commit'
        ? contract.baseSelectionRule.commit
        : undefined,
      acceptanceClauseIds: contract.acceptanceClauses.map(clause => clause.id),
    })
    const packetRequest = {
      idempotencyKey: 'create-packet-local-v1',
      contractRevisionId: contract.id,
      repository: {
        repositoryId: contract.repositoryId,
        selectionRule: contract.baseSelectionRule,
        commit: fixture.baseCommit,
      } as never,
      packet: packetDraft(fixture),
    }
    const [packet, packetReplay] = await Promise.all([
      first.ctx.delivery.createWorkPacket(packetRequest),
      first.ctx.delivery.createWorkPacket(packetRequest),
    ])
    expect(packetReplay).toEqual(packet)
    await first.dispose()
    active.splice(active.indexOf(first), 1)

    const reopened = await harness(pool)
    expect(reopened.ctx.delivery.getWorkPacket(packet.id)).toEqual(packet)
    await expect(reopened.ctx.delivery.createWorkPacket(
      packetRequest,
      async () => { throw new Error('durable replay must not resolve the plan blob') },
    )).resolves.toEqual(packet)
    await expect(reopened.ctx.delivery.createWorkPacket({
      ...packetRequest,
      packet: { ...packetRequest.packet, objective: 'conflicting objective after restart' },
    })).rejects.toMatchObject({ code: 'idempotency-conflict' })
    expect(packet.verificationPlan.provenance).toEqual({
      kind: 'contract-field',
      contractRevisionId: contract.id,
      field: 'verificationSource',
    })
  })

  it('rejects Packet creation outside the ready Contract authority', async () => {
    const local = await harness(new MemoryMediaPool())
    const baseCommit = GitCommitId('1111111111111111111111111111111111111111')
    const otherCommit = GitCommitId('3333333333333333333333333333333333333333')
    const repositoryId = RepositoryId('repository-fixture')
    const packetFixture = readyWorkPacketFixture()
    await expect(local.ctx.delivery.createWorkPacket({
      idempotencyKey: 'packet-missing-contract',
      contractRevisionId: ContractRevisionId('missing-contract'),
      repository: {
        repositoryId,
        selectionRule: { kind: 'commit', commit: baseCommit },
        commit: baseCommit,
      } as never,
      packet: packetDraft(packetFixture),
    })).rejects.toMatchObject({ code: 'not-found' })

    const notReady = await local.ctx.delivery.adoptContractRevision(adoptionRequest(
      contractRevisionFixture({ outcome: null }),
      'packet-not-ready-contract',
    ))
    if (notReady.repositoryId === null || notReady.baseSelectionRule?.kind !== 'commit') {
      throw new Error('not-ready fixture unexpectedly lacks repository fields')
    }
    await expect(local.ctx.delivery.createWorkPacket({
      idempotencyKey: 'packet-not-ready',
      contractRevisionId: notReady.id,
      repository: {
        repositoryId: notReady.repositoryId,
        selectionRule: notReady.baseSelectionRule,
        commit: notReady.baseSelectionRule.commit,
      } as never,
      packet: packetDraft(packetFixture),
    })).rejects.toMatchObject({ code: 'invalid-reference' })

    const ready = await local.ctx.delivery.adoptContractRevision(adoptionRequest(
      contractRevisionFixture(),
      'packet-ready-contract',
    ))
    if (ready.repositoryId === null || ready.baseSelectionRule?.kind !== 'commit') {
      throw new Error('ready fixture unexpectedly lacks repository fields')
    }
    const readyFixture = readyWorkPacketFixture({
      contractRevisionId: ready.id,
      repositoryId: ready.repositoryId,
      baseCommit: ready.baseSelectionRule.commit,
      acceptanceClauseIds: ready.acceptanceClauses.map(clause => clause.id),
    })
    const validRepository: CreateWorkPacketRequest['repository'] = {
      repositoryId: ready.repositoryId,
      selectionRule: ready.baseSelectionRule,
      commit: ready.baseSelectionRule.commit,
    } as never
    const valid: CreateWorkPacketRequest = {
      idempotencyKey: 'packet-authority-valid',
      contractRevisionId: ready.id,
      repository: validRepository,
      packet: packetDraft(readyFixture),
    }
    await expect(local.ctx.delivery.createWorkPacket({
      ...valid,
      idempotencyKey: 'packet-wrong-repository',
      repository: { ...valid.repository, repositoryId: RepositoryId('other-repository') },
    })).rejects.toMatchObject({ code: 'invalid-reference' })
    await expect(local.ctx.delivery.createWorkPacket({
      ...valid,
      idempotencyKey: 'packet-wrong-selection',
      repository: {
        ...valid.repository,
        selectionRule: { kind: 'commit', commit: otherCommit },
        commit: otherCommit,
      },
    })).rejects.toMatchObject({ code: 'invalid-reference' })
    await expect(local.ctx.delivery.createWorkPacket({
      ...valid,
      idempotencyKey: 'packet-wrong-clause',
      packet: {
        ...valid.packet,
        acceptanceClauseIds: [AcceptanceClauseId('outside-contract')],
      },
    })).rejects.toMatchObject({ code: 'invalid-reference' })
    const firstPacket = await local.ctx.delivery.createWorkPacket(valid)
    await expect(local.ctx.delivery.createWorkPacket(valid)).resolves.toEqual(firstPacket)
    const crossOperationKey = 'packet-dispatch-concurrent-cross-operation'
    const crossOperationResults = await Promise.allSettled([
      local.ctx.delivery.createWorkPacket({
        ...valid,
        idempotencyKey: crossOperationKey,
      }),
      local.ctx.delivery.beginDispatch({
        idempotencyKey: crossOperationKey,
        packetId: firstPacket.id,
        kind: 'code.verify@1',
        inputDigest: canonicalDigest({ packetId: firstPacket.id, concurrent: true }),
      }),
    ])
    expect(crossOperationResults[0]).toMatchObject({ status: 'fulfilled' })
    expect(crossOperationResults[1]).toMatchObject({
      status: 'rejected',
      reason: { code: 'idempotency-conflict' },
    })
    await expect(local.ctx.delivery.beginDispatch({
      idempotencyKey: valid.idempotencyKey,
      packetId: firstPacket.id,
      kind: 'code.verify@1',
      inputDigest: canonicalDigest({ packetId: firstPacket.id }),
    })).rejects.toMatchObject({ code: 'idempotency-conflict' })
    await expect(local.ctx.delivery.beginDispatch({
      idempotencyKey: '   ',
      packetId: firstPacket.id,
      kind: 'code.verify@1',
      inputDigest: canonicalDigest({ packetId: firstPacket.id }),
    })).rejects.toMatchObject({ code: 'idempotency-conflict' })
  })

  it('derives a Packet plan from the exact bounded Contract Git blob', async () => {
    const pool = new MemoryMediaPool()
    const local = await harness(pool)
    const original = contractRevisionFixture()
    if (original.verificationSource?.kind !== 'contract-field') {
      throw new Error('Contract fixture unexpectedly lacks inline checks')
    }
    const path = RepositoryRelativePath('.dsh/delivery-verification.json')
    const contract = await local.ctx.delivery.adoptContractRevision(adoptionRequest(
      contractRevisionFixture({
        verificationSource: { kind: 'git-blob', path, format: 'delivery-verification-plan@1' },
      }),
    ))
    if (contract.repositoryId === null || contract.baseSelectionRule?.kind !== 'commit') {
      throw new Error('ready Contract fixture unexpectedly lacks repository authority')
    }
    const fixture = readyWorkPacketFixture({
      contractRevisionId: contract.id,
      repositoryId: contract.repositoryId,
      baseCommit: contract.baseSelectionRule.commit,
      acceptanceClauseIds: contract.acceptanceClauses.map(clause => clause.id),
    })
    const bytes = new TextEncoder().encode(JSON.stringify({
      format: 'delivery-verification-plan@1',
      checks: original.verificationSource.checks,
    }))
    const resolveBlob = vi.fn(async (_request: unknown) => ({
      repositoryId: contract.repositoryId as NonNullable<ContractRevision['repositoryId']>,
      commit: contract.baseSelectionRule?.kind === 'commit' ? contract.baseSelectionRule.commit : fixture.baseCommit,
      path,
      blobId: GitBlobId('4444444444444444444444444444444444444444'),
      bytes,
    } as never))

    const packetRequest = {
      idempotencyKey: 'create-packet-git-blob-v1',
      contractRevisionId: contract.id,
      repository: {
        repositoryId: contract.repositoryId,
        selectionRule: contract.baseSelectionRule,
        commit: contract.baseSelectionRule.commit,
      } as never,
      packet: packetDraft(fixture),
    }
    const packet = await local.ctx.delivery.createWorkPacket(packetRequest, resolveBlob)

    expect(resolveBlob).toHaveBeenCalledOnce()
    expect(resolveBlob.mock.calls[0]?.[0]).toEqual({
      repository: {
        repositoryId: contract.repositoryId,
        selectionRule: contract.baseSelectionRule,
        commit: contract.baseSelectionRule.commit,
      },
      path,
      maxBytes: DELIVERY_VERIFICATION_SOURCE_MAX_BYTES,
    })
    expect(packet.verificationPlan.provenance).toEqual({
      kind: 'git-blob',
      baseCommit: contract.baseSelectionRule.commit,
      path,
      blobId: GitBlobId('4444444444444444444444444444444444444444'),
    })

    const exactLimitBytes = new Uint8Array(DELIVERY_VERIFICATION_SOURCE_MAX_BYTES)
    exactLimitBytes.fill(0x20)
    exactLimitBytes.set(bytes)
    await expect(local.ctx.delivery.createWorkPacket({
      idempotencyKey: 'create-packet-git-blob-exact-limit',
      contractRevisionId: contract.id,
      repository: {
        repositoryId: contract.repositoryId,
        selectionRule: contract.baseSelectionRule,
        commit: contract.baseSelectionRule.commit,
      } as never,
      packet: packetDraft(fixture),
    }, async () => ({
      repositoryId: contract.repositoryId,
      commit: fixture.baseCommit,
      path,
      blobId: GitBlobId('5555555555555555555555555555555555555555'),
      bytes: exactLimitBytes,
    } as never))).resolves.toMatchObject({
      verificationPlan: { checks: original.verificationSource.checks },
    })

    const multibyteDocument = JSON.stringify({
      format: 'delivery-verification-plan@1',
      checks: original.verificationSource.checks.map(check => ({
        ...check,
        name: '检查交付消费者',
      })),
    })
    const multibyteBytes = new TextEncoder().encode(multibyteDocument)
    expect(multibyteBytes.byteLength).toBeGreaterThan(multibyteDocument.length)
    await expect(local.ctx.delivery.createWorkPacket({
      idempotencyKey: 'create-packet-git-blob-multibyte',
      contractRevisionId: contract.id,
      repository: {
        repositoryId: contract.repositoryId,
        selectionRule: contract.baseSelectionRule,
        commit: contract.baseSelectionRule.commit,
      } as never,
      packet: packetDraft(fixture),
    }, async () => ({
      repositoryId: contract.repositoryId,
      commit: fixture.baseCommit,
      path,
      blobId: GitBlobId('6666666666666666666666666666666666666666'),
      bytes: multibyteBytes,
    } as never))).resolves.toMatchObject({
      verificationPlan: { checks: [{ name: '检查交付消费者' }] },
    })

    await local.dispose()
    active.splice(active.indexOf(local), 1)
    const reopened = await harness(pool)
    const replayResolver = vi.fn(async () => {
      throw new Error('durable Git-blob Packet replay must not resolve the plan blob')
    })
    await expect(reopened.ctx.delivery.createWorkPacket(packetRequest, replayResolver)).resolves.toEqual(packet)
    expect(replayResolver).not.toHaveBeenCalled()
  })

  it('rejects missing, mismatched, oversized, and malformed Contract Git blobs', async () => {
    const local = await harness(new MemoryMediaPool())
    const original = contractRevisionFixture()
    if (original.verificationSource?.kind !== 'contract-field') {
      throw new Error('Contract fixture unexpectedly lacks inline checks')
    }
    const path = RepositoryRelativePath('.dsh/delivery-verification.json')
    const otherPath = RepositoryRelativePath('.dsh/other-verification.json')
    const contract = await local.ctx.delivery.adoptContractRevision(adoptionRequest(
      contractRevisionFixture({
        verificationSource: { kind: 'git-blob', path, format: 'delivery-verification-plan@1' },
      }),
      'git-blob-errors-contract',
    ))
    if (contract.repositoryId === null || contract.baseSelectionRule?.kind !== 'commit') {
      throw new Error('ready Contract fixture unexpectedly lacks repository authority')
    }
    const fixture = readyWorkPacketFixture({
      contractRevisionId: contract.id,
      repositoryId: contract.repositoryId,
      baseCommit: contract.baseSelectionRule.commit,
      acceptanceClauseIds: contract.acceptanceClauses.map(clause => clause.id),
    })
    const baseRequest = {
      contractRevisionId: contract.id,
      repository: {
        repositoryId: contract.repositoryId,
        selectionRule: contract.baseSelectionRule,
        commit: contract.baseSelectionRule.commit,
      } as never,
      packet: packetDraft(fixture),
    }
    await expect(local.ctx.delivery.createWorkPacket({
      ...baseRequest,
      idempotencyKey: 'git-blob-missing-resolver',
    })).rejects.toMatchObject({ code: 'invalid-reference' })

    const validBytes = new TextEncoder().encode(JSON.stringify({
      format: 'delivery-verification-plan@1',
      checks: original.verificationSource.checks,
    }))
    const validBlob = {
      repositoryId: contract.repositoryId,
      commit: contract.baseSelectionRule.commit,
      path,
      blobId: GitBlobId('4444444444444444444444444444444444444444'),
      bytes: validBytes,
    }
    const mismatches = [
      { ...validBlob, repositoryId: RepositoryId('other-repository') },
      { ...validBlob, commit: GitCommitId('3333333333333333333333333333333333333333') },
      { ...validBlob, path: otherPath },
    ]
    for (const [index, blob] of mismatches.entries()) {
      await expect(local.ctx.delivery.createWorkPacket({
        ...baseRequest,
        idempotencyKey: `git-blob-mismatch-${String(index)}`,
      }, async () => blob as never)).rejects.toMatchObject({ code: 'invalid-reference' })
    }
    await expect(local.ctx.delivery.createWorkPacket({
      ...baseRequest,
      idempotencyKey: 'git-blob-oversized',
    }, async () => ({
      ...validBlob,
      bytes: new Uint8Array(DELIVERY_VERIFICATION_SOURCE_MAX_BYTES + 1),
    } as never))).rejects.toMatchObject({ code: 'invalid-reference' })
    const multibyteOverflowDocument = JSON.stringify({
      format: 'delivery-verification-plan@1',
      checks: original.verificationSource.checks.map(check => ({
        ...check,
        name: '界'.repeat(Math.floor(DELIVERY_VERIFICATION_SOURCE_MAX_BYTES / 2)),
      })),
    })
    const multibyteOverflowBytes = new TextEncoder().encode(multibyteOverflowDocument)
    expect(multibyteOverflowDocument.length).toBeLessThan(DELIVERY_VERIFICATION_SOURCE_MAX_BYTES)
    expect(multibyteOverflowBytes.byteLength).toBeGreaterThan(DELIVERY_VERIFICATION_SOURCE_MAX_BYTES)
    await expect(local.ctx.delivery.createWorkPacket({
      ...baseRequest,
      idempotencyKey: 'git-blob-multibyte-byte-overflow',
    }, async () => ({
      ...validBlob,
      bytes: multibyteOverflowBytes,
    } as never))).rejects.toMatchObject({ code: 'invalid-reference' })
    await expect(local.ctx.delivery.createWorkPacket({
      ...baseRequest,
      idempotencyKey: 'git-blob-malformed',
    }, async () => ({
      ...validBlob,
      bytes: new TextEncoder().encode('{"format":"wrong"}'),
    } as never))).rejects.toMatchObject({ code: 'invalid-reference' })
  })

  it('reopens the bound Delivery-to-Queue handshake', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    const contract = await first.ctx.delivery.adoptContractRevision(
      adoptionRequest(contractRevisionFixture()),
    )
    if (contract.repositoryId === null || contract.baseSelectionRule?.kind !== 'commit') {
      throw new Error('ready Contract fixture unexpectedly lacks repository authority')
    }
    const packetFixture = readyWorkPacketFixture({
      contractRevisionId: contract.id,
      repositoryId: contract.repositoryId,
      baseCommit: contract.baseSelectionRule.commit,
      acceptanceClauseIds: contract.acceptanceClauses.map(clause => clause.id),
    })
    const packet = await first.ctx.delivery.createWorkPacket({
      idempotencyKey: 'create-packet-for-binding-v1',
      contractRevisionId: contract.id,
      repository: {
        repositoryId: contract.repositoryId,
        selectionRule: contract.baseSelectionRule,
        commit: contract.baseSelectionRule.commit,
      } as never,
      packet: packetDraft(packetFixture),
    })
    const dispatchRequest = {
      idempotencyKey: 'begin-change-dispatch-v1',
      packetId: packet.id,
      kind: 'code.change@1' as const,
      executorId: ExecutorId('codex'),
      inputDigest: canonicalDigest({ packetId: packet.id }),
    }
    const [submitting, submittingReplay] = await Promise.all([
      first.ctx.delivery.beginDispatch(dispatchRequest),
      first.ctx.delivery.beginDispatch(dispatchRequest),
    ])
    expect(submittingReplay).toEqual(submitting)
    const bound = await first.ctx.delivery.bindDispatch({
      bindingId: submitting.id,
      queueWorkId: QueueWorkIdRef('queue-work-change-1'),
    })
    await first.dispose()
    active.splice(active.indexOf(first), 1)

    const reopened = await harness(pool)
    expect(reopened.ctx.delivery.getDispatchBinding(bound.id)).toEqual(bound)
    await expect(reopened.ctx.delivery.beginDispatch(dispatchRequest)).resolves.toEqual(bound)
    await expect(reopened.ctx.delivery.beginDispatch({
      ...dispatchRequest,
      inputDigest: canonicalDigest({ packetId: packet.id, conflict: true }),
    })).rejects.toMatchObject({ code: 'idempotency-conflict' })
  })

  it('keeps dispatch admission idempotent and Queue binding single-assignment', async () => {
    const local = await harness(new MemoryMediaPool())
    await expect(local.ctx.delivery.beginDispatch({
      idempotencyKey: 'dispatch-missing-packet',
      packetId: readyWorkPacketFixture().id,
      kind: 'code.verify@1',
      inputDigest: canonicalDigest({ packetId: readyWorkPacketFixture().id }),
    })).rejects.toMatchObject({ code: 'not-found' })
    await expect(local.ctx.delivery.bindDispatch({
      bindingId: DispatchBindingId('missing-binding'),
      queueWorkId: QueueWorkIdRef('missing-binding-work'),
    })).rejects.toMatchObject({ code: 'not-found' })

    const packet = await storedPacket(local, 'dispatch-single-assignment')
    const request = {
      idempotencyKey: 'dispatch-single-assignment',
      packetId: packet.id,
      kind: 'code.change@1' as const,
      executorId: ExecutorId('codex'),
      inputDigest: canonicalDigest({ packetId: packet.id }),
    }
    const submitting = await local.ctx.delivery.beginDispatch(request)
    await expect(local.ctx.delivery.beginDispatch(request)).resolves.toEqual(submitting)
    const bound = await local.ctx.delivery.bindDispatch({
      bindingId: submitting.id,
      queueWorkId: QueueWorkIdRef('queue-work-single-assignment'),
    })
    await expect(local.ctx.delivery.bindDispatch({
      bindingId: submitting.id,
      queueWorkId: QueueWorkIdRef('queue-work-single-assignment'),
    })).resolves.toEqual(bound)
    await expect(local.ctx.delivery.bindDispatch({
      bindingId: submitting.id,
      queueWorkId: QueueWorkIdRef('queue-work-conflict'),
    })).rejects.toMatchObject({ code: 'invalid-transition' })
  })

  it('commits only one Queue Work identity when binding races', async () => {
    const local = await harness(new MemoryMediaPool())
    const packet = await storedPacket(local, 'dispatch-binding-race')
    const submitting = await local.ctx.delivery.beginDispatch({
      idempotencyKey: 'dispatch-binding-race',
      packetId: packet.id,
      kind: 'code.change@1',
      executorId: ExecutorId('codex'),
      inputDigest: canonicalDigest({ packetId: packet.id }),
    })
    const firstQueueWorkId = QueueWorkIdRef('queue-work-race-first')
    const secondQueueWorkId = QueueWorkIdRef('queue-work-race-second')
    const results = await Promise.allSettled([
      local.ctx.delivery.bindDispatch({
        bindingId: submitting.id,
        queueWorkId: firstQueueWorkId,
      }),
      local.ctx.delivery.bindDispatch({
        bindingId: submitting.id,
        queueWorkId: secondQueueWorkId,
      }),
    ])

    expect(results[0]).toMatchObject({
      status: 'fulfilled',
      value: { phase: 'bound', queueWorkId: firstQueueWorkId },
    })
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: { code: 'invalid-transition' },
    })
    expect(local.ctx.delivery.getDispatchBinding(submitting.id)).toMatchObject({
      phase: 'bound',
      queueWorkId: firstQueueWorkId,
    })

    const matching = await local.ctx.delivery.beginDispatch({
      idempotencyKey: 'dispatch-binding-matching-race',
      packetId: packet.id,
      kind: 'code.verify@1',
      inputDigest: canonicalDigest({ packetId: packet.id, kind: 'verification' }),
    })
    const matchingQueueWorkId = QueueWorkIdRef('queue-work-race-matching')
    const matchingResults = await Promise.all([
      local.ctx.delivery.bindDispatch({
        bindingId: matching.id,
        queueWorkId: matchingQueueWorkId,
      }),
      local.ctx.delivery.bindDispatch({
        bindingId: matching.id,
        queueWorkId: matchingQueueWorkId,
      }),
    ])
    expect(matchingResults[1]).toEqual(matchingResults[0])
    expect(local.ctx.delivery.getDispatchBinding(matching.id)).toEqual(matchingResults[0])
  })

  it('reopens a human acceptance committed from exact bound Queue and evidence facts', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    const contract = await first.ctx.delivery.adoptContractRevision(
      adoptionRequest(contractRevisionFixture()),
    )
    if (contract.repositoryId === null || contract.baseSelectionRule?.kind !== 'commit') {
      throw new Error('ready Contract fixture unexpectedly lacks repository authority')
    }
    const packetFixture = readyWorkPacketFixture({
      contractRevisionId: contract.id,
      repositoryId: contract.repositoryId,
      baseCommit: contract.baseSelectionRule.commit,
      acceptanceClauseIds: contract.acceptanceClauses.map(clause => clause.id),
    })
    const packet = await first.ctx.delivery.createWorkPacket({
      idempotencyKey: 'create-packet-for-acceptance-v1',
      contractRevisionId: contract.id,
      repository: {
        repositoryId: contract.repositoryId,
        selectionRule: contract.baseSelectionRule,
        commit: contract.baseSelectionRule.commit,
      } as never,
      packet: packetDraft(packetFixture),
    })
    const changeQueueWorkId = QueueWorkIdRef('queue-work-change-acceptance')
    const changeBinding = await first.ctx.delivery.bindDispatch({
      bindingId: (await first.ctx.delivery.beginDispatch({
        idempotencyKey: 'begin-change-for-acceptance-v1',
        packetId: packet.id,
        kind: 'code.change@1',
        executorId: ExecutorId('codex'),
        inputDigest: canonicalDigest({ packetId: packet.id }),
      })).id,
      queueWorkId: changeQueueWorkId,
    })
    const targetCommit = GitCommitId('2222222222222222222222222222222222222222')
    const verificationIntent = {
      packetId: packet.id,
      targetCommit,
      verificationPlanDigest: packet.verificationPlan.digest,
    }
    const verificationQueueWorkId = QueueWorkIdRef('queue-work-verify-acceptance')
    const verificationBinding = await first.ctx.delivery.bindDispatch({
      bindingId: (await first.ctx.delivery.beginDispatch({
        idempotencyKey: 'begin-verify-for-acceptance-v1',
        packetId: packet.id,
        kind: 'code.verify@1',
        inputDigest: canonicalDigest(verificationIntent),
      })).id,
      queueWorkId: verificationQueueWorkId,
    })
    const changeAttemptId = QueueAttemptIdRef('queue-attempt-change-acceptance')
    const verificationAttemptId = QueueAttemptIdRef('queue-attempt-verify-acceptance')
    const changeEvidenceId = EvidenceId('evidence-change-acceptance')
    const verificationEvidenceId = EvidenceId('evidence-verify-acceptance')
    const completionClaim = completedClaimFixture({
      packetId: packet.id,
      queueWorkId: changeQueueWorkId,
      queueAttemptId: changeAttemptId,
      checkpointCommit: targetCommit,
      evidenceIds: [changeEvidenceId],
    })
    const initialVerdict = passedVerdictFixture({
      packetId: packet.id,
      baseCommit: packet.baseCommit,
      targetCommit,
      verificationPlanDigest: packet.verificationPlan.digest,
      evidenceIds: [changeEvidenceId, verificationEvidenceId],
    })
    const verificationVerdict = passedVerdictFixture({
      ...initialVerdict,
      checkResults: initialVerdict.checkResults.map(result => ({
        ...result,
        evidenceIds: [verificationEvidenceId],
      })),
      evidenceIntegrityFindings: [changeEvidenceId, verificationEvidenceId].map(evidenceId => ({
        evidenceId,
        required: true,
        status: 'verified' as const,
      })),
    })
    const evidence = new Map([
      [changeEvidenceId, evidenceRefFixture({
        id: changeEvidenceId,
        provenance: {
          kind: 'change-attempt',
          packetId: packet.id,
          queueWorkId: changeQueueWorkId,
          queueAttemptId: changeAttemptId,
        },
      })],
      [verificationEvidenceId, evidenceRefFixture({
        id: verificationEvidenceId,
        kind: 'verification-output',
        provenance: {
          kind: 'verification-check',
          packetId: packet.id,
          queueWorkId: verificationQueueWorkId,
          queueAttemptId: verificationAttemptId,
          checkId: packet.verificationPlan.checks[0]!.id,
        },
      })],
    ])

    const decisionRequest = {
      idempotencyKey: 'accept-packet-local-v1',
      packetId: packet.id,
      changeBindingId: changeBinding.id,
      verificationBindingId: verificationBinding.id,
      decision: 'accepted' as const,
      reason: 'Independent verification passed and the result was reviewed.',
      actorId: 'local-operator',
      decisionNonce: 'accept-packet-local-v1',
    }
    const candidate = {
      completionClaim,
      changeQueueAttemptId: changeAttemptId,
      verificationIntent,
      verificationVerdict,
      verificationQueueAttemptId: verificationAttemptId,
    }
    const [decision, decisionReplay] = await Promise.all([
      first.ctx.delivery.recordAcceptanceDecision(
        decisionRequest,
        async () => candidate,
        async evidenceId => evidence.get(evidenceId),
      ),
      first.ctx.delivery.recordAcceptanceDecision(
        decisionRequest,
        async () => candidate,
        async evidenceId => evidence.get(evidenceId),
      ),
    ])
    expect(decisionReplay).toEqual(decision)
    await first.dispose()
    active.splice(active.indexOf(first), 1)

    const reopened = await harness(pool)
    expect(reopened.ctx.delivery.snapshot().acceptanceDecisions).toEqual([decision])
    await expect(reopened.ctx.delivery.recordAcceptanceDecision(
      decisionRequest,
      async () => { throw new Error('durable replay must not resolve Queue results') },
      async () => { throw new Error('durable replay must not read evidence') },
    )).resolves.toEqual(decision)
    await expect(reopened.ctx.delivery.recordAcceptanceDecision({
      ...decisionRequest,
      reason: 'conflicting reason after restart',
    }, async () => candidate, async evidenceId => evidence.get(evidenceId)))
      .rejects.toMatchObject({ code: 'idempotency-conflict' })
  })

  it('rejects broken Packet, binding, Attempt, intent, and verdict authority before commit', async () => {
    const local = await harness(new MemoryMediaPool())
    const chain = await acceptanceChain(local, 'authority-cases')
    const baseRequest = {
      idempotencyKey: 'acceptance-authority-base',
      packetId: chain.packet.id,
      changeBindingId: chain.changeBinding.id,
      verificationBindingId: chain.verificationBinding.id,
      decision: 'accepted' as const,
      reason: 'Authority chain must match.',
      actorId: 'local-operator',
      decisionNonce: 'acceptance-authority-base',
    }
    const evidenceResolver = async (id: EvidenceId) => chain.evidence.get(id)
    const candidateResolver = vi.fn(async () => chain.candidate)

    await expect(local.ctx.delivery.recordAcceptanceDecision({
      ...baseRequest,
      idempotencyKey: 'acceptance-missing-packet',
      packetId: readyWorkPacketFixture().id,
      decisionNonce: 'acceptance-missing-packet',
    }, candidateResolver, evidenceResolver)).rejects.toMatchObject({ code: 'not-found' })
    expect(candidateResolver).not.toHaveBeenCalled()
    await expect(local.ctx.delivery.recordAcceptanceDecision({
      ...baseRequest,
      idempotencyKey: 'acceptance-missing-binding',
      changeBindingId: DispatchBindingId('missing-acceptance-binding'),
      decisionNonce: 'acceptance-missing-binding',
    }, candidateResolver, evidenceResolver)).rejects.toMatchObject({ code: 'not-found' })

    const submitting = await local.ctx.delivery.beginDispatch({
      idempotencyKey: 'acceptance-submitting-binding',
      packetId: chain.packet.id,
      kind: 'code.verify@1',
      inputDigest: canonicalDigest(chain.candidate.verificationIntent),
    })
    const otherPacket = await storedPacket(local, 'acceptance-other-packet')
    const otherBinding = await local.ctx.delivery.bindDispatch({
      bindingId: (await local.ctx.delivery.beginDispatch({
        idempotencyKey: 'acceptance-other-packet-binding',
        packetId: otherPacket.id,
        kind: 'code.change@1',
        executorId: ExecutorId('codex'),
        inputDigest: canonicalDigest({ packetId: otherPacket.id }),
      })).id,
      queueWorkId: QueueWorkIdRef('queue-work-other-packet'),
    })
    for (const [index, bindingIds] of [
      { changeBindingId: chain.changeBinding.id, verificationBindingId: submitting.id },
      { changeBindingId: otherBinding.id, verificationBindingId: chain.verificationBinding.id },
      { changeBindingId: chain.verificationBinding.id, verificationBindingId: chain.changeBinding.id },
    ].entries()) {
      await expect(local.ctx.delivery.recordAcceptanceDecision({
        ...baseRequest,
        ...bindingIds,
        idempotencyKey: `acceptance-invalid-binding-${String(index)}`,
        decisionNonce: `acceptance-invalid-binding-${String(index)}`,
      }, async () => chain.candidate, evidenceResolver)).rejects.toMatchObject({ code: 'invalid-reference' })
    }

    const wrongChangeBinding = await local.ctx.delivery.bindDispatch({
      bindingId: (await local.ctx.delivery.beginDispatch({
        idempotencyKey: 'acceptance-wrong-change-digest-binding',
        packetId: chain.packet.id,
        kind: 'code.change@1',
        executorId: ExecutorId('codex'),
        inputDigest: canonicalDigest({ packetId: 'other-packet' }),
      })).id,
      queueWorkId: QueueWorkIdRef('queue-work-wrong-change-digest'),
    })
    await expect(local.ctx.delivery.recordAcceptanceDecision({
      ...baseRequest,
      idempotencyKey: 'acceptance-wrong-change-digest',
      changeBindingId: wrongChangeBinding.id,
      decisionNonce: 'acceptance-wrong-change-digest',
    }, async () => chain.candidate, evidenceResolver)).rejects.toMatchObject({ code: 'invalid-reference' })

    const wrongVerificationBinding = await local.ctx.delivery.bindDispatch({
      bindingId: (await local.ctx.delivery.beginDispatch({
        idempotencyKey: 'acceptance-wrong-verification-digest-binding',
        packetId: chain.packet.id,
        kind: 'code.verify@1',
        inputDigest: canonicalDigest({ ...chain.candidate.verificationIntent, packetId: otherPacket.id }),
      })).id,
      queueWorkId: QueueWorkIdRef('queue-work-wrong-verification-digest'),
    })
    const candidateCases = [
      { ...chain.candidate, completionClaim: { ...chain.candidate.completionClaim, packetId: otherPacket.id } },
      { ...chain.candidate, completionClaim: {
        ...chain.candidate.completionClaim,
        queueWorkId: QueueWorkIdRef('other-change-work'),
      } },
      { ...chain.candidate, changeQueueAttemptId: QueueAttemptIdRef('other-change-attempt') },
      { ...chain.candidate, completionClaim: {
        ...chain.candidate.completionClaim,
        disposition: 'blocked',
        checkpointCommit: null,
        blocker: 'blocked for test',
        nextSmallestAction: 'stop',
      } },
      { ...chain.candidate, verificationIntent: {
        ...chain.candidate.verificationIntent,
        packetId: otherPacket.id,
      } },
      { ...chain.candidate, verificationIntent: {
        ...chain.candidate.verificationIntent,
        targetCommit: GitCommitId('3333333333333333333333333333333333333333'),
      } },
      { ...chain.candidate, verificationIntent: {
        ...chain.candidate.verificationIntent,
        verificationPlanDigest: canonicalDigest('other-plan'),
      } },
      { ...chain.candidate, verificationVerdict: passedVerdictFixture({
        ...chain.candidate.verificationVerdict,
        packetId: otherPacket.id,
      }) },
      { ...chain.candidate, verificationVerdict: passedVerdictFixture({
        ...chain.candidate.verificationVerdict,
        baseCommit: GitCommitId('3333333333333333333333333333333333333333'),
      }) },
      { ...chain.candidate, verificationVerdict: passedVerdictFixture({
        ...chain.candidate.verificationVerdict,
        targetCommit: GitCommitId('3333333333333333333333333333333333333333'),
      }) },
      { ...chain.candidate, verificationVerdict: passedVerdictFixture({
        ...chain.candidate.verificationVerdict,
        verificationPlanDigest: canonicalDigest('other-plan'),
      }) },
      { ...chain.candidate, verificationVerdict: passedVerdictFixture({
        ...chain.candidate.verificationVerdict,
        checkResults: chain.candidate.verificationVerdict.checkResults.map(result => ({
          ...result,
          checkDigest: canonicalDigest('wrong-check'),
        })),
      }) },
      { ...chain.candidate, verificationVerdict: passedVerdictFixture({
        ...chain.candidate.verificationVerdict,
        status: 'failed',
      }) },
    ]
    for (const [index, candidate] of candidateCases.entries()) {
      await expect(local.ctx.delivery.recordAcceptanceDecision({
        ...baseRequest,
        idempotencyKey: `acceptance-candidate-${String(index)}`,
        decisionNonce: `acceptance-candidate-${String(index)}`,
      }, async () => candidate as never, evidenceResolver)).rejects.toMatchObject({
        code: index === 3 || index === 12 ? 'acceptance-denied' : 'invalid-reference',
      })
    }
    await expect(local.ctx.delivery.recordAcceptanceDecision({
      ...baseRequest,
      idempotencyKey: 'acceptance-verification-binding-digest',
      verificationBindingId: wrongVerificationBinding.id,
      decisionNonce: 'acceptance-verification-binding-digest',
    }, async () => chain.candidate, evidenceResolver)).rejects.toMatchObject({ code: 'invalid-reference' })

    const invalidIntents = [
      { ...chain.candidate.verificationIntent, packetId: otherPacket.id },
      {
        ...chain.candidate.verificationIntent,
        targetCommit: GitCommitId('3333333333333333333333333333333333333333'),
      },
      { ...chain.candidate.verificationIntent, verificationPlanDigest: canonicalDigest('other-plan') },
    ]
    for (const [index, intent] of invalidIntents.entries()) {
      const matchingInvalidBinding = await local.ctx.delivery.bindDispatch({
        bindingId: (await local.ctx.delivery.beginDispatch({
          idempotencyKey: `acceptance-invalid-intent-binding-${String(index)}`,
          packetId: chain.packet.id,
          kind: 'code.verify@1',
          inputDigest: canonicalDigest(intent),
        })).id,
        queueWorkId: QueueWorkIdRef(`queue-work-invalid-intent-${String(index)}`),
      })
      await expect(local.ctx.delivery.recordAcceptanceDecision({
        ...baseRequest,
        idempotencyKey: `acceptance-invalid-intent-${String(index)}`,
        verificationBindingId: matchingInvalidBinding.id,
        decisionNonce: `acceptance-invalid-intent-${String(index)}`,
      }, async () => ({ ...chain.candidate, verificationIntent: intent }), evidenceResolver))
        .rejects.toMatchObject({ code: 'invalid-reference' })
    }

    const rejected = await local.ctx.delivery.recordAcceptanceDecision({
      ...baseRequest,
      idempotencyKey: 'acceptance-explicit-rejection',
      decision: 'rejected',
      decisionNonce: 'acceptance-explicit-rejection',
    }, async () => chain.candidate, async () => { throw new Error('rejection must not read evidence') })
    expect(rejected.decision).toBe('rejected')
    const accepted = await local.ctx.delivery.recordAcceptanceDecision(baseRequest, async () => chain.candidate, evidenceResolver)
    await expect(local.ctx.delivery.recordAcceptanceDecision(
      baseRequest,
      async () => { throw new Error('idempotent replay must not resolve Queue') },
      async () => { throw new Error('idempotent replay must not read evidence') },
    )).resolves.toEqual(accepted)
  })

  it('rejects incomplete, unrelated, or unverified acceptance evidence', async () => {
    const local = await harness(new MemoryMediaPool())
    const chain = await acceptanceChain(local, 'evidence-cases')
    const request = {
      packetId: chain.packet.id,
      changeBindingId: chain.changeBinding.id,
      verificationBindingId: chain.verificationBinding.id,
      decision: 'accepted' as const,
      reason: 'Evidence must match every authority.',
      actorId: 'local-operator',
    }
    const run = (
      id: string,
      candidate: typeof chain.candidate,
      resolveEvidence: (evidenceId: EvidenceId) => Promise<ReturnType<typeof evidenceRefFixture> | undefined>,
    ) => local.ctx.delivery.recordAcceptanceDecision({
      ...request,
      idempotencyKey: id,
      decisionNonce: id,
    }, async () => candidate, resolveEvidence)

    await expect(run('evidence-missing', chain.candidate, async () => undefined))
      .rejects.toMatchObject({ code: 'acceptance-denied' })
    await expect(run('evidence-wrong-id', chain.candidate, async () => evidenceRefFixture({
      id: EvidenceId('wrong-evidence-id'),
    }))).rejects.toMatchObject({ code: 'acceptance-denied' })

    const resumeCapsuleId = EvidenceId('evidence-resume-capsule')
    const candidateWithResumeCapsule = {
      ...chain.candidate,
      completionClaim: completedClaimFixture({
        ...chain.candidate.completionClaim,
        resumeCapsuleEvidenceId: resumeCapsuleId,
      }),
    }
    await expect(run(
      'evidence-resume-capsule-missing',
      candidateWithResumeCapsule,
      async id => chain.evidence.get(id),
    )).rejects.toMatchObject({ code: 'acceptance-denied' })

    const resumeCapsuleEvidence = evidenceRefFixture({
      id: resumeCapsuleId,
      kind: 'resume-capsule',
      provenance: {
        kind: 'change-attempt',
        packetId: chain.packet.id,
        queueWorkId: chain.candidate.completionClaim.queueWorkId,
        queueAttemptId: chain.candidate.completionClaim.queueAttemptId,
      },
    })
    const evidenceWithResumeCapsule = new Map(chain.evidence).set(resumeCapsuleId, resumeCapsuleEvidence)
    const resolveResumeCapsule = vi.fn(async (id: EvidenceId) => evidenceWithResumeCapsule.get(id))
    await expect(run(
      'evidence-resume-capsule-valid',
      candidateWithResumeCapsule,
      resolveResumeCapsule,
    )).resolves.toMatchObject({ decision: 'accepted' })
    expect(resolveResumeCapsule).toHaveBeenCalledWith(resumeCapsuleId)

    const wrongResumeCapsule = new Map(evidenceWithResumeCapsule).set(resumeCapsuleId, {
      ...resumeCapsuleEvidence,
      kind: 'log',
      provenance: {
        ...resumeCapsuleEvidence.provenance,
        queueAttemptId: QueueAttemptIdRef('wrong-resume-attempt'),
      },
    } as never)
    await expect(run(
      'evidence-resume-capsule-unrelated',
      candidateWithResumeCapsule,
      async id => wrongResumeCapsule.get(id),
    )).rejects.toMatchObject({ code: 'acceptance-denied' })

    const changeId = chain.candidate.completionClaim.evidenceIds[0]!
    const verificationId = chain.candidate.verificationVerdict.checkResults[0]!.evidenceIds[0]!
    const changedKind = new Map(chain.evidence)
    changedKind.set(changeId, evidenceRefFixture({
      ...chain.evidence.get(changeId),
      id: changeId,
      kind: 'log',
    }))
    await expect(run(
      'evidence-no-git-fact',
      chain.candidate,
      async id => changedKind.get(id),
    )).rejects.toMatchObject({ code: 'acceptance-denied' })

    const verdictWithoutClaim = passedVerdictFixture({
      ...chain.candidate.verificationVerdict,
      evidenceIds: [verificationId],
      evidenceIntegrityFindings: chain.candidate.verificationVerdict.evidenceIntegrityFindings
        .filter(finding => finding.evidenceId === verificationId),
    })
    await expect(run('evidence-verdict-omits-claim', {
      ...chain.candidate,
      verificationVerdict: verdictWithoutClaim,
    }, async id => chain.evidence.get(id))).rejects.toMatchObject({ code: 'acceptance-denied' })

    const wrongClaimProvenance = new Map(chain.evidence)
    wrongClaimProvenance.set(changeId, evidenceRefFixture({
      ...chain.evidence.get(changeId),
      id: changeId,
      provenance: {
        kind: 'change-attempt',
        packetId: chain.packet.id,
        queueWorkId: chain.candidate.completionClaim.queueWorkId,
        queueAttemptId: QueueAttemptIdRef('wrong-change-attempt'),
      },
    }))
    await expect(run(
      'evidence-wrong-claim-provenance',
      chain.candidate,
      async id => wrongClaimProvenance.get(id),
    )).rejects.toMatchObject({ code: 'acceptance-denied' })

    const extraClaimId = EvidenceId('evidence-extra-claim')
    const extraClaimEvidence = evidenceRefFixture({
      id: extraClaimId,
      kind: 'log',
      provenance: {
        kind: 'change-attempt',
        packetId: chain.packet.id,
        queueWorkId: chain.candidate.completionClaim.queueWorkId,
        queueAttemptId: QueueAttemptIdRef('wrong-extra-claim-attempt'),
      },
    })
    const claimWithExtra = completedClaimFixture({
      ...chain.candidate.completionClaim,
      evidenceIds: [...chain.candidate.completionClaim.evidenceIds, extraClaimId],
    })
    const verdictCoveringExtraClaim = passedVerdictFixture({
      ...chain.candidate.verificationVerdict,
      evidenceIds: [...chain.candidate.verificationVerdict.evidenceIds, extraClaimId],
      evidenceIntegrityFindings: [
        ...chain.candidate.verificationVerdict.evidenceIntegrityFindings,
        { evidenceId: extraClaimId, required: false, status: 'verified' },
      ],
    })
    const withExtraClaim = new Map(chain.evidence).set(extraClaimId, extraClaimEvidence)
    await expect(run('evidence-unrelated-extra-claim', {
      ...chain.candidate,
      completionClaim: claimWithExtra,
      verificationVerdict: verdictCoveringExtraClaim,
    }, async id => withExtraClaim.get(id))).rejects.toMatchObject({ code: 'acceptance-denied' })

    const wrongVerificationProvenance = new Map(chain.evidence)
    wrongVerificationProvenance.set(verificationId, evidenceRefFixture({
      ...chain.evidence.get(verificationId),
      id: verificationId,
      kind: 'verification-output',
      provenance: {
        kind: 'verification-check',
        packetId: chain.packet.id,
        queueWorkId: chain.verificationBinding.queueWorkId,
        queueAttemptId: chain.candidate.verificationQueueAttemptId,
        checkId: chain.packet.verificationPlan.checks[0]!.id,
      },
    }))
    wrongVerificationProvenance.set(verificationId, {
      ...wrongVerificationProvenance.get(verificationId)!,
      provenance: {
        ...wrongVerificationProvenance.get(verificationId)!.provenance,
        checkId: chain.packet.verificationPlan.checks[0]!.id,
        queueAttemptId: QueueAttemptIdRef('wrong-verification-attempt'),
      },
    } as never)
    await expect(run(
      'evidence-wrong-verification-provenance',
      chain.candidate,
      async id => wrongVerificationProvenance.get(id),
    )).rejects.toMatchObject({ code: 'acceptance-denied' })

    const extraId = EvidenceId('evidence-extra-verdict')
    const extraEvidence = evidenceRefFixture({
      id: extraId,
      kind: 'verification-output',
      provenance: {
        kind: 'verification-check',
        packetId: chain.packet.id,
        queueWorkId: chain.verificationBinding.queueWorkId,
        queueAttemptId: QueueAttemptIdRef('wrong-extra-attempt'),
        checkId: chain.packet.verificationPlan.checks[0]!.id,
      },
    })
    const withExtra = new Map(chain.evidence).set(extraId, extraEvidence)
    const verdictWithExtra = passedVerdictFixture({
      ...chain.candidate.verificationVerdict,
      evidenceIds: [...chain.candidate.verificationVerdict.evidenceIds, extraId],
      evidenceIntegrityFindings: [
        ...chain.candidate.verificationVerdict.evidenceIntegrityFindings,
        { evidenceId: extraId, required: false, status: 'verified' },
      ],
    })
    await expect(run('evidence-unrelated-verdict-extra', {
      ...chain.candidate,
      verificationVerdict: verdictWithExtra,
    }, async id => withExtra.get(id))).rejects.toMatchObject({ code: 'acceptance-denied' })

    const optionalId = EvidenceId('evidence-optional-unverified')
    const optionalEvidence = evidenceRefFixture({
      id: optionalId,
      kind: 'verification-output',
      provenance: {
        kind: 'verification-check',
        packetId: chain.packet.id,
        queueWorkId: chain.verificationBinding.queueWorkId,
        queueAttemptId: chain.candidate.verificationQueueAttemptId,
        checkId: chain.packet.verificationPlan.checks[0]!.id,
      },
    })
    const withOptional = new Map(chain.evidence).set(optionalId, optionalEvidence)
    const unverified = passedVerdictFixture({
      ...chain.candidate.verificationVerdict,
      evidenceIds: [...chain.candidate.verificationVerdict.evidenceIds, optionalId],
      evidenceIntegrityFindings: [
        ...chain.candidate.verificationVerdict.evidenceIntegrityFindings,
        { evidenceId: optionalId, required: false, status: 'missing' },
      ],
    })
    await expect(run('evidence-unverified', {
      ...chain.candidate,
      verificationVerdict: unverified,
    }, async id => withOptional.get(id))).rejects.toMatchObject({ code: 'acceptance-denied' })
  })
})
