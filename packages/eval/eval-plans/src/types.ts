import type { EvalPlan, EvalSuite, ResolvedExecutionManifest } from '@changanhua/dsh-eval'
import type { Workspace } from '@deepseek-ai/dsh-workspace'

/** Host entrypoint authority; wire callers cannot supply the live Workspace or authorize callback. */
export interface EvalPlanAccess {
  readonly workspace: Workspace
  readonly entrypoint: 'web' | 'cli' | 'ci'
  readonly authorize: () => void | Promise<void>
}

/** The only Plan selection accepted from a browser, model or command argument. */
export interface EvalPlanSelection { readonly id: string; readonly version: string }

/** Path-free approved source identity shared by every Consumer. */
export interface EvalPlanSummary extends EvalPlanSelection {
  readonly mode: 'keyless' | 'live'
  readonly digest: string
  readonly suiteId: string
  readonly cellCount: number
  readonly routeIds: readonly string[]
}

/** A stable non-secret check result, with no credential values or filesystem diagnostics. */
export interface EvalPreflightCheck {
  readonly subject: string
  readonly code: string
  readonly ok: boolean
}

/** Host-only source/preflight observation; not an execution Manifest or a GateDecision. */
export interface ResolvedEvalPlan {
  readonly mode: 'keyless' | 'live'
  readonly plan: EvalPlan
  readonly suite: EvalSuite
  readonly summary: EvalPlanSummary
  /** Host-approved capability expectations, frozen and bound into resolvedDigest; checks report their current verification. */
  readonly resolvedRequirements: {
    readonly tools: readonly Readonly<ResolvedExecutionManifest['subject']['tools'][number]>[]
    readonly skills: readonly Readonly<ResolvedExecutionManifest['subject']['skills'][number]>[]
  }
  readonly checks: readonly EvalPreflightCheck[]
  readonly ready: boolean
  readonly resolvedDigest: string
}

/** A durable admitted identity. No Queue work or model execution is started by admission. */
export interface EvalPlanAdmission {
  readonly requestId: string
  readonly runId: string
  readonly workspaceId: string
  readonly planId: string
  readonly planVersion: string
  readonly planDigest: string
  readonly resolvedDigest: string
  readonly admittedAt: number
}
