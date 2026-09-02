/** Canonical JSON and SHA-256 identities for immutable Delivery records. */

import { createHash } from 'node:crypto'
import { IssuePublicationId, Sha256Digest } from './brand.ts'
import type {
  ContractRevisionId,
  DeliveryCaseId,
  IssuePublicationId as IssuePublicationIdType,
  Sha256Digest as Sha256DigestType,
} from './brand.ts'
import type {
  EvidenceRef,
  VerificationCheck,
  VerificationPlan,
  WorkPacket,
} from './types.ts'

/**
 * Serialize a JSON-safe value with recursively sorted object keys.
 *
 * Delivery owns this implementation so its protocol does not depend on Queue.
 * A parity test pins the shared cross-store idempotency contract.
 * @param value - JSON-safe value to serialize.
 * @returns deterministic JSON with recursively sorted object keys.
 */
export function canonicalJson(value: unknown): string {
  return new CanonicalJsonWriter().write(value)
}

/**
 * Compute a lowercase SHA-256 digest over canonical UTF-8 JSON.
 * @param value - JSON-safe semantic input.
 * @returns the canonical SHA-256 digest.
 */
export function canonicalDigest(value: unknown): Sha256DigestType {
  return Sha256Digest(`sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`)
}

/**
 * Compute the digest of an imported GitHub Issue title/body snapshot.
 * @param source - Imported title and body.
 * @returns the snapshot digest retained by a `github-import` requirement origin.
 */
export function githubIssueContentDigest(source: { readonly title: string; readonly body: string }): Sha256DigestType {
  return canonicalDigest({ body: source.body, title: source.title })
}

/**
 * Derive the one durable Issue-publication identity owned by a Case revision.
 * Both Delivery Providers and the Host publisher use this identity so the
 * publisher can render the exact persisted id before the prepare transition.
 * @param caseId - Owning Delivery Case identity.
 * @param revisionId - Exact immutable revision being published.
 * @returns stable publication identity for that Case revision.
 */
export function issuePublicationIdForRevision(
  caseId: DeliveryCaseId,
  revisionId: ContractRevisionId,
): IssuePublicationIdType {
  const digest = canonicalDigest({ caseId, revisionId })
  return IssuePublicationId(`issue-publication-${digest.slice('sha256:'.length)}`)
}

/**
 * Compute the digest of a resolved plan, excluding its self-referential digest field.
 * @param plan - Resolved checks and immutable provenance.
 * @returns the verification-plan digest.
 */
export function verificationPlanDigest(plan: Pick<VerificationPlan, 'checks' | 'provenance'>): Sha256DigestType {
  return canonicalDigest({ checks: plan.checks, provenance: plan.provenance })
}

/**
 * Compute the command identity retained by one verification result.
 * @param check - Fixed-argv verification check.
 * @returns the check digest.
 */
export function verificationCheckDigest(check: VerificationCheck): Sha256DigestType {
  return canonicalDigest(check)
}

/** Packet fields that participate in its deterministic semantic identity. */
export type WorkPacketDigestInput = Omit<WorkPacket, 'id' | 'packetDigest' | 'createdAt'>

/**
 * Compute a Packet digest independent of generated id and persistence time.
 * @param packet - Packet semantic fields.
 * @returns the packet digest.
 */
export function workPacketDigest(packet: WorkPacketDigestInput): Sha256DigestType {
  return canonicalDigest(packet)
}

/**
 * Digest immutable evidence bytes without treating them as JSON.
 * @param bytes - Exact evidence bytes.
 * @returns their SHA-256 digest.
 */
export function evidenceBytesDigest(bytes: Uint8Array): Sha256DigestType {
  return Sha256Digest(`sha256:${createHash('sha256').update(bytes).digest('hex')}`)
}

/**
 * Check both byte length and SHA-256 against an EvidenceRef.
 * @param reference - Expected immutable metadata.
 * @param bytes - Candidate evidence bytes.
 * @returns whether length and digest both match.
 */
export function evidenceBytesMatch(reference: Pick<EvidenceRef, 'byteLength' | 'digest'>, bytes: Uint8Array): boolean {
  return reference.byteLength === bytes.byteLength && reference.digest === evidenceBytesDigest(bytes)
}

class CanonicalJsonWriter {
  private readonly ancestors = new WeakSet<object>()

  write(value: unknown): string {
    if (value === null) return 'null'
    switch (typeof value) {
      case 'boolean': return value ? 'true' : 'false'
      case 'number': return this.number(value)
      case 'string': return JSON.stringify(value)
      case 'object': return this.object(value)
      default: throw new TypeError(`canonicalJson received unsupported non-JSON-safe ${typeof value}`)
    }
  }

  private number(value: number): string {
    if (!Number.isFinite(value)) throw new TypeError('canonicalJson requires finite JSON-safe numbers')
    return Object.is(value, -0) ? '0' : String(value)
  }

  private object(value: object): string {
    if (this.ancestors.has(value)) throw new TypeError('canonicalJson received a cyclic value')
    this.ancestors.add(value)
    try {
      return Array.isArray(value) ? this.array(value) : this.record(value)
    } finally {
      this.ancestors.delete(value)
    }
  }

  private array(value: unknown[]): string {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new TypeError('canonicalJson rejects sparse non-JSON-safe arrays')
    }
    const keys = Reflect.ownKeys(value)
    if (keys.some(key => typeof key === 'symbol' || (key !== 'length' && !/^(0|[1-9]\d*)$/u.test(key)))) {
      throw new TypeError('canonicalJson rejects arrays with non-JSON-safe extra or symbol keys')
    }
    return `[${value.map(item => this.write(item)).join(',')}]`
  }

  private record(value: object): string {
    const prototype: unknown = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('canonicalJson requires plain JSON-safe objects')
    }
    const keys = Reflect.ownKeys(value)
    if (keys.some(key => typeof key === 'symbol')) throw new TypeError('canonicalJson rejects symbol keys')
    const stringKeys = keys as string[]
    for (const key of stringKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor?.enumerable !== true || !('value' in descriptor)) {
        throw new TypeError('canonicalJson requires enumerable data properties')
      }
    }
    stringKeys.sort(compare)
    const record = value as Record<string, unknown>
    return `{${stringKeys.map(key => `${JSON.stringify(key)}:${this.write(record[key])}`).join(',')}}`
  }
}

function compare(left: string, right: string): number {
  // Object keys are unique, so sort never compares equal strings here.
  return left < right ? -1 : 1
}
