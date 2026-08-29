/** JSON wire declarations for the Personal Delivery workbench. */

import type {
  AcceptanceDecision,
  CompletionClaim,
  ContractRevision,
  DispatchBindingId,
  EvidenceId,
  EvidenceRef,
  ExecutorId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  VerificationVerdict,
  WorkPacket,
} from '@deepseek-ai/dsh-delivery-protocol'
import type { WorkPacketDraft } from '@deepseek-ai/dsh-delivery'
import type { SideEffectState, WorkStatus } from '@deepseek-ai/dsh-task-queue'

/** Browser-safe view of one immutable adopted Contract revision. */
export type DeliveryContractRevisionView = ContractRevision

/** Browser-safe view of one immutable executable Packet. */
export type DeliveryWorkPacketView = WorkPacket

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
  readonly message: string
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

/** Browser-safe view of one explicit human acceptance decision. */
export type DeliveryAcceptanceDecisionView = AcceptanceDecision

/** Derived workbench lane; never a writable Delivery-domain status. */
export type DeliveryLane = 'ready' | 'running' | 'review' | 'blocked' | 'accepted'

/** One Packet and the cross-authority facts required to derive its lane. */
export interface DeliveryWorkbenchCard {
  readonly contractRevision: DeliveryContractRevisionView
  readonly packet: DeliveryWorkPacketView
  readonly lane: DeliveryLane
  readonly dispatches: readonly DeliveryWorkbenchDispatch[]
  readonly completionClaim: CompletionClaim | null
  readonly verificationVerdict: VerificationVerdict | null
  readonly acceptanceDecision: AcceptanceDecision | null
  readonly attentionReasons: readonly string[]
}

/** Complete MVP workbench projection returned from one host snapshot. */
export interface DeliverySnapshotView {
  readonly contractsWithoutPacket: readonly DeliveryContractRevisionView[]
  readonly cards: readonly DeliveryWorkbenchCard[]
}

/** Explicit import of the current revision at one public GitHub Issue URL. */
export interface DeliveryImportIssueInput {
  readonly issueUrl: string
  readonly repositoryId: string
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
