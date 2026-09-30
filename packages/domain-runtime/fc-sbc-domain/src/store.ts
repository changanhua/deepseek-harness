/** FC-owned immutable publication over Storage Domain; the generic registry stores no payloads. */
import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { boundedDomainMetadata, domainArtifactHeaderSchema, domainArtifactRefSchema } from '@changanhua/dsh-domain-runtime'
import type { DomainArtifactRef, DomainArtifactHeader } from '@changanhua/dsh-domain-runtime'
import { canonical, verifyArtifact } from './compiler.ts'
import type { FcLimits } from './compiler.ts'
import type { FcArtifact } from './types.ts'
import { cardSchema, challengeSchema } from './schema.ts'
const short = z.string().max(512)
const codeList = z.array(short).max(64)
const status = z.enum(['complete', 'partial', 'unknown'])
const realityPayload = z.strictObject({
  schemaVersion: z.literal(1), pageIdentity: z.strictObject({ tabId: z.number().int(), frameId: z.number().int(),
    documentId: short, url: short,
    installationId: short.optional(), clubId: short.optional(), platform: short.optional() }),
  group: z.strictObject({ id: short.optional(), title: short, taskType: z.enum(['puzzle', 'item-score', 'unknown']),
    coverage: z.enum(['partial', 'unknown']), challenges: z.array(challengeSchema.strict()).max(24) }),
  inventory: z.strictObject({ status, coverage: short, cards: z.array(cardSchema.strict()).max(4000), summary: z.record(z.string(),
    z.union([z.string(), z.number().int().nonnegative()])) }),
  marketAccess: z.strictObject({ status: z.enum(['visible', 'blocked', 'unknown']),
    observedAt: z.iso.datetime({ offset: true }).optional() }),
  pageModel: z.strictObject({
    page: z.strictObject({ tabId: z.number().int(), frameId: z.number().int(), documentId: short, url: short }),
    observedAt: z.iso.datetime({ offset: true }),
    view: z.strictObject({ kind: short, selectedChallenge: z.strictObject({ title: short, visibleIndex: z.number().int() }).nullable() }),
    group: z.strictObject({ title: short.nullable(), signature: z.string().max(8192), visibleChallengeCount: z.number().int(),
      observedDetailCount: z.number().int(), coverage: z.enum(['unread', 'partial', 'visible-rows-read']),
      challenges: z.array(z.strictObject({ title: short, visibleIndex: z.number().int(), completed: z.boolean(),
        requirements: z.array(short).max(64).nullable(), rewards: z.array(short).max(32).nullable(),
        observedAt: z.iso.datetime({ offset: true }).nullable() })).max(24),
    }).nullable(),
    inventory: z.strictObject({ coverage: z.enum(['unread', 'visible-only']), visibleCardCount: z.number().int(),
      sbcStorageVisible: z.boolean(), observedAt: z.iso.datetime({ offset: true }).nullable() }),
  }).nullable(), capturedAt: z.iso.datetime({ offset: true }),
})
const candidate = z.strictObject({ candidateId: short, cards: z.array(z.strictObject({ instanceId: short })).max(30) })
const challengePlan = z.strictObject({ challengeId: short, candidateId: short,
  cards: z.array(z.strictObject({ kind: z.literal('owned'), instanceId: short, cardVersionId: short, reserveValue: z.number(),
    opportunityCost: z.number() })).max(30),
  purchaseCount: z.number(), maxSpend: z.number(), opportunityCost: z.number(), score: z.number() })
const planPayload = z.strictObject({
  schemaVersion: z.literal(1), realityRef: domainArtifactRefSchema,
  solver: z.strictObject({ version: short, searched: z.number().int().nonnegative(), searchComplete: z.boolean(),
    incompleteReasons: codeList }),
  candidates: z.array(z.strictObject({ id: short, challengePlans: z.array(challengePlan).max(24),
    purchaseCount: z.number().int().nonnegative(), maxSpend: z.number().int().nonnegative(), provisional: z.boolean(),
    issues: codeList })).max(12),
  challengeCandidates: z.array(z.strictObject({ challengeId: short, candidates: z.array(candidate).max(12), provisional: z.boolean(),
    issues: codeList })).max(24),
  quoteStatus: z.strictObject({ status: z.literal('missing'), quoteRefs: z.array(domainArtifactRefSchema).max(0) }),
  readiness: z.strictObject({ status: z.enum(['candidate', 'blocked']), blockers: codeList }),
})
const artifactSchema = z.strictObject({ header: domainArtifactHeaderSchema, payload: z.unknown() }).superRefine((value, context) => {
  const payload = value.header.ref.kind === 'sbc-reality' ? realityPayload : planPayload
  const parsed = payload.safeParse(value.payload)
  const plan = value.header.ref.kind === 'sbc-plan' ? planPayload.safeParse(value.payload) : undefined
  const lineageValid = plan?.success
    ? value.header.derivedFrom.length === 1 && canonical(value.header.derivedFrom[0]) === canonical(plan.data.realityRef)
    : value.header.ref.kind === 'sbc-reality' && value.header.derivedFrom.length === 0
  if (!parsed.success || !lineageValid || !verifyArtifact(value as FcArtifact)) context.addIssue({ code: 'custom',
    message: 'invalid FC artifact payload or digest' })
  try { boundedDomainMetadata(value.header) } catch { context.addIssue({ code: 'custom', message: 'FC metadata exceeds its contract' }) }
}).transform(value => value as FcArtifact)
const stateSchema = z.strictObject({ artifacts: z.array(artifactSchema), requests: z.record(z.string(), z.strictObject({ digest: short,
  ref: domainArtifactRefSchema })),
canonicalRefs: z.record(z.string(), domainArtifactRefSchema) }).superRefine((value, context) => {
  const byId = new Map(value.artifacts.map(artifact => [artifact.header.ref.id, artifact]))
  if (byId.size !== value.artifacts.length || [...Object.values(value.requests).map(row => row.ref),
    ...Object.values(value.canonicalRefs)].some(ref => canonical(byId.get(ref.id)?.header.ref) !== canonical(ref))) {
    context.addIssue({ code: 'custom', message: 'FC receipt points to a missing or mismatched artifact' })
  }
})
const spec = defineDomain({ name: 'fc_sbc_artifacts', version: 1,
  global: { schema: stateSchema, initial: stateSchema.parse({ artifacts: [], requests: {}, canonicalRefs: {} }) }, tables: {} })

