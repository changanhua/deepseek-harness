/** Local Personal Delivery provider scaffold. @module @deepseek-ai/dsh-delivery-local */

import type {
  AcceptanceDecision,
  ContractRevision,
  ContractRevisionId,
  DispatchBinding,
  DispatchBindingId,
  WorkPacket,
  WorkPacketId,
} from '@deepseek-ai/dsh-delivery-protocol'
import { Delivery, DeliveryError } from '@deepseek-ai/dsh-delivery'
import type {
  AdoptContractRevisionRequest,
  AcceptanceCandidateResolver,
  AcceptanceEvidenceResolver,
  BeginDispatchRequest,
  BindDispatchRequest,
  CreateWorkPacketRequest,
  DeliverySnapshot,
  RecordAcceptanceDecisionRequest,
  VerificationSourceResolver,
} from '@deepseek-ai/dsh-delivery'
import type {} from '@deepseek-ai/dsh-storage-domain'

const UNAVAILABLE = 'delivery-local is unavailable because durable storage is not implemented'

/** Storage-domain-backed provider selected for the local MVP deployment. */
export class LocalDelivery extends Delivery {
  /** The provider opens its private durable domain only after Storage Domain is present. */
  static inject = ['storageDomain']

  private unavailable(): DeliveryError {
    return new DeliveryError('unavailable', UNAVAILABLE)
  }

  override adoptContractRevision(_request: AdoptContractRevisionRequest): Promise<ContractRevision> {
    return Promise.reject(this.unavailable())
  }

  override createWorkPacket(
    _request: CreateWorkPacketRequest,
    _resolveVerificationSource?: VerificationSourceResolver,
  ): Promise<WorkPacket> {
    return Promise.reject(this.unavailable())
  }

  override beginDispatch(_request: BeginDispatchRequest): Promise<DispatchBinding> {
    return Promise.reject(this.unavailable())
  }

  override bindDispatch(_request: BindDispatchRequest): Promise<DispatchBinding & { readonly phase: 'bound' }> {
    return Promise.reject(this.unavailable())
  }

  override recordAcceptanceDecision(
    _request: RecordAcceptanceDecisionRequest,
    _resolveCandidate: AcceptanceCandidateResolver,
    _resolveEvidence: AcceptanceEvidenceResolver,
  ): Promise<AcceptanceDecision> {
    return Promise.reject(this.unavailable())
  }

  override getContractRevision(_id: ContractRevisionId): ContractRevision | undefined {
    throw this.unavailable()
  }

  override getWorkPacket(_id: WorkPacketId): WorkPacket | undefined {
    throw this.unavailable()
  }

  override getDispatchBinding(_id: DispatchBindingId): DispatchBinding | undefined {
    throw this.unavailable()
  }

  override snapshot(): DeliverySnapshot {
    throw this.unavailable()
  }
}

export default LocalDelivery
