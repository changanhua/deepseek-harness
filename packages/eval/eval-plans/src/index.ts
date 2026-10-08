import { Context, Service } from '@deepseek-ai/cordis'
import type { EvalPlanAccess, EvalPlanAdmission, EvalPlanSelection, EvalPlanSummary, ResolvedEvalPlan, RecoveredEvalPlan } from './types.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { evalPlans: EvalPlans } }

/** Stable source, authorization, freshness and persistence failures. */
export class EvalPlanError extends Error {
  constructor(readonly code: 'unavailable' | 'unauthorized' | 'not-found' | 'invalid-source' | 'preflight-blocked' | 'conflict' | 'capacity', message: string) {
    super(message); this.name = 'EvalPlanError'
  }
}

/** Trusted project Plan source. This owner does not execute, grade, enqueue or attest model outcomes. */
export abstract class EvalPlans extends Service {
  constructor(ctx: Context) { super(ctx, 'evalPlans') }
  /**
   * Read safe source summaries under the caller's exact live Workspace authority.
   * @param access - Exact live Workspace and trusted entrypoint authorization.
   * @param signal - Optional caller cancellation.
   * @returns Safe Plan summaries without Host paths or credential material.
   */
  abstract discover(access: EvalPlanAccess, signal?: AbortSignal): Promise<readonly EvalPlanSummary[]>
  /**
   * Resolve approved immutable source and fresh runtime preflight. The returned object is Host-only.
   * @param access - Exact live Workspace and trusted entrypoint authorization.
   * @param selection - Only the configured Plan id and version.
   * @param signal - Optional caller cancellation.
   * @returns Owner-minted resolution with current readiness evidence.
   */
  abstract resolve(access: EvalPlanAccess, selection: EvalPlanSelection, signal?: AbortSignal): Promise<ResolvedEvalPlan>
  /**
   * Revalidate one Provider-minted resolution and durably mint/recover the same run identity.
   * @param access - Current Workspace authority, rechecked before persistence.
   * @param resolved - Exact resolution object issued by this Provider.
   * @param requestId - Stable admission identity; changed resolution reuse rejects.
   * @param signal - Optional caller cancellation.
   * @returns Durable admission receipt; replay recovers the original run identity.
   */
  abstract admit(access: EvalPlanAccess, resolved: ResolvedEvalPlan, requestId: string, signal?: AbortSignal): Promise<EvalPlanAdmission>
  /**
   * Recover original admitted facts without requiring current Provider availability or remaining Budget.
   * @param access - Current read authority for the exact live Workspace and an originally allowed entrypoint.
   * @param requestId - Original admission request identity in that Workspace.
   * @param signal - Read cancellation; this operation performs no execution or new admission.
   * @returns Frozen historical snapshot, or null when this Workspace has no matching admission.
   */
  abstract recover(access: EvalPlanAccess, requestId: string, signal?: AbortSignal): Promise<RecoveredEvalPlan | null>
  /**
   * Atomically publish a complete configured source generation, or retain the prior generation on error.
   * @param authorize - Host reload authority, rechecked before publication.
   * @param signal - Optional caller cancellation.
   */
  abstract reload(authorize: () => void | Promise<void>, signal?: AbortSignal): Promise<void>
}
export default EvalPlans
