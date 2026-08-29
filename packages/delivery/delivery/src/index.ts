/** Personal Delivery domain Service Definition (`ctx.delivery`). @module @deepseek-ai/dsh-delivery */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  AcceptanceDecision,
  ContractRevision,
  ContractRevisionId,
  DispatchBinding,
  DispatchBindingId,
  WorkPacket,
  WorkPacketId,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  AdoptContractRevisionRequest,
  AcceptanceCandidateResolver,
  AcceptanceEvidenceResolver,
  BeginDispatchRequest,
  BindDispatchRequest,
  CreateWorkPacketRequest,
  DeliveryErrorCode,
  DeliverySnapshot,
  RecordAcceptanceDecisionRequest,
  VerificationSourceResolver,
} from './types.ts'

export type {
  AcceptanceCandidateFacts,
  AcceptanceCandidateResolver,
  AcceptanceEvidenceResolver,
  AdoptContractRevisionRequest,
  BeginDispatchRequest,
  BindDispatchRequest,
  ContractRevisionDraft,
  CreateWorkPacketRequest,
  DeliveryErrorCode,
  DeliverySnapshot,
  RecordAcceptanceDecisionRequest,
  ResolveVerificationSourceRequest,
  SourceRefDraft,
  WorkPacketDraft,
  VerificationSourceResolver,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    delivery: Delivery
  }
}

/** Maximum trusted verification-plan blob size selected by every Delivery provider. */
export const DELIVERY_VERIFICATION_SOURCE_MAX_BYTES = 64 * 1024

/** Error with a stable classification shared by Delivery providers and host Consumers. */
export class DeliveryError extends Error {
  /**
   * @param code - Stable provider-independent failure classification.
   * @param message - Human-readable diagnostic.
   * @param options - Optional underlying failure.
   */
  constructor(readonly code: DeliveryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DeliveryError'
  }
}

/**
 * Durable Personal Delivery records and their idempotent write operations.
 * Providers allocate ids and timestamps, validate protocol objects at the
 * storage boundary, and serialize writes. The service does not persist Queue
 * lifecycle, executor handles, verification bytes, or UI lanes.
 */
export abstract class Delivery extends Service {
  constructor(ctx: Context) {
    super(ctx, 'delivery')
  }

  /**
   * Adopt one exact source snapshot as an immutable Contract revision.
   * @param request - Source, interpreted revision, and deterministic idempotency key.
   * @returns the existing or newly committed revision.
   */
  abstract adoptContractRevision(request: AdoptContractRevisionRequest): Promise<ContractRevision>

  /**
   * Create one immutable Packet after the repository provider resolved the Contract base.
   * @param request - Ready Contract id, verified base, caller-selected Packet fields, and idempotency key.
   * @param resolveVerificationSource - Host-only Git blob resolver used when the Contract names a blob source.
   * @returns the existing or newly committed Packet.
   */
  abstract createWorkPacket(
    request: CreateWorkPacketRequest,
    resolveVerificationSource?: VerificationSourceResolver,
  ): Promise<WorkPacket>

  /**
   * Commit the submitting side of one Delivery-to-Queue admission handshake.
   * @param request - Packet, WorkKind, canonical Queue input digest, and idempotency identity.
   * @returns the existing or newly committed submitting binding.
   */
  abstract beginDispatch(request: BeginDispatchRequest): Promise<DispatchBinding>

  /**
   * Bind a submitting handshake to the one Queue Work id returned for it.
   * @param request - Binding id and returned Queue Work identity.
   * @returns the bound record; repeating the same work id is idempotent.
   */
  abstract bindDispatch(request: BindDispatchRequest): Promise<DispatchBinding & { readonly phase: 'bound' }>

  /**
   * Record a human decision after resolving Queue facts for two bound dispatches.
   * @param request - Human fields and Delivery-owned change/verification binding ids.
   * @param resolveCandidate - Host-only resolver invoked with the two validated Queue Work ids.
   * @param resolveEvidence - Host-only resolve-and-integrity-read capability invoked for exact evidence ids.
   * @returns the existing or newly committed decision.
   */
  abstract recordAcceptanceDecision(
    request: RecordAcceptanceDecisionRequest,
    resolveCandidate: AcceptanceCandidateResolver,
    resolveEvidence: AcceptanceEvidenceResolver,
  ): Promise<AcceptanceDecision>

  /**
   * Read one adopted Contract revision.
   * @param id - Durable revision identity.
   * @returns the revision or `undefined` when absent.
   */
  abstract getContractRevision(id: ContractRevisionId): ContractRevision | undefined

  /**
   * Read one immutable Packet.
   * @param id - Durable Packet identity.
   * @returns the Packet or `undefined` when absent.
   */
  abstract getWorkPacket(id: WorkPacketId): WorkPacket | undefined

  /**
   * Read one dispatch handshake.
   * @param id - Durable binding identity.
   * @returns the current binding projection or `undefined` when absent.
   */
  abstract getDispatchBinding(id: DispatchBindingId): DispatchBinding | undefined

  /**
   * Read a stable fresh snapshot of every Delivery-owned record.
   * @returns committed records in provider-defined stable order.
   */
  abstract snapshot(): DeliverySnapshot
}

export default Delivery
