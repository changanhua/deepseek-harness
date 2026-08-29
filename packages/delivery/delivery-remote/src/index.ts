/** Personal Delivery Typert Remote scaffold. @module @deepseek-ai/dsh-delivery-remote */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-delivery'
import type {} from '@deepseek-ai/dsh-delivery-evidence'
import type {} from '@deepseek-ai/dsh-repo-workspace'
import type {} from '@deepseek-ai/dsh-task-queue'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  DeliveryAcceptanceDecisionView,
  DeliveryContractRevisionView,
  DeliveryCreatePacketInput,
  DeliveryDispatchBindingView,
  DeliveryImportIssueInput,
  DeliveryRecordDecisionInput,
  DeliverySnapshotView,
  DeliveryStartChangeInput,
  DeliveryStartVerificationInput,
  DeliveryWorkPacketView,
} from './types.ts'

export type {
  DeliveryAcceptanceDecisionView,
  DeliveryContractRevisionView,
  DeliveryCreatePacketInput,
  DeliveryDispatchBindingView,
  DeliveryImportIssueInput,
  DeliveryLane,
  DeliveryRecordDecisionInput,
  DeliverySnapshotView,
  DeliveryStartChangeInput,
  DeliveryStartVerificationInput,
  DeliveryWorkPacketView,
  DeliveryWorkbenchCard,
} from './types.ts'

const UNAVAILABLE = 'delivery Remote is unavailable because its host projection is not implemented'

/** Trusted single-operator identity configured on the Host, never supplied by browser input. */
export interface Config {
  /** Non-blank human operator identity minted by trusted Host configuration. */
  readonly operatorId?: string
}

/** Loader schema for the trusted Personal Delivery operator identity. */
export const Config: z<Config> = z.object({
  operatorId: z.string().min(1).pattern(/\S/u).default('local-operator'),
})

/** Stable Remote failure classification. */
export type DeliveryRemoteErrorCode = 'unavailable'

/** Typed failure emitted while the frozen Remote surface has no implementation. */
export class DeliveryRemoteError extends Error {
  constructor(readonly code: DeliveryRemoteErrorCode, message: string) {
    super(message)
    this.name = 'DeliveryRemoteError'
  }
}

function unavailable(): never {
  throw new DeliveryRemoteError('unavailable', UNAVAILABLE)
}

function unavailableAsync<T>(operation: string): Promise<T> {
  return Promise.reject(new DeliveryRemoteError(
    'unavailable',
    `${UNAVAILABLE}: ${operation}`,
  ))
}

/** Host service contributing the reserved `delivery` Remote namespace. */
export class DeliveryRemoteService extends TypertRemoteService {
  /** Domain, repository proof, and trusted Queue admission are required by the final methods. */
  static inject = ['delivery', 'deliveryEvidence', 'repoWorkspace', 'taskQueue']
  static Config = Config

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'deliveryRemote', { namespace: 'delivery' })
    void config.operatorId
  }

  /**
   * Return the complete derived MVP workbench snapshot.
   * @returns the browser-safe projection of current Delivery facts.
   */
  @Remote('snapshot')
  snapshot(): DeliverySnapshotView {
    return unavailable()
  }

  /**
   * Explicitly adopt the current revision of one GitHub Issue URL.
   * @param input - Operator-selected Issue URL and configured repository.
   * @param signal - Operation-local Remote cancellation.
   * @returns the adopted immutable Contract revision.
   */
  @Remote('importIssue')
  importIssue(
    input: DeliveryImportIssueInput,
    signal: AbortSignal,
  ): Promise<DeliveryContractRevisionView> {
    void input
    void signal
    return unavailableAsync('importIssue')
  }

  /**
   * Resolve the Contract-owned repository base and create one immutable Packet.
   * @param input - Operator-selected Contract and bounded Packet draft fields.
   * @param signal - Operation-local Remote cancellation.
   * @returns the immutable Packet after host-owned verification and key derivation.
   */
  @Remote('createPacket')
  createPacket(
    input: DeliveryCreatePacketInput,
    signal: AbortSignal,
  ): Promise<DeliveryWorkPacketView> {
    void input
    void signal
    return unavailableAsync('createPacket')
  }

  /**
   * Start one idempotently bound ownerless change dispatch.
   * @param input - Operator-selected Packet and executor.
   * @param signal - Operation-local Remote cancellation.
   * @returns the Delivery-to-Queue dispatch binding.
   */
  @Remote('startChange')
  startChange(
    input: DeliveryStartChangeInput,
    signal: AbortSignal,
  ): Promise<DeliveryDispatchBindingView> {
    void input
    void signal
    return unavailableAsync('startChange')
  }

  /**
   * Start independent verification from one bound change dispatch.
   * @param input - Operator-selected Packet and bound change dispatch.
   * @param signal - Operation-local Remote cancellation.
   * @returns the Delivery-to-Queue verification dispatch binding.
   */
  @Remote('startVerification')
  startVerification(
    input: DeliveryStartVerificationInput,
    signal: AbortSignal,
  ): Promise<DeliveryDispatchBindingView> {
    void input
    void signal
    return unavailableAsync('startVerification')
  }

  /**
   * Persist one explicit human acceptance, rejection, or waiver.
   * @param input - Human decision and the two bound dispatch selections.
   * @param signal - Operation-local Remote cancellation.
   * @returns the acceptance decision attributed by trusted operator context.
   */
  @Remote('recordDecision')
  recordDecision(
    input: DeliveryRecordDecisionInput,
    signal: AbortSignal,
  ): Promise<DeliveryAcceptanceDecisionView> {
    void input
    void signal
    return unavailableAsync('recordDecision')
  }
}

export default DeliveryRemoteService
