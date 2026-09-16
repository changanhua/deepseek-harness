/** Client-safe durable vocabulary for the Session-backed browser task domain. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { BrowserPage } from '@changanhua/dsh-browser/types'

export type BrowserTaskId = Branded<'BrowserTaskId'>
export interface BrowserTaskRef { readonly id: BrowserTaskId; readonly revision: number }
export type BrowserTaskPhase = 'running' | 'waiting' | 'verifying' | 'settling' | 'terminal'
export type BrowserTaskOutcome = 'completed' | 'refused' | 'cancelled' | 'failed' | 'budget-exhausted'
export type BrowserTaskBlocker = 'approval' | 'human-interaction' | 'unknown-attempt' | 'capability-drift' | 'target-lost' | 'delegated-work' | 'cleanup'
export interface BrowserTargetBinding { readonly installationId: string; readonly page: BrowserPage }

/** A small, typed pointer to a fact already present in the Session log. */
export type BrowserTaskSourceRef =
  | { readonly kind: 'user' | 'message'; readonly sessionSeq: number }
  | { readonly kind: 'tool-call'; readonly callId: string }
  | { readonly kind: 'tool-result'; readonly callId: string; readonly sessionSeq: number }
  | { readonly kind: 'browser-task-receipt'; readonly sessionSeq: number }
  | { readonly kind: 'browser-task-check'; readonly sessionSeq: number }

export type EvidenceState = 'current' | 'stale' | 'superseded'
export interface BrowserTaskEvidence {
  readonly id: string
  readonly state: EvidenceState
  readonly source: BrowserTaskSourceRef
  readonly digest: string
  readonly coverage?: number
  readonly target: BrowserTargetBinding
  readonly grantEpoch: number
}
export type AcceptanceClause =
  | { readonly id: string; readonly kind: 'text-contains'; readonly text: string }
  | { readonly id: string; readonly kind: 'url-equals'; readonly url: string }
  | { readonly id: string; readonly kind: 'control-state'; readonly control: string; readonly state: string }
