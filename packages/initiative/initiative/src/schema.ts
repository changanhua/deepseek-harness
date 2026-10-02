import { z } from 'zod'
import { CandidateId } from './brand.ts'
import { assessmentBaselineSchema } from '@changanhua/dsh-requirement-assessment'

const id = z.string().trim().min(1).max(256)
const candidateId = id.transform(CandidateId)
const text = z.string().trim().min(1).max(4000)
const version = z.number().int().positive()
const timestamp = z.iso.datetime()
/** Candidate-owned opaque locator; text and hashes supplied by callers are never proof. */
export const initiativeRefSchema = z.strictObject({
  owner: id, kind: id, id, revision: id.optional(), digest: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  verification: z.enum(['unverified', 'unknown', 'unavailable']), excerpt: z.string().max(1024).optional(),
})
/** Cheap hypothesis categories, including no-build alternatives. */
export const candidateKindSchema = z.enum(['problem', 'opportunity', 'improvement', 'experiment', 'simplify', 'remove'])
/** Candidate state never represents execution permission. */
export const candidateStatusSchema = z.enum(['PROPOSED', 'INVESTIGATING', 'ASSESSABLE', 'DEFERRED', 'DROPPED', 'PROMOTED'])
/** Facts supplied to a new immutable revision. */
export const candidateFactsSchema = z.strictObject({
  claim: text, assumptions: z.array(text).max(30).default([]), uncertainties: z.array(text).max(30).default([]),
  evidenceRefs: z.array(initiativeRefSchema).max(30).default([]),
  counterEvidenceRefs: z.array(initiativeRefSchema).max(30).default([]), suggestedNextStep: text.optional(),
})
/** Host-derived identity and exact initiating Session event, not a claimed model identity. */
export const candidateActorSchema = z.strictObject({
  kind: z.enum(['human', 'agent']), id, sessionId: id, eventSeq: z.number().int().nonnegative(),
  commandId: id.optional(),
})
/** Append-only investigation facts; recommendations cannot settle a Candidate. */
export const investigationSchema = z.strictObject({
  baseVersion: version, resultVersion: version, actor: candidateActorSchema, at: timestamp,
  completion: z.enum(['ongoing', 'complete', 'blocked']), blockedReason: text.optional(),
  recommendation: z.enum(['continue', 'assess', 'defer', 'drop', 'simplify', 'remove']).optional(),
})
const mutation = { key: id }
const target = { id: candidateId, expectedRecordVersion: version, expectedVersion: version }
/** Strict commands shared by Human and Agent entry points; authority is absent from the JSON. */
export const initiativeCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('propose'), ...mutation, kind: candidateKindSchema, trigger: text,
    facts: candidateFactsSchema, sourceRefs: z.array(initiativeRefSchema).max(30).default([]),
    parents: z.array(candidateId).max(20).default([]) }),
  z.strictObject({ action: z.literal('investigate'), ...mutation, ...target, facts: candidateFactsSchema,
    completion: investigationSchema.shape.completion, blockedReason: text.optional(),
    recommendation: investigationSchema.shape.recommendation }),
  z.strictObject({ action: z.literal('disposition'), ...mutation, ...target,
    status: z.enum(['DEFERRED', 'DROPPED', 'INVESTIGATING']), rationale: text }),
  z.strictObject({ action: z.literal('assess'), ...mutation, id: candidateId, version }),
  z.strictObject({ action: z.literal('promote'), ...mutation, ...target, rationale: text, assessmentId: id.optional() }),
])
/** Bounded query; an exact revision stays readable after later refinements. */
export const initiativeQuerySchema = z.strictObject({
  action: z.literal('read'), id: candidateId.optional(), version: version.optional(), status: candidateStatusSchema.optional(),
  proposer: z.enum(['human', 'agent']).optional(), offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(50).default(20),
})
/** Exact durable receipt returned before CAS checks on an authorized replay. */
export const initiativeReceiptSchema = z.strictObject({
  id: candidateId, recordVersion: version, headVersion: version, status: candidateStatusSchema,
  proposalId: id.optional(), assessmentId: id.optional(),
})
/** Candidate-owned immutable history and optional non-canonical Planning relation. */
export const candidateSchema = z.strictObject({
  id: candidateId, workspaceId: id, kind: candidateKindSchema, trigger: text, proposer: candidateActorSchema,
  origin: z.array(initiativeRefSchema).max(31), parents: z.array(candidateId).max(20), createdAt: timestamp,
  recordVersion: version, headVersion: version, status: candidateStatusSchema,
  revisions: z.array(z.strictObject({
    version, facts: candidateFactsSchema, createdBy: candidateActorSchema, createdAt: timestamp,
  })).min(1),
  investigations: z.array(investigationSchema),
  dispositions: z.array(z.strictObject({ status: candidateStatusSchema, rationale: text, actor: candidateActorSchema, at: timestamp })),
  promotion: z.strictObject({
    phase: z.enum(['prepared', 'linked']), key: id, digest: id, candidateVersion: version, rationale: text,
    actor: candidateActorSchema, proposalId: id, requestId: id, expectedBoardVersion: z.number().int().nonnegative(),
    preparedAt: timestamp, linkedAt: timestamp.optional(),
    assessment: z.strictObject({ id, baseline: assessmentBaselineSchema }).optional(),
  }).optional(),
}).superRefine((value, ctx) => {
  if (value.headVersion !== value.revisions.length || value.revisions.some((revision, index) => revision.version !== index + 1))
    ctx.addIssue({ code: 'custom', message: 'Candidate revisions must form a complete immutable sequence' })
  if (value.recordVersion < value.headVersion)
    ctx.addIssue({ code: 'custom', message: 'Candidate record version cannot precede its revision' })
  if (value.investigations.some(fact => fact.resultVersion !== fact.baseVersion + 1 || fact.resultVersion > value.headVersion))
    ctx.addIssue({ code: 'custom', message: 'Investigation must identify its exact revision transition' })
  if ((value.status === 'PROMOTED') !== (value.promotion?.phase === 'linked'))
    ctx.addIssue({ code: 'custom', message: 'Promoted Candidate requires its durable linked Proposal' })
  if (value.promotion !== undefined && (value.promotion.candidateVersion !== value.headVersion
    || (value.promotion.phase === 'prepared' && value.status !== 'ASSESSABLE')
    || (value.promotion.phase === 'linked') !== (value.promotion.linkedAt !== undefined)))
    ctx.addIssue({ code: 'custom', message: 'Promotion must retain its exact Candidate baseline and settlement' })
  const assessment = value.promotion?.assessment
  if (assessment !== undefined && (assessment.baseline.subject.kind !== 'candidate'
    || assessment.baseline.subject.id !== value.id || assessment.baseline.workspace !== value.workspaceId
    || assessment.baseline.subject.revision > value.headVersion))
    ctx.addIssue({ code: 'custom', message: 'Selected Assessment must retain this Candidate and Workspace baseline' })
})
