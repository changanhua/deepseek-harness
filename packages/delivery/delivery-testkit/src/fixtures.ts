/** Schema-validated deterministic fixtures for Delivery Protocol V1. */

import {
  AcceptanceClauseId,
  AcceptanceDecisionId,
  CompletionClaimId,
  ContractRevisionId,
  DELIVERY_SCHEMA_VERSION,
  DispatchBindingId,
  EvidenceId,
  ExecutorId,
  GitCommitId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryId,
  RepositoryRelativePath,
  SourceRefId,
  VerificationCheckId,
  VerificationVerdictId,
  WorkPacketId,
  acceptanceDecisionSchema,
  canonicalGitHubIssueUrl,
  canonicalDigest,
  completionClaimSchema,
  contractRevisionSchema,
  dispatchBindingSchema,
  evidenceBytesDigest,
  evidenceRefSchema,
  resumeCapsuleContentSchema,
  sourceRefContentDigest,
  sourceRefSchema,
  verificationCheckDigest,
  verificationPlanDigest,
  verificationPlanSchema,
  verificationVerdictSchema,
  workPacketDigest,
  workPacketSchema,
  type AcceptanceDecision,
  type CompletionClaim,
  type ContractRevision,
  type DispatchBinding,
  type EvidenceRef,
  type ResumeCapsuleContent,
  type SourceRef,
  type VerificationCheck,
  type VerificationPlan,
  type VerificationVerdict,
  type WorkPacket,
  type WorkPacketDigestInput,
} from '@deepseek-ai/dsh-delivery-protocol'

const FIXTURE_TIME = '2026-08-29T00:00:00.000Z'
const BASE_COMMIT = GitCommitId('1111111111111111111111111111111111111111')
const TARGET_COMMIT = GitCommitId('2222222222222222222222222222222222222222')
const CONTRACT_ID = ContractRevisionId('contract-revision-fixture')
const PACKET_ID = WorkPacketId('work-packet-fixture')
const QUEUE_WORK_ID = QueueWorkIdRef('queue-work-fixture')
const QUEUE_ATTEMPT_ID = QueueAttemptIdRef('queue-attempt-fixture')
const EVIDENCE_ID = EvidenceId('evidence-fixture')
const CHECK_ID = VerificationCheckId('verification-check-fixture')
const DEFAULT_EVIDENCE_BYTES = new TextEncoder().encode('delivery fixture evidence\n')

type CompletedClaim = Extract<CompletionClaim, { readonly disposition: 'completed' }>
type SubmittingBinding = Extract<DispatchBinding, { readonly phase: 'submitting' }>
type BoundBinding = Extract<DispatchBinding, { readonly phase: 'bound' }>

const DEFAULT_CHECK: VerificationCheck = {
  id: CHECK_ID,
  name: 'Typecheck Delivery consumer',
  argv: ['pnpm', 'exec', 'tsc', '--noEmit'],
  cwd: '.',
  timeoutMs: 60_000,
  severity: 'required',
  expectedExitCodes: [0],
}

/**
 * Build a fresh immutable GitHub Issue snapshot with derived canonical URL and content digest.
 * @param overrides - Exact fixture fields to replace.
 * @returns a schema-validated detached SourceRef.
 */
export function sourceRefFixture(overrides: Partial<SourceRef> = {}): SourceRef {
  const title = overrides.title ?? 'Deliver one bounded change'
  const body = overrides.body ?? 'Implement the accepted outcome and collect independent evidence.'
  const repository = overrides.repository ?? { owner: 'deepseek-ai', name: 'deepseek-harness' }
  const issueNumber = overrides.issueNumber ?? 101
  return sourceRefSchema.parse({
    schemaVersion: overrides.schemaVersion ?? DELIVERY_SCHEMA_VERSION,
    id: overrides.id ?? SourceRefId('source-ref-fixture'),
    provider: overrides.provider ?? 'github',
    repository,
    issueNumber,
    canonicalUrl: overrides.canonicalUrl ?? canonicalGitHubIssueUrl(repository, issueNumber),
    updatedAt: overrides.updatedAt ?? FIXTURE_TIME,
    title,
    body,
    contentDigest: overrides.contentDigest ?? sourceRefContentDigest({ title, body }),
    createdAt: overrides.createdAt ?? FIXTURE_TIME,
  })
}

/**
 * Build a fresh ready Contract revision whose references are internally valid.
 * @param overrides - Exact fixture fields to replace.
 * @returns a schema-validated detached Contract revision.
 */
