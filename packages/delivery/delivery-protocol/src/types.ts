/** Queue-independent durable Personal Delivery declarations. */

import type {
  AcceptanceClauseId,
  AcceptanceDecisionId,
  CompletionClaimId,
  ContractRevisionId,
  DispatchBindingId,
  EvidenceId,
  ExecutorId,
  GitBlobId,
  GitCommitId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryId,
  RepositoryRelativePath,
  Sha256Digest,
  SourceRefId,
  VerificationCheckId,
  VerificationVerdictId,
  WorkPacketId,
} from './brand.ts'

/** Current durable protocol version. */
export type DeliverySchemaVersion = 1
/** Supported ownerless Queue kinds. */
export type DeliveryWorkKind = 'code.change@1' | 'code.verify@1'

/** GitHub repository coordinates carried by one imported snapshot. */
export interface GitHubRepositoryRef {
  readonly owner: string
  readonly name: string
}

/** Exact GitHub Issue snapshot adopted by a contract revision. */
export interface SourceRef {
  readonly schemaVersion: DeliverySchemaVersion
  readonly id: SourceRefId
  readonly provider: 'github'
  readonly repository: GitHubRepositoryRef
  readonly issueNumber: number
  readonly canonicalUrl: string
  readonly updatedAt: string
  readonly title: string
  readonly body: string
  readonly contentDigest: Sha256Digest
  readonly createdAt: string
}

/** Human-verifiable outcome clause. */
export interface AcceptanceClause {
  readonly id: AcceptanceClauseId
  readonly text: string
}

/** Product decision that still blocks a contract from readiness. */
export interface OpenDecision {
  readonly id: string
  readonly question: string
}

/** Immutable rule for selecting a Packet base. */
export type BaseSelectionRule =
  | { readonly kind: 'commit'; readonly commit: GitCommitId }
  | { readonly kind: 'ref-head'; readonly ref: string }

/** One allowed or forbidden repository path boundary. */
export interface PathRule {
  readonly kind: 'exact' | 'subtree'
  readonly path: RepositoryRelativePath
}

/** One trusted fixed-argv validation check. */
export interface VerificationCheck {
  readonly id: VerificationCheckId
  readonly name: string
  /** Non-empty fixed argv, enforced at every Protocol runtime boundary. */
  readonly argv: readonly string[]
  readonly cwd: '.' | RepositoryRelativePath
  readonly timeoutMs: number
  readonly severity: 'required' | 'optional'
  readonly expectedExitCodes: readonly number[]
}

/** Contract-owned source from which a trusted plan is resolved. */
export type ContractVerificationSource =
  | { readonly kind: 'contract-field'; readonly checks: readonly VerificationCheck[] }
  | {
    readonly kind: 'git-blob'
    readonly path: RepositoryRelativePath
    readonly format: 'delivery-verification-plan@1'
  }

/** Strict JSON document stored by a Contract-owned Git-blob verification source. */
export interface VerificationPlanDocument {
  readonly format: 'delivery-verification-plan@1'
  readonly checks: readonly VerificationCheck[]
}

/** Link retained as supporting contract context. */
export interface ReferenceLink {
  readonly label: string
  readonly url: string
}

/** Immutable adoption of one Issue snapshot and its delivery boundary. */
export interface ContractRevision {
  readonly schemaVersion: DeliverySchemaVersion
  readonly id: ContractRevisionId
  readonly previousRevisionId: ContractRevisionId | null
  readonly sourceRef: SourceRef
  readonly repositoryId: RepositoryId | null
  readonly outcome: string | null
  readonly context: string
  readonly allowedScope: readonly string[]
  readonly forbiddenScope: readonly string[]
  readonly acceptanceClauses: readonly AcceptanceClause[]
  readonly openDecisions: readonly OpenDecision[]
  readonly baseSelectionRule: BaseSelectionRule | null
  readonly verificationSource: ContractVerificationSource | null
  readonly referenceLinks: readonly ReferenceLink[]
  readonly createdAt: string
}

/** Machine-readable reason that a syntactically valid Contract is not ready. */
export type ContractReadinessReason =
  | 'missing-outcome'
  | 'missing-repository'
  | 'missing-scope'
  | 'missing-acceptance'
  | 'missing-base-selection'
  | 'missing-verification-source'
  | 'open-decisions'

/** Readiness projection; never persisted as another Contract status. */
export interface ContractReadiness {
  readonly ready: boolean
  readonly reasons: readonly ContractReadinessReason[]
}

/** Immutable provenance for a resolved trusted verification plan. */
export type VerificationPlanProvenance =
  | {
    readonly kind: 'contract-field'
    readonly contractRevisionId: ContractRevisionId
    readonly field: 'verificationSource'
  }
  | {
    readonly kind: 'git-blob'
    readonly baseCommit: GitCommitId
    readonly path: RepositoryRelativePath
    readonly blobId: GitBlobId
  }

