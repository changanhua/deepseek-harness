/** Public request and read-model types for the Personal Delivery domain. @module @deepseek-ai/dsh-delivery/types */

import type {
  AcceptanceClauseId,
  AcceptanceDecision,
  CodeVerifyIntent,
  CompletionClaim,
  ContractRevision,
  ContractRevisionId,
  DispatchBinding,
  DispatchBindingId,
  EvidenceId,
  EvidenceRef,
  ExecutorId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryId,
  RepositoryRelativePath,
  Sha256Digest,
  SourceRef,
  VerificationVerdict,
  WorkPacket,
  WorkPacketId,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  VerifiedRepositoryBase,
  VerifiedRepositoryBlob,
} from '@deepseek-ai/dsh-repo-workspace'

/** GitHub Issue snapshot fields whose durable identity and timestamp are allocated by {@link Delivery.adoptContractRevision}. */
export interface SourceRefDraft {
  readonly repository: SourceRef['repository']
  readonly issueNumber: number
  readonly canonicalUrl: string
  readonly updatedAt: string
  readonly title: string
  readonly body: string
  readonly contentDigest: Sha256Digest
}

/** Immutable requirement fields adopted beside one exact {@link SourceRefDraft}. */
export interface ContractRevisionDraft {
  readonly previousRevisionId: ContractRevisionId | null
  readonly repositoryId: RepositoryId | null
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

/** Idempotent adoption of one exact source snapshot and its interpreted requirement revision. */
export interface AdoptContractRevisionRequest {
  readonly idempotencyKey: string
  readonly source: SourceRefDraft
  readonly revision: ContractRevisionDraft
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

/** Idempotent creation of one immutable packet from a ready Contract revision. */
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
}

/** Provider-independent Delivery domain failures. */
export type DeliveryErrorCode =
  | 'unavailable'
  | 'not-found'
  | 'idempotency-conflict'
  | 'invalid-reference'
  | 'invalid-transition'
  | 'acceptance-denied'
