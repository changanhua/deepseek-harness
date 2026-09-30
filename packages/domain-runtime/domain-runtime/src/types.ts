import type { z } from 'zod'
import type { domainArtifactHeaderSchema, domainArtifactRefSchema, domainDescriptorSchema, domainSourceRefSchema } from './schema.ts'

/** An immutable artifact locator whose payload belongs to its provider. */
export type DomainArtifactRef = z.infer<typeof domainArtifactRefSchema>
/** Bounded provenance locator. */
export type DomainSourceRef = z.infer<typeof domainSourceRefSchema>
/** Immutable metadata captured when the owner publishes an artifact. */
export type DomainArtifactHeader = z.infer<typeof domainArtifactHeaderSchema>
/** Bounded discovery description, never an action-dispatch interface. */
export type DomainDescriptor = z.infer<typeof domainDescriptorSchema>
/** Detached owner payload paired with its exact immutable identity. */
export interface DomainArtifactView { readonly header: DomainArtifactHeader; readonly payload: unknown }
/** Trusted Host provider. No payload writes or domain actions exist on this contract. */
export interface DomainRuntimeProvider {
  readonly domain: string
  descriptor(): DomainDescriptor
  readArtifact(ref: DomainArtifactRef, signal?: AbortSignal): Promise<DomainArtifactView | undefined>
  readArtifactHeader(ref: DomainArtifactRef, signal?: AbortSignal): Promise<DomainArtifactHeader | undefined>
}
