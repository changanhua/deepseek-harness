/** FC27 read-only Reality and Plan owner; payloads persist only in its Storage Domain. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { domainArtifactRefSchema } from '@changanhua/dsh-domain-runtime'
import type { DomainArtifactRef, DomainRuntimeProvider } from '@changanhua/dsh-domain-runtime'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { captureRealitySchema, buildPlanSchema } from './schema.ts'
import { compilePlan, compileReality, digest, freshness } from './compiler.ts'
import type { FcLimits } from './compiler.ts'
import { FcArtifactStore } from './store.ts'
import type { BuildFcPlan, CaptureFcReality, FcArtifact, FcArtifactStatus, FcSbcPlanArtifact } from './types.ts'
export type * from './types.ts'
export { captureRealitySchema, buildPlanSchema } from './schema.ts'

declare module '@deepseek-ai/cordis' { interface Context { fcSbcDomain: FcSbcDomain } }
/** Deployment capacity, independent from Browser/Safety/Planning policy. */
export interface Config extends Partial<FcLimits> {}

/** Typed offline FC capability. It accepts read observations, never external-write callbacks. */
export class FcSbcDomain extends Service {
  static inject = ['storageDomain', 'domainArtifacts']
  static Config: z<Config, FcLimits> = z.object({
    maxArtifacts: z.number().step(1).min(1).max(4096).default(256),
    maxArtifactBytes: z.number().step(1).min(1024).max(8_388_608).default(1_048_576),
    maxCards: z.number().step(1).min(1).max(4000).default(2000),
    maxChallenges: z.number().step(1).min(1).max(24).default(8),
    maxCrossChallengeCombinations: z.number().step(1).min(1).max(100000).default(10000),
  })
  private store!: FcArtifactStore
  private readonly limits: FcLimits
  constructor(ctx: Context, config: Config) { super(ctx, 'fcSbcDomain'); this.limits = FcSbcDomain.Config(config) }
  protected async [Service.init](): Promise<void> {
    this.store = await FcArtifactStore.open(this.ctx.storageDomain, this.limits)
    this.ctx.effect(() => () => this.store.close())
    const provider: DomainRuntimeProvider = {
      domain: 'fc27', descriptor: () => ({ domain: domainArtifactRefSchema.parse({ domain: 'fc27', kind: 'sbc-reality',
        id: 'descriptor' }).domain,
      label: 'FC27 SBC', artifactKinds: ['sbc-reality', 'sbc-plan'], capabilities: [{ name: 'inspect', mode: 'read' },
        { name: 'plan', mode: 'plan' }, { name: 'status', mode: 'read' }] }),
      readArtifact: (ref, signal) => this.readArtifact(ref, signal),
      readArtifactHeader: async (ref, signal) => { signal?.throwIfAborted(); return this.store.readHeader(ref) },
    }
    this.ctx.domainArtifacts.register(provider)
  }
  /**
   * Persist an allowlisted existing read/probe observation and return its immutable reference.
   * @param input - Typed observations, provenance and idempotency request identity.
   * @param signal - Optional cancellation checked before durable publication.
   * @returns The committed immutable Reality reference; changed request reuse rejects.
   */
  async captureReality(input: CaptureFcReality, signal?: AbortSignal): Promise<DomainArtifactRef> {
    signal?.throwIfAborted()
    const parsed = captureRealitySchema.parse(input)
    const { requestId, ...observation } = parsed
    const artifact = await this.store.publish(`capture:${requestId}`, digest({ operation: 'capture-v1', observation }),
      () => compileReality(parsed, this.limits, Date.now()), signal)
    return artifact.header.ref
  }
  /**
   * Freeze existing-solver candidates from an exact persisted Reality; never approve or execute.
   * @param input - Exact Reality reference including digest, request identity and bounded search options.
   * @param signal - Optional cancellation checked before durable publication.
   * @returns The committed immutable Plan reference; identical canonical input reuses the first artifact.
   */
  async buildPlan(input: BuildFcPlan, signal?: AbortSignal): Promise<DomainArtifactRef> {
    signal?.throwIfAborted()
    const parsed = buildPlanSchema.parse(input)
    const reality = this.store.read(parsed.realityRef)
    if (!reality || reality.header.ref.kind !== 'sbc-reality' || parsed.realityRef.digest !== reality.header.ref.digest) throw new Error('exact-reality-required')
    const options = { searchLimit: parsed.searchLimit ?? 25000, candidateLimit: parsed.candidateLimit ?? 12 }
    const artifact = await this.store.publish(`plan:${parsed.requestId}`, digest({ operation: 'plan-v1',
      realityRef: reality.header.ref, options,
      maxCrossChallengeCombinations: this.limits.maxCrossChallengeCombinations }), () => compilePlan(reality, options, this.limits,
      Date.now()), signal)
    return artifact.header.ref
  }
  /**
   * Read one exact detached owner payload; unknown identity returns undefined.
   * @param ref - Artifact owner, kind, id and optional digest to verify.
   * @param signal - Optional cancellation checked before reading.
   * @returns Detached FC payload and metadata, or undefined for a missing artifact.
   */
  async readArtifact(ref: DomainArtifactRef, signal?: AbortSignal): Promise<FcArtifact | undefined> {
    signal?.throwIfAborted()
    return this.store.read(domainArtifactRefSchema.parse(ref))
  }
  /**
   * Bounded summary; freshness is evaluated at read time without editing historical artifacts.
   * @param ref - Exact artifact identity.
   * @param signal - Optional cancellation forwarded to the owner read.
   * @returns Bounded status and blockers, or undefined for a missing artifact.
   */
  async getStatus(ref: DomainArtifactRef, signal?: AbortSignal): Promise<FcArtifactStatus | undefined> {
    const artifact = await this.readArtifact(ref, signal)
    if (!artifact) return undefined
    const plan = artifact.header.ref.kind === 'sbc-plan' ? artifact.payload as FcSbcPlanArtifact : undefined
    return { ref: artifact.header.ref, coverage: artifact.header.coverage, freshness: freshness(artifact.header, Date.now()),
      issueCodes: artifact.header.issues.map(row => row.code),
      ...(plan ? { candidateCount: plan.candidates.length, readiness: plan.readiness, quoteStatus: plan.quoteStatus } : {}) }
  }
}
export default FcSbcDomain
