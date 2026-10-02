import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { planningReviewSchema } from '@changanhua/dsh-planning'
import { candidateKindSchema, initiativeCommandSchema, initiativeReceiptSchema } from '@changanhua/dsh-initiative'

const id = z.string().trim().min(1).max(256)
const text = z.string().trim().min(1).max(4000)
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
/** Only Candidate intake operations can be retained for recovery. */
export const reviewCommandSchema = initiativeCommandSchema.refine(command => command.action === 'propose' || command.action === 'investigate')
/** Three bounded outcomes; enrichment preserves existing Candidate facts. */
export const decisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('no-op') }),
  z.strictObject({ kind: z.literal('create'), candidateKind: candidateKindSchema, claim: text }),
  z.strictObject({ kind: z.literal('enrich'), candidateId: id, expectedRecordVersion: z.number().int().positive(),
    expectedCandidateVersion: z.number().int().positive(), observation: z.string().trim().min(1).max(1024) }),
])
/** Read one Review and a bounded page or exact Candidate for comparison. */
export const readSchema = z.strictObject({ reviewId: id, candidateId: id.optional(),
  expectedContextDigest: digest.optional(),
  offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(5).default(1) })
/** Decision admitted against the Planning inputs and complete Candidate comparison snapshot. */
export const decideSchema = z.strictObject({ reviewId: id, expectedContextDigest: digest,
  expectedDecisionVersion: z.number().int().nonnegative(), rationale: text, decision: decisionSchema })
/** Intent precedes Candidate writes; receipt publication follows their durable acknowledgement. */
export const attemptSchema = z.strictObject({
  version: z.number().int().positive(), phase: z.enum(['prepared', 'committed', 'conflict']),
  review: planningReviewSchema, contextDigest: digest, planningDigest: digest, candidateSnapshotDigest: digest,
  actorId: id, sessionId: id,
  rationale: text, decision: decisionSchema, createdAt: z.iso.datetime(),
  command: reviewCommandSchema.optional(),
  result: initiativeReceiptSchema.optional(), error: text.optional(),
}).superRefine((attempt, ctx) => {
  if (attempt.decision.kind === 'no-op'
    ? attempt.phase !== 'committed' || attempt.command !== undefined || attempt.result !== undefined
    : attempt.command === undefined || (attempt.phase === 'committed') !== (attempt.result !== undefined))
    ctx.addIssue({ code: 'custom', message: 'Decision phase and Candidate acknowledgement must agree' })
  if (attempt.command !== undefined && attempt.command.expectedSnapshotDigest !== attempt.candidateSnapshotDigest)
    ctx.addIssue({ code: 'custom', message: 'Prepared Candidate command must retain its exact comparison snapshot' })
})
/** Bounded history, including successful no-op decisions and definite CAS failures. */
export const workspaceSchema = z.strictObject({ reviews: z.record(id, z.array(attemptSchema).min(1).max(16)) })
/** Bridge-owned decisions; Candidate and Planning keep their existing domains. */
export const reviewDomain = defineDomain({ name: 'initiative_review_decisions', version: 2, layout: 'single',
  tables: { workspaces: domainTable(workspaceSchema) } })