export function contractRevisionFixture(overrides: Partial<ContractRevision> = {}): ContractRevision {
  return contractRevisionSchema.parse({
    schemaVersion: overrides.schemaVersion ?? DELIVERY_SCHEMA_VERSION,
    id: overrides.id ?? CONTRACT_ID,
    previousRevisionId: overrides.previousRevisionId !== undefined ? overrides.previousRevisionId : null,
    sourceRef: overrides.sourceRef ?? sourceRefFixture(),
    repositoryId: overrides.repositoryId !== undefined ? overrides.repositoryId : RepositoryId('repository-fixture'),
    outcome: overrides.outcome !== undefined
      ? overrides.outcome
      : 'A bounded change is implemented and independently verified.',
    context: overrides.context ?? 'The Consumer needs a deterministic Delivery contract.',
    allowedScope: overrides.allowedScope ?? ['Delivery package sources and focused tests'],
    forbiddenScope: overrides.forbiddenScope ?? ['Unrelated product behavior'],
    acceptanceClauses: overrides.acceptanceClauses ?? [{
      id: AcceptanceClauseId('acceptance-clause-fixture'),
      text: 'Focused verification passes for the bounded change.',
    }],
    openDecisions: overrides.openDecisions ?? [],
    baseSelectionRule: overrides.baseSelectionRule !== undefined
      ? overrides.baseSelectionRule
      : { kind: 'commit', commit: BASE_COMMIT },
    verificationSource: overrides.verificationSource !== undefined ? overrides.verificationSource : {
      kind: 'contract-field',
      checks: [DEFAULT_CHECK],
    },
    referenceLinks: overrides.referenceLinks ?? [{
      label: 'Delivery subsystem',
      url: 'https://github.com/deepseek-ai/deepseek-harness',
    }],
    createdAt: overrides.createdAt ?? FIXTURE_TIME,
  })
}

/**
 * Build a fresh trusted plan with a digest derived from its checks and provenance.
 * @param overrides - Exact fixture fields to replace.
 * @returns a schema-validated detached verification plan.
 */
export function verificationPlanFixture(overrides: Partial<VerificationPlan> = {}): VerificationPlan {
  const checks = overrides.checks ?? [DEFAULT_CHECK]
  const provenance = overrides.provenance ?? {
    kind: 'contract-field' as const,
    contractRevisionId: CONTRACT_ID,
    field: 'verificationSource' as const,
  }
  return verificationPlanSchema.parse({
    checks,
    provenance,
    digest: overrides.digest ?? verificationPlanDigest({ checks, provenance }),
  })
}

/**
 * Build a fresh ready Work Packet with a derived semantic packet digest.
 * @param overrides - Exact fixture fields to replace.
 * @returns a schema-validated detached Work Packet.
 */
export function readyWorkPacketFixture(overrides: Partial<WorkPacket> = {}): WorkPacket {
  const digestInput: WorkPacketDigestInput = {
    schemaVersion: overrides.schemaVersion ?? DELIVERY_SCHEMA_VERSION,
    contractRevisionId: overrides.contractRevisionId ?? CONTRACT_ID,
    repositoryId: overrides.repositoryId ?? RepositoryId('repository-fixture'),
    baseCommit: overrides.baseCommit ?? BASE_COMMIT,
    objective: overrides.objective ?? 'Implement the bounded Delivery fixture change.',
    allowedPaths: overrides.allowedPaths ?? [{ kind: 'subtree', path: RepositoryRelativePath('packages/delivery') }],
    forbiddenPaths: overrides.forbiddenPaths ?? [{ kind: 'subtree', path: RepositoryRelativePath('packages/unrelated') }],
    acceptanceClauseIds: overrides.acceptanceClauseIds ?? [AcceptanceClauseId('acceptance-clause-fixture')],
    verificationPlan: overrides.verificationPlan ?? verificationPlanFixture({
      provenance: {
        kind: 'contract-field',
        contractRevisionId: overrides.contractRevisionId ?? CONTRACT_ID,
        field: 'verificationSource',
      },
    }),
    stopConditions: overrides.stopConditions ?? ['Stop when repository facts do not match the Contract.'],
    executorPreference: overrides.executorPreference ?? { mode: 'preferred', executorId: ExecutorId('codex-fixture') },
  }
  return workPacketSchema.parse({
    ...digestInput,
    id: overrides.id ?? PACKET_ID,
    packetDigest: overrides.packetDigest ?? workPacketDigest(digestInput),
    createdAt: overrides.createdAt ?? FIXTURE_TIME,
  })
}

/**
 * Build a fresh submitting code-change binding.
 * @param overrides - Exact fixture fields to replace.
 * @returns a schema-validated detached submitting binding.
 */
