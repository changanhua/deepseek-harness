import type { BudgetRequest, BudgetScopeInput, BudgetUsage } from './schema.ts'

/** Stable identity of the immutable Host-authorized scope definition, including its start time. */
export interface BudgetReference { readonly id: string; readonly version: '1'; readonly digest: string }

/** Owner-derived Session, Goal or Workflow identity, never a model-supplied attribution. */
export interface BudgetSubject { readonly kind: BudgetScopeInput['kind']; readonly id: string }

/** Resource totals; reservation amounts remain estimates until actual usage is settled. */
export interface BudgetTotals {
  readonly requests: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
}

/** Non-secret view of one scope and all descendant consumption. */
export interface BudgetSnapshot {
  readonly reference: BudgetReference
  readonly scope: BudgetScopeInput & { readonly createdAt: number; readonly revoked: boolean }
  readonly consumed: BudgetTotals
  readonly reserved: BudgetTotals
  readonly unknownRequests: number
  readonly deadline: number | null
  readonly remainingMs: number | null
}

/** Trusted Consumer rechecks the initiator's authority immediately before a durable mutation. */
export type BudgetAuthority = () => void | Promise<void>

/** Purely observational resolver owned by a Session, Goal or Workflow bridge. */
export type BudgetSubjectResolver = () => readonly BudgetSubject[] | Promise<readonly BudgetSubject[]>

/** One interactive exception for this exact dispatch, without increasing any scope's future limits. */
export type BudgetApprover = (request: BudgetApprovalRequest, signal: AbortSignal) => Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>

/** Complete non-secret question captured before entering the existing approval waterfall. */
export interface BudgetApprovalRequest {
  readonly request: BudgetRequest
  readonly scopes: readonly BudgetSnapshot[]
}

/** Retained admission outcome; a pending question folds to unavailable after restart. */
export interface BudgetDecisionRecord {
  readonly request: BudgetRequest
  readonly scopeId: string
  readonly kind: 'allow' | 'deny' | 'pause' | 'ask'
  readonly reason: string
  readonly createdAt: number
  readonly approval: 'pending' | 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable' | null
  readonly snapshots: readonly BudgetSnapshot[]
}

/** Adapter-bound accounting projection; terminal output waits for durable settlement. */
export interface BudgetChunkObservation {
  readonly terminal: boolean
  readonly usage?: BudgetUsage | null
}

/** Structured refusal retained by the budget owner; never represented as provider usage. */
export interface BudgetRefusal {
  readonly kind: 'deny' | 'pause' | 'ask'
  readonly reason: string
  readonly scopeId: string | null
  readonly request: BudgetRequest
}

/** Request/attempt accounting retained across restart and explicit unknown reconciliation. */
export interface BudgetReservationView {
  readonly scopeId: string
  readonly request: BudgetRequest
  readonly phase: 'reserved' | 'dispatched' | 'settled' | 'released' | 'unknown'
  readonly usage: BudgetUsage | null
  readonly createdAt: number
  readonly exceptionScopes: readonly string[]
}
