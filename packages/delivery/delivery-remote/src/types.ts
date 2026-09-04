/** JSON wire declarations for the Personal Delivery workbench. */

import type {
  AcceptanceDecision,
  CompletionClaim,
  ContractRevision,
  ContractReadiness,
  DeliveryCase,
  DispatchBindingId,
  EvidenceId,
  EvidenceRef,
  ExecutorId,
  GitHubIssueRef,
  IssuePublication,
  PublicationFailureCategory,
  RequirementDecision,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  VerificationVerdict,
  WorkPacket,
} from '@changanhua/dsh-delivery-protocol'
import type { ContractRevisionDraft, WorkPacketDraft } from '@changanhua/dsh-delivery'
import type { SideEffectState, WorkStatus } from '@changanhua/dsh-task-queue'

/** Browser-safe revision origin; trusted human actor identity remains Host-only. */
export type DeliveryRequirementOriginView =
  | { readonly kind: 'human' }
  | Extract<ContractRevision['origin'], { readonly kind: 'github-import' }>

/** Browser-safe view of one immutable adopted Contract revision. */
export type DeliveryContractRevisionView = Omit<ContractRevision, 'origin'> & {
  readonly origin: DeliveryRequirementOriginView
}

/** Browser-safe view of one immutable executable Packet. */
export type DeliveryWorkPacketView = WorkPacket

/** Browser-safe human requirement decision without its trusted Host actor. */
export interface DeliveryRequirementDecisionView {
  readonly id: RequirementDecision['id']
  readonly caseId: RequirementDecision['caseId']
  readonly revisionId: RequirementDecision['revisionId']
  readonly decision: RequirementDecision['decision']
  readonly reason: RequirementDecision['reason']
  readonly decidedAt: RequirementDecision['decidedAt']
}

/** Browser-safe binding identity with host-only digests and idempotency omitted. */
export interface DeliveryDispatchBindingView {
  readonly id: DispatchBindingId
  readonly packetId: WorkPacket['id']
  readonly kind: 'code.change@1' | 'code.verify@1'
  readonly phase: 'submitting' | 'bound'
  readonly queueWorkId: QueueWorkIdRef | null
  readonly executorId: ExecutorId | null
  readonly createdAt: string
  readonly updatedAt: string
}

/** Browser-safe Queue failure facts for one Delivery-owned binding. */
export interface DeliveryQueueFailureView {
  readonly category: string
  readonly sideEffect: SideEffectState
  readonly retriable: boolean
}

/** Narrow Queue projection; intent, resolved input, policy, resources, and output stay Host-only. */
export interface DeliveryQueueWorkView {
  readonly id: QueueWorkIdRef
  readonly status: WorkStatus
  readonly attemptCount: number
  readonly activeAttemptId: QueueAttemptIdRef | null
  readonly failure: DeliveryQueueFailureView | null
  readonly cancelRequestedAt: string | null
  readonly updatedAt: string
}

/** One Delivery binding paired with its current Queue lifecycle projection. */
export interface DeliveryWorkbenchDispatch {
  readonly binding: DeliveryDispatchBindingView
  readonly queue: DeliveryQueueWorkView | null
}

/** Browser-safe human decision with Host actor and idempotency nonce omitted. */
export interface DeliveryAcceptanceDecisionView {
  readonly schemaVersion: AcceptanceDecision['schemaVersion']
  readonly id: AcceptanceDecision['id']
  readonly packetId: AcceptanceDecision['packetId']
  readonly targetCommit: AcceptanceDecision['targetCommit']
  readonly verdictId: AcceptanceDecision['verdictId']
  readonly decision: AcceptanceDecision['decision']
  readonly reason: AcceptanceDecision['reason']
  readonly decidedAt: AcceptanceDecision['decidedAt']
}

/** Derived workbench lane; never a writable Delivery-domain status. */
export type DeliveryLane = 'ready' | 'running' | 'review' | 'blocked' | 'accepted'

/** Case lifecycle shown by the primary workbench; publication remains a separate axis. */
export type DeliveryCaseLane = 'shaping' | DeliveryLane

/** Stable, locale-owned reason codes for a blocked or attention-required Packet. */
export type DeliveryAttentionReason =
  | 'bound-work-unavailable'
  | 'queue-work-failed'
  | 'queue-attention'
  | 'change-result-invalid'
  | 'verification-result-invalid'
  | 'change-interrupted'
  | 'change-blocked'
  | 'verification-failed'
  | 'verification-needs-human-review'
  | 'decision-rejected'
  | 'projection-inconsistent'

