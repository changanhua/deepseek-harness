import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { assessmentEvaluationSchema, assessmentActualInputSchema, assessmentBaselineSchema, AssessmentError } from '@changanhua/dsh-requirement-assessment'
import type { AssessmentAccess, AssessmentActualInput, AssessmentBaseline, RequirementAssessment } from '@changanhua/dsh-requirement-assessment'
import { buildPlanningContext } from '@changanhua/dsh-planning'
import { runReviewModel } from './model.ts'
import type { ReviewModelConfig } from './model.ts'
import { quickReviewInputSchema } from './schema.ts'
import type { CandidateReviewSource, QuickReviewInput } from './types.ts'
import { REVIEW_PROMPT_VERSION, REVIEW_SYSTEM_PROMPT } from './prompt.ts'
export * from './types.ts'
export * from './schema.ts'
export { REVIEW_PROMPT_VERSION, REVIEW_SYSTEM_PROMPT } from './prompt.ts'
/** Explicit deployment policy; no model route or unverified baseline is guessed. */
export interface Config extends ReviewModelConfig { dshBaseline: string }
export const Config: Schema<Config> = Schema.object({
  provider: Schema.string().required(), model: Schema.string().required(),
  maxInputBytes: Schema.number().min(1).step(1).required(), maxOutputBytes: Schema.number().min(1).step(1).required(),
  maxOutputTokens: Schema.number().min(1).step(1).required(), timeoutMs: Schema.number().min(1).max(2147483647).step(1).required(),
  dshBaseline: Schema.string().required(),
})
declare module '@deepseek-ai/cordis' { interface Context { requirementAssessmentReview: RequirementAssessmentReview } }
/** Fixed-context, bounded, single-call evaluator using the configured LLM runtime. */
export class RequirementAssessmentReview extends Service {
  static inject = ['requirementAssessment', 'planning', 'llm']
  static Config = Config
  private readonly config: Config
  private readonly lifetime = new AbortController()
  private readonly inflight = new Map<string, { digest: string; promise: Promise<RequirementAssessment> }>()
  constructor(ctx: Context, config: Config) {
    super(ctx, 'requirementAssessmentReview')
    this.config = Object.freeze({
      provider: config.provider, model: config.model, dshBaseline: config.dshBaseline,
      maxInputBytes: config.maxInputBytes, maxOutputBytes: config.maxOutputBytes,
      maxOutputTokens: config.maxOutputTokens, timeoutMs: config.timeoutMs,
    })
    for (const key of ['provider', 'model', 'dshBaseline'] as const) if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error(`invalid ${key}`)
    for (const key of ['maxInputBytes', 'maxOutputBytes', 'maxOutputTokens', 'timeoutMs'] as const) if (!Number.isSafeInteger(config[key]) || config[key] <= 0) throw new Error(`invalid ${key}`)
    if (config.timeoutMs > 2147483647) throw new Error('invalid timeoutMs')
    ctx.effect(() => async () => {
      this.lifetime.abort(new Error('review service disposed'))
      await Promise.allSettled([...this.inflight.values()].map(value => value.promise))
    }, 'requirement review lifetime')
  }
  /**
   * Deduplicate requests before spending model tokens.
   * @param access - Trusted Host workspace and actor capability, reauthorized before work and commit.
   * @param raw - Strict user request without provenance or authority fields.
   * @param signal - Caller lifetime; cancellation leaves a spent reservation unresolved.
   * @param candidateSource - Trusted owner snapshot for a Candidate subject; never browser/model input.
   * @returns The immutable completed assessment, including a replayed original for the same request.
   */
  async review(
    access: AssessmentAccess, raw: QuickReviewInput, signal?: AbortSignal, candidateSource?: CandidateReviewSource,
  ): Promise<RequirementAssessment> {
    const active = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])])
    active.throwIfAborted()
    await access.authorize()
    const input = quickReviewInputSchema.parse(raw)
    const source = candidateSource === undefined ? undefined : structuredClone(candidateSource)
    if (input.subject.kind === 'candidate' && (!source || JSON.stringify(source.subject) !== JSON.stringify(input.subject)))
      throw new AssessmentError('invalid-input', 'Candidate review requires its exact trusted owner snapshot')
    if (source && createHash('sha256').update(source.text).digest('hex') !== source.subject.digest)
      throw new AssessmentError('invalid-input', 'Candidate snapshot digest does not match its recorded content')
    if (input.subject.kind !== 'candidate' && source !== undefined)
      throw new AssessmentError('invalid-input', 'Candidate snapshot requires a Candidate subject')
    const identity = input.subject.kind === 'candidate' ? { actor: { kind: access.kind, id: access.actorId }, input } : input
    const digest = createHash('sha256').update(JSON.stringify(identity)).digest('hex')
    const key = JSON.stringify([access.workspaceId, access.actorId, access.kind, input.requestId])
    const existing = this.inflight.get(key)
    if (existing) {
      if (existing.digest !== digest) throw new AssessmentError('idempotency-conflict', 'request id already used')
      const result = await waitForReview(existing.promise, active)
      active.throwIfAborted(); await access.authorize()
      return structuredClone(result)
    }
    const promise = this.perform(access, input, digest, active, source)
    this.inflight.set(key, { digest, promise })
    try { return await promise } finally { this.inflight.delete(key) }
  }
  private async perform(
    access: AssessmentAccess, input: QuickReviewInput, requestDigest: string, signal: AbortSignal, source?: CandidateReviewSource,
  ): Promise<RequirementAssessment> {
    const previous = await this.ctx.requirementAssessment.replay(access, input.requestId, requestDigest, signal)
    if (previous) return previous
    if (input.supersedes) {
      const old = await this.ctx.requirementAssessment.get(access, input.supersedes, signal)
      if (old.subject.kind !== input.subject.kind || old.subject.id !== input.subject.id || (old.subject.kind === 'focus' && input.subject.kind === 'focus' && old.subject.planId !== input.subject.planId)) throw new AssessmentError('invalid-input', 'superseded assessment has another subject')
    }
    const actualInput: AssessmentActualInput = {
      text: input.text ?? '', evidence: (input.evidence ?? []).map(value => ({ ...value, provenance: 'user_statement', verification: 'unverified' })),
      selectedContext: [REVIEW_SYSTEM_PROMPT], omissions: ['Opaque resource references were not fetched. No external research was performed. User statements and evidence are unverified.'],
    }
    const baseline: AssessmentBaseline = {
      assessedAt: new Date().toISOString(), subject: input.subject, dsh: this.config.dshBaseline,
      workspace: access.workspaceId, capabilityRefs: [],
      evaluator: { provider: this.config.provider, model: this.config.model, identity: 'unknown (configured runtime route; backend model identity not attested)', promptVersion: REVIEW_PROMPT_VERSION }, contextVersions: [],
    }
    if (input.subject.kind === 'candidate' && source !== undefined) {
      actualInput.text = source.text
      actualInput.evidence = source.evidence
      actualInput.omissions.push('Candidate owner observation verifies recorded content, not the truth of its claims or opaque references.')
    } else if (input.subject.kind === 'plan' || input.subject.kind === 'focus') {
      const board = await this.ctx.planning.snapshot(access, signal)
      const pack = buildPlanningContext(board, { kind: input.subject.kind, id: input.subject.id })
      if (input.subject.kind === 'focus' && pack.selectedFocus?.planId !== input.subject.planId) throw new AssessmentError('invalid-input', 'focus owner mismatch')
      baseline.planRevision = pack.plan.revision
      actualInput.text = JSON.stringify({ planningOwnerSnapshot: pack, userStatement: input.text ?? null })
      baseline.capabilityRefs = pack.resourceRefs.slice(0, 50).map(link => link.resource)
      if (pack.selectedFocus) {
        baseline.focusVersion = pack.selectedFocus.version
        actualInput.focus = { ...pack.selectedFocus, objective: pack.selectedFocus.objective ?? '' }
        const { id, planId, version, title, objective, status } = actualInput.focus
        actualInput.focus = { id, planId, version, title, objective, status }
      }
    }
    assessmentActualInputSchema.parse(actualInput)
    assessmentBaselineSchema.parse(baseline)
    signal.throwIfAborted(); await access.authorize()
    const reservation = await this.ctx.requirementAssessment.reserve(access, { requestId: input.requestId, requestDigest }, signal)
    if (reservation.status === 'completed') return reservation.assessment
    if (reservation.status === 'pending') throw new AssessmentError('conflict', 'review may already have consumed model tokens; use a new request id for an explicit retry')
    const result = await runReviewModel(this.ctx, this.config, REVIEW_SYSTEM_PROMPT,
      { baseline, actualInput }, signal, () => access.authorize())
    const evaluation = assessmentEvaluationSchema.parse(result.output)
    actualInput.requestPrompt = result.prompt
    baseline.contextVersions.push({ name: 'llm-call-settings', version: JSON.stringify(result.settings) })
    signal.throwIfAborted(); await access.authorize()
    return this.ctx.requirementAssessment.create(access, {
      requestId: input.requestId, requestDigest, subject: input.subject, baseline, actualInput, evaluation,
      rawOutput: result.rawOutput, ...(input.supersedes ? { supersedes: input.supersedes } : {}),
    }, signal)
  }
}
export default RequirementAssessmentReview

/** A duplicate caller may stop waiting without cancelling the original admitted request. */
async function waitForReview(promise: Promise<RequirementAssessment>, signal: AbortSignal): Promise<RequirementAssessment> {
  signal.throwIfAborted()
  let abort: (() => void) | undefined
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => { reject(signal.reason instanceof Error ? signal.reason : new Error('review caller cancelled')) }
    signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([promise, stopped]) }
  finally { if (abort) signal.removeEventListener('abort', abort) }
}
