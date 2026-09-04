/** Immutable content-addressed Delivery evidence Service Definition (`ctx.deliveryEvidence`). @module @changanhua/dsh-delivery-evidence */

import { Context, Service } from '@deepseek-ai/cordis'
import type { EvidenceId, EvidenceRef } from '@changanhua/dsh-delivery-protocol'
import type {
  BoundDeliveryEvidenceWriter,
  DeliveryEvidenceErrorCode,
  SaveBoundDeliveryEvidence,
  SaveDeliveryEvidence,
  StoredDeliveryEvidence,
} from './types.ts'

export type {
  BoundDeliveryEvidenceWriter,
  DeliveryEvidenceErrorCode,
  SaveBoundDeliveryEvidence,
  SaveDeliveryEvidence,
  StoredDeliveryEvidence,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    deliveryEvidence: DeliveryEvidence
  }
}

/** Error with a stable classification shared by evidence providers and verification Consumers. */
export class DeliveryEvidenceError extends Error {
  /**
   * @param code - Stable provider-independent failure classification.
   * @param message - Human-readable diagnostic.
   * @param options - Optional underlying failure.
   */
  constructor(readonly code: DeliveryEvidenceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DeliveryEvidenceError'
  }
}

/**
 * Immutable evidence publication and verified reads. Providers derive id,
 * URI, byte length, digest, and creation time; callers supply none of them.
 */
export abstract class DeliveryEvidence extends Service {
  constructor(ctx: Context) {
    super(ctx, 'deliveryEvidence')
  }

  /**
   * Publish one immutable byte object atomically.
   * @param input - Kind, media type, bytes, and owning execution provenance.
   * @param signal - Optional cancellation for provider work.
   * @returns the durable reference after the bytes are committed.
   */
  abstract save(input: SaveDeliveryEvidence, signal?: AbortSignal): Promise<EvidenceRef>

  /**
   * Resolve durable metadata from an Evidence id retained by a Claim, Verdict, or Resume Capsule.
   * @param id - Durable evidence identity.
   * @param signal - Optional cancellation for provider index work.
   * @returns detached immutable metadata, or `undefined` when the object is absent.
   */
  abstract resolve(id: EvidenceId, signal?: AbortSignal): Promise<EvidenceRef | undefined>

  /**
   * Read one object and verify its identity, length, and digest against the reference.
   * @param ref - Durable reference to verify and read.
   * @param signal - Optional cancellation for provider work.
   * @returns a detached byte copy and the validated reference.
   */
  abstract read(ref: EvidenceRef, signal?: AbortSignal): Promise<StoredDeliveryEvidence>

  /**
   * Bind one immutable provenance before handing a writer to a runner or verifier.
   * @param provenance - Work/Attempt or verification-check provenance.
  * @returns a writer that cannot replace or omit that provenance.
  */
  bind(provenance: EvidenceRef['provenance']): BoundDeliveryEvidenceWriter {
    const boundProvenance = Object.freeze(structuredClone(provenance))
    return Object.freeze({
      save: (input: SaveBoundDeliveryEvidence, signal?: AbortSignal) =>
        this.save({ ...input, provenance: boundProvenance }, signal),
    })
  }
}

export default DeliveryEvidence
