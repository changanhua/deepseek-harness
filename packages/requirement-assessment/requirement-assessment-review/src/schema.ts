import { z } from 'zod'
import { assessmentSubjectSchema } from '@changanhua/dsh-requirement-assessment'
/** Browser/model input has no trusted identity, baseline, route, or provenance fields. */
export const quickReviewInputSchema = z.strictObject({
  requestId: z.string().trim().min(1).max(256), subject: assessmentSubjectSchema,
  text: z.string().min(1).max(50000).optional(),
  evidence: z.array(z.strictObject({ source: z.string().min(1).max(8000), excerpt: z.string().min(1).max(8000) })).max(30).optional(),
  supersedes: z.string().trim().min(1).max(256).optional(),
}).refine(value => value.subject.kind !== 'manual' || value.text !== undefined, 'manual review requires text')
