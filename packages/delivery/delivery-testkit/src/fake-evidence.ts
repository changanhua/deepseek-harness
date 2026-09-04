/** Deterministic in-memory provider for immutable Delivery evidence. */

/* oxlint-disable typescript/require-await -- keep fake failures on the asynchronous Service contract without artificial I/O */

import { Service, type Context } from '@deepseek-ai/cordis'
import DeliveryEvidence, {
  DeliveryEvidenceError,
  type SaveDeliveryEvidence,
  type StoredDeliveryEvidence,
} from '@changanhua/dsh-delivery-evidence'
import {
  DELIVERY_SCHEMA_VERSION,
  EvidenceId,
  canonicalDigest,
  canonicalJson,
  evidenceBytesDigest,
  evidenceRefSchema,
  type EvidenceId as EvidenceIdType,
  type EvidenceRef,
} from '@changanhua/dsh-delivery-protocol'

/** Deterministic clock and id hooks for one fake evidence provider. */
export interface FakeDeliveryEvidenceOptions {
  /** RFC 3339 UTC time used for the next publication. */
  readonly now?: () => string
  /** Stable raw id allocator keyed by one-based ordinal. */
  readonly allocateId?: (ordinal: number) => string
}

interface StoredObject {
  readonly ref: EvidenceRef
  data: Uint8Array
}

/**
 * Content-addressed in-memory evidence. It computes real SHA-256 digests,
 * detaches every byte array, verifies reads, and exposes explicit corruption
 * controls for negative Consumer tests.
 */
export class FakeDeliveryEvidence extends DeliveryEvidence {
  /** Detached save requests observed by this fake. */
  readonly saveCalls: SaveDeliveryEvidence[] = []
  /** Evidence identities resolved by this fake. */
  readonly resolveCalls: EvidenceIdType[] = []
  /** Detached evidence refs integrity-read by this fake. */
  readonly readCalls: EvidenceRef[] = []
  private readonly objects = new Map<EvidenceIdType, StoredObject>()
  private readonly envelopes = new Map<string, EvidenceIdType>()
  private readonly failures: Error[] = []
  private readonly now: () => string
  private readonly allocate: (ordinal: number) => string
  private ordinal = 0

  constructor(ctx: Context, options: FakeDeliveryEvidenceOptions = {}) {
    super(ctx)
    // Test controls intentionally expose the registered concrete fake rather than a per-read trace proxy.
    Object.defineProperty(this, Service.tracker, { value: undefined })
    this.now = options.now ?? (() => '2026-08-29T00:00:00.000Z')
    this.allocate = options.allocateId ?? (ordinal => `evidence-${String(ordinal)}`)
  }

  async save(input: SaveDeliveryEvidence, signal?: AbortSignal): Promise<EvidenceRef> {
    signal?.throwIfAborted()
    this.saveCalls.push({ ...input, data: input.data.slice() })
    const failure = this.failures.shift()
    if (failure !== undefined) throw failure
    const envelope = canonicalDigest({
      kind: input.kind,
      mediaType: input.mediaType,
      provenance: input.provenance,
      data: Buffer.from(input.data).toString('base64'),
    })
    const priorId = this.envelopes.get(envelope)
    if (priorId !== undefined) {
      const prior = this.objects.get(priorId)
      /* v8 ignore next -- only direct mutation of both private indexes can violate this fake's envelope invariant. */
      if (prior === undefined) throw new Error('delivery-testkit: evidence envelope references a missing object')
      return structuredClone(prior.ref)
    }
    this.ordinal += 1
    const id = EvidenceId(this.allocate(this.ordinal))
    const bytes = input.data.slice()
    const ref = evidenceRefSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id,
      kind: input.kind,
      mediaType: input.mediaType,
      uri: `memory://delivery-evidence/${encodeURIComponent(id)}`,
      byteLength: bytes.byteLength,
      digest: evidenceBytesDigest(bytes),
      createdAt: this.now(),
      provenance: structuredClone(input.provenance),
    })
    this.objects.set(id, { ref, data: bytes })
    this.envelopes.set(envelope, id)
    return structuredClone(ref)
  }

  async read(ref: EvidenceRef, signal?: AbortSignal): Promise<StoredDeliveryEvidence> {
    signal?.throwIfAborted()
    this.readCalls.push(structuredClone(ref))
    const object = this.objects.get(ref.id)
    if (object === undefined) {
      throw new DeliveryEvidenceError('not-found', `evidence '${ref.id}' is absent`)
    }
    if (canonicalJson(object.ref) !== canonicalJson(ref)) {
      throw new DeliveryEvidenceError('reference-mismatch', `evidence '${ref.id}' metadata does not match the published reference`)
    }
    if (object.data.byteLength !== ref.byteLength) {
      throw new DeliveryEvidenceError('length-mismatch', `evidence '${ref.id}' byte length changed`)
    }
    if (evidenceBytesDigest(object.data) !== ref.digest) {
      throw new DeliveryEvidenceError('digest-mismatch', `evidence '${ref.id}' digest changed`)
    }
    return { ref: structuredClone(object.ref), data: object.data.slice() }
  }

  async resolve(id: EvidenceIdType, signal?: AbortSignal): Promise<EvidenceRef | undefined> {
    signal?.throwIfAborted()
    this.resolveCalls.push(id)
    const object = this.objects.get(id)
    return object === undefined ? undefined : structuredClone(object.ref)
  }

  /**
   * Make the next save fail before it publishes a reference.
   * @param error - exact rejection returned to the caller.
   */
  failNextSave(error: Error): void {
    this.failures.push(error)
  }

  /**
   * Remove one published object while retaining any references held by callers.
   * @param id - evidence identity to remove.
   */
  remove(id: EvidenceIdType): void {
    this.objects.delete(id)
    for (const [envelope, storedId] of this.envelopes) {
      if (storedId === id) this.envelopes.delete(envelope)
    }
  }

  /**
   * Replace stored bytes without rewriting published metadata.
   * @param id - evidence identity to corrupt.
   * @param data - replacement bytes.
   */
  corrupt(id: EvidenceIdType, data: Uint8Array): void {
    const object = this.objects.get(id)
    if (object === undefined) throw new DeliveryEvidenceError('not-found', `evidence '${id}' is absent`)
    object.data = data.slice()
  }
}