/** Resolved fixed-argv plan carried by one Packet. */
export interface VerificationPlan {
  readonly checks: readonly VerificationCheck[]
  readonly provenance: VerificationPlanProvenance
  readonly digest: Sha256Digest
}

/** Explicit executor preference captured by a Packet. */
export type ExecutorPreference =
  | { readonly mode: 'any' }
  | { readonly mode: 'preferred' | 'required'; readonly executorId: ExecutorId }

/** Immutable bounded execution unit. */
export interface WorkPacket {
  readonly schemaVersion: DeliverySchemaVersion
  readonly id: WorkPacketId
  readonly contractRevisionId: ContractRevisionId
  readonly repositoryId: RepositoryId
  readonly baseCommit: GitCommitId
  readonly objective: string
  readonly allowedPaths: readonly PathRule[]
  readonly forbiddenPaths: readonly PathRule[]
  readonly acceptanceClauseIds: readonly AcceptanceClauseId[]
  readonly verificationPlan: VerificationPlan
  readonly stopConditions: readonly string[]
  readonly executorPreference: ExecutorPreference
  readonly packetDigest: Sha256Digest
  readonly createdAt: string
}

/** Pending or completed cross-store Queue admission binding. */
export type DispatchBinding = {
  readonly schemaVersion: DeliverySchemaVersion
  readonly id: DispatchBindingId
  readonly packetId: WorkPacketId
  readonly inputDigest: Sha256Digest
  readonly idempotencyKey: string
  readonly createdAt: string
  readonly updatedAt: string
} & (
  | { readonly phase: 'submitting'; readonly queueWorkId: null }
  | { readonly phase: 'bound'; readonly queueWorkId: QueueWorkIdRef }
) & (
  | { readonly kind: 'code.change@1'; readonly executorId: ExecutorId }
  | { readonly kind: 'code.verify@1'; readonly executorId: null }
)

/** Fields shared by every truthful completion disposition. */
export interface CompletionClaimCommon {
  readonly schemaVersion: DeliverySchemaVersion
  readonly id: CompletionClaimId
  readonly packetId: WorkPacketId
  readonly queueWorkId: QueueWorkIdRef
  readonly queueAttemptId: QueueAttemptIdRef
  readonly summary: string
  readonly completedWork: readonly string[]
  readonly remainingWork: readonly string[]
  readonly checkpointCommit: GitCommitId | null
  readonly changedPaths: readonly RepositoryRelativePath[]
  readonly evidenceIds: readonly EvidenceId[]
  readonly resumeCapsuleEvidenceId: EvidenceId | null
  readonly createdAt: string
}

/** Successful business output; only `completed` is eligible for verification. */
export type CompletionClaim = CompletionClaimCommon & (
  | { readonly disposition: 'completed'; readonly checkpointCommit: GitCommitId }
  | { readonly disposition: 'blocked'; readonly blocker: string; readonly nextSmallestAction: string }
  | { readonly disposition: 'needs-decision'; readonly question: string }
  | { readonly disposition: 'needs-scope-change'; readonly proposedScopeDelta: string; readonly reason: string }
)

/** Result of one resolved verification command. */
export type VerificationCheckResult = {
  readonly checkId: VerificationCheckId
  readonly checkDigest: Sha256Digest
  readonly severity: 'required' | 'optional'
  readonly durationMs: number
  readonly evidenceIds: readonly EvidenceId[]
} & (
  | { readonly status: 'exited'; readonly exitCode: number; readonly expected: boolean }
  | { readonly status: 'timed-out' }
)

/** Integrity result for one required or optional evidence object. */
export interface EvidenceIntegrityFinding {
  readonly evidenceId: EvidenceId
  readonly required: boolean
  readonly status: 'verified' | 'missing' | 'digest-mismatch' | 'size-mismatch'
}

/** Changed path that violates the Packet boundary. */
export interface ChangedPathFinding {
  readonly path: RepositoryRelativePath
  readonly kind: 'forbidden' | 'outside-allowed'
}

/** Independent verdict for one immutable target and plan. */
export interface VerificationVerdict {
  readonly schemaVersion: DeliverySchemaVersion
  readonly id: VerificationVerdictId
  readonly packetId: WorkPacketId
  readonly targetCommit: GitCommitId
  readonly baseCommit: GitCommitId
  readonly verificationPlanDigest: Sha256Digest
  readonly status: 'passed' | 'failed' | 'needs-human-review'
  readonly ancestryResult: 'descendant' | 'not-descendant'
  readonly checkResults: readonly VerificationCheckResult[]
  readonly evidenceIntegrityFindings: readonly EvidenceIntegrityFinding[]
  readonly changedPathFindings: readonly ChangedPathFinding[]
  readonly evidenceIds: readonly EvidenceId[]
  readonly verifierVersion: string
  readonly reviewReasons: readonly string[]
  readonly completedAt: string
}

