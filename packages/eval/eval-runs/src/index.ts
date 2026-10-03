import { Context, Service } from '@deepseek-ai/cordis'
import type { EvalPlanAccess, EvalPlanSelection } from '@changanhua/dsh-eval-plans'

/** The Host binds a current principal; neither a browser nor an Agent can supply this capability as JSON. */
export interface EvalRunAccess extends EvalPlanAccess { readonly actorId: string }
/** User-selectable intent; filesystem paths, credentials and execution policy bodies remain Host-owned. */
export interface StartEvalRun { readonly requestId: string
  readonly plan: EvalPlanSelection
  readonly policyId: string }
/** Path-free durable run view. Queue remains the authority for all Work/Attempt lifecycle facts. */
export interface EvalRunView {
  readonly id: string | null
  readonly requestId: string
  readonly plan: { readonly id: string
    readonly version: string
    readonly digest: string }
  readonly revision: string
  readonly phase: 'submitting' | 'queued' | 'running' | 'settled' | 'canceled' | 'needs-attention'
  readonly outcome: 'passed' | 'failed' | 'invalid' | null
  readonly cells: readonly EvalCellView[]
  readonly controls: readonly { readonly operationId: string
    readonly actorId: string
    readonly action: string
    readonly phase: 'pending' | 'applied' | 'needs-attention'
    readonly reason: string | null }[]
}
/** A safe cell projection with historical Attempt identities and evidence availability. */
export interface EvalCellView {
  readonly id: string
  readonly caseId: string
  readonly routeId: string
  readonly repeatIndex: number
  readonly workId: string | null
  readonly status: string
  readonly attempts: readonly { readonly id: string
    readonly ordinal: number
    readonly status: string }[]
  readonly evidence: 'none' | 'intact' | 'missing' | 'expired' | 'corrupt'
  readonly outcome: 'passed' | 'failed' | 'invalid' | null
  readonly reason: string | null
}
/** Content identity without private source locations or material bodies. */
export interface EvalEvidenceIdentity { readonly id: string
  readonly digest: string }
/** Host-observed model usage; missing accounting is explicitly unknown. */
export interface EvalModelCall {
  readonly requestId: string
  readonly attemptId: string
  readonly provider: string
  readonly model: string
  readonly dispatched: boolean
  readonly phase: 'reserved' | 'dispatched' | 'settled' | 'released' | 'unknown' | 'denied'
  readonly usage: { readonly inputTokens: number
    readonly outputTokens: number } | null
}
/** Safe navigation into one retained Attempt; roles are absent when material cannot be verified. */
export interface EvalEvidenceView {
  readonly runId: string
  readonly cellId: string
  readonly attemptId: string
  readonly availability: EvalCellView['evidence']
  readonly bundle: EvalEvidenceIdentity | null
  readonly receivedAt: number | null
  readonly expiresAt: number | null
  readonly materials: readonly { readonly reference: EvalEvidenceIdentity
    readonly kind: string
    readonly role: 'subject' | 'grader'
    readonly executionId: string
    readonly bytes: number }[]
  readonly roles: readonly { readonly role: 'subject' | 'grader'
    readonly executionId: string
    readonly sessionId: string
    readonly verifiedCommit: string
    readonly buildDigest: string
    readonly profile: EvalEvidenceIdentity
    readonly elapsedMs: number
    readonly preset: EvalEvidenceIdentity | null
    readonly tools: readonly EvalEvidenceIdentity[]
    readonly skills: readonly EvalEvidenceIdentity[]
    readonly calls: readonly EvalModelCall[] }[]
}
/** Durable control intent, fenced by the last safe view and one stable operation identity. */
export type EvalRunControl = {
  readonly runId: string
  readonly operationId: string
  readonly expectedRevision: string
} & ({ readonly action: 'cancel' } | { readonly action: 'retry'
  readonly cellId: string }
  | { readonly action: 'resolve-unknown'
    readonly cellId: string
    readonly resolution: 'confirm-failed' | 'authorize-retry'
    readonly evidence: string })

/** Stable, path-free failure classification for all Eval run Consumers. */
export class EvalRunError extends Error {
  constructor(readonly code: 'unavailable' | 'unauthorized' | 'not-found' | 'conflict' | 'capacity' | 'blocked' | 'invalid-evidence', options?: ErrorOptions) {
    super(`eval-run:${code}`, options); this.name = 'EvalRunError'
  }
}
declare module '@deepseek-ai/cordis' { interface Context { evalRuns: EvalRuns } }

/** Shared run-control and report contract for CLI and future Web Consumers. */
export abstract class EvalRuns extends Service {
  constructor(ctx: Context) { super(ctx, 'evalRuns') }
  /**
   * Admit or reconcile one exact request through the Plan owner and Queue.
   * @param access Current Workspace and principal authority.
   * @param input Stable request, approved Plan selection and Host policy id.
   * @param signal Caller cancellation; committed intent remains recoverable.
   * @returns Safe current view; repeated intent resolves the original run.
   */
  abstract start(access: EvalRunAccess, input: StartEvalRun, signal?: AbortSignal): Promise<EvalRunView>
  /**
   * Read one run without dispatching work or requiring unspent model budget.
   * @param access Current read authority.
   * @param runId Exact admitted run identity.
   * @returns Current Queue-derived status and checked evidence availability.
   */
  abstract get(access: EvalRunAccess, runId: string): Promise<EvalRunView>
  /**
   * List bounded run projections for one authorized Workspace.
   * @param access Current Workspace read authority.
   * @returns Views without private evidence bodies, raw Queue payloads or Host paths.
   */
  abstract list(access: EvalRunAccess): Promise<readonly EvalRunView[]>
  /**
   * Verify and inspect one historical Attempt without executing or exposing private material.
   * @param access Current Workspace read authority.
   * @param runId Exact admitted run identity.
   * @param cellId Exact cell identity from the run view.
   * @param attemptId Real Queue Attempt identity from that cell.
   * @returns Evidence availability, material identities and allowlisted role/accounting facts.
   */
  abstract evidence(access: EvalRunAccess, runId: string, cellId: string, attemptId: string): Promise<EvalEvidenceView>
  /**
   * Persist an operator action and conditionally apply it to the observed Queue state.
   * @param access Current operator identity and authority.
   * @param input Exact operation and expected safe-view revision.
   * @returns Reconciled view; uncertainty is retained instead of replaying against a later Attempt.
   */
  abstract control(access: EvalRunAccess, input: EvalRunControl): Promise<EvalRunView>
}
export default EvalRuns
