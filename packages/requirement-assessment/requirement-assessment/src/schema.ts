import { z } from 'zod'
const id = z.string().trim().min(1).max(256)
const text = z.string().min(1).max(8000)
const texts = z.array(text).max(30)
const ref = z.strictObject({ kind: id, id, provider: id.optional(), revision: id.optional(), label: text.optional() })
export const assessmentSubjectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('manual'), id, title: text }),
  z.strictObject({ kind: z.literal('plan'), id }),
  z.strictObject({ kind: z.literal('focus'), id, planId: id }),
])
export const assessmentEvidenceSchema = z.strictObject({
  source: text, provenance: z.enum(['user_statement', 'owner_observation', 'model_inference', 'unknown']),
  verification: z.enum(['verified', 'unverified', 'unknown']), excerpt: text.optional(), immutableRef: ref.optional(),
}).refine(value => value.excerpt !== undefined || value.immutableRef?.revision !== undefined, 'evidence requires an excerpt or immutable revision')
export const assessmentActualInputSchema = z.strictObject({
  text: z.string().min(1).max(100000), evidence: z.array(assessmentEvidenceSchema).max(50),
  selectedContext: texts, omissions: texts, requestPrompt: z.string().min(1).max(200000).optional(),
  focus: z.strictObject({
    id, planId: id, version: z.number().int().positive(), title: text, objective: z.string().max(8000), status: id,
  }).optional(),
})
export const assessmentBaselineSchema = z.strictObject({
  assessedAt: z.iso.datetime(), subject: assessmentSubjectSchema,
  planRevision: id.optional(), focusVersion: z.number().int().positive().optional(),
  dsh: text, workspace: text, capabilityRefs: z.array(ref).max(50),
  evaluator: z.strictObject({ provider: id, model: id, identity: text, promptVersion: id }),
  contextVersions: z.array(z.strictObject({ name: id, version: text })).max(30),
})
export const assessmentDimensionKeys = ['real_utility', 'system_leverage', 'model_durability', 'flywheel', 'composability', 'option_value', 'engineering_burden', 'substitution_risk'] as const
export const assessmentDimensionSchema = z.strictObject({
  dimension: z.enum(assessmentDimensionKeys), level: z.enum(['low', 'medium', 'high', 'unknown']),
  confidence: z.enum(['low', 'medium', 'high']), claim: text, grounds: texts.min(1), counterArguments: texts, unknowns: texts,
})
export const assessmentStressTestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('model_x2'), declines: texts, remains: texts, increases: texts, durableCore: text }),
  z.strictObject({ kind: z.literal('upstream_substitution'), deletable: texts, retained: texts, avoidOverbuilding: text }),
  z.strictObject({ kind: z.literal('no_build'), workaround: text, actualLoss: text, investmentEvidence: text, smallestExperiment: text }),
])
const allocation = z.array(z.strictObject({ component: text, rationale: text })).max(30)
export const assessmentEvaluationSchema = z.strictObject({
  dimensions: z.array(assessmentDimensionSchema).length(8).refine(values => new Set(values.map(value => value.dimension)).size === 8, 'each dimension appears exactly once'),
  stressTests: z.array(assessmentStressTestSchema).length(3).refine(values => new Set(values.map(value => value.kind)).size === 3, 'each stress test appears exactly once'),
  allocation: z.strictObject({ SYSTEM_OWNED: allocation, MODEL_OWNED: allocation, EXPERIMENT: allocation }),
  route: z.enum(['MODEL_ONLY', 'EXPERIMENT', 'BUILD_CORE', 'BUILD', 'DEFER']),
  routeRationale: text,
  uncertainties: z.array(z.strictObject({ question: text, consequence: text, nextEvidence: text })).max(30),
})
export const assessmentCreateSchema = z.strictObject({
  requestId: id, requestDigest: id, subject: assessmentSubjectSchema, baseline: assessmentBaselineSchema,
  actualInput: assessmentActualInputSchema, evaluation: assessmentEvaluationSchema,
  rawOutput: z.string().min(1).max(150000), supersedes: id.optional(),
}).superRefine((value, ctx) => {
  if (JSON.stringify(value.subject) !== JSON.stringify(value.baseline.subject)) ctx.addIssue({ code: 'custom', message: 'baseline subject mismatch' })
  if (value.subject.kind !== 'manual' && !value.baseline.planRevision) ctx.addIssue({ code: 'custom', message: 'planning baseline requires exact revision' })
  if (value.subject.kind === 'focus') {
    const focus = value.actualInput.focus
    if (!focus || focus.id !== value.subject.id || focus.planId !== value.subject.planId || focus.version !== value.baseline.focusVersion)
      ctx.addIssue({ code: 'custom', message: 'focus input and baseline must match' })
  } else if (value.actualInput.focus || value.baseline.focusVersion) ctx.addIssue({ code: 'custom', message: 'non-focus subject cannot carry focus baseline' })
})
export const requirementAssessmentSchema = z.strictObject({
  ...assessmentCreateSchema.shape, id, workspaceId: id, mode: z.literal('quick'), createdAt: z.iso.datetime(),
  createdBy: z.strictObject({ kind: z.enum(['human', 'agent']), id }),
}).superRefine((value, ctx) => {
  const { id: _id, workspaceId: _workspaceId, mode: _mode, createdAt: _createdAt, createdBy: _createdBy, ...input } = value
  const result = assessmentCreateSchema.safeParse(input)
  if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path })
})
