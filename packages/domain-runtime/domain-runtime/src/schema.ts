/** Validated, bounded metadata carried across domain provider and durable boundaries. */
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque provider-owned immutable artifact identity. */
export type DomainArtifactId = Branded<'DomainArtifactId'>
/** Domain provider identity. */
export type DomainId = Branded<'DomainId'>
/** UTF-8 bound on a complete header or descriptor, including its envelope. */
export const DOMAIN_METADATA_MAX_BYTES = 32_768
const id = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u)
const text = z.string().min(1).max(512)
const time = z.iso.datetime({ offset: true })
/** Exact provider, artifact kind, identity and optional content digest. */
export const domainArtifactRefSchema = z.strictObject({
  domain: id.transform(value => value as DomainId),
  kind: id,
  id: id.transform(value => value as DomainArtifactId),
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u).optional(),
})
/** Provenance locator; the source owner keeps its payload. */
export const domainSourceRefSchema = z.strictObject({
  kind: id, id, provider: id.optional(), revision: text.optional(), label: text.optional(),
})
/** Metadata is immutable capture-time evidence; readers evaluate expiry separately. */
export const domainArtifactHeaderSchema = z.strictObject({
  ref: domainArtifactRefSchema,
  createdAt: time,
  observedAt: time.optional(),
  expiresAt: time.optional(),
  coverage: z.strictObject({ status: z.enum(['complete', 'partial', 'unknown']), reasons: z.array(text).max(64) }).optional(),
  freshness: z.strictObject({ status: z.enum(['fresh', 'stale', 'unknown']), observedAt: time.optional(),
    expiresAt: time.optional() }).optional(),
  derivedFrom: z.array(domainArtifactRefSchema).max(64),
  sourceRefs: z.array(domainSourceRefSchema).max(64),
  issues: z.array(z.strictObject({ code: id, severity: z.enum(['info', 'warning', 'blocked']).optional(),
    detail: text.optional() })).max(64),
})
/** Discovery describes supported capabilities without providing an invocation escape hatch. */
export const domainDescriptorSchema = z.strictObject({
  domain: id.transform(value => value as DomainId), label: text,
  artifactKinds: z.array(id).min(1).max(32),
  capabilities: z.array(z.strictObject({ name: id, mode: z.enum(['read', 'plan']) })).max(32),
})
