/** Schema-validated deterministic fixtures for Delivery Protocol V2. */

import {
  AcceptanceClauseId,
  AcceptanceDecisionId,
  CompletionClaimId,
  ContractRevisionId,
  DELIVERY_SCHEMA_VERSION,
  DeliveryCaseId,
  DispatchBindingId,
  EvidenceId,
  ExecutorId,
  GitCommitId,
  IssuePublicationId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryId,
  RepositoryRelativePath,
  RequirementDecisionId,
  VerificationCheckId,
  VerificationVerdictId,
  WorkPacketId,
  acceptanceDecisionSchema,
  canonicalDigest,
  canonicalGitHubIssueUrl,
  completionClaimSchema,
  contractRevisionSchema,
  deliveryCaseSchema,
  dispatchBindingSchema,
  evidenceBytesDigest,
  evidenceRefSchema,
  githubIssueContentDigest,
  issuePublicationSchema,
  requirementDecisionSchema,
  requirementOriginSchema,
  resumeCapsuleContentSchema,
  verificationCheckDigest,
  verificationPlanDigest,
  verificationPlanSchema,
  verificationVerdictSchema,
  workPacketDigest,
  workPacketSchema,
  type AcceptanceDecision,
  type CompletionClaim,
  type ContractRevision,
  type DeliveryCase,
  type DispatchBinding,
  type EvidenceRef,
  type GitHubIssueRef,
  type GitHubRepositoryRef,
  type IssuePublication,
  type PublicationFailure,
  type RequirementDecision,
  type RequirementOrigin,
  type ResumeCapsuleContent,
  type Sha256Digest,
  type VerificationCheck,
  type VerificationPlan,
  type VerificationVerdict,
  type WorkPacket,
  type WorkPacketDigestInput,
} from '@changanhua/dsh-delivery-protocol'

const FIXTURE_TIME = '2026-08-29T00:00:00.000Z'
const BASE_COMMIT = GitCommitId('1111111111111111111111111111111111111111')
const TARGET_COMMIT = GitCommitId('2222222222222222222222222222222222222222')
const CONTRACT_ID = ContractRevisionId('contract-revision-fixture')
const CASE_ID = DeliveryCaseId('delivery-case-fixture')
const DECISION_ID = RequirementDecisionId('requirement-decision-fixture')
const PUBLICATION_ID = IssuePublicationId('issue-publication-fixture')
const PACKET_ID = WorkPacketId('work-packet-fixture')
const QUEUE_WORK_ID = QueueWorkIdRef('queue-work-fixture')
const QUEUE_ATTEMPT_ID = QueueAttemptIdRef('queue-attempt-fixture')
const EVIDENCE_ID = EvidenceId('evidence-fixture')
const CHECK_ID = VerificationCheckId('verification-check-fixture')
const DEFAULT_EVIDENCE_BYTES = new TextEncoder().encode('delivery fixture evidence\n')
const IMPORT_REPOSITORY: GitHubRepositoryRef = { owner: 'deepseek-ai', name: 'deepseek-harness' }
const DEFAULT_TITLE = 'Deliver one bounded change'
const DEFAULT_BODY = 'Implement the accepted outcome and collect independent evidence.'
const DEFAULT_PUBLICATION_MARKER = '<!-- dsh-delivery:issue-publication-fixture -->'

type CompletedClaim = Extract<CompletionClaim, { readonly disposition: 'completed' }>
type SubmittingBinding = Extract<DispatchBinding, { readonly phase: 'submitting' }>
type BoundBinding = Extract<DispatchBinding, { readonly phase: 'bound' }>
type BindingOverrides = Partial<SubmittingBinding> | Partial<BoundBinding>

/** Overrides for the `github-import` origin builder; omitted digest fields derive from title and body. */
export interface GithubImportOriginOverrides {
  readonly repository?: GitHubRepositoryRef
  readonly issueNumber?: number
  readonly title?: string
  readonly body?: string
  readonly contentDigest?: Sha256Digest
}

/** Overrides that permit intentionally invalid phase combinations for schema-negative tests. */
export interface IssuePublicationOverrides {
  readonly schemaVersion?: IssuePublication['schemaVersion']
  readonly id?: IssuePublication['id']
  readonly caseId?: IssuePublication['caseId']
  readonly revisionId?: IssuePublication['revisionId']
  readonly repository?: GitHubRepositoryRef
  readonly renderedDigest?: IssuePublication['renderedDigest']
  readonly marker?: string
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly phase?: IssuePublication['phase']
  readonly issue?: GitHubIssueRef | null
  readonly failure?: PublicationFailure | null
  readonly issueNumber?: number
}

const DEFAULT_CHECK: VerificationCheck = {
  id: CHECK_ID,
  name: 'Typecheck Delivery consumer',
  argv: ['pnpm', 'exec', 'tsc', '--noEmit'],
  cwd: '.',
  timeoutMs: 60_000,
  severity: 'required',
  expectedExitCodes: [0],
}

function bindingFixtureFields(overrides: BindingOverrides) {
  const packetId = overrides.packetId ?? PACKET_ID
  return {
    schemaVersion: overrides.schemaVersion ?? DELIVERY_SCHEMA_VERSION,
    id: overrides.id ?? DispatchBindingId('dispatch-binding-fixture'),
    packetId,
    inputDigest: overrides.inputDigest ?? canonicalDigest({ packetId }),
    idempotencyKey: overrides.idempotencyKey ?? 'dispatch-fixture-v2',
    kind: overrides.kind ?? 'code.change@1',
    executorId: overrides.executorId ?? ExecutorId('codex-fixture'),
    createdAt: overrides.createdAt ?? FIXTURE_TIME,
    updatedAt: overrides.updatedAt ?? FIXTURE_TIME,
  }
}

