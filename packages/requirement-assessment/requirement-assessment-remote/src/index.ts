import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { Remote, TypertRemoteService, TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { PlanningBoardSnapshot } from '@changanhua/dsh-planning'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { AssessmentError } from '@changanhua/dsh-requirement-assessment'
import type { AssessmentAccess, RequirementAssessment } from '@changanhua/dsh-requirement-assessment'
import { quickReviewInputSchema } from '@changanhua/dsh-requirement-assessment-review'
import type { AssessmentView, AssessmentDrift, AssessmentListInput, AssessmentGetInput, AssessmentReviewInput } from './types.ts'
export * from './types.ts'
/** Deployment-owned local operator identity, never accepted from the wire. */
export interface Config {
  /** Host-authenticated actor recorded for browser operations. */
  operatorId?: string
}
export const Config: Schema<Config> = Schema.object({ operatorId: Schema.string().default('local-operator') })
const id = z.string().trim().min(1).max(256)
const listSchema = z.strictObject({ workspaceId: id })
const getSchema = listSchema.extend({ id })
const reviewSchema = quickReviewInputSchema.safeExtend({ workspaceId: id })
/** Sanitize failures: model text, host paths and credential diagnostics stay off the wire. */
function failure(error: unknown, signal: AbortSignal): TypertRemoteFailure {
  const code = signal.aborted ? 'cancelled' : error instanceof z.ZodError ? 'bad-request' : error instanceof AssessmentError
    ? ({ 'invalid-input': 'bad-request', 'not-found': 'not-found', conflict: 'conflict', 'idempotency-conflict': 'conflict', 'capacity-exceeded': 'capacity-exceeded', closed: 'unavailable' } as const)[error.code] : 'internal'
  return new TypertRemoteFailure({ code, message: `Investment review: ${code}`, details: {} })
}
declare module '@deepseek-ai/cordis' { interface Context { requirementAssessmentRemote: RequirementAssessmentRemote } }
/** Read-only Planning projection and trusted evaluation entry point. */
export class RequirementAssessmentRemote extends TypertRemoteService {
  static inject = ['requirementAssessment', 'requirementAssessmentReview', 'planning', 'workspaceRegistry']
  static Config = Config
  private readonly operatorId: string
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'requirementAssessmentRemote', { namespace: 'requirementAssessment' })
    this.operatorId = id.parse(config.operatorId ?? 'local-operator')
  }
  /**
   * List immutable assessments and live baseline status within the selected registered workspace.
   * @param raw - Selected workspace, checked against Host registration.
   * @param signal - Browser request lifetime.
   * @returns Immutable history projected against one current authorized Planning snapshot.
   */
  @Remote('list')
  async list(raw: AssessmentListInput, signal: AbortSignal): Promise<AssessmentView[]> {
    try {
      const input = listSchema.parse(raw), access = this.access(input.workspaceId, signal)
      const snapshot = await this.ctx.requirementAssessment.snapshot(access, signal)
      const board = snapshot.assessments.some(value => value.subject.kind === 'plan' || value.subject.kind === 'focus') ? await this.board(access, signal) : undefined
      const result = snapshot.assessments.map(assessment => ({ assessment, drift: this.drift(assessment, board) }))
      await access.authorize(); return result
    } catch (error) { throw failure(error, signal) }
  }
  /**
   * Resolve only an assessment owned by the selected registered workspace.
   * @param raw - Workspace and assessment identities; foreign ids never resolve.
   * @param signal - Browser request lifetime.
   * @returns The assessment and read-time baseline drift.
   */
  @Remote('get')
  async get(raw: AssessmentGetInput, signal: AbortSignal): Promise<AssessmentView> {
    try {
      const input = getSchema.parse(raw), access = this.access(input.workspaceId, signal)
      return await this.view(access, await this.ctx.requirementAssessment.get(access, input.id, signal), signal)
    } catch (error) { throw failure(error, signal) }
  }
  /**
   * Run one explicitly requested quick review; routes never execute downstream actions.
   * @param raw - Bounded user input without actor, baseline or evidence provenance authority.
   * @param signal - Browser lifetime propagated through capture, evaluation and persistence.
   * @returns Completed assessment with current drift; rejected attempts do not create results.
   */
  @Remote('review')
  async review(raw: AssessmentReviewInput, signal: AbortSignal): Promise<AssessmentView> {
    try {
      const { workspaceId, ...input } = reviewSchema.parse(raw), access = this.access(workspaceId, signal)
      return await this.view(access, await this.ctx.requirementAssessmentReview.review(access, input, signal), signal)
    } catch (error) { throw failure(error, signal) }
  }
  private async view(access: AssessmentAccess, assessment: RequirementAssessment, signal: AbortSignal): Promise<AssessmentView> {
    const board = assessment.subject.kind === 'manual' || assessment.subject.kind === 'candidate' ? undefined : await this.board(access, signal)
    signal.throwIfAborted(); await access.authorize()
    return { assessment, drift: this.drift(assessment, board) }
  }
  private async board(access: AssessmentAccess, signal: AbortSignal): Promise<PlanningBoardSnapshot | undefined> {
    try { return await this.ctx.planning.snapshot(access, signal) }
    catch { signal.throwIfAborted(); await access.authorize(); return undefined }
  }
  private drift(assessment: RequirementAssessment, board: PlanningBoardSnapshot | undefined): AssessmentDrift {
    const subject = assessment.subject
    if (subject.kind === 'manual' || subject.kind === 'candidate') return 'unknown'
    if (!board) return 'unavailable'
    const focus = subject.kind === 'focus' ? board.focuses?.find(value => value.id === subject.id && value.planId === subject.planId) : undefined
    const plan = board.items.find(value => value.id === (subject.kind === 'plan' ? subject.id : subject.planId))
    if (!plan || (subject.kind === 'focus' && !focus)) return 'unavailable'
    return plan.headRevisionId !== assessment.baseline.planRevision || (focus && focus.version !== assessment.baseline.focusVersion) ? 'stale' : 'fresh'
  }
  private access(workspaceId: string, signal: AbortSignal): AssessmentAccess {
    const authorize = () => {
      signal.throwIfAborted()
      if (!this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))) throw new AssessmentError('not-found', 'workspace unavailable')
    }
    authorize()
    return { workspaceId, actorId: this.operatorId, kind: 'human', authorize }
  }
}
export default RequirementAssessmentRemote