export function submittingBindingFixture(overrides: Partial<SubmittingBinding> = {}): SubmittingBinding {
  const value = dispatchBindingSchema.parse({
    schemaVersion: overrides.schemaVersion ?? DELIVERY_SCHEMA_VERSION,
    id: overrides.id ?? DispatchBindingId('dispatch-binding-fixture'),
    packetId: overrides.packetId ?? PACKET_ID,
    inputDigest: overrides.inputDigest ?? canonicalDigest({ packetId: overrides.packetId ?? PACKET_ID }),
    idempotencyKey: overrides.idempotencyKey ?? 'dispatch-fixture-v1',
    phase: 'submitting',
    queueWorkId: null,
    kind: overrides.kind ?? 'code.change@1',
    executorId: overrides.executorId ?? ExecutorId('codex-fixture'),
    createdAt: overrides.createdAt ?? FIXTURE_TIME,
    updatedAt: overrides.updatedAt ?? FIXTURE_TIME,
  })
  return value as SubmittingBinding
}

/**
 * Build a fresh bound code-change binding.
 * @param overrides - Exact fixture fields to replace.
 * @returns a schema-validated detached bound binding.
 */
export function boundBindingFixture(overrides: Partial<BoundBinding> = {}): BoundBinding {
  const value = dispatchBindingSchema.parse({
    schemaVersion: overrides.schemaVersion ?? DELIVERY_SCHEMA_VERSION,
    id: overrides.id ?? DispatchBindingId('dispatch-binding-fixture'),
    packetId: overrides.packetId ?? PACKET_ID,
    inputDigest: overrides.inputDigest ?? canonicalDigest({ packetId: overrides.packetId ?? PACKET_ID }),
    idempotencyKey: overrides.idempotencyKey ?? 'dispatch-fixture-v1',
    phase: 'bound',
    queueWorkId: overrides.queueWorkId ?? QUEUE_WORK_ID,
    kind: overrides.kind ?? 'code.change@1',
    executorId: overrides.executorId ?? ExecutorId('codex-fixture'),
    createdAt: overrides.createdAt ?? FIXTURE_TIME,
    updatedAt: overrides.updatedAt ?? FIXTURE_TIME,
  })
  return value as BoundBinding
}

/**
 * Build a fresh completed claim with Git evidence from its producing Attempt.
 * @param overrides - Exact fixture fields to replace.
 * @returns a schema-validated detached completed claim.
 */
export function completedClaimFixture(overrides: Partial<CompletedClaim> = {}): CompletedClaim {
  const value = completionClaimSchema.parse({
    schemaVersion: overrides.schemaVersion ?? DELIVERY_SCHEMA_VERSION,
    id: overrides.id ?? CompletionClaimId('completion-claim-fixture'),
    packetId: overrides.packetId ?? PACKET_ID,
    queueWorkId: overrides.queueWorkId ?? QUEUE_WORK_ID,
    queueAttemptId: overrides.queueAttemptId ?? QUEUE_ATTEMPT_ID,
    summary: overrides.summary ?? 'The bounded change was implemented and checkpointed.',
    completedWork: overrides.completedWork ?? ['Implemented the requested behavior.'],
    remainingWork: overrides.remainingWork ?? [],
    disposition: 'completed',
    checkpointCommit: overrides.checkpointCommit ?? TARGET_COMMIT,
    changedPaths: overrides.changedPaths ?? [RepositoryRelativePath('packages/delivery/example.ts')],
    evidenceIds: overrides.evidenceIds ?? [EVIDENCE_ID],
    resumeCapsuleEvidenceId: overrides.resumeCapsuleEvidenceId !== undefined
      ? overrides.resumeCapsuleEvidenceId
      : null,
    createdAt: overrides.createdAt ?? FIXTURE_TIME,
  })
  return value as CompletedClaim
}

/**
 * Build a fresh passed verdict whose check identities match the default trusted plan.
 * @param overrides - Exact fixture fields to replace.
 * @returns a schema-validated detached verification verdict.
 */
export function passedVerdictFixture(overrides: Partial<VerificationVerdict> = {}): VerificationVerdict {
  const plan = verificationPlanFixture()
  const evidenceIds = overrides.evidenceIds ?? [EVIDENCE_ID]
  return verificationVerdictSchema.parse({
    schemaVersion: overrides.schemaVersion ?? DELIVERY_SCHEMA_VERSION,
    id: overrides.id ?? VerificationVerdictId('verification-verdict-fixture'),
    packetId: overrides.packetId ?? PACKET_ID,
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
    verifierVersion: overrides.verifierVersion ?? 'delivery-testkit/1',
    reviewReasons: overrides.reviewReasons ?? [],
    completedAt: overrides.completedAt ?? FIXTURE_TIME,
  })
}