export interface AcceptanceEvaluation {
  readonly clauseId: string
  readonly satisfied: boolean
  readonly evidenceIds: readonly string[]
  readonly checkerRef: { readonly kind: 'browser-task-check'; readonly sessionSeq: number }
}
export type AttemptStage = 'planned' | 'prepared' | 'dispatched' | 'settled'
export type AttemptOutcome = 'observed' | 'failed' | 'cancelled' | 'unknown'
export interface BrowserActionAttempt {
  readonly attemptId: string
  readonly requestId: string
  readonly actionKind: string
  readonly grantEpoch: number
  readonly stage: AttemptStage
  readonly outcome?: AttemptOutcome
  readonly quiescent?: boolean
  readonly write: boolean
  readonly target: BrowserTargetBinding
  /** Exact page-resource lease for a region or mount action, when applicable. */
  readonly resourceId?: string
  readonly settledBy?: BrowserTaskSourceRef
  readonly reconciledBy?: BrowserTaskSourceRef
}
export type PageResourceState = 'reserved' | 'active' | 'release-pending' | 'released' | 'vanished' | 'unresolved' | 'retained'
export type ResourceDisposition = 'clear-observed' | 'document-replaced' | 'owner-transfer' | 'reconcile-active' | 'reconcile-observed' | 'not-sent'
export interface BrowserPageResource {
  readonly id: string
  readonly state: PageResourceState
  readonly owner?: 'session' | 'user'
  readonly target: BrowserTargetBinding
  readonly disposition?: ResourceDisposition
  readonly dispositionSource?: BrowserTaskSourceRef
}
export type CapabilityState = 'observed' | 'degraded' | 'unavailable'
export interface BrowserCapability {
  readonly installationId: string
  readonly state: CapabilityState
  readonly grantEpoch: number
  readonly scopes: readonly string[]
  readonly actions: readonly string[]
  readonly protocol: string
}
export interface DelegatedWorkRef { readonly id: string; readonly kind: 'job' | 'subagent' | 'cordis'; readonly status: string; readonly expectedOutput: string; readonly evidenceIds: readonly string[]; readonly source: BrowserTaskSourceRef }
export interface BrowserTaskBudget {
  readonly maxSteps: number
  readonly maxActions: number
  readonly stepsUsed: number
  readonly actionsUsed: number
}
export interface BrowserTaskSnapshot extends BrowserTaskRef {
  readonly objective: string
  readonly sourceSeq: number
  readonly phase: BrowserTaskPhase
  readonly outcome?: BrowserTaskOutcome
  readonly blockers: readonly BrowserTaskBlocker[]
  readonly target?: BrowserTargetBinding
  readonly targetLossAcknowledged: boolean
  readonly acceptance: readonly AcceptanceClause[]
  readonly evidence: readonly BrowserTaskEvidence[]
  readonly evaluations: readonly AcceptanceEvaluation[]
  readonly attempts: readonly BrowserActionAttempt[]
  readonly resources: readonly BrowserPageResource[]
  readonly capability?: BrowserCapability
  readonly delegated: readonly DelegatedWorkRef[]
  readonly budget: BrowserTaskBudget
  readonly createdAt: number
  readonly updatedAt: number
}
/** Bounded receipt fact appended before a task change cites an execution outcome. */
export interface BrowserTaskReceipt {
  readonly kind: 'browser-task/receipt'
  readonly version: 1
  readonly taskId: BrowserTaskId
  readonly requestId: string
  readonly actionKind: string
  readonly target: BrowserTargetBinding
  readonly outcome: AttemptOutcome
  readonly delivery: 'sent' | 'not-sent'
  readonly quiescent: boolean
  readonly grantEpoch: number
  /** Exact resource lease affected by this receipt, when the action is resource-scoped. */
  readonly resourceId?: string
  readonly reason?: string
}
export interface BrowserTaskCheck { readonly kind: 'browser-task/check'; readonly version: 1; readonly taskId: BrowserTaskId; readonly checkerId: string; readonly target: BrowserTargetBinding; readonly grantEpoch: number; readonly evaluations: readonly { readonly clauseId: string; readonly satisfied: boolean; readonly evidenceIds: readonly string[] }[] }
/** Host-only replay index. It never crosses the projection wire. */
export interface BrowserTaskSourceFact {
  readonly kind: BrowserTaskSourceRef['kind']
  readonly sessionSeq: number
  readonly callId?: string
  readonly name?: string
  readonly taskId?: BrowserTaskId
  readonly requestId?: string
  readonly actionKind?: string
  readonly target?: BrowserTargetBinding
  readonly outcome?: AttemptOutcome
  readonly delivery?: 'sent' | 'not-sent'
  readonly quiescent?: boolean
  readonly grantEpoch?: number
  readonly resourceId?: string
  readonly reason?: string
  readonly checkerId?: string
  readonly evaluations?: readonly {
    readonly clauseId: string
    readonly satisfied: boolean
    readonly evidenceIds: readonly string[]
  }[]
}
export interface BrowserTaskProjectionState {
  readonly current: BrowserTaskSnapshot | null
  readonly recentTaskIds: readonly BrowserTaskId[]
  readonly lastSourceSeq: number
  readonly lastTaskSourceSeq: number
  readonly sourceFacts: readonly BrowserTaskSourceFact[]
  readonly failure: string | null
}
export interface CreateBrowserTaskRequest {
  readonly objective: string
  readonly sourceSeq: number
  readonly acceptance: readonly AcceptanceClause[]
  readonly target?: BrowserTargetBinding
  readonly maxSteps?: number
  readonly maxActions?: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { browserTask: BrowserTaskProjectionState }
  interface SessionProjectionMap { browserTask: BrowserTaskSnapshot | null }
}