/** Explicit human-only delivery disposition. */
export interface AcceptanceDecision {
  readonly schemaVersion: DeliverySchemaVersion
  readonly id: AcceptanceDecisionId
  readonly packetId: WorkPacketId
  readonly targetCommit: GitCommitId
  readonly verdictId: VerificationVerdictId
  readonly decision: 'accepted' | 'rejected' | 'waived'
  readonly reason: string
  readonly actor: { readonly kind: 'human'; readonly actorId: string }
  readonly decisionNonce: string
  readonly decidedAt: string
}

/** Supported immutable evidence labels. */
export type EvidenceKind =
  | 'log'
  | 'git-diff-metadata'
  | 'patch'
  | 'checkpoint-metadata'
  | 'verification-output'
  | 'screenshot'
  | 'resume-capsule'

/** Provenance binding evidence to the Queue attempt or verification check that produced it. */
export type EvidenceProvenance =
  | {
    readonly kind: 'change-attempt'
    readonly packetId: WorkPacketId
    readonly queueWorkId: QueueWorkIdRef
    readonly queueAttemptId: QueueAttemptIdRef
  }
  | {
    readonly kind: 'verification-check'
    readonly packetId: WorkPacketId
    readonly queueWorkId: QueueWorkIdRef
    readonly queueAttemptId: QueueAttemptIdRef
    readonly checkId: VerificationCheckId
  }

/** Immutable content-addressed evidence metadata. */
export interface EvidenceRef {
  readonly schemaVersion: DeliverySchemaVersion
  readonly id: EvidenceId
  readonly kind: EvidenceKind
  readonly mediaType: string
  readonly uri: string
  readonly byteLength: number
  readonly digest: Sha256Digest
  readonly createdAt: string
  readonly provenance: EvidenceProvenance
}

/** Latest Queue Attempt facts compiled into a Resume Capsule. */
export interface ResumeAttemptFacts {
  readonly queueWorkId: QueueWorkIdRef
  readonly queueAttemptId: QueueAttemptIdRef
  readonly status: 'starting' | 'running' | 'unknown' | 'succeeded' | 'failed' | 'canceled'
  readonly sideEffect: 'not-started' | 'started' | 'unknown'
  readonly startedAt: string
  readonly finishedAt: string | null
}

/** Failed check summary retained without raw transcript authority. */
export interface ResumeFailingCheck {
  readonly checkId: VerificationCheckId
  readonly summary: string
  readonly evidenceIds: readonly EvidenceId[]
}

/** Compiled content stored as one `resume-capsule` evidence object. */
export interface ResumeCapsuleContent {
  readonly schemaVersion: DeliverySchemaVersion
  readonly contractRevisionId: ContractRevisionId
  readonly packetId: WorkPacketId
  readonly objective: string
  readonly baseCommit: GitCommitId
  readonly checkpointCommit: GitCommitId | null
  readonly completedChanges: readonly string[]
  readonly latestAttempt: ResumeAttemptFacts
  readonly failingChecks: readonly ResumeFailingCheck[]
  readonly decisions: readonly string[]
  readonly rejectedApproaches: readonly string[]
  readonly openQuestions: readonly string[]
  readonly knownRisks: readonly string[]
  readonly nextSmallestAction: string
  readonly relevantFiles: readonly RepositoryRelativePath[]
  readonly evidenceIds: readonly EvidenceId[]
  readonly compiledAt: string
}

/** Caller intent for Queue kind `code.change@1`. */
export interface CodeChangeIntent { readonly packetId: WorkPacketId }
/** Admission-resolved specification for Queue kind `code.change@1`. */
export interface ResolvedCodeChange {
  readonly packetId: WorkPacketId
  readonly contractRevisionId: ContractRevisionId
  readonly repositoryId: RepositoryId
  readonly baseCommit: GitCommitId
  readonly executorId: ExecutorId
  readonly policyDigest: Sha256Digest
}
/** Successful output for Queue kind `code.change@1`. */
export interface CodeChangeOutput { readonly completionClaim: CompletionClaim }

/** Caller intent for Queue kind `code.verify@1`. */
export interface CodeVerifyIntent {
  readonly packetId: WorkPacketId
  readonly targetCommit: GitCommitId
  readonly verificationPlanDigest: Sha256Digest
}
/** Admission-resolved specification for Queue kind `code.verify@1`. */
export interface ResolvedCodeVerify {
  readonly packetId: WorkPacketId
  readonly contractRevisionId: ContractRevisionId
  readonly repositoryId: RepositoryId
  readonly baseCommit: GitCommitId
  readonly targetCommit: GitCommitId
  readonly trustedPlan: VerificationPlan
}
/** Successful output for Queue kind `code.verify@1`. */
export interface CodeVerifyOutput { readonly verificationVerdict: VerificationVerdict }
