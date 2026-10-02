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
  /**
   * Reserve a model invocation durably; unresolved reservations forbid automatic repeated billing.
   * @param access - Trusted Workspace and actor capability, rechecked before publication.
   * @param request - Request id and digest binding the exact evaluator input.
   * @param signal - Caller cancellation, checked before publication.
   * @returns Acquired, pending, or completed reservation with its immutable original result.
   */
  abstract reserve(access: AssessmentAccess, request: AssessmentRequestIdentity, signal?: AbortSignal): Promise<AssessmentReservation>
  /**
   * Persist one complete review atomically; identical request identities return their immutable original.
   * @param access - Trusted Workspace and actor capability.
   * @param input - Schema-valid immutable review and request identity.
   * @param signal - Caller cancellation, checked before publication.
   * @returns The committed Assessment; conflicting request digests reject.
   */
  abstract create(access: AssessmentAccess, input: AssessmentCreateInput, signal?: AbortSignal): Promise<RequirementAssessment>
  /**
   * Read detached bounded Workspace history, rechecking the trusted caller's current authority.
   * @param access - Trusted Workspace and actor capability.
   * @param signal - Caller cancellation.
   * @returns The authorized Workspace's immutable Assessment history.
   */
  abstract snapshot(access: AssessmentAccess, signal?: AbortSignal): Promise<AssessmentSnapshot>
  /**
   * Read one immutable result inside the authorized Workspace; foreign ids are never resolved.
   * @param access - Trusted Workspace and actor capability.
   * @param id - Assessment identity within this Workspace.
   * @param signal - Caller cancellation.
   * @returns The detached Assessment; missing or foreign ids reject as not-found.
   */
  abstract get(access: AssessmentAccess, id: string, signal?: AbortSignal): Promise<RequirementAssessment>
  /**
   * Recover a committed request before calling the evaluator; conflicting request digests reject.
   * @param access - Trusted Workspace and actor capability.
   * @param requestId - Durable request identity.
   * @param requestDigest - Exact evaluator input digest.
   * @param signal - Caller cancellation.
   * @returns The immutable original when committed, otherwise undefined.
   */
  abstract replay(
    access: AssessmentAccess, requestId: string, requestDigest: string, signal?: AbortSignal,
  ): Promise<RequirementAssessment | undefined>
}
export default RequirementAssessmentService
