/** Provider-routed immutable domain artifacts; payload persistence stays with each owner. */
import { Context, Service } from '@deepseek-ai/cordis'
import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import { DOMAIN_METADATA_MAX_BYTES, domainArtifactHeaderSchema, domainArtifactRefSchema, domainDescriptorSchema } from './schema.ts'
import type { DomainArtifactHeader, DomainArtifactRef, DomainArtifactView, DomainDescriptor, DomainRuntimeProvider } from './types.ts'
export * from './schema.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { domainArtifacts: DomainArtifactRegistry } }

/** Stable fail-closed registry error. */
export class DomainArtifactError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'DomainArtifactError' }
}

/**
 * Validate the entire metadata envelope rather than only individual text fields.
 * @param value - Parsed complete metadata envelope.
 * @returns The same value when it fits the fixed UTF-8 metadata contract.
 */
export function boundedDomainMetadata<T>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > DOMAIN_METADATA_MAX_BYTES) {
    throw new DomainArtifactError('metadata-too-large', 'domain artifact metadata exceeds 32768 UTF-8 bytes')
  }
  return value
}

/** Effect-scoped provider registry; no central payload store or action executor. */
export class DomainArtifactRegistry extends Service {
  private readonly providers = new Map<string, { provider: DomainRuntimeProvider; descriptor: DomainDescriptor }>()
  constructor(ctx: Context) { super(ctx, 'domainArtifacts') }

  /**
   * Register one domain until its contributing fiber is disposed. Duplicate domains reject.
   * @param provider - Trusted owner that supplies metadata and immutable payload reads.
   * @returns Effect disposer; existing reads reject if this registration is unloaded.
   */
  register(provider: DomainRuntimeProvider): () => void {
    const descriptor = boundedDomainMetadata(domainDescriptorSchema.parse(provider.descriptor()))
    if (descriptor.domain !== provider.domain) throw new DomainArtifactError('provider-mismatch',
      'descriptor domain differs from provider domain')
    const domain = descriptor.domain
    const registration = { provider, descriptor }
    return this.ctx.effect(() => {
      if (this.providers.has(domain)) throw new DomainArtifactError('duplicate-provider', `domain ${domain} is already registered`)
      boundedDomainMetadata([...this.providers.values()].map(row => row.descriptor).concat(descriptor))
      this.providers.set(domain, registration)
      return () => { if (this.providers.get(domain) === registration) this.providers.delete(domain) }
    })
  }

  /**
   * Return detached provider descriptions; no owner payload is loaded.
   * @returns The bounded registered domain catalog.
   */
  discover(): DomainDescriptor[] { return structuredClone([...this.providers.values()].map(row => row.descriptor)) }

  private resolve(ref: DomainArtifactRef) {
    const canonical = domainArtifactRefSchema.parse(ref)
    const entry = this.providers.get(canonical.domain)
    if (!entry) throw new DomainArtifactError('unknown-provider', `domain ${canonical.domain} is unavailable`)
    if (!entry.descriptor.artifactKinds.includes(canonical.kind)) throw new DomainArtifactError('unknown-kind',
      `artifact kind ${canonical.kind} is unavailable`)
    return { ...entry, registration: entry, ref: canonical }
  }

  private validateHeader(header: DomainArtifactHeader, ref: DomainArtifactRef): DomainArtifactHeader {
    const result = boundedDomainMetadata(domainArtifactHeaderSchema.parse(header))
    if (result.ref.domain !== ref.domain || result.ref.kind !== ref.kind || result.ref.id !== ref.id
      || (ref.digest !== undefined && result.ref.digest !== ref.digest)) {
      throw new DomainArtifactError('reference-mismatch', 'provider returned a different artifact identity')
    }
    return result
  }

  /**
   * Route a metadata-only read, reject mismatched identities, and return a detached header.
   * @param ref - Exact owner, kind and identity; a supplied digest must match.
   * @param signal - Optional lifetime checked before and after the provider read.
   * @returns Owner metadata, or undefined for a missing artifact; unavailable providers reject.
   */
  async readHeader(ref: DomainArtifactRef, signal?: AbortSignal): Promise<DomainArtifactHeader | undefined> {
    signal?.throwIfAborted()
    const entry = this.resolve(ref)
    const header = await entry.provider.readArtifactHeader(structuredClone(entry.ref), signal)
    signal?.throwIfAborted()
    if (this.providers.get(entry.ref.domain) !== entry.registration) throw new DomainArtifactError('provider-unloaded',
      'domain provider was unloaded during the read')
    return header === undefined ? undefined : this.validateHeader(header, entry.ref)
  }

  /**
   * Route one exact artifact read; validate JSON but never interpret domain payload fields.
   * @param ref - Exact owner, kind and identity; a supplied digest must match.
   * @param signal - Optional lifetime forwarded to the provider.
   * @returns A detached header and payload, or undefined for a missing artifact.
   */
  async readArtifact(ref: DomainArtifactRef, signal?: AbortSignal): Promise<DomainArtifactView | undefined> {
    signal?.throwIfAborted()
    const entry = this.resolve(ref)
    const view = await entry.provider.readArtifact(structuredClone(entry.ref), signal)
    signal?.throwIfAborted()
    if (this.providers.get(entry.ref.domain) !== entry.registration) throw new DomainArtifactError('provider-unloaded',
      'domain provider was unloaded during the read')
    if (view === undefined) return undefined
    const header = this.validateHeader(view.header, entry.ref)
    const payload = snapshotJsonValue(view.payload)
    if (payload === undefined) throw new DomainArtifactError('invalid-payload', 'domain provider payload must be lossless JSON')
    return { header, payload }
  }

  /**
   * Return direct immutable parent references without recursively loading their payloads.
   * @param ref - Child artifact identity.
   * @param signal - Optional lifetime forwarded to the metadata read.
   * @returns Detached direct parent references, or undefined for a missing child.
   */
  async parents(ref: DomainArtifactRef, signal?: AbortSignal): Promise<DomainArtifactRef[] | undefined> {
    return (await this.readHeader(ref, signal))?.derivedFrom
  }
}
export default DomainArtifactRegistry
