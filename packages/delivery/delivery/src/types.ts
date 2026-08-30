/** Public request and read-model types for the Personal Delivery domain. @module @deepseek-ai/dsh-delivery/types */

import type {
  AcceptanceClauseId,
  AcceptanceDecision,
  CodeVerifyIntent,
  CompletionClaim,
  ContractRevision,
  ContractRevisionId,
  DeliveryCase,
  DeliveryCaseId,
  DispatchBinding,
  DispatchBindingId,
  EvidenceId,
  EvidenceRef,
  ExecutorId,
  GitHubIssueRef,
  GitHubRepositoryRef,
  IssuePublication,
  IssuePublicationId,
  PublicationFailure,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryId,
  RepositoryRelativePath,
  RequirementDecision,
  RequirementOrigin,
  Sha256Digest,
  VerificationVerdict,
  WorkPacket,
  WorkPacketId,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  VerifiedRepositoryBase,
  VerifiedRepositoryBlob,
} from '@deepseek-ai/dsh-repo-workspace'

/**
 * Requirement content fields chosen by the caller for one new revision.
 * The provider allocates the revision identity, lineage, provenance,
 * repository binding, and timestamp; callers never supply them here.
 */
export interface ContractRevisionDraft {
  readonly outcome: string | null
  readonly context: string
  readonly allowedScope: readonly string[]
  readonly forbiddenScope: readonly string[]
  readonly acceptanceClauses: readonly { readonly id: AcceptanceClauseId; readonly text: string }[]
  readonly openDecisions: ContractRevision['openDecisions']
  readonly baseSelectionRule: ContractRevision['baseSelectionRule']
  readonly verificationSource: ContractRevision['verificationSource']
  readonly referenceLinks: ContractRevision['referenceLinks']
}

/**
 * Atomic creation of one Delivery Case together with its root requirement
 * revision. The root revision has a `null` `previousRevisionId` and carries
 * the request's origin and title verbatim.
 */
export interface CreateDeliveryCaseRequest {
  readonly idempotencyKey: string
  /** Repository the Case anchors; also written into the root revision. */
  readonly repositoryId: RepositoryId
  readonly origin: RequirementOrigin
  readonly title: string
  readonly revision: ContractRevisionDraft
}

/**
 * Expected-head compare-and-set revision of one existing Delivery Case.
 * The child revision's `previousRevisionId` is the expected head, and the
 * Case head moves to the child in the same critical section; a head that has
 * already moved fails closed instead of branching the Case.
 */
export interface ReviseDeliveryCaseRequest {
  readonly idempotencyKey: string
  readonly caseId: DeliveryCaseId
  /** Head revision the caller observed; the write fails unless it is still current. */
  readonly expectedHeadRevisionId: ContractRevisionId
  readonly origin: RequirementOrigin
  readonly title: string
  readonly revision: ContractRevisionDraft
}

/**
 * Human requirement decision over one exact Case revision. A revision has at
 * most one decision: repeating identical content returns the existing record,
 * while different content under the same revision fails closed.
 */
export interface RecordRequirementDecisionRequest {
  readonly idempotencyKey: string
  readonly caseId: DeliveryCaseId
  readonly revisionId: ContractRevisionId
  readonly decision: RequirementDecision['decision']
  readonly reason: string
  readonly actorId: string
  readonly decisionNonce: string
}

/**
 * First durable publication intent for one approved ready Case revision.
 * A revision has at most one publication: repeated preparation returns the
 * existing record, and re-preparing a failed publication resets that same
 * record to `prepared` for a new attempt.
 */
export interface PrepareIssuePublicationRequest {
  readonly idempotencyKey: string
  readonly caseId: DeliveryCaseId
  readonly revisionId: ContractRevisionId
  readonly repository: GitHubRepositoryRef
  readonly renderedDigest: Sha256Digest
  readonly marker: string
}

/** Commit of one verified published GitHub Issue onto a `publishing` record. */
export interface CompleteIssuePublicationRequest {
  readonly publicationId: IssuePublicationId
  /** Concurrency boundary: the transition fails closed unless the record is still `publishing`. */
  readonly expectedPhase: 'publishing'
  /** Exact GitHub Issue coordinates validated by the publisher before this call. */
  readonly issue: GitHubIssueRef
}

/**
 * Truthful failure classification for one started publication attempt.
 * `sideEffect: 'not-started'` lands the record in `failed`; `sideEffect:
 * 'unknown'` lands it in `unknown` for human resolution.
 */
export interface FailIssuePublicationRequest {
  readonly publicationId: IssuePublicationId
  /** Concurrency boundary: the transition fails closed unless the record is still `publishing`. */
  readonly expectedPhase: 'publishing'
  readonly failure: PublicationFailure
}

/**
 * Human-authorized resolution of an unresolved publication.
 * `confirm-published` moves an `unknown` or stalled `publishing` record to
 * `published` with the exact verified Issue coordinates; `confirm-not-created`
 * returns one to `prepared` after an authoritative verification basis proves
 * no Issue was created.
 */