/** Single owner serializes immutable publication and idempotency receipts in one durable write. */
export class FcArtifactStore {
  private tail: Promise<unknown> = Promise.resolve()
  private closing = false
  private constructor(private readonly domain: Domain<typeof spec>, private readonly limits: FcLimits) {}
  /**
   * Open the FC-owned Storage Domain and verify persisted capacity and identity.
   * @param facility - Composed Storage Domain facility.
   * @param limits - Current deployment capacities, also applied on restart.
   * @returns The sole owner handle for this open domain.
   */
  static async open(facility: DomainFacility, limits: FcLimits): Promise<FcArtifactStore> {
    const domain = await facility.open(spec)
    const store = new FcArtifactStore(domain, limits)
    try { store.checkCapacity(domain.global.get()) } catch (error) { await domain.close(); throw error }
    return store
  }
  private checkCapacity(value: z.infer<typeof stateSchema>): void {
    if (value.artifacts.length > this.limits.maxArtifacts) throw new Error('artifact-capacity')
    if (value.artifacts.some(row => Buffer.byteLength(canonical(row)) > this.limits.maxArtifactBytes)) throw new Error('artifact-byte-capacity')
    if (Buffer.byteLength(canonical(value)) > this.limits.maxArtifacts * this.limits.maxArtifactBytes) throw new Error('store-byte-capacity')
  }
  private resolve(ref: import('@changanhua/dsh-domain-runtime').DomainArtifactRef): FcArtifact | undefined {
    if (this.closing) throw new Error('fc-domain-closed')
    const artifact = this.domain.global.get().artifacts.find(row => row.header.ref.id === ref.id)
    if (artifact && (artifact.header.ref.domain !== ref.domain || artifact.header.ref.kind !== ref.kind || (ref.digest && artifact.header.ref.digest !== ref.digest))) throw new Error('artifact-reference-mismatch')
    return artifact
  }
  /**
   * Read one exact artifact without exposing authoritative storage objects.
   * @param ref - Expected immutable artifact identity.
   * @returns A detached artifact, or undefined when missing.
   */
  read(ref: import('@changanhua/dsh-domain-runtime').DomainArtifactRef): FcArtifact | undefined {
    const value = this.resolve(ref); return value === undefined ? undefined : structuredClone(value)
  }
  /**
   * Read metadata without cloning or returning the owner payload.
   * @param ref - Expected immutable artifact identity.
   * @returns A detached header, or undefined when missing.
   */
  readHeader(ref: DomainArtifactRef): DomainArtifactHeader | undefined {
    const value = this.resolve(ref); return value === undefined ? undefined : structuredClone(value.header)
  }
  /**
   * Serialize idempotent creation and commit artifact plus receipts atomically.
   * @param requestId - Operation-qualified request identity.
   * @param requestDigest - Canonical input identity; conflicting reuse rejects.
   * @param create - Deterministic producer invoked only when no canonical artifact exists.
   * @param signal - Optional cancellation checked before durable commit.
   * @returns The original or newly committed detached artifact.
   */
  async publish(requestId: string, requestDigest: string, create: () => FcArtifact, signal?: AbortSignal): Promise<FcArtifact> {
    if (this.closing) throw new Error('fc-domain-closed')
    const operation = this.tail.then(async () => {
      signal?.throwIfAborted()
      const state = this.domain.global.get()
      const previous = state.requests[requestId]
      if (previous && previous.digest !== requestDigest) throw new Error('request-id-conflict')
      const ref = previous?.ref ?? state.canonicalRefs[requestDigest]
      const existing = ref && state.artifacts.find(row => row.header.ref.id === ref.id)
      if (previous && existing) return structuredClone(existing)
      const artifact = existing ?? create()
      const duplicate = state.artifacts.find(row => row.header.ref.id === artifact.header.ref.id)
      if (duplicate && canonical(duplicate) !== canonical(artifact)) throw new Error('immutable-artifact-conflict')
      const next = stateSchema.parse({ artifacts: duplicate ? state.artifacts : [...state.artifacts, artifact],
        requests: { ...state.requests, [requestId]: { digest: requestDigest, ref: artifact.header.ref } },
        canonicalRefs: { ...state.canonicalRefs, [requestDigest]: artifact.header.ref } })
      this.checkCapacity(next)
      signal?.throwIfAborted()
      await this.domain.global.set(next)
      return structuredClone(artifact)
    })
    this.tail = operation.catch(() => {})
    return operation
  }
  /** Drain admitted publications and release the Storage Domain. */
  async close(): Promise<void> { this.closing = true; await this.tail; await this.domain.close() }
}
