/** Validated constructors for identifiers and value brands owned by Delivery Protocol. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one immutable delivery-contract revision. */
export type ContractRevisionId = Branded<'DeliveryContractRevisionId'>
/** Identifies one durable Personal Delivery Case. */
export type DeliveryCaseId = Branded<'DeliveryCaseId'>
/** Identifies one human requirement decision over a Case revision. */
export type RequirementDecisionId = Branded<'DeliveryRequirementDecisionId'>
/** Identifies one Issue publication attempt for a Case revision. */
export type IssuePublicationId = Branded<'DeliveryIssuePublicationId'>
/** Identifies one immutable bounded work packet. */
export type WorkPacketId = Branded<'DeliveryWorkPacketId'>
/** Identifies one persisted Queue-admission handshake. */
export type DispatchBindingId = Branded<'DeliveryDispatchBindingId'>
/** Identifies one successful business output from code-change work. */
export type CompletionClaimId = Branded<'DeliveryCompletionClaimId'>
/** Identifies one independent verification verdict. */
export type VerificationVerdictId = Branded<'DeliveryVerificationVerdictId'>
/** Identifies one explicit human delivery decision. */
export type AcceptanceDecisionId = Branded<'DeliveryAcceptanceDecisionId'>
/** Identifies immutable evidence bytes and metadata. */
export type EvidenceId = Branded<'DeliveryEvidenceId'>
/** Identifies one acceptance clause within a contract revision. */
export type AcceptanceClauseId = Branded<'DeliveryAcceptanceClauseId'>
/** Identifies one resolved verification check. */
export type VerificationCheckId = Branded<'DeliveryVerificationCheckId'>
/** Identifies a configured local Git repository without exposing its host path. */
export type RepositoryId = Branded<'DeliveryRepositoryId'>
/** Identifies a selected executor provider. */
export type ExecutorId = Branded<'DeliveryExecutorId'>
/** Queue-owned Work id retained as an opaque durable reference. */
export type QueueWorkIdRef = Branded<'DeliveryQueueWorkIdRef'>
/** Queue-owned Attempt id retained as an opaque durable reference. */
export type QueueAttemptIdRef = Branded<'DeliveryQueueAttemptIdRef'>
/** Full lowercase Git SHA-1 or SHA-256 object id naming a commit. */
export type GitCommitId = Branded<'DeliveryGitCommitId'>
/** Full lowercase Git SHA-1 or SHA-256 object id naming a blob. */
export type GitBlobId = Branded<'DeliveryGitBlobId'>
/** Lowercase SHA-256 digest in `sha256:<64 hex>` form. */
export type Sha256Digest = Branded<'DeliverySha256Digest'>
/** Normalized repository-relative path using forward slashes. */
export type RepositoryRelativePath = Branded<'DeliveryRepositoryRelativePath'>

const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u

function opaqueId(label: string, value: string): string {
  if (value.trim().length === 0) throw new TypeError(`${label} must be non-blank`)
  return value
}

/**
 * Validate and brand a ContractRevision identity.
 * @param value - Non-blank ContractRevision identity.
 * @returns the validated branded identity.
 */
export const ContractRevisionId = (value: string): ContractRevisionId => opaqueId('ContractRevisionId', value) as ContractRevisionId
/**
 * Validate and brand a DeliveryCase identity.
 * @param value - Non-blank DeliveryCase identity.
 * @returns the validated branded identity.
 */
export const DeliveryCaseId = (value: string): DeliveryCaseId => opaqueId('DeliveryCaseId', value) as DeliveryCaseId
/**
 * Validate and brand a RequirementDecision identity.
 * @param value - Non-blank RequirementDecision identity.
 * @returns the validated branded identity.
 */
export const RequirementDecisionId = (value: string): RequirementDecisionId => opaqueId('RequirementDecisionId', value) as RequirementDecisionId
/**
 * Validate and brand an IssuePublication identity.
 * @param value - Non-blank IssuePublication identity.
 * @returns the validated branded identity.
 */
export const IssuePublicationId = (value: string): IssuePublicationId => opaqueId('IssuePublicationId', value) as IssuePublicationId
/**
 * Validate and brand a WorkPacket identity.
 * @param value - Non-blank WorkPacket identity.
 * @returns the validated branded identity.
 */
export const WorkPacketId = (value: string): WorkPacketId => opaqueId('WorkPacketId', value) as WorkPacketId
/**
 * Validate and brand a DispatchBinding identity.
 * @param value - Non-blank DispatchBinding identity.
 * @returns the validated branded identity.
 */