export type ResolveIssuePublicationRequest =
  | {
    readonly resolution: 'confirm-published'
    readonly publicationId: IssuePublicationId
    readonly issue: GitHubIssueRef
    /** Human-recorded verification basis; blank text is rejected. */
    readonly verificationBasis: string
  }
  | {
    readonly resolution: 'confirm-not-created'
    readonly publicationId: IssuePublicationId
    /** Explicit verification basis proving the Issue was never created; operator impression alone is rejected. */
    readonly verificationBasis: string
  }

/** Packet fields chosen by the operator after repository and base verification. */
export interface WorkPacketDraft {
  readonly objective: string
  readonly allowedPaths: WorkPacket['allowedPaths']
  readonly forbiddenPaths: WorkPacket['forbiddenPaths']
  readonly acceptanceClauseIds: readonly AcceptanceClauseId[]
  readonly stopConditions: readonly string[]
  readonly executorPreference: WorkPacket['executorPreference']
}

/** Idempotent creation of one immutable packet from an approved ready revision. */
export interface CreateWorkPacketRequest {
  readonly idempotencyKey: string
  readonly contractRevisionId: ContractRevisionId
  readonly repository: VerifiedRepositoryBase
  readonly packet: WorkPacketDraft
}

/** Provider-selected repository blob lookup for one Contract-owned verification source. */
export interface ResolveVerificationSourceRequest {
  readonly repository: VerifiedRepositoryBase
  readonly path: RepositoryRelativePath
  /** Maximum complete blob length chosen by Delivery before any bytes are returned. */
  readonly maxBytes: number
}

/**
 * Operation-local repository authority used only for a Contract `git-blob` source.
 * Delivery chooses the already verified base and Contract-owned path.
 */
export type VerificationSourceResolver = (
  request: ResolveVerificationSourceRequest,
) => Promise<VerifiedRepositoryBlob>

interface BeginDispatchCommon {
  readonly idempotencyKey: string
  readonly packetId: WorkPacketId
  readonly inputDigest: Sha256Digest
}

/** Begin the Delivery side of one cross-store Queue admission handshake. */
export type BeginDispatchRequest = BeginDispatchCommon & (
  | { readonly kind: 'code.change@1'; readonly executorId: ExecutorId }
  | { readonly kind: 'code.verify@1' }
)

/** Conditionally attach the Queue Work identity returned for a submitting binding. */
export interface BindDispatchRequest {
  readonly bindingId: DispatchBindingId
  readonly queueWorkId: QueueWorkIdRef
}

/** Queue-owned facts resolved for the two exact Work identities selected by Delivery. */
export interface AcceptanceCandidateFacts {
  readonly completionClaim: CompletionClaim
  readonly changeQueueAttemptId: QueueAttemptIdRef
  readonly verificationIntent: CodeVerifyIntent
  readonly verificationVerdict: VerificationVerdict
  readonly verificationQueueAttemptId: QueueAttemptIdRef
}

/**
 * Operation-local authority for resolving Queue-owned acceptance facts.
 *
 * Delivery supplies both Work identities from already validated bound dispatches.
 * This callback is a host capability, never part of a browser or durable DTO.
 */
export type AcceptanceCandidateResolver = (
  changeQueueWorkId: QueueWorkIdRef,
  verificationQueueWorkId: QueueWorkIdRef,
) => Promise<AcceptanceCandidateFacts>

/**
 * Operation-local integrity lookup invoked by Delivery for each exact referenced id.
 * The host must resolve the ref and successfully read its bytes before returning it.
 */
export type AcceptanceEvidenceResolver = (
  evidenceId: EvidenceId,
) => Promise<EvidenceRef | undefined>

/** Human-authored decision input containing only Delivery-owned durable references and decision fields. */
export interface RecordAcceptanceDecisionRequest {
  readonly idempotencyKey: string
  readonly packetId: WorkPacketId
  readonly changeBindingId: DispatchBindingId
  readonly verificationBindingId: DispatchBindingId
  readonly decision: AcceptanceDecision['decision']
  readonly reason: string
  readonly actorId: string
  readonly decisionNonce: string
}

/** Stable Delivery-owned records; Queue lifecycle and UI lanes are deliberately absent. */
export interface DeliverySnapshot {
  readonly contractRevisions: readonly ContractRevision[]
  readonly workPackets: readonly WorkPacket[]
  readonly dispatchBindings: readonly DispatchBinding[]
  readonly acceptanceDecisions: readonly AcceptanceDecision[]
  readonly deliveryCases: readonly DeliveryCase[]
  readonly requirementDecisions: readonly RequirementDecision[]
  readonly issuePublications: readonly IssuePublication[]
}

/** Provider-independent Delivery domain failures. */
export type DeliveryErrorCode =
  | 'unavailable'
  | 'not-found'
  | 'idempotency-conflict'
  | 'invalid-reference'
  | 'invalid-transition'
  | 'conflict'
  | 'approval-required'
  | 'acceptance-denied'
