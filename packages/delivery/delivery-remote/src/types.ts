/** JSON wire declarations for the Personal Delivery workbench. */

import type {
  AcceptanceDecision,
  CompletionClaim,
  ContractRevision,
  DispatchBinding,
  VerificationVerdict,
  WorkPacket,
} from '@deepseek-ai/dsh-delivery-protocol'
import type { WorkPacketDraft } from '@deepseek-ai/dsh-delivery'

/** Browser-safe view of one immutable adopted Contract revision. */
export type DeliveryContractRevisionView = ContractRevision

/** Browser-safe view of one immutable executable Packet. */
export type DeliveryWorkPacketView = WorkPacket

/** Browser-safe view of one Delivery-to-Queue dispatch binding. */
export type DeliveryDispatchBindingView = DispatchBinding

/** Browser-safe view of one explicit human acceptance decision. */
export type DeliveryAcceptanceDecisionView = AcceptanceDecision

/** Derived workbench lane; never a writable Delivery-domain status. */
export type DeliveryLane = 'ready' | 'running' | 'review' | 'blocked' | 'accepted'

/** One Packet and the cross-authority facts required to derive its lane. */
export interface DeliveryWorkbenchCard {
  readonly contractRevision: DeliveryContractRevisionView
  readonly packet: DeliveryWorkPacketView
  readonly lane: DeliveryLane
  readonly dispatchBindings: readonly DeliveryDispatchBindingView[]
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

/**
 * Record one explicit human decision after the host resolves its matching
 * verdict. The host derives the actor from trusted operator authentication and
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
