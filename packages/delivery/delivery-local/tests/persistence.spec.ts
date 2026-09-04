import { Context } from '@deepseek-ai/cordis'
import Storage, { StorageError } from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CompleteIssuePublicationRequest,
  ContractRevisionDraft,
  CreateDeliveryCaseRequest,
  CreateWorkPacketRequest,
  FailIssuePublicationRequest,
  PrepareIssuePublicationRequest,
  RecordRequirementDecisionRequest,
  ReviseDeliveryCaseRequest,
  WorkPacketDraft,
} from '@changanhua/dsh-delivery'
import { DELIVERY_VERIFICATION_SOURCE_MAX_BYTES, DeliveryError } from '@changanhua/dsh-delivery'
import {
  DELIVERY_SCHEMA_VERSION,
  AcceptanceClauseId,
  CompletionClaimId,
  ContractRevisionId,
  DeliveryCaseId,
  DispatchBindingId,
  EvidenceId,
  ExecutorId,
  GitBlobId,
  GitCommitId,
  IssuePublicationId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryId,
  RepositoryRelativePath,
  VerificationCheckId,
  VerificationVerdictId,
  WorkPacketId,
  canonicalDigest,
  canonicalGitHubIssueUrl,
  completionClaimSchema,
  evidenceBytesDigest,
  evidenceRefSchema,
  githubIssueContentDigest,
  gitHubIssueRefSchema,
  issuePublicationIdForRevision,
  verificationCheckDigest,
  verificationPlanDigest,
  verificationPlanSchema,
  verificationVerdictSchema,
  workPacketDigest,
  workPacketSchema,
  type CompletionClaim,
  type ContractRevision,
  type DeliveryCase,
  type EvidenceRef,
  type GitHubIssueRef,
  type RequirementOrigin,
  type VerificationCheck,
  type VerificationPlan,
  type VerificationVerdict,
  type WorkPacket,
  type WorkPacketDigestInput,
} from '@changanhua/dsh-delivery-protocol'
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

/** Manual assembly for harnesses whose provider startup is expected to fail. */
async function failingHarness(pool: MemoryMediaPool): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  return ctx
}

const BASE_COMMIT = GitCommitId('1111111111111111111111111111111111111111')
const TARGET_COMMIT = GitCommitId('2222222222222222222222222222222222222222')
const REPOSITORY_ID = RepositoryId('repository-fixture')
const CASE_TITLE = 'Deliver one bounded change'
const HUMAN_ACTOR = 'local-operator'
const IMPORT_REPOSITORY = { owner: 'deepseek-ai', name: 'deepseek-harness' } as const

const FIXTURE_CHECK: VerificationCheck = {
  id: VerificationCheckId('verification-check-fixture'),
  name: 'Typecheck Delivery consumer',
  argv: ['pnpm', 'exec', 'tsc', '--noEmit'],
  cwd: '.',
  timeoutMs: 60_000,
  severity: 'required',
  expectedExitCodes: [0],
}

const FIXTURE_CLAUSE = {
  id: AcceptanceClauseId('acceptance-clause-fixture'),
  text: 'Focused verification passes for the bounded change.',
} as const

function revisionDraft(overrides: Partial<ContractRevisionDraft> = {}): ContractRevisionDraft {
  return {
    outcome: 'A bounded change is implemented and independently verified.',
    context: 'The Consumer needs a deterministic Delivery contract.',
    allowedScope: ['Delivery package sources and focused tests'],
    forbiddenScope: ['Unrelated product behavior'],
    acceptanceClauses: [FIXTURE_CLAUSE],
    openDecisions: [],
    baseSelectionRule: { kind: 'commit', commit: BASE_COMMIT },
    verificationSource: { kind: 'contract-field', checks: [FIXTURE_CHECK] },
    referenceLinks: [],
    ...overrides,
  }
}

function createCaseRequest(
  overrides: Partial<Omit<CreateDeliveryCaseRequest, 'idempotencyKey'>> = {},
  idempotencyKey = 'create-case-local-v2',
): CreateDeliveryCaseRequest {
  return {
    idempotencyKey,
    repositoryId: REPOSITORY_ID,
    origin: { kind: 'human', actorId: HUMAN_ACTOR },
    title: CASE_TITLE,
    revision: revisionDraft(),
    ...overrides,
  }
}

function decisionRequest(
  created: { case: DeliveryCase; revision: ContractRevision },
  overrides: Partial<Omit<RecordRequirementDecisionRequest, 'idempotencyKey'>> = {},
  idempotencyKey = 'decision-local-v2',
): RecordRequirementDecisionRequest {
  return {
    idempotencyKey,
    caseId: created.case.id,
    revisionId: created.revision.id,
    decision: 'approved',
    reason: 'Requirement reviewed and approved.',
    actorId: HUMAN_ACTOR,
    decisionNonce: `nonce-${idempotencyKey}`,
    ...overrides,
  }
}