/**
 * Build a fresh human acceptance decision matching the default passed verdict.
 * @param overrides - Exact fixture fields to replace.
 * @returns a schema-validated detached acceptance decision.
 */
export function acceptedDecisionFixture(overrides: Partial<AcceptanceDecision> = {}): AcceptanceDecision {
  return acceptanceDecisionSchema.parse({
    schemaVersion: overrides.schemaVersion ?? DELIVERY_SCHEMA_VERSION,
    id: overrides.id ?? AcceptanceDecisionId('acceptance-decision-fixture'),
    packetId: overrides.packetId ?? PACKET_ID,
    targetCommit: overrides.targetCommit ?? TARGET_COMMIT,
    verdictId: overrides.verdictId ?? VerificationVerdictId('verification-verdict-fixture'),
    decision: overrides.decision ?? 'accepted',
    reason: overrides.reason ?? 'Independent verification passed and the outcome was reviewed.',
    actor: overrides.actor ?? { kind: 'human', actorId: 'developer-fixture' },
    decisionNonce: overrides.decisionNonce ?? 'acceptance-fixture-v1',
    decidedAt: overrides.decidedAt ?? FIXTURE_TIME,
  })
}

/**
 * Build a fresh content-addressed Git evidence reference.
 * @param overrides - Exact fixture fields to replace.
 * @returns a schema-validated detached evidence reference.
 */
export function evidenceRefFixture(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  const id = overrides.id ?? EVIDENCE_ID
  return evidenceRefSchema.parse({
    schemaVersion: overrides.schemaVersion ?? DELIVERY_SCHEMA_VERSION,
    id,
    kind: overrides.kind ?? 'git-diff-metadata',
    mediaType: overrides.mediaType ?? 'application/json',
    uri: overrides.uri ?? `memory://delivery-evidence/${encodeURIComponent(id)}`,
    byteLength: overrides.byteLength ?? DEFAULT_EVIDENCE_BYTES.byteLength,
    digest: overrides.digest ?? evidenceBytesDigest(DEFAULT_EVIDENCE_BYTES),
    createdAt: overrides.createdAt ?? FIXTURE_TIME,
    provenance: overrides.provenance ?? {
      kind: 'change-attempt',
      packetId: PACKET_ID,
      queueWorkId: QUEUE_WORK_ID,
      queueAttemptId: QUEUE_ATTEMPT_ID,
    },
  })
}

/**
 * Build a fresh compact resume capsule for the default interrupted Attempt.
 * @param overrides - Exact fixture fields to replace.
 * @returns a schema-validated detached resume capsule.
 */
export function resumeCapsuleFixture(overrides: Partial<ResumeCapsuleContent> = {}): ResumeCapsuleContent {
  return resumeCapsuleContentSchema.parse({
    schemaVersion: overrides.schemaVersion ?? DELIVERY_SCHEMA_VERSION,
    contractRevisionId: overrides.contractRevisionId ?? CONTRACT_ID,
    packetId: overrides.packetId ?? PACKET_ID,
    objective: overrides.objective ?? 'Resume the bounded Delivery fixture change.',
    baseCommit: overrides.baseCommit ?? BASE_COMMIT,
    checkpointCommit: overrides.checkpointCommit !== undefined ? overrides.checkpointCommit : TARGET_COMMIT,
    completedChanges: overrides.completedChanges ?? ['Implemented the first bounded step.'],
    latestAttempt: overrides.latestAttempt ?? {
      queueWorkId: QUEUE_WORK_ID,
      queueAttemptId: QUEUE_ATTEMPT_ID,
      status: 'failed',
      sideEffect: 'started',
      startedAt: FIXTURE_TIME,
      finishedAt: '2026-08-29T00:01:00.000Z',
    },
    failingChecks: overrides.failingChecks ?? [{
      checkId: CHECK_ID,
      summary: 'The focused typecheck failed.',
      evidenceIds: [EVIDENCE_ID],
    }],
    decisions: overrides.decisions ?? ['Keep the original Packet boundary.'],
    rejectedApproaches: overrides.rejectedApproaches ?? ['Do not broaden the repository scope.'],
    openQuestions: overrides.openQuestions ?? [],
    knownRisks: overrides.knownRisks ?? ['The failed check must pass before acceptance.'],
    nextSmallestAction: overrides.nextSmallestAction ?? 'Fix the focused type error and rerun verification.',
    relevantFiles: overrides.relevantFiles ?? [RepositoryRelativePath('packages/delivery/example.ts')],
    evidenceIds: overrides.evidenceIds ?? [EVIDENCE_ID],
    compiledAt: overrides.compiledAt ?? FIXTURE_TIME,
  })
}
