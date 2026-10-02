import { Context, Service } from '@deepseek-ai/cordis'
import type { AssessmentAccess, AssessmentRequestIdentity, AssessmentReservation, AssessmentCreateInput, AssessmentSnapshot, RequirementAssessment } from './types.ts'
export * from './schema.ts'
export * from './types.ts'
export class AssessmentError extends Error {
  constructor(readonly code: 'invalid-input' | 'not-found' | 'conflict' | 'idempotency-conflict' | 'capacity-exceeded' | 'closed', message: string) { super(message); this.name = 'AssessmentError' }
}
declare module '@deepseek-ai/cordis' { interface Context { requirementAssessment: RequirementAssessmentService } }
/** Assessment owner; no Planning mutations or execution authority are part of this service. */
export abstract class RequirementAssessmentService extends Service {
  constructor(ctx: Context) { super(ctx, 'requirementAssessment') }
  /** Reserve a model invocation durably; an unresolved reservation forbids automatic repeated billing. */
  abstract reserve(access: AssessmentAccess, request: AssessmentRequestIdentity, signal?: AbortSignal): Promise<AssessmentReservation>
  /** Persist one complete review atomically; identical request identities return their immutable original. */
  abstract create(access: AssessmentAccess, input: AssessmentCreateInput, signal?: AbortSignal): Promise<RequirementAssessment>
  /** Read a detached bounded Workspace history, rechecking the trusted caller's current authority. */
  abstract snapshot(access: AssessmentAccess, signal?: AbortSignal): Promise<AssessmentSnapshot>
  /** Read one immutable result inside the authorized Workspace; foreign ids are never resolved. */
  abstract get(access: AssessmentAccess, id: string, signal?: AbortSignal): Promise<RequirementAssessment>
  /** Recover a committed request before calling the evaluator; conflicting request digests reject. */
  abstract replay(
    access: AssessmentAccess, requestId: string, requestDigest: string, signal?: AbortSignal,
  ): Promise<RequirementAssessment | undefined>
}
export default RequirementAssessmentService
