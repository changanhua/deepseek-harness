import type { RequirementAssessment } from '@changanhua/dsh-requirement-assessment'
import type { QuickReviewInput } from '@changanhua/dsh-requirement-assessment-review'
/** Relationship between frozen input and the currently readable owner state. */
export type AssessmentDrift = 'fresh' | 'stale' | 'unknown' | 'unavailable'
/** Immutable assessment with a read-time freshness projection. */
export interface AssessmentView { assessment: RequirementAssessment; drift: AssessmentDrift }
/** Selected registered workspace; never a filesystem path. */
export interface AssessmentListInput { workspaceId: string }
/** Assessment identity scoped to the selected workspace. */
export interface AssessmentGetInput extends AssessmentListInput { id: string }
/** Explicit user review request plus the selected workspace. */
export type AssessmentReviewInput = QuickReviewInput & AssessmentListInput
