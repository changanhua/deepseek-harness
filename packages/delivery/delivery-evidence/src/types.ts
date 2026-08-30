/** Public request and stored-object types for Delivery evidence. @module @deepseek-ai/dsh-delivery-evidence/types */

import type { EvidenceRef } from '@deepseek-ai/dsh-delivery-protocol'

/** Bytes and immutable metadata to publish under one execution provenance. */
export interface SaveDeliveryEvidence {
  readonly kind: EvidenceRef['kind']
  readonly mediaType: string
  readonly data: Uint8Array
  readonly provenance: EvidenceRef['provenance']
}

/** Save input after a caller binds one Work/Attempt or verification-check provenance. */
export interface SaveBoundDeliveryEvidence {
  readonly kind: EvidenceRef['kind']
  readonly mediaType: string
  readonly data: Uint8Array
}

/** Verified immutable bytes returned with their durable reference. */
export interface StoredDeliveryEvidence {
  readonly ref: EvidenceRef
  readonly data: Uint8Array
}

/** Operation-local writer that cannot omit or replace its bound provenance. */
export interface BoundDeliveryEvidenceWriter {
  /**
   * Atomically publish immutable evidence bytes.
   * @param input - Evidence kind, media type, and bytes.
   * @param signal - Optional cancellation for provider work.
   * @returns the durable reference only after byte publication succeeds.
   */
  save(input: SaveBoundDeliveryEvidence, signal?: AbortSignal): Promise<EvidenceRef>
}

/** Provider-independent evidence failures. */
export type DeliveryEvidenceErrorCode =
  | 'unavailable'
  | 'not-found'
  | 'reference-mismatch'
  | 'length-mismatch'
  | 'digest-mismatch'
  | 'read-failed'
  | 'write-failed'
