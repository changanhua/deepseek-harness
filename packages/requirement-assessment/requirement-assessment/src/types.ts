import type { z } from 'zod'
import type { assessmentSubjectSchema, assessmentBaselineSchema, assessmentActualInputSchema, assessmentEvaluationSchema, assessmentCreateSchema, requirementAssessmentSchema, assessmentEvidenceSchema } from './schema.ts'
export type AssessmentSubject = z.infer<typeof assessmentSubjectSchema>
export type AssessmentBaseline = z.infer<typeof assessmentBaselineSchema>
export type AssessmentActualInput = z.infer<typeof assessmentActualInputSchema>
export type AssessmentEvaluation = z.infer<typeof assessmentEvaluationSchema>
export type AssessmentEvidence = z.infer<typeof assessmentEvidenceSchema>
export type AssessmentCreateInput = z.infer<typeof assessmentCreateSchema>
export type RequirementAssessment = z.infer<typeof requirementAssessmentSchema>
/** Trusted Host capability; never accept this object from a model or browser payload. */
export interface AssessmentAccess {
  readonly workspaceId: string
  readonly actorId: string
  readonly kind: 'human' | 'agent'
  authorize(): void | Promise<void>
}
export interface AssessmentSnapshot { workspaceId: string; assessments: RequirementAssessment[] }

export interface AssessmentRequestIdentity { requestId: string; requestDigest: string }
export type AssessmentReservation = { status: 'acquired' | 'pending' } | { status: 'completed'; assessment: RequirementAssessment }
