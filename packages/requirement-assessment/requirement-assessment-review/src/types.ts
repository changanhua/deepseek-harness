import type { z } from 'zod'
import type { quickReviewInputSchema } from './schema.ts'
import type { AssessmentSubject, AssessmentEvidence } from '@changanhua/dsh-requirement-assessment'
/** Strict review request; identity and provenance come from the trusted Host. */
export type QuickReviewInput = z.infer<typeof quickReviewInputSchema>
/** Owner-captured exact Candidate content, supplied only by a trusted Host adapter. */
export interface CandidateReviewSource {
  subject: Extract<AssessmentSubject, { kind: 'candidate' }>
  text: string
  evidence: AssessmentEvidence[]
}
