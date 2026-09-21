/** Client-safe durable vocabulary for the Session-backed browser task domain. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { BrowserPage, BrowserRecoveryLocator } from '@changanhua/dsh-browser/types'

export type BrowserTaskId = Branded<'BrowserTaskId'>
export interface BrowserTaskRef { readonly id: BrowserTaskId; readonly revision: number }
export type BrowserTaskPhase = 'running' | 'waiting' | 'verifying' | 'settling' | 'terminal'
export type BrowserTaskOutcome = 'completed' | 'refused' | 'cancelled' | 'failed' | 'budget-exhausted'
export type BrowserTaskBlocker = 'approval' | 'human-interaction' | 'unknown-attempt' | 'capability-drift' | 'target-lost' | 'delegated-work' | 'cleanup' | 'repeated-error' | 'internal-invariant'
export interface BrowserTargetBinding { readonly installationId: string; readonly page: BrowserPage }
export interface BrowserFunctionOwner {
  readonly kind: 'browser-installation'
  readonly installationId: string
  readonly grantEpoch: number
  readonly pluginId: string
  readonly packageId: string
  readonly pluginRunId: string
  readonly handoffId: string
}
export type BrowserFunctionScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'page'; readonly target: BrowserTargetBinding; readonly targetRevision: number }
/** Session-owned stable tab chosen through an authenticated user surface. */
export interface BrowserSessionTargetBinding extends BrowserTargetBinding {
  /** Bind-time page evidence; only its tabId is the lasting selection identity. */
  readonly page: BrowserPage
  readonly revision: number
  readonly boundAt: number
  readonly boundBy: 'user'
}
export interface BrowserSessionTargetState {
  readonly revision: number
  readonly binding: BrowserSessionTargetBinding | null
}

/** A small, typed pointer to a fact already present in the Session log. */
export type BrowserTaskSourceRef =
  | { readonly kind: 'user' | 'message'; readonly sessionSeq: number }
  | { readonly kind: 'tool-call'; readonly callId: string }
  | { readonly kind: 'tool-result'; readonly callId: string; readonly sessionSeq: number }
  | { readonly kind: 'browser-task-receipt'; readonly sessionSeq: number }
  | { readonly kind: 'browser-task-check'; readonly sessionSeq: number }
  | { readonly kind: 'browser-task-delegation'; readonly sessionSeq: number }
  | { readonly kind: 'browser-task-function-handoff'; readonly sessionSeq: number }

export type EvidenceState = 'current' | 'stale' | 'superseded'
export interface BrowserPageMapEvidence {
  readonly regions: readonly {
    /** Opaque map generation reference; never a page selector. */
    readonly regionRef: string
    readonly disposable: boolean
    readonly protected: boolean
  }[]
}
export interface BrowserTaskEvidence {
  readonly id: string
  readonly state: EvidenceState
  readonly source: BrowserTaskSourceRef
  readonly digest: string
  readonly coverage?: number
  /** Bounded page facts used only to decide whether a failed semantic target materially changed. */
  readonly pageMap?: BrowserPageMapEvidence
  readonly target: BrowserTargetBinding
  readonly grantEpoch: number
}
export type AcceptanceClause =
  | { readonly id: string; readonly kind: 'text-contains'; readonly text: string }
  | { readonly id: string; readonly kind: 'url-equals'; readonly url: string }
  | { readonly id: string; readonly kind: 'control-state'; readonly control: string; readonly state: string }
  | { readonly id: string; readonly kind: 'region-content'; readonly resourceId: string; readonly text: string }