/**
 * Build a fresh `github-import` requirement origin with a derived content digest.
 * @param overrides - Exact origin fields to replace, plus the title and body feeding the digest.
 * @returns a schema-validated detached requirement origin.
 */
export function githubImportOriginFixture(overrides: GithubImportOriginOverrides = {}): RequirementOrigin {
  const repository = overrides.repository ?? IMPORT_REPOSITORY
  const issueNumber = overrides.issueNumber ?? 101
  const title = overrides.title ?? DEFAULT_TITLE
  const body = overrides.body ?? DEFAULT_BODY
  return requirementOriginSchema.parse({
    kind: 'github-import',
    repository,
    issueNumber,
    contentDigest: overrides.contentDigest ?? githubIssueContentDigest({ title, body }),
  })
}

/**
 * Build a fresh immutable requirement revision carrying origin and title provenance.
 * @param overrides - Exact fixture fields to replace.
 * @returns a schema-validated detached Contract revision.
 */
export function contractRevisionFixture(overrides: Partial<ContractRevision> = {}): ContractRevision {
  return contractRevisionSchema.parse({
    schemaVersion: overrides.schemaVersion ?? DELIVERY_SCHEMA_VERSION,
    id: overrides.id ?? CONTRACT_ID,
    previousRevisionId: overrides.previousRevisionId !== undefined ? overrides.previousRevisionId : null,
    origin: overrides.origin ?? { kind: 'human', actorId: 'developer-fixture' },
    title: overrides.title ?? DEFAULT_TITLE,
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
 * Build a fresh Delivery Case anchored on the default Contract revision.
 * @param overrides - Exact fixture fields to replace.
 * @returns a schema-validated detached Delivery Case.
 */
export function deliveryCaseFixture(overrides: Partial<DeliveryCase> = {}): DeliveryCase {
  return deliveryCaseSchema.parse({
    schemaVersion: overrides.schemaVersion ?? DELIVERY_SCHEMA_VERSION,
    id: overrides.id ?? CASE_ID,
    repositoryId: overrides.repositoryId ?? RepositoryId('repository-fixture'),
    headRevisionId: overrides.headRevisionId ?? CONTRACT_ID,
    createdAt: overrides.createdAt ?? FIXTURE_TIME,
    updatedAt: overrides.updatedAt ?? FIXTURE_TIME,
  })
}

/**
 * Build a fresh human requirement decision over the default Contract revision.
 * @param overrides - Exact fixture fields to replace.
 * @returns a schema-validated detached requirement decision.
 */
export function requirementDecisionFixture(overrides: Partial<RequirementDecision> = {}): RequirementDecision {
  return requirementDecisionSchema.parse({
    schemaVersion: overrides.schemaVersion ?? DELIVERY_SCHEMA_VERSION,
    id: overrides.id ?? DECISION_ID,
    caseId: overrides.caseId ?? CASE_ID,
    revisionId: overrides.revisionId ?? CONTRACT_ID,
    decision: overrides.decision ?? 'approved',
    reason: overrides.reason ?? 'Requirement reviewed and approved.',
    actor: overrides.actor ?? { kind: 'human', actorId: 'developer-fixture' },
    decisionNonce: overrides.decisionNonce ?? 'requirement-decision-fixture-v2',
    decidedAt: overrides.decidedAt ?? FIXTURE_TIME,
  })
}

/**
 * Build a fresh Issue publication in any phase with phase-consistent defaults.
 * @param overrides - Exact fixture fields to replace, plus the default published-Issue number.
 * @returns a schema-validated detached Issue publication.
 */
export function issuePublicationFixture(overrides: IssuePublicationOverrides = {}): IssuePublication {
  const phase = overrides.phase ?? 'prepared'
  const repository = overrides.repository ?? IMPORT_REPOSITORY
  const issueNumber = overrides.issueNumber ?? 101
  const issue = overrides.issue !== undefined
    ? overrides.issue
    : phase === 'published'
      ? { repository, issueNumber, url: canonicalGitHubIssueUrl(repository, issueNumber) }
      : null
  const failure = overrides.failure !== undefined
    ? overrides.failure
    : phase === 'failed'
      ? {
        sideEffect: 'not-started' as const,
        category: 'transport' as const,
        detail: 'The publication request never reached GitHub.',
        occurredAt: FIXTURE_TIME,
      }
      : phase === 'unknown'
        ? {
          sideEffect: 'unknown' as const,
          category: 'transport' as const,
          detail: 'The publication request timed out after it may have reached GitHub.',
          occurredAt: FIXTURE_TIME,
        }
        : null
  return issuePublicationSchema.parse({
    schemaVersion: overrides.schemaVersion ?? DELIVERY_SCHEMA_VERSION,
    id: overrides.id ?? PUBLICATION_ID,
    caseId: overrides.caseId ?? CASE_ID,
    revisionId: overrides.revisionId ?? CONTRACT_ID,
    repository,
    renderedDigest: overrides.renderedDigest ?? canonicalDigest({ marker: DEFAULT_PUBLICATION_MARKER }),
    marker: overrides.marker ?? DEFAULT_PUBLICATION_MARKER,
    createdAt: overrides.createdAt ?? FIXTURE_TIME,
    updatedAt: overrides.updatedAt ?? FIXTURE_TIME,
    phase,
    issue,
    failure,
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
    ...bindingFixtureFields(overrides),
    phase: 'submitting',
    queueWorkId: null,
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
    ...bindingFixtureFields(overrides),
    phase: 'bound',
    queueWorkId: overrides.queueWorkId ?? QUEUE_WORK_ID,
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
    decisionNonce: overrides.decisionNonce ?? 'acceptance-fixture-v2',
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
