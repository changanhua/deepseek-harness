/** Bounded, execution-local evidence transfer. Long-term retention belongs to the receiving Host. */
import { createHash, randomUUID } from 'node:crypto'

/** Content-addressed reference scoped to one execution handoff. */
export interface ExecutionEvidenceReference { readonly id: string
  readonly version: '1'
  readonly digest: string }
/** One JSON material retained by its producing Host, not writable by a role process. */
export interface ExecutionEvidenceMaterial {
  readonly reference: ExecutionEvidenceReference
  readonly kind: 'observer' | 'workspace' | 'execution'
  readonly executionId: string
  readonly role: 'subject' | 'grader'
  readonly content: string
}

/** A receiving Host acknowledges the complete bundle's digest before the sender can release it. */
export interface ExecutionEvidenceBundle {
  readonly id: string
  readonly digest: string
  readonly materials: readonly ExecutionEvidenceMaterial[]
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }

/** One execution owns these materials until a complete Host-to-Host handoff is acknowledged. */
export class ExecutionEvidenceHandoff {
  private readonly id = randomUUID()
  private readonly materials = new Map<string, ExecutionEvidenceMaterial>()
  private state: 'collecting' | 'offered' | 'accepted' = 'collecting'
  private bundle: ExecutionEvidenceBundle | undefined
  private pending = false
  private acceptedDigest: string | undefined

  constructor(private readonly maxBytes: number, private readonly maxMaterials: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxMaterials) || maxMaterials < 1) {
      throw new Error('eval-evidence-invalid-bound')
    }
  }

  /**
   * Retain Host-produced JSON under a content identity. Worker reports must be explicitly labelled inside the material.
   * @param kind Evidence purpose; a label alone never confers authenticity.
   * @param executionId Actual role execution identity.
   * @param role Role whose facts the material describes.
   * @param data Private execution material without credentials; the trusted receiver must redact private paths before public reporting.
   * @returns Reference resolvable only through this live handoff owner.
   */
  retain(kind: ExecutionEvidenceMaterial['kind'], executionId: string, role: ExecutionEvidenceMaterial['role'], data: unknown): ExecutionEvidenceReference {
    if (this.state !== 'collecting') throw new Error('eval-evidence-sealed')
    if (!executionId || this.materials.size >= this.maxMaterials) throw new Error('eval-evidence-capacity')
    const content = JSON.stringify(data) as string | undefined
    if (content === undefined) throw new Error('eval-evidence-not-json')
    const reference = Object.freeze({ id: randomUUID(), version: '1' as const, digest: digest(JSON.stringify({ kind, executionId, role, content })) })
    const material = Object.freeze({ reference, kind, executionId, role, content })
    // Bound the complete transferred representation, including reference and ownership metadata.
    this.makeBundle([...this.materials.values(), material])
    this.materials.set(reference.id, material)
    return reference
  }

  /**
   * Resolve exact content and ownership without accepting a caller's same-shaped replacement.
   * @param reference Reference returned by this owner and embedded in the Manifest.
   * @param executionId Execution identity required by that Manifest role.
   * @param role Expected role, checked before exposing private material.
   * @returns Immutable original material; retained after an unacknowledged offer.
   */
  resolve(reference: ExecutionEvidenceReference, executionId: string, role: ExecutionEvidenceMaterial['role']): ExecutionEvidenceMaterial {
    const value = this.materials.get(reference.id)
    if (!value || !['1'].includes(reference.version) || value.reference.digest !== reference.digest
      || value.executionId !== executionId || value.role !== role) throw new Error('eval-evidence-identity-mismatch')
    return value
  }

  /**
   * Seal one stable bundle and await the receiving Host's acknowledgement. An exception or wrong digest retains every material.
   * @param receive Trusted receiving owner; return the digest only after assuming retention responsibility.
   * @param signal Bounded Host wait; abort retains material and prevents another offer until the original receiver settles.
   * @returns Acknowledged content identity. Retrying offers the same bundle, never regenerated references.
   */
  async offer(receive: (bundle: ExecutionEvidenceBundle) => Promise<{ readonly acceptedDigest: string }>,
    signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    if (this.state === 'accepted' && this.acceptedDigest) return this.acceptedDigest
    if (this.pending) throw new Error('eval-evidence-handoff-in-progress')
    this.bundle ??= this.makeBundle([...this.materials.values()])
    this.state = 'offered'
    this.pending = true
    const bundle = this.bundle
    const transfer = (async () => {
      try {
        const receipt = await receive(bundle)
        if (receipt.acceptedDigest !== bundle.digest) throw new Error('eval-evidence-handoff-uncertain')
        this.state = 'accepted'
        this.acceptedDigest = bundle.digest
        return bundle.digest
      } finally { this.pending = false }
    })()
    if (!signal) return transfer
    return new Promise<string>((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(new Error('eval-evidence-handoff-interrupted')) }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      void transfer.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
    })
  }

  /** Release the sender's material only after the receiver owns the acknowledged bundle. */
  release(): void {
    if (this.state !== 'accepted') throw new Error('eval-evidence-handoff-uncertain')
    this.materials.clear()
    this.bundle = undefined
  }

  private makeBundle(materials: ExecutionEvidenceMaterial[]): ExecutionEvidenceBundle {
    const body = JSON.stringify({ id: this.id, materials })
    const bundle = Object.freeze({ id: this.id, digest: digest(body), materials: Object.freeze(materials) })
    if (Buffer.byteLength(JSON.stringify(bundle)) > this.maxBytes) throw new Error('eval-evidence-capacity')
    return bundle
  }
}
