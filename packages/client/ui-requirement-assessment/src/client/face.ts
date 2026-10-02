import type { AssessmentReviewInput as ReviewInput, AssessmentView } from '@changanhua/dsh-requirement-assessment-remote/types'
export type { AssessmentReviewInput as ReviewInput, AssessmentView } from '@changanhua/dsh-requirement-assessment-remote/types'
export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
export interface RirRemote {
  list(input: { workspaceId: string }, signal?: AbortSignal): Promise<Result<AssessmentView[]>>
  get(input: { workspaceId: string; id: string }, signal?: AbortSignal): Promise<Result<AssessmentView>>
  review(input: ReviewInput, signal?: AbortSignal): Promise<Result<AssessmentView>>
}
export interface WorkspaceReader {
  workspaces(signal?: AbortSignal): Promise<Result<{ id: string; title: string }[]>>
}
