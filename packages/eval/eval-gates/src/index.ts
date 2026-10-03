import { Context, Service } from '@deepseek-ai/cordis'
import type { EvalGateDecision } from '@changanhua/dsh-eval'
import type { EvalRunAccess } from '@changanhua/dsh-eval-runs'

export * from './types.ts'

/** Safe Gate conclusion; it carries no right to spend, continue a Goal, or activate an Agent. */
export interface EvalGateView { readonly id: string
  readonly runId: string
  readonly policyId: string
  readonly snapshotRevision: string
  readonly decision: EvalGateDecision
  /** Historical decisions remain readable; only current evidence can authorize a continuation. */
  readonly validity: 'current' | 'stale'
  readonly createdAt: number }

/** Stable, path-free failure classifications for decision Consumers. */
export class EvalGateError extends Error {
  constructor(readonly code: 'unavailable' | 'unauthorized' | 'not-found' | 'conflict' | 'blocked', options?: ErrorOptions) {
    super(`eval-gate:${code}`, options); this.name = 'EvalGateError'
  }
}

declare module '@deepseek-ai/cordis' { interface Context { evalGates: EvalGates } }

/** Gate producer contract for CLI and later Activation Consumers. */
export abstract class EvalGates extends Service {
  constructor(ctx: Context) { super(ctx, 'evalGates') }
  /**
   * Re-read original Host facts, evaluate one frozen policy idempotently, and retain the conclusion.
   * @param access Current Workspace and principal authorization.
   * @param runId Existing admitted run whose original evidence is available to the Host.
   * @param policyId Host-approved fixed verifier policy.
   * @param signal Cancellation of verification; no partial pass is retained.
   * @returns Retained decision and independently refreshed evidence validity.
   */
  abstract evaluate(access: EvalRunAccess, runId: string, policyId: string, signal?: AbortSignal): Promise<EvalGateView>
  /**
   * Read one previously retained conclusion without re-running the verifier.
   * @param access Current Workspace read authorization.
   * @param id Exact retained decision identity.
   * @returns Historical decision with current or stale validity; neither implies permission to act.
   */
  abstract get(access: EvalRunAccess, id: string): Promise<EvalGateView>
}

export default EvalGates