export const DispatchBindingId = (value: string): DispatchBindingId => opaqueId('DispatchBindingId', value) as DispatchBindingId
/**
 * Validate and brand a CompletionClaim identity.
 * @param value - Non-blank CompletionClaim identity.
 * @returns the validated branded identity.
 */
export const CompletionClaimId = (value: string): CompletionClaimId => opaqueId('CompletionClaimId', value) as CompletionClaimId
/**
 * Validate and brand a VerificationVerdict identity.
 * @param value - Non-blank VerificationVerdict identity.
 * @returns the validated branded identity.
 */
export const VerificationVerdictId = (value: string): VerificationVerdictId => opaqueId('VerificationVerdictId', value) as VerificationVerdictId
/**
 * Validate and brand an AcceptanceDecision identity.
 * @param value - Non-blank AcceptanceDecision identity.
 * @returns the validated branded identity.
 */
export const AcceptanceDecisionId = (value: string): AcceptanceDecisionId => opaqueId('AcceptanceDecisionId', value) as AcceptanceDecisionId
/**
 * Validate and brand an Evidence identity.
 * @param value - Non-blank Evidence identity.
 * @returns the validated branded identity.
 */
export const EvidenceId = (value: string): EvidenceId => opaqueId('EvidenceId', value) as EvidenceId
/**
 * Validate and brand an acceptance-clause identity.
 * @param value - Non-blank acceptance-clause identity.
 * @returns the validated branded identity.
 */
export const AcceptanceClauseId = (value: string): AcceptanceClauseId => opaqueId('AcceptanceClauseId', value) as AcceptanceClauseId
/**
 * Validate and brand a verification-check identity.
 * @param value - Non-blank verification-check identity.
 * @returns the validated branded identity.
 */
export const VerificationCheckId = (value: string): VerificationCheckId => opaqueId('VerificationCheckId', value) as VerificationCheckId
/**
 * Validate and brand a configured repository identity.
 * @param value - Non-blank configured repository identity.
 * @returns the validated branded identity.
 */
export const RepositoryId = (value: string): RepositoryId => opaqueId('RepositoryId', value) as RepositoryId
/**
 * Validate and brand an executor identity.
 * @param value - Non-blank executor identity.
 * @returns the validated branded identity.
 */
export const ExecutorId = (value: string): ExecutorId => opaqueId('ExecutorId', value) as ExecutorId
/**
 * Validate and brand an opaque Queue Work reference.
 * @param value - Non-blank Queue Work identity.
 * @returns the validated opaque reference.
 */
export const QueueWorkIdRef = (value: string): QueueWorkIdRef => opaqueId('QueueWorkIdRef', value) as QueueWorkIdRef
/**
 * Validate and brand an opaque Queue Attempt reference.
 * @param value - Non-blank Queue Attempt identity.
 * @returns the validated opaque reference.
 */
export const QueueAttemptIdRef = (value: string): QueueAttemptIdRef => opaqueId('QueueAttemptIdRef', value) as QueueAttemptIdRef

function gitObjectId(label: string, value: string): string {
  if (!GIT_OBJECT_ID.test(value)) {
    throw new TypeError(`${label} must be a full lowercase 40- or 64-hex Git object id`)
  }
  return value
}

/**
 * Validate and brand a full Git commit object id.
 * @param value - Full lowercase Git object id.
 * @returns the validated commit identity.
 */
export const GitCommitId = (value: string): GitCommitId => gitObjectId('GitCommitId', value) as GitCommitId
/**
 * Validate and brand a full Git blob object id.
 * @param value - Full lowercase Git object id.
 * @returns the validated blob identity.
 */
export const GitBlobId = (value: string): GitBlobId => gitObjectId('GitBlobId', value) as GitBlobId

/**
 * Validate and brand a lowercase SHA-256 digest.
 * @param value - Candidate `sha256:<64 lowercase hex>` value.
 * @returns the validated digest.
 */
export function Sha256Digest(value: string): Sha256Digest {
  if (!SHA256_DIGEST.test(value)) {
    throw new TypeError('Sha256Digest must match sha256:<64 lowercase hex>')
  }
  return value as Sha256Digest
}

/**
 * Validate and brand a normalized repository-relative path.
 * @param value - Candidate path using forward slashes.
 * @returns the validated repository-relative path.
 */
export function RepositoryRelativePath(value: string): RepositoryRelativePath {
  if (value.length === 0 || value === '.' || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/u.test(value)) {
    throw new TypeError('RepositoryRelativePath must be a non-root relative path using forward slashes')
  }
  const segments = value.split('/')
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw new TypeError('RepositoryRelativePath must be normalized and contain no empty, dot, parent, or NUL segment')
  }
  return value as RepositoryRelativePath
}