export interface AcceptanceEvaluation {
  readonly clauseId: string
  readonly satisfied: boolean
  readonly evidenceIds: readonly string[]
  readonly checkerRef: { readonly kind: 'browser-task-check'; readonly sessionSeq: number }
}
export type AttemptStage = 'planned' | 'prepared' | 'dispatch-intent' | 'dispatched' | 'settled'
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
  /** Bounded render intent retained before dispatch so a recovered receipt can prove presentation. */
  readonly presentationIntent?: { readonly contentDigest: string; readonly excerpt: string }
  /** Public extension-journal key written atomically with dispatch intent. */
  readonly recoveryLocator?: BrowserRecoveryLocator
  readonly settledBy?: BrowserTaskSourceRef
  readonly reconciledBy?: BrowserTaskSourceRef
}
export type PageResourceState = 'reserved' | 'active' | 'release-pending' | 'released' | 'vanished' | 'unresolved' | 'retained'
export type ResourceDisposition = 'clear-observed' | 'document-replaced' | 'absent' | 'owner-transfer' | 'reconcile-active' | 'reconcile-observed' | 'not-sent'
export interface BrowserPagePresentation {
  readonly contentDigest: string
  readonly excerpt: string
  readonly renderReceipt: Extract<BrowserTaskSourceRef, { kind: 'browser-task-receipt' }>
  readonly evidenceId?: string
}
export interface BrowserPageResource {
  readonly id: string
  readonly state: PageResourceState
  readonly owner?: BrowserFunctionOwner
  readonly target: BrowserTargetBinding
  readonly disposition?: ResourceDisposition
  readonly dispositionSource?: BrowserTaskSourceRef
  readonly presentation?: BrowserPagePresentation
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
export type DelegatedWorkIdentity =
  | { readonly mode: 'foreground'; readonly runId: string }
  | { readonly mode: 'background'; readonly jobId: string }
  | { readonly mode: 'continuable'; readonly subagentId: string }
  | { readonly mode: 'cordis'; readonly pluginId: string; readonly packageId: string; readonly pluginRunId: string }
  | { readonly mode: 'tool-call' }
export interface DelegatedWorkRef {
  readonly callId: string
  readonly kind: 'job' | 'subagent' | 'cordis'
  readonly status: string
  readonly identity: DelegatedWorkIdentity
  readonly outputDigest?: string
  readonly evidenceIds: readonly string[]
  readonly source: BrowserTaskSourceRef
}
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
  /** Direct user Session fact that explicitly ended an uncertain task. */
  readonly terminationSource?: { readonly kind: 'user'; readonly sessionSeq: number }
  readonly blockers: readonly BrowserTaskBlocker[]
  readonly target?: BrowserTargetBinding
  /** Session target revision copied when the product tool starts this task. */
  readonly targetRevision?: number
  readonly targetLossAcknowledged: boolean
  readonly acceptance: readonly AcceptanceClause[]
  readonly evidence: readonly BrowserTaskEvidence[]
  readonly evaluations: readonly AcceptanceEvaluation[]
  readonly attempts: readonly BrowserActionAttempt[]
  readonly resources: readonly BrowserPageResource[]
  readonly functionHandoff?: {
    readonly owner: BrowserFunctionOwner
    readonly scope: BrowserFunctionScope
    readonly resourceIds: readonly string[]
    readonly createdBySessionId: string
    readonly source: Extract<BrowserTaskSourceRef, { kind: 'browser-task-function-handoff' }>
  }
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
  /** Stable semantic identity for a deterministic failure; excludes request and resource IDs. */
  readonly failureFingerprint?: string
  readonly presentation?: { readonly contentDigest: string; readonly excerpt: string }
}
export interface BrowserTaskCheck { readonly kind: 'browser-task/check'; readonly version: 1; readonly taskId: BrowserTaskId; readonly checkerId: string; readonly target: BrowserTargetBinding; readonly grantEpoch: number; readonly evaluations: readonly { readonly clauseId: string; readonly satisfied: boolean; readonly evidenceIds: readonly string[] }[] }
/** Canonical bounded delegation fact captured from the Tool runtime before the task cites it. */
export interface BrowserTaskDelegation {
  readonly kind: 'browser-task/delegation'
  readonly version: 1
  readonly taskId: BrowserTaskId
  readonly work: Omit<DelegatedWorkRef, 'source'>
}
/** Canonical delegated work observed before its same-turn BrowserTask exists. */
export interface BrowserTaskDelegationCandidate {
  readonly kind: 'browser-task/delegation-candidate'
  readonly version: 1
  readonly originUserSeq: number
  readonly toolCallId: string
  readonly toolCallSeq: number
  readonly toolResultSeq: number
  readonly work: Omit<DelegatedWorkRef, 'source'>
}
export interface BrowserTaskFunctionHandoff {
  readonly kind: 'browser-task/function-handoff'
  readonly version: 1
  readonly taskId: BrowserTaskId
  readonly taskRevision: number
  readonly createdBySessionId: string
  readonly owner: BrowserFunctionOwner
  readonly scope: BrowserFunctionScope
  readonly resourceIds: readonly string[]
}
/** Host-only replay index. It never crosses the projection wire. */
export interface BrowserTaskSourceFact {
  readonly kind: BrowserTaskSourceRef['kind']
  readonly sessionSeq: number
  readonly callId?: string
  readonly name?: string
  /** Explicit user decision marker derived from content; raw content is never retained here. */
  readonly decision?: 'cancel' | 'accept-unknown'
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
  readonly failureFingerprint?: string
  readonly presentation?: { readonly contentDigest: string; readonly excerpt: string }
  readonly checkerId?: string
  readonly evaluations?: readonly {
    readonly clauseId: string
    readonly satisfied: boolean
    readonly evidenceIds: readonly string[]
  }[]
  readonly work?: Omit<DelegatedWorkRef, 'source'>
  readonly owner?: BrowserFunctionOwner
  readonly scope?: BrowserFunctionScope
  readonly resourceIds?: readonly string[]
  readonly taskRevision?: number
  readonly createdBySessionId?: string
}
export interface BrowserTaskProjectionState {
  readonly current: BrowserTaskSnapshot | null
  readonly recentTaskIds: readonly BrowserTaskId[]
  readonly lastSourceSeq: number
  readonly lastTaskSourceSeq: number
  readonly sourceFacts: readonly BrowserTaskSourceFact[]
  /** Host-only same-user-turn delegations waiting for task creation. */
  readonly pendingDelegations: readonly BrowserTaskDelegationCandidate[]
  readonly targetBinding: BrowserSessionTargetBinding | null
  readonly targetRevision: number
  readonly failure: string | null
}
export interface CreateBrowserTaskRequest {
  readonly objective: string
  readonly sourceSeq: number
  readonly acceptance: readonly AcceptanceClause[]
  readonly target?: BrowserTargetBinding
  readonly targetRevision?: number
  readonly maxSteps?: number
  readonly maxActions?: number
}
export interface HandoffBrowserFunctionRequest {
  readonly owner: BrowserFunctionOwner
  readonly scope: BrowserFunctionScope
  readonly resourceIds: readonly string[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { browserTask: BrowserTaskProjectionState }
  interface SessionProjectionMap { browserTask: BrowserTaskSnapshot | null }
}
