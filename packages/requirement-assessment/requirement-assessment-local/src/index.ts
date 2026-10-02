import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import RequirementAssessmentService, { AssessmentError } from '@changanhua/dsh-requirement-assessment'
import type { AssessmentAccess, AssessmentRequestIdentity, AssessmentReservation, AssessmentCreateInput, AssessmentSnapshot, RequirementAssessment } from '@changanhua/dsh-requirement-assessment'
import { AssessmentStore } from './store.ts'
import { acquireAssessmentOwnership } from './ownership.ts'
export interface LocalAssessmentConfig { ownershipRoot: string; maxWorkspaceBytes?: number }
/** Single-Host local provider using the existing Storage Domain atomic persistence. */
export class LocalRequirementAssessment extends RequirementAssessmentService {
  static inject = ['storageDomain', 'workspaceRegistry']
  static Config: z<LocalAssessmentConfig, Required<LocalAssessmentConfig>> = z.object({
    ownershipRoot: z.string().required(), maxWorkspaceBytes: z.number().step(1).min(1).max(64 * 1024 * 1024).default(4 * 1024 * 1024),
  })
  private readonly config: Required<LocalAssessmentConfig>
  private store?: AssessmentStore
  private closing = false
  private readonly pending = new Set<Promise<unknown>>()
  constructor(ctx: import('@deepseek-ai/cordis').Context, config: LocalAssessmentConfig) {
    super(ctx)
    this.config = LocalRequirementAssessment.Config(config)
  }
  protected async [Service.init](): Promise<void> {
    const ownership = await acquireAssessmentOwnership(this.config.ownershipRoot)
    try { this.store = await AssessmentStore.open(this.ctx.storageDomain, this.config.maxWorkspaceBytes) }
    catch (error) { await ownership.release(); throw error }
    this.ctx.effect(() => async () => {
      this.closing = true
      await Promise.allSettled([...this.pending])
      try { await this.store?.close() } finally { await ownership.release() }
    }, 'requirement assessment local storage')
  }
  reserve(access: AssessmentAccess, request: AssessmentRequestIdentity, signal?: AbortSignal): Promise<AssessmentReservation> {
    const captured = { ...request }
    return this.use(access, signal, (store, checked) => store.reserve(checked, captured, signal))
  }
  create(access: AssessmentAccess, input: AssessmentCreateInput, signal?: AbortSignal): Promise<RequirementAssessment> {
    const captured = structuredClone(input)
    return this.use(access, signal, (store, checked) => store.create(checked, captured, signal))
  }
  snapshot(access: AssessmentAccess, signal?: AbortSignal): Promise<AssessmentSnapshot> {
    return this.use(access, signal, (store, checked) => store.snapshot(checked.workspaceId))
  }
  get(access: AssessmentAccess, id: string, signal?: AbortSignal): Promise<RequirementAssessment> {
    return this.use(access, signal, (store, checked) => store.get(checked.workspaceId, id))
  }
  replay(
    access: AssessmentAccess, requestId: string, requestDigest: string, signal?: AbortSignal,
  ): Promise<RequirementAssessment | undefined> {
    return this.use(access, signal, (store, checked) => store.replay(checked.workspaceId, requestId, requestDigest))
  }
  private use<T>(
    access: AssessmentAccess, signal: AbortSignal | undefined,
    operation: (store: AssessmentStore, access: AssessmentAccess) => T | Promise<T>,
  ): Promise<T> {
    const store = this.store
    if (!store || this.closing) return Promise.reject(new AssessmentError('closed', 'assessment provider is unavailable'))
    const checked: AssessmentAccess = {
      workspaceId: access.workspaceId, actorId: access.actorId, kind: access.kind, authorize: async () => {
        signal?.throwIfAborted()
        await access.authorize()
        if (!this.ctx.workspaceRegistry.get(WorkspaceId(checked.workspaceId)))
          throw new AssessmentError('not-found', 'assessment workspace is unavailable')
      },
    }
    const pending = Promise.resolve().then(async () => {
      await checked.authorize()
      const result = await operation(store, checked)
      await checked.authorize()
      return result
    })
    this.pending.add(pending)
    void pending.then(() => this.pending.delete(pending), () => this.pending.delete(pending))
    return pending
  }
}
export default LocalRequirementAssessment