/** Create one Case and approve its root revision, the gate for Packets and publications. */
async function createApprovedCase(
  local: Harness,
  key: string,
  overrides: Partial<Omit<CreateDeliveryCaseRequest, 'idempotencyKey'>> = {},
): Promise<{ case: DeliveryCase; revision: ContractRevision }> {
  const created = await local.ctx.delivery.createCase(createCaseRequest(overrides, `case-${key}`))
  await local.ctx.delivery.recordRequirementDecision(decisionRequest(created, {}, `decision-${key}`))
  return created
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

function verificationPlanFixture(overrides: Partial<VerificationPlan> = {}): VerificationPlan {
  const checks = overrides.checks ?? [FIXTURE_CHECK]
  const provenance = overrides.provenance ?? {
    kind: 'contract-field' as const,
    contractRevisionId: ContractRevisionId('contract-revision-fixture'),
    field: 'verificationSource' as const,
  }
  return verificationPlanSchema.parse({
    checks,
    provenance,
    digest: overrides.digest ?? verificationPlanDigest({ checks, provenance }),
  })
}

function readyPacketFixture(overrides: Partial<WorkPacket> = {}): WorkPacket {
  const digestInput: WorkPacketDigestInput = {
    schemaVersion: overrides.schemaVersion ?? DELIVERY_SCHEMA_VERSION,
    contractRevisionId: overrides.contractRevisionId ?? ContractRevisionId('contract-revision-fixture'),
    repositoryId: overrides.repositoryId ?? REPOSITORY_ID,
    baseCommit: overrides.baseCommit ?? BASE_COMMIT,
    objective: overrides.objective ?? 'Implement the bounded Delivery fixture change.',
    allowedPaths: overrides.allowedPaths ?? [{ kind: 'subtree', path: RepositoryRelativePath('packages/delivery') }],
    forbiddenPaths: overrides.forbiddenPaths ?? [{ kind: 'subtree', path: RepositoryRelativePath('packages/unrelated') }],
    acceptanceClauseIds: overrides.acceptanceClauseIds ?? [FIXTURE_CLAUSE.id],
    verificationPlan: overrides.verificationPlan ?? verificationPlanFixture({
      provenance: {
        kind: 'contract-field',
        contractRevisionId: overrides.contractRevisionId ?? ContractRevisionId('contract-revision-fixture'),
        field: 'verificationSource',
      },
    }),
    stopConditions: overrides.stopConditions ?? ['Stop when repository facts do not match the Contract.'],
    executorPreference: overrides.executorPreference ?? { mode: 'preferred', executorId: ExecutorId('codex-fixture') },
  }
  return workPacketSchema.parse({
    ...digestInput,
    id: overrides.id ?? WorkPacketId('work-packet-fixture'),
    packetDigest: overrides.packetDigest ?? workPacketDigest(digestInput),
    createdAt: overrides.createdAt ?? '2026-08-29T00:00:00.000Z',
  })
}

async function storedPacket(local: Harness, suffix: string): Promise<WorkPacket> {
  const created = await createApprovedCase(local, suffix)
  const revision = created.revision
  if (revision.baseSelectionRule?.kind !== 'commit') {
    throw new Error('ready revision fixture unexpectedly lacks repository authority')
  }
  const fixture = readyPacketFixture({
    contractRevisionId: revision.id,
    repositoryId: created.case.repositoryId,
    baseCommit: revision.baseSelectionRule.commit,
    acceptanceClauseIds: revision.acceptanceClauses.map(clause => clause.id),
  })
  return await local.ctx.delivery.createWorkPacket({
    idempotencyKey: `packet-${suffix}`,
    contractRevisionId: revision.id,
    repository: {
      repositoryId: created.case.repositoryId,
      selectionRule: revision.baseSelectionRule,
      commit: revision.baseSelectionRule.commit,
    } as never,
    packet: packetDraft(fixture),
  })
}

type CompletedClaim = Extract<CompletionClaim, { readonly disposition: 'completed' }>

function completedClaimFixture(overrides: Partial<CompletedClaim> = {}): CompletedClaim {
  const value = completionClaimSchema.parse({
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    id: overrides.id ?? CompletionClaimId('completion-claim-fixture'),
    packetId: overrides.packetId ?? WorkPacketId('work-packet-fixture'),
    queueWorkId: overrides.queueWorkId ?? QueueWorkIdRef('queue-work-fixture'),
    queueAttemptId: overrides.queueAttemptId ?? QueueAttemptIdRef('queue-attempt-fixture'),
    summary: overrides.summary ?? 'The bounded change was implemented and checkpointed.',
    completedWork: overrides.completedWork ?? ['Implemented the requested behavior.'],
    remainingWork: overrides.remainingWork ?? [],
    disposition: 'completed',
    checkpointCommit: overrides.checkpointCommit ?? TARGET_COMMIT,
    changedPaths: overrides.changedPaths ?? [RepositoryRelativePath('packages/delivery/example.ts')],
    evidenceIds: overrides.evidenceIds ?? [EvidenceId('evidence-fixture')],
    resumeCapsuleEvidenceId: overrides.resumeCapsuleEvidenceId ?? null,
    createdAt: overrides.createdAt ?? '2026-08-29T00:00:00.000Z',
  })
  return value as CompletedClaim
}

function passedVerdictFixture(overrides: Partial<VerificationVerdict> = {}): VerificationVerdict {
  const plan = verificationPlanFixture({
    provenance: {
      kind: 'contract-field',
      contractRevisionId: ContractRevisionId('contract-revision-fixture'),
      field: 'verificationSource',
    },
  })
  const evidenceIds = overrides.evidenceIds ?? [EvidenceId('evidence-fixture')]
  const value = verificationVerdictSchema.parse({
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    id: overrides.id ?? VerificationVerdictId('verification-verdict-fixture'),
    packetId: overrides.packetId ?? WorkPacketId('work-packet-fixture'),
    targetCommit: overrides.targetCommit ?? TARGET_COMMIT,
    baseCommit: overrides.baseCommit ?? BASE_COMMIT,
    verificationPlanDigest: overrides.verificationPlanDigest ?? plan.digest,
    status: overrides.status ?? 'passed',
    ancestryResult: overrides.ancestryResult ?? 'descendant',
    checkResults: overrides.checkResults ?? plan.checks.map(check => ({
      checkId: check.id,
      checkDigest: verificationCheckDigest(check),
      severity: check.severity,
      durationMs: 25,
      evidenceIds,
      status: 'exited' as const,
      exitCode: check.expectedExitCodes[0] as number,
      expected: true,
    })),
    evidenceIntegrityFindings: overrides.evidenceIntegrityFindings ?? evidenceIds.map(evidenceId => ({
      evidenceId,
      required: true,
      status: 'verified' as const,
    })),
    changedPathFindings: overrides.changedPathFindings ?? [],
    evidenceIds,
    verifierVersion: overrides.verifierVersion ?? 'delivery-local-tests/1',
    reviewReasons: overrides.reviewReasons ?? [],
    completedAt: overrides.completedAt ?? '2026-08-29T00:00:00.000Z',
  })
  return value
}

function evidenceRefFixture(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  const id = overrides.id ?? EvidenceId('evidence-fixture')
  const bytes = new TextEncoder().encode('delivery fixture evidence\n')
  return evidenceRefSchema.parse({
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    id,
    kind: overrides.kind ?? 'git-diff-metadata',
    mediaType: overrides.mediaType ?? 'application/json',
    uri: overrides.uri ?? `memory://delivery-evidence/${encodeURIComponent(id)}`,
    byteLength: overrides.byteLength ?? bytes.byteLength,
    digest: overrides.digest ?? evidenceBytesDigest(bytes),
    createdAt: overrides.createdAt ?? '2026-08-29T00:00:00.000Z',
    provenance: overrides.provenance ?? {
      kind: 'change-attempt',
      packetId: WorkPacketId('work-packet-fixture'),
      queueWorkId: QueueWorkIdRef('queue-work-fixture'),
      queueAttemptId: QueueAttemptIdRef('queue-attempt-fixture'),
    },
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

function issueRef(overrides?: { readonly issueNumber?: number; readonly owner?: string }): GitHubIssueRef {
  const repository = { owner: overrides?.owner ?? IMPORT_REPOSITORY.owner, name: IMPORT_REPOSITORY.name }
  const issueNumber = overrides?.issueNumber ?? 101
  return gitHubIssueRefSchema.parse({
    repository,
    issueNumber,
    url: canonicalGitHubIssueUrl(repository, issueNumber),
  })
}

const PUBLICATION_MARKER = 'delivery-issue-publication-marker'

function prepareRequest(
  created: { case: DeliveryCase; revision: ContractRevision },
  idempotencyKey = 'prepare-publication-local-v2',
  overrides: Partial<Omit<PrepareIssuePublicationRequest, 'idempotencyKey'>> = {},
): PrepareIssuePublicationRequest {
  return {
    idempotencyKey,
    caseId: created.case.id,
    revisionId: created.revision.id,
    repository: { ...IMPORT_REPOSITORY },
    renderedDigest: canonicalDigest({ rendered: CASE_TITLE }),
    marker: PUBLICATION_MARKER,
    ...overrides,
  }
}

const notStartedFailure = (detail: string): FailIssuePublicationRequest['failure'] => ({
  sideEffect: 'not-started',
  category: 'transport',
  detail,
  occurredAt: new Date().toISOString(),
})

const unknownFailure = (detail: string): FailIssuePublicationRequest['failure'] => ({
  sideEffect: 'unknown',
  category: 'transport',
  detail,
  occurredAt: new Date().toISOString(),
})

describe('LocalDelivery persistence', () => {
  it('reopens a created Case with its root revision from durable storage', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    const request = createCaseRequest()
    const stored = await first.ctx.delivery.createCase(request)
    expect(stored.revision.previousRevisionId).toBeNull()
    expect(stored.revision.origin).toEqual(request.origin)
    expect(stored.revision.title).toBe(request.title)
    expect(stored.case.headRevisionId).toBe(stored.revision.id)
    await first.dispose()
    active.splice(active.indexOf(first), 1)

    const reopened = await harness(pool)
    expect(reopened.ctx.delivery.getCase(stored.case.id)).toEqual(stored.case)
    expect(reopened.ctx.delivery.getContractRevision(stored.revision.id)).toEqual(stored.revision)
    await expect(reopened.ctx.delivery.createCase(request)).resolves.toEqual(stored)
    await expect(reopened.ctx.delivery.createCase({
      ...request,
      revision: { ...request.revision, context: 'conflicting context after restart' },
    })).rejects.toMatchObject({ code: 'idempotency-conflict' })
  })

  it('enforces durable createCase idempotency within one session', async () => {
    const local = await harness(new MemoryMediaPool())
    const request = createCaseRequest()
    const first = await local.ctx.delivery.createCase(request)

    await expect(local.ctx.delivery.createCase(request)).resolves.toEqual(first)
    await expect(local.ctx.delivery.createCase({
      ...request,
      revision: { ...request.revision, context: 'different contract context' },
    })).rejects.toMatchObject({
      code: 'idempotency-conflict',
      name: 'DeliveryError',
    })
  })

  it('serializes concurrent createCase replays on one idempotency key', async () => {
    const local = await harness(new MemoryMediaPool())
    const request = createCaseRequest({}, 'create-case-concurrent-local-v2')

    const [first, replay] = await Promise.all([
      local.ctx.delivery.createCase(request),
      local.ctx.delivery.createCase(request),
    ])

    expect(replay).toEqual(first)
    expect(local.ctx.delivery.snapshot().deliveryCases).toEqual([first.case])
    expect(local.ctx.delivery.snapshot().contractRevisions).toEqual([first.revision])
  })

  it('moves the Case head only through the expected-head compare-and-set', async () => {
    const local = await harness(new MemoryMediaPool())
    const created = await createApprovedCase(local, 'cas')
    const revise = (overrides: Partial<Omit<ReviseDeliveryCaseRequest, 'idempotencyKey'>> & { idempotencyKey: string }) =>
      local.ctx.delivery.reviseCase({
        caseId: created.case.id,
        expectedHeadRevisionId: created.revision.id,
        origin: { kind: 'human', actorId: HUMAN_ACTOR },
        title: 'Revised delivery title',
        revision: revisionDraft({ outcome: 'A revised bounded change is implemented.' }),
        ...overrides,
      })

    await expect(local.ctx.delivery.reviseCase({
      idempotencyKey: 'revise-missing-case',
      caseId: DeliveryCaseId('missing-delivery-case'),
      expectedHeadRevisionId: created.revision.id,
      origin: { kind: 'human', actorId: HUMAN_ACTOR },
      title: 'Revised delivery title',
      revision: revisionDraft(),
    })).rejects.toMatchObject({ code: 'not-found' })
    await expect(revise({ idempotencyKey: 'revise-stale-head', expectedHeadRevisionId: ContractRevisionId('stale-head') }))
      .rejects.toMatchObject({ code: 'conflict' })

    const first = await revise({ idempotencyKey: 'revise-first' })
    expect(first.revision.previousRevisionId).toBe(created.revision.id)
    expect(first.case.headRevisionId).toBe(first.revision.id)
    expect(first.case.repositoryId).toBe(created.case.repositoryId)
    expect(Date.parse(first.case.updatedAt)).toBeGreaterThanOrEqual(Date.parse(first.case.createdAt))

    await expect(revise({ idempotencyKey: 'revise-from-old-head' })).rejects.toMatchObject({ code: 'conflict' })
    await expect(revise({ idempotencyKey: 'revise-first' })).resolves.toEqual(first)

    const [left, right] = await Promise.allSettled([
      revise({ idempotencyKey: 'revise-race-left', expectedHeadRevisionId: first.revision.id }),
      revise({ idempotencyKey: 'revise-race-right', expectedHeadRevisionId: first.revision.id }),
    ])
    const settled = [left, right].map(outcome => outcome.status)
    expect(settled).toContain('fulfilled')
    expect(settled).toContain('rejected')
    const winner = left.status === 'fulfilled' ? left.value : right.status === 'fulfilled' ? right.value : undefined
    expect(winner?.case.headRevisionId).toBe(local.ctx.delivery.getCase(created.case.id)?.headRevisionId)
    const rejectedOutcomes = [left, right].filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    expect(rejectedOutcomes).toHaveLength(1)
    expect(rejectedOutcomes[0]!.reason as DeliveryError).toMatchObject({ code: 'conflict' })
  })

  it('keeps github-import revisions within one repository and Issue', async () => {
    const local = await harness(new MemoryMediaPool())
    const importedOrigin = {
      kind: 'github-import' as const,
      repository: { ...IMPORT_REPOSITORY },
      issueNumber: 101,
      contentDigest: githubIssueContentDigest({ title: CASE_TITLE, body: 'Imported requirement body.' }),
    }
    const created = await local.ctx.delivery.createCase(
      createCaseRequest({ origin: importedOrigin }, 'case-imported'),
    )
    const revise = (origin: RequirementOrigin, key: string, expectedHead = created.case.headRevisionId) =>
      local.ctx.delivery.reviseCase({
        idempotencyKey: key,
        caseId: created.case.id,
        expectedHeadRevisionId: expectedHead,
        origin,
        title: CASE_TITLE,
        revision: revisionDraft(),
      })

    const sameIssue = await revise({ ...importedOrigin, contentDigest: canonicalDigest({ revised: true }) }, 'revise-same-issue')
    expect(sameIssue.revision.previousRevisionId).toBe(created.revision.id)

    await expect(revise({ ...importedOrigin, issueNumber: 102 }, 'revise-drifted-issue', sameIssue.revision.id))
      .rejects.toMatchObject({ code: 'invalid-reference' })
    await expect(revise({ ...importedOrigin, repository: { owner: 'other-owner', name: IMPORT_REPOSITORY.name } }, 'revise-drifted-owner', sameIssue.revision.id))
      .rejects.toMatchObject({ code: 'invalid-reference' })
    await expect(revise({ ...importedOrigin, repository: { owner: IMPORT_REPOSITORY.owner, name: 'other-repository' } }, 'revise-drifted-name', sameIssue.revision.id))
      .rejects.toMatchObject({ code: 'invalid-reference' })
    await expect(revise({ kind: 'human', actorId: HUMAN_ACTOR }, 'revise-human-origin', sameIssue.revision.id))
      .resolves.toMatchObject({ revision: { previousRevisionId: sameIssue.revision.id } })
  })

  it('records one requirement decision per revision and fails closed on conflicts', async () => {
    const local = await harness(new MemoryMediaPool())
    const created = await local.ctx.delivery.createCase(createCaseRequest({}, 'case-decision'))
    const request = decisionRequest(created)

    const decision = await local.ctx.delivery.recordRequirementDecision(request)
    expect(decision).toMatchObject({
      caseId: created.case.id,
      revisionId: created.revision.id,
      decision: 'approved',
      actor: { kind: 'human', actorId: HUMAN_ACTOR },
    })
    expect(local.ctx.delivery.getRequirementDecision(decision.id)).toEqual(decision)

    await expect(local.ctx.delivery.recordRequirementDecision({
      ...request,
      idempotencyKey: 'decision-replay-other-key',
    })).resolves.toEqual(decision)
    await expect(local.ctx.delivery.recordRequirementDecision({
      ...request,
      idempotencyKey: 'decision-conflict',
      reason: 'A different review conclusion.',
    })).rejects.toMatchObject({ code: 'idempotency-conflict' })
    await expect(local.ctx.delivery.recordRequirementDecision({
      ...request,
      idempotencyKey: 'decision-conflict-decision',
      decision: 'rejected',
    })).rejects.toMatchObject({ code: 'idempotency-conflict' })
    await expect(local.ctx.delivery.recordRequirementDecision({
      ...request,
      idempotencyKey: 'decision-missing-revision',
      revisionId: ContractRevisionId('missing-contract-revision'),
    })).rejects.toMatchObject({ code: 'not-found' })
    await expect(local.ctx.delivery.recordRequirementDecision({
      ...request,
      idempotencyKey: 'decision-missing-case',
      caseId: DeliveryCaseId('missing-delivery-case'),
    })).rejects.toMatchObject({ code: 'not-found' })

    const other = await local.ctx.delivery.createCase(createCaseRequest({}, 'case-decision-other'))
    await expect(local.ctx.delivery.recordRequirementDecision({
      ...request,
      idempotencyKey: 'decision-cross-case',
      caseId: other.case.id,
    })).rejects.toMatchObject({ code: 'invalid-reference' })
  })

  it('rejects Packet creation outside the approved ready Case revision authority', async () => {
    const local = await harness(new MemoryMediaPool())
    const otherCommit = GitCommitId('3333333333333333333333333333333333333333')
    const packetFixture = readyPacketFixture()
    await expect(local.ctx.delivery.createWorkPacket({
      idempotencyKey: 'packet-missing-contract',
      contractRevisionId: ContractRevisionId('missing-contract'),
      repository: {
        repositoryId: REPOSITORY_ID,
        selectionRule: { kind: 'commit', commit: BASE_COMMIT },
        commit: BASE_COMMIT,
      } as never,
      packet: packetDraft(packetFixture),
    })).rejects.toMatchObject({ code: 'not-found' })

    const unapproved = await local.ctx.delivery.createCase(createCaseRequest({}, 'case-unapproved-packet'))
    if (unapproved.revision.baseSelectionRule?.kind !== 'commit') {
      throw new Error('fixture unexpectedly lacks repository fields')
    }
    await expect(local.ctx.delivery.createWorkPacket({
      idempotencyKey: 'packet-unapproved',
      contractRevisionId: unapproved.revision.id,
      repository: {
        repositoryId: unapproved.case.repositoryId,
        selectionRule: unapproved.revision.baseSelectionRule,
        commit: unapproved.revision.baseSelectionRule.commit,
      } as never,
      packet: packetDraft(packetFixture),
    })).rejects.toMatchObject({ code: 'approval-required' })

    await local.ctx.delivery.recordRequirementDecision(decisionRequest(unapproved, {
      decision: 'rejected',
      reason: 'Requirement needs another round.',
    }, 'decision-rejected-packet'))
    await expect(local.ctx.delivery.createWorkPacket({
      idempotencyKey: 'packet-rejected',
      contractRevisionId: unapproved.revision.id,
      repository: {
        repositoryId: unapproved.case.repositoryId,
        selectionRule: unapproved.revision.baseSelectionRule,
        commit: unapproved.revision.baseSelectionRule.commit,
      } as never,
      packet: packetDraft(packetFixture),
    })).rejects.toMatchObject({ code: 'approval-required' })

    const notReady = await local.ctx.delivery.createCase(
      createCaseRequest({ revision: revisionDraft({ outcome: null }) }, 'case-not-ready-packet'),
    )
    await local.ctx.delivery.recordRequirementDecision(decisionRequest(notReady, {}, 'decision-not-ready-packet'))
    if (notReady.revision.baseSelectionRule?.kind !== 'commit') {
      throw new Error('not-ready fixture unexpectedly lacks repository fields')
    }
    await expect(local.ctx.delivery.createWorkPacket({
      idempotencyKey: 'packet-not-ready',
      contractRevisionId: notReady.revision.id,
      repository: {
        repositoryId: notReady.case.repositoryId,
        selectionRule: notReady.revision.baseSelectionRule,
        commit: notReady.revision.baseSelectionRule.commit,
      } as never,
      packet: packetDraft(packetFixture),
    })).rejects.toMatchObject({ code: 'invalid-reference' })

    const ready = await createApprovedCase(local, 'packet-authority')
    if (ready.revision.baseSelectionRule?.kind !== 'commit') {
      throw new Error('ready fixture unexpectedly lacks repository fields')
    }
    const readyFixture = readyPacketFixture({
      contractRevisionId: ready.revision.id,
      repositoryId: ready.case.repositoryId,
      baseCommit: ready.revision.baseSelectionRule.commit,
      acceptanceClauseIds: ready.revision.acceptanceClauses.map(clause => clause.id),
    })
    const valid: CreateWorkPacketRequest = {
      idempotencyKey: 'packet-authority-valid',
      contractRevisionId: ready.revision.id,
      repository: {
        repositoryId: ready.case.repositoryId,
        selectionRule: ready.revision.baseSelectionRule,
        commit: ready.revision.baseSelectionRule.commit,
      } as never,
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

  it('reopens a Packet with its revision-derived verification plan', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    const created = await createApprovedCase(first, 'packet-reopen')
    const revision = created.revision
    if (revision.baseSelectionRule === null || revision.baseSelectionRule.kind !== 'commit') {
      throw new Error('ready revision fixture unexpectedly lacks repository authority')
    }
    const fixture = readyPacketFixture({
      contractRevisionId: revision.id,
      repositoryId: created.case.repositoryId,
      baseCommit: revision.baseSelectionRule.commit,
      acceptanceClauseIds: revision.acceptanceClauses.map(clause => clause.id),
    })
    const packetRequest = {
      idempotencyKey: 'create-packet-local-v2',
      contractRevisionId: revision.id,
      repository: {
        repositoryId: created.case.repositoryId,
        selectionRule: revision.baseSelectionRule,
        commit: revision.baseSelectionRule.commit,
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
      contractRevisionId: revision.id,
      field: 'verificationSource',
    })
  })

  it('derives a Packet plan from the exact bounded revision Git blob', async () => {
    const pool = new MemoryMediaPool()
    const local = await harness(pool)
    const inlineChecks = [FIXTURE_CHECK]
    const path = RepositoryRelativePath('.dsh/delivery-verification.json')
    const created = await createApprovedCase(local, 'git-blob', {
      revision: revisionDraft({
        verificationSource: { kind: 'git-blob', path, format: 'delivery-verification-plan@1' },
      }),
    })
    const revision = created.revision
    if (revision.baseSelectionRule?.kind !== 'commit') {
      throw new Error('ready revision fixture unexpectedly lacks repository authority')
    }
    const fixture = readyPacketFixture({
      contractRevisionId: revision.id,
      repositoryId: created.case.repositoryId,
      baseCommit: revision.baseSelectionRule.commit,
      acceptanceClauseIds: revision.acceptanceClauses.map(clause => clause.id),
      verificationPlan: verificationPlanFixture({
        checks: inlineChecks,
        provenance: {
          kind: 'git-blob',
          baseCommit: revision.baseSelectionRule.commit,
          path,
          blobId: GitBlobId('4444444444444444444444444444444444444444'),
        },
      }),
    })
    const bytes = new TextEncoder().encode(JSON.stringify({
      format: 'delivery-verification-plan@1',
      checks: inlineChecks,
    }))
    const resolveBlob = vi.fn(async (_request: unknown) => ({
      repositoryId: created.case.repositoryId,
      commit: revision.baseSelectionRule?.kind === 'commit' ? revision.baseSelectionRule.commit : fixture.baseCommit,
      path,
      blobId: GitBlobId('4444444444444444444444444444444444444444'),
      bytes,
    } as never))

    const packetRequest = {
      idempotencyKey: 'create-packet-git-blob-v2',
      contractRevisionId: revision.id,
      repository: {
        repositoryId: created.case.repositoryId,
        selectionRule: revision.baseSelectionRule,
        commit: revision.baseSelectionRule.commit,
      } as never,
      packet: packetDraft(fixture),
    }
    const packet = await local.ctx.delivery.createWorkPacket(packetRequest, resolveBlob)

    expect(resolveBlob).toHaveBeenCalledOnce()
    expect(resolveBlob.mock.calls[0]?.[0]).toEqual({
      repository: {
        repositoryId: created.case.repositoryId,
        selectionRule: revision.baseSelectionRule,
        commit: revision.baseSelectionRule.commit,
      },
      path,
      maxBytes: DELIVERY_VERIFICATION_SOURCE_MAX_BYTES,
    })
    expect(packet.verificationPlan.provenance).toEqual({
      kind: 'git-blob',
      baseCommit: revision.baseSelectionRule.commit,
      path,
      blobId: GitBlobId('4444444444444444444444444444444444444444'),
    })

    const exactLimitBytes = new Uint8Array(DELIVERY_VERIFICATION_SOURCE_MAX_BYTES)
    exactLimitBytes.fill(0x20)
    exactLimitBytes.set(bytes)
    await expect(local.ctx.delivery.createWorkPacket({
      idempotencyKey: 'create-packet-git-blob-exact-limit',
      contractRevisionId: revision.id,
      repository: {
        repositoryId: created.case.repositoryId,
        selectionRule: revision.baseSelectionRule,
        commit: revision.baseSelectionRule.commit,
      } as never,
      packet: packetDraft(fixture),
    }, async () => ({
      repositoryId: created.case.repositoryId,
      commit: revision.baseSelectionRule?.kind === 'commit' ? revision.baseSelectionRule.commit : fixture.baseCommit,
      path,
      blobId: GitBlobId('5555555555555555555555555555555555555555'),
      bytes: exactLimitBytes,
    } as never))).resolves.toMatchObject({
      verificationPlan: { checks: inlineChecks },
    })

    const multibyteDocument = JSON.stringify({
      format: 'delivery-verification-plan@1',
      checks: inlineChecks.map(check => ({
        ...check,
        name: '检查交付消费者',
      })),
    })
    const multibyteBytes = new TextEncoder().encode(multibyteDocument)
    expect(multibyteBytes.byteLength).toBeGreaterThan(multibyteDocument.length)
    await expect(local.ctx.delivery.createWorkPacket({
      idempotencyKey: 'create-packet-git-blob-multibyte',
      contractRevisionId: revision.id,
      repository: {
        repositoryId: created.case.repositoryId,
        selectionRule: revision.baseSelectionRule,
        commit: revision.baseSelectionRule.commit,
      } as never,
      packet: packetDraft(fixture),
    }, async () => ({
      repositoryId: created.case.repositoryId,
      commit: revision.baseSelectionRule?.kind === 'commit' ? revision.baseSelectionRule.commit : fixture.baseCommit,
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

  it('rejects missing, mismatched, oversized, and malformed revision Git blobs', async () => {
    const local = await harness(new MemoryMediaPool())
    const inlineChecks = [FIXTURE_CHECK]
    const path = RepositoryRelativePath('.dsh/delivery-verification.json')
    const otherPath = RepositoryRelativePath('.dsh/other-verification.json')
    const created = await createApprovedCase(local, 'git-blob-errors', {
      revision: revisionDraft({
        verificationSource: { kind: 'git-blob', path, format: 'delivery-verification-plan@1' },
      }),
    })
    const revision = created.revision
    if (revision.baseSelectionRule?.kind !== 'commit') {
      throw new Error('ready revision fixture unexpectedly lacks repository authority')
    }
    const fixture = readyPacketFixture({
      contractRevisionId: revision.id,
      repositoryId: created.case.repositoryId,
      baseCommit: revision.baseSelectionRule.commit,
      acceptanceClauseIds: revision.acceptanceClauses.map(clause => clause.id),
      verificationPlan: verificationPlanFixture({
        checks: inlineChecks,
        provenance: {
          kind: 'git-blob',
          baseCommit: revision.baseSelectionRule.commit,
          path,
          blobId: GitBlobId('4444444444444444444444444444444444444444'),
        },
      }),
    })
    const baseRequest = {
      contractRevisionId: revision.id,
      repository: {
        repositoryId: created.case.repositoryId,
        selectionRule: revision.baseSelectionRule,
        commit: revision.baseSelectionRule.commit,
      } as never,
      packet: packetDraft(fixture),
    }
    await expect(local.ctx.delivery.createWorkPacket({
      ...baseRequest,
      idempotencyKey: 'git-blob-missing-resolver',
    })).rejects.toMatchObject({ code: 'invalid-reference' })

    const validBytes = new TextEncoder().encode(JSON.stringify({
      format: 'delivery-verification-plan@1',
      checks: inlineChecks,
    }))
    const validBlob = {
      repositoryId: created.case.repositoryId,
      commit: revision.baseSelectionRule.commit,
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
      checks: inlineChecks.map(check => ({
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
    const packet = await storedPacket(first, 'binding-reopen')
    const dispatchRequest = {
      idempotencyKey: 'begin-change-dispatch-v2',
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
      packetId: readyPacketFixture().id,
      kind: 'code.verify@1',
      inputDigest: canonicalDigest({ packetId: readyPacketFixture().id }),
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
    const packet = await storedPacket(first, 'acceptance-reopen')
    const changeQueueWorkId = QueueWorkIdRef('queue-work-change-acceptance')
    const changeBinding = await first.ctx.delivery.bindDispatch({
      bindingId: (await first.ctx.delivery.beginDispatch({
        idempotencyKey: 'begin-change-for-acceptance-v2',
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
        idempotencyKey: 'begin-verify-for-acceptance-v2',
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
      idempotencyKey: 'accept-packet-local-v2',
      packetId: packet.id,
      changeBindingId: changeBinding.id,
      verificationBindingId: verificationBinding.id,
      decision: 'accepted' as const,
      reason: 'Independent verification passed and the result was reviewed.',
      actorId: HUMAN_ACTOR,
      decisionNonce: 'accept-packet-local-v2',
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
      actorId: HUMAN_ACTOR,
      decisionNonce: 'acceptance-authority-base',
    }
    const evidenceResolver = async (id: EvidenceId) => chain.evidence.get(id)
    const candidateResolver = vi.fn(async () => chain.candidate)

    await expect(local.ctx.delivery.recordAcceptanceDecision({
      ...baseRequest,
      idempotencyKey: 'acceptance-missing-packet',
      packetId: readyPacketFixture().id,
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

  it('rejects a version-1 domain medium before any write', async () => {
    const pool = new MemoryMediaPool()
    pool.versions.set('personal_delivery', 1)
    const legacyRecords = new Map<string, unknown>([['legacy-key', { legacy: true }]])
    pool.media.set('personal_delivery', {
      tables: new Map([['contract_revisions', legacyRecords]]),
      global: null,
    })
    const ctx = await failingHarness(pool)
    try {
      const outcome = await ctx.plugin(LocalDelivery).then(() => 'started' as const, (error: unknown) => error)
      expect(outcome).toBeInstanceOf(StorageError)
      expect(outcome instanceof Error ? outcome.message : String(outcome)).toMatch(/stamped v1/)
      expect(pool.versions.get('personal_delivery')).toBe(1)
      expect([...legacyRecords.keys()]).toEqual(['legacy-key'])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('reconstructs Cases, decisions, and publications byte-equal after restart', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    const created = await createApprovedCase(first, 'restart')
    const revised = await first.ctx.delivery.reviseCase({
      idempotencyKey: 'revise-restart',
      caseId: created.case.id,
      expectedHeadRevisionId: created.revision.id,
      origin: { kind: 'human', actorId: HUMAN_ACTOR },
      title: 'Revised delivery title',
      revision: revisionDraft({ outcome: 'A revised bounded change is implemented.' }),
    })
    const headDecision = await first.ctx.delivery.recordRequirementDecision(
      decisionRequest(revised, {}, 'decision-restart-head'),
    )
    const publication = await first.ctx.delivery.prepareIssuePublication(prepareRequest(revised, 'prepare-restart'))
    await first.ctx.delivery.markIssuePublicationStarted(publication.id)
    const published = await first.ctx.delivery.completeIssuePublication({
      publicationId: publication.id,
      expectedPhase: 'publishing',
      issue: issueRef(),
    } satisfies CompleteIssuePublicationRequest)
    const before = first.ctx.delivery.snapshot()
    await first.dispose()
    active.splice(active.indexOf(first), 1)

    const reopened = await harness(pool)
    const after = reopened.ctx.delivery.snapshot()
    expect(after.deliveryCases).toEqual(before.deliveryCases)
    expect(after.contractRevisions).toEqual(before.contractRevisions)
    expect(after.requirementDecisions).toEqual(before.requirementDecisions)
    expect(after.issuePublications).toEqual(before.issuePublications)
    expect(after.deliveryCases).toHaveLength(1)
    expect(after.issuePublications[0]).toMatchObject({ id: published.id, phase: 'published' })
    expect(reopened.ctx.delivery.getCase(created.case.id)).toEqual(revised.case)
    expect(reopened.ctx.delivery.getRequirementDecision(headDecision.id)).toEqual(headDecision)
    await expect(reopened.ctx.delivery.prepareIssuePublication(prepareRequest(revised, 'prepare-restart-replay')))
      .resolves.toEqual(after.issuePublications[0])
    await expect(reopened.ctx.delivery.recordRequirementDecision(
      decisionRequest(revised, {}, 'decision-restart-head'),
    )).resolves.toEqual(headDecision)
  })

  describe('Issue publication lifecycle', () => {
    it('walks prepared → publishing → published and rejects every illegal transition', async () => {
      const local = await harness(new MemoryMediaPool())
      const created = await createApprovedCase(local, 'published-path')
      const request = prepareRequest(created)
      const prepared = await local.ctx.delivery.prepareIssuePublication(request)
      expect(prepared.id).toBe(issuePublicationIdForRevision(created.case.id, created.revision.id))
      expect(prepared).toMatchObject({
        phase: 'prepared',
        issue: null,
        failure: null,
        caseId: created.case.id,
        revisionId: created.revision.id,
        marker: PUBLICATION_MARKER,
      })

      await expect(local.ctx.delivery.completeIssuePublication({
        publicationId: prepared.id,
        expectedPhase: 'publishing',
        issue: issueRef(),
      })).rejects.toMatchObject({ code: 'invalid-transition' })
      await expect(local.ctx.delivery.failIssuePublication({
        publicationId: prepared.id,
        expectedPhase: 'publishing',
        failure: notStartedFailure('never started'),
      })).rejects.toMatchObject({ code: 'invalid-transition' })
      await expect(local.ctx.delivery.resolveIssuePublication({
        resolution: 'confirm-published',
        publicationId: prepared.id,
        issue: issueRef(),
        verificationBasis: 'Host GET returned the exact marker and digest.',
      })).rejects.toMatchObject({ code: 'invalid-transition' })
      await expect(local.ctx.delivery.resolveIssuePublication({
        resolution: 'confirm-not-created',
        publicationId: prepared.id,
        verificationBasis: '   ',
      })).rejects.toMatchObject({ code: 'invalid-reference' })
      await expect(local.ctx.delivery.markIssuePublicationStarted(IssuePublicationId('missing-publication')))
        .rejects.toMatchObject({ code: 'not-found' })
      await expect(local.ctx.delivery.completeIssuePublication({
        publicationId: IssuePublicationId('missing-publication'),
        expectedPhase: 'publishing',
        issue: issueRef(),
      })).rejects.toMatchObject({ code: 'not-found' })

      const publishing = await local.ctx.delivery.markIssuePublicationStarted(prepared.id)
      expect(publishing).toMatchObject({ phase: 'publishing', issue: null, failure: null })
      await expect(local.ctx.delivery.markIssuePublicationStarted(prepared.id))
        .rejects.toMatchObject({ code: 'invalid-transition' })

      const published = await local.ctx.delivery.completeIssuePublication({
        publicationId: prepared.id,
        expectedPhase: 'publishing',
        issue: issueRef(),
      })
      expect(published).toMatchObject({ phase: 'published', issue: issueRef() })
      await expect(local.ctx.delivery.markIssuePublicationStarted(prepared.id))
        .rejects.toMatchObject({ code: 'invalid-transition' })
      await expect(local.ctx.delivery.completeIssuePublication({
        publicationId: prepared.id,
        expectedPhase: 'publishing',
        issue: issueRef(),
      })).rejects.toMatchObject({ code: 'invalid-transition' })
      await expect(local.ctx.delivery.failIssuePublication({
        publicationId: prepared.id,
        expectedPhase: 'publishing',
        failure: notStartedFailure('already published'),
      })).rejects.toMatchObject({ code: 'invalid-transition' })
      await expect(local.ctx.delivery.resolveIssuePublication({
        resolution: 'confirm-published',
        publicationId: prepared.id,
        issue: issueRef(),
        verificationBasis: 'Already published.',
      })).rejects.toMatchObject({ code: 'invalid-transition' })

      await expect(local.ctx.delivery.prepareIssuePublication({
        ...request,
        idempotencyKey: 'prepare-again-after-published',
      })).resolves.toEqual(published)
      expect(local.ctx.delivery.snapshot().issuePublications).toHaveLength(1)
    })

    it('validates the committed Issue reference against its coordinates', async () => {
      const local = await harness(new MemoryMediaPool())
      const created = await createApprovedCase(local, 'issue-validation')
      const prepared = await local.ctx.delivery.prepareIssuePublication(prepareRequest(created, 'prepare-issue-validation'))
      const publishing = await local.ctx.delivery.markIssuePublicationStarted(prepared.id)
      const driftedReader = gitHubIssueRefSchema.safeParse({
        repository: IMPORT_REPOSITORY,
        issueNumber: 102,
        url: canonicalGitHubIssueUrl(IMPORT_REPOSITORY, 101),
      })
      expect(driftedReader.success).toBe(false)
      await expect(local.ctx.delivery.completeIssuePublication({
        publicationId: publishing.id,
        expectedPhase: 'publishing',
        issue: { repository: IMPORT_REPOSITORY, issueNumber: 102, url: canonicalGitHubIssueUrl(IMPORT_REPOSITORY, 101) },
      })).rejects.toThrow()
      const published = await local.ctx.delivery.completeIssuePublication({
        publicationId: publishing.id,
        expectedPhase: 'publishing',
        issue: issueRef({ issueNumber: 102 }),
      })
      expect(published.issue).toEqual(issueRef({ issueNumber: 102 }))
    })

    it('records a not-started failure and resets the same record for a new attempt', async () => {
      const local = await harness(new MemoryMediaPool())
      const created = await createApprovedCase(local, 'failed-reset')
      const request = prepareRequest(created, 'prepare-failed-reset')
      const prepared = await local.ctx.delivery.prepareIssuePublication(request)
      await local.ctx.delivery.markIssuePublicationStarted(prepared.id)
      const failed = await local.ctx.delivery.failIssuePublication({
        publicationId: prepared.id,
        expectedPhase: 'publishing',
        failure: notStartedFailure('credential rejected before the request'),
      })
      expect(failed).toMatchObject({
        phase: 'failed',
        id: prepared.id,
        issue: null,
        failure: { sideEffect: 'not-started', category: 'transport' },
      })

      const reset = await local.ctx.delivery.prepareIssuePublication({
        ...request,
        idempotencyKey: 'prepare-failed-retry',
      })
      expect(reset.id).toBe(prepared.id)
      expect(reset).toMatchObject({ phase: 'prepared', issue: null, failure: null })
      expect(local.ctx.delivery.snapshot().issuePublications).toHaveLength(1)
      await expect(local.ctx.delivery.prepareIssuePublication({
        ...request,
        idempotencyKey: 'prepare-failed-retry',
      })).resolves.toEqual(reset)
      await expect(local.ctx.delivery.failIssuePublication({
        publicationId: reset.id,
        expectedPhase: 'publishing',
        failure: notStartedFailure('cannot fail from prepared'),
      })).rejects.toMatchObject({ code: 'invalid-transition' })

      await local.ctx.delivery.markIssuePublicationStarted(reset.id)
      const unknown = await local.ctx.delivery.failIssuePublication({
        publicationId: reset.id,
        expectedPhase: 'publishing',
        failure: unknownFailure('connection lost after the request was sent'),
      })
      expect(unknown).toMatchObject({
        phase: 'unknown',
        id: prepared.id,
        failure: { sideEffect: 'unknown', category: 'transport' },
      })
      await expect(local.ctx.delivery.prepareIssuePublication({
        ...request,
        idempotencyKey: 'prepare-while-unknown',
      })).rejects.toMatchObject({ code: 'invalid-transition' })

      const resolved = await local.ctx.delivery.resolveIssuePublication({
        resolution: 'confirm-not-created',
        publicationId: unknown.id,
        verificationBasis: 'The GitHub POST returned 422 and a Host GET returned 404 for the expected Issue location.',
      })
      expect(resolved.id).toBe(prepared.id)
      expect(resolved).toMatchObject({ phase: 'prepared', issue: null, failure: null })
      await expect(local.ctx.delivery.resolveIssuePublication({
        resolution: 'confirm-not-created',
        publicationId: resolved.id,
        verificationBasis: 'Operator impression only.',
      })).rejects.toMatchObject({ code: 'invalid-transition' })
      expect(local.ctx.delivery.snapshot().issuePublications).toHaveLength(1)
    })

    it('confirms an uncertain publication as published only through human resolution', async () => {
      const local = await harness(new MemoryMediaPool())
      const created = await createApprovedCase(local, 'confirm-published')
      const prepared = await local.ctx.delivery.prepareIssuePublication(prepareRequest(created, 'prepare-confirm'))
      await local.ctx.delivery.markIssuePublicationStarted(prepared.id)
      const unknown = await local.ctx.delivery.failIssuePublication({
        publicationId: prepared.id,
        expectedPhase: 'publishing',
        failure: unknownFailure('response never arrived'),
      })
      const confirmed = await local.ctx.delivery.resolveIssuePublication({
        resolution: 'confirm-published',
        publicationId: unknown.id,
        issue: issueRef(),
        verificationBasis: 'A fresh Host GET validated the exact marker and rendered digest.',
      })
      expect(confirmed).toMatchObject({ phase: 'published', issue: issueRef(), failure: null })
      await expect(local.ctx.delivery.resolveIssuePublication({
        resolution: 'confirm-not-created',
        publicationId: confirmed.id,
        verificationBasis: 'Already confirmed.',
      })).rejects.toMatchObject({ code: 'invalid-transition' })
      expect(local.ctx.delivery.getIssuePublication(prepared.id)).toEqual(confirmed)
    })

    it('resolves a crash-stalled publishing record back to prepared', async () => {
      const local = await harness(new MemoryMediaPool())
      const created = await createApprovedCase(local, 'stalled-publishing')
      const prepared = await local.ctx.delivery.prepareIssuePublication(prepareRequest(created, 'prepare-stalled'))
      await local.ctx.delivery.markIssuePublicationStarted(prepared.id)
      const resolved = await local.ctx.delivery.resolveIssuePublication({
        resolution: 'confirm-not-created',
        publicationId: prepared.id,
        verificationBasis: 'The process crashed before the POST; the backend log shows no request left the host.',
      })
      expect(resolved).toMatchObject({ phase: 'prepared', issue: null, failure: null })
      const publishingAgain = await local.ctx.delivery.markIssuePublicationStarted(prepared.id)
      const confirmed = await local.ctx.delivery.resolveIssuePublication({
        resolution: 'confirm-published',
        publicationId: publishingAgain.id,
        issue: issueRef({ issueNumber: 103 }),
        verificationBasis: 'The Issue exists and carries the exact marker after restart.',
      })
      expect(confirmed).toMatchObject({ phase: 'published', issue: issueRef({ issueNumber: 103 }) })
    })

    it('refuses preparation without an approved ready revision or a matching Case', async () => {
      const local = await harness(new MemoryMediaPool())
      const unapproved = await local.ctx.delivery.createCase(createCaseRequest({}, 'case-unapproved-publication'))
      await expect(local.ctx.delivery.prepareIssuePublication(prepareRequest(unapproved, 'prepare-unapproved')))
        .rejects.toMatchObject({ code: 'approval-required' })

      await local.ctx.delivery.recordRequirementDecision(decisionRequest(unapproved, {
        decision: 'deferred',
        reason: 'Waiting on product input.',
      }, 'decision-deferred-publication'))
      await expect(local.ctx.delivery.prepareIssuePublication(prepareRequest(unapproved, 'prepare-deferred')))
        .rejects.toMatchObject({ code: 'approval-required' })

      const notReady = await local.ctx.delivery.createCase(
        createCaseRequest({ revision: revisionDraft({ outcome: null }) }, 'case-not-ready-publication'),
      )
      await local.ctx.delivery.recordRequirementDecision(decisionRequest(notReady, {}, 'decision-not-ready-publication'))
      await expect(local.ctx.delivery.prepareIssuePublication(prepareRequest(notReady, 'prepare-not-ready')))
        .rejects.toMatchObject({ code: 'invalid-reference' })

      const approved = await createApprovedCase(local, 'publication-cross-case')
      const other = await local.ctx.delivery.createCase(createCaseRequest({}, 'case-other-publication'))
      await expect(local.ctx.delivery.prepareIssuePublication(prepareRequest(
        { case: other.case, revision: approved.revision },
        'prepare-cross-case',
      ))).rejects.toMatchObject({ code: 'invalid-reference' })
      await expect(local.ctx.delivery.prepareIssuePublication(prepareRequest(
        { case: approved.case, revision: approved.revision },
        'prepare-missing-case',
        { caseId: DeliveryCaseId('missing-delivery-case') },
      ))).rejects.toMatchObject({ code: 'not-found' })
      await expect(local.ctx.delivery.prepareIssuePublication(prepareRequest(
        approved,
        'prepare-missing-revision',
        { revisionId: ContractRevisionId('missing-contract-revision') },
      ))).rejects.toMatchObject({ code: 'not-found' })
    })

    it('replays preparation idempotently for one revision across keys', async () => {
      const local = await harness(new MemoryMediaPool())
      const created = await createApprovedCase(local, 'prepare-idempotent')
      const request = prepareRequest(created, 'prepare-idempotent-first')
      const first = await local.ctx.delivery.prepareIssuePublication(request)
      await expect(local.ctx.delivery.prepareIssuePublication(request)).resolves.toEqual(first)
      await expect(local.ctx.delivery.prepareIssuePublication({
        ...request,
        idempotencyKey: 'prepare-idempotent-second',
      })).resolves.toEqual(first)
      await expect(local.ctx.delivery.prepareIssuePublication({
        ...request,
        idempotencyKey: 'prepare-idempotent-first',
        marker: 'different-marker',
      })).rejects.toMatchObject({ code: 'idempotency-conflict' })
      expect(local.ctx.delivery.snapshot().issuePublications).toEqual([first])
    })
  })
})