/** One Packet and the cross-authority facts required to derive its lane. */
export interface DeliveryWorkbenchCard {
  readonly contractRevision: DeliveryContractRevisionView
  readonly packet: DeliveryWorkPacketView
  readonly lane: DeliveryLane
  readonly dispatches: readonly DeliveryWorkbenchDispatch[]
  readonly completionClaim: CompletionClaim | null
  readonly verificationVerdict: VerificationVerdict | null
  readonly acceptanceDecision: DeliveryAcceptanceDecisionView | null
  readonly attentionReasons: readonly DeliveryAttentionReason[]
}

/** One Case-centered workbench row with its exact head authority and downstream work. */
export interface DeliveryCaseCard {
  readonly case: DeliveryCase
  readonly headRevision: DeliveryContractRevisionView
  readonly readiness: ContractReadiness
  readonly requirementDecision: DeliveryRequirementDecisionView | null
  readonly publication: DeliveryIssuePublicationView | null
  readonly publicationTarget: GitHubIssueRef['repository'] | null
  readonly lane: DeliveryCaseLane
  readonly packets: readonly DeliveryWorkbenchCard[]
}

/** Result of creating or revising one Case without exposing the Host actor. */
export interface DeliveryCaseMutationView {
  readonly case: DeliveryCase
  readonly revision: DeliveryContractRevisionView
}

/** Complete MVP workbench projection returned from one host snapshot. */
export interface DeliverySnapshotView {
  readonly cases: readonly DeliveryCaseCard[]
  readonly contractsWithoutPacket: readonly DeliveryContractRevisionView[]
  readonly cards: readonly DeliveryWorkbenchCard[]
  readonly publications: readonly DeliveryIssuePublicationView[]
}

/** Create one human-origin Case in the Host-configured local repository. */
export interface DeliveryCreateCaseInput {
  readonly title: string
  readonly revision: ContractRevisionDraft
}

/** Revise the exact Case head observed by the browser. */
export interface DeliveryReviseCaseInput extends DeliveryCreateCaseInput {
  readonly caseId: string
  readonly expectedHeadRevisionId: string
}

/** Record one explicit human requirement decision for the current revision. */
export interface DeliveryRecordRequirementDecisionInput {
  readonly caseId: string
  readonly revisionId: string
  readonly decision: RequirementDecision['decision']
  readonly reason: string
}

/** Browser-safe Issue publication state without marker, digest, or Host failure detail. */
export interface DeliveryIssuePublicationView {
  readonly id: IssuePublication['id']
  readonly caseId: IssuePublication['caseId']
  readonly revisionId: IssuePublication['revisionId']
  readonly phase: IssuePublication['phase']
  readonly failureCategory: PublicationFailureCategory | null
  readonly issue: GitHubIssueRef | null
  readonly updatedAt: string
}

/** Publish one exact Case revision through its Host-configured GitHub target. */
export interface DeliveryPublishIssueInput {
  readonly caseId: string
  readonly revisionId: string
}

/** Resolve one uncertain publication through a fresh Host-side GitHub GET. */
export interface DeliveryResolvePublicationInput {
  readonly publicationId: string
  readonly resolution: 'confirm-published'
  readonly issueNumber: number
}

/** Explicit import of the current revision at one public GitHub Issue URL. */
export interface DeliveryImportIssueInput {
  readonly issueUrl: string
}

/**
 * Browser-selected Packet fields. The host resolves repository identity, base
 * proof, and verification source from the immutable Contract, then derives the
 * idempotency key from Contract identity plus the canonical Packet digest.
 */
export interface DeliveryCreatePacketInput {
  readonly contractRevisionId: string
  readonly packet: WorkPacketDraft
}

/** Begin one ownerless `code.change@1` dispatch for an immutable Packet. */
export interface DeliveryStartChangeInput {
  readonly packetId: string
  readonly executorId: string
}

/** Begin verification from one operator-selected, bound change dispatch. */
export interface DeliveryStartVerificationInput {
  readonly packetId: string
  readonly changeBindingId: string
}

/** Read one existing immutable evidence object selected by id. */
export interface DeliveryReadEvidenceInput {
  readonly evidenceId: EvidenceId
}

/** Evidence metadata safe for browser inspection; the provider URI stays Host-only. */
export interface DeliveryEvidenceView {
  readonly id: EvidenceId
  readonly kind: EvidenceRef['kind']
  readonly mediaType: string
  readonly byteLength: number
  readonly digest: EvidenceRef['digest']
  readonly createdAt: string
  readonly provenance: EvidenceRef['provenance']
  readonly contentBase64: string
}

/**
 * Record one explicit human decision after the host resolves its matching
 * verdict. The host derives the actor from trusted Host configuration and
 * the idempotency key from the target plus operator-supplied decision nonce.
 */
export interface DeliveryRecordDecisionInput {
  readonly packetId: string
  readonly changeBindingId: string
  readonly verificationBindingId: string
  readonly decision: DeliveryAcceptanceDecisionView['decision']
  readonly reason: string
  readonly decisionNonce: string
}
