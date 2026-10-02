import { Context, Service } from '@deepseek-ai/cordis'
import type { BudgetRequest, BudgetScopeInput, BudgetUsage } from './schema.ts'
import type { BudgetApprover, BudgetAuthority, BudgetChunkObservation, BudgetDecisionRecord, BudgetReference, BudgetReservationView, BudgetSnapshot, BudgetSubject, BudgetSubjectResolver } from './types.ts'

export * from './schema.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { budget: Budget }
}

/** Stable budget failure kept distinct from a failed model response. */
export class BudgetError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'BudgetError' }
}

/** Durable user resource policy; no model-facing mutation or monetary accounting. */
export abstract class Budget extends Service {
  constructor(ctx: Context) { super(ctx, 'budget') }

  /**
   * Create immutable limits through a trusted Consumer, with idempotent scope identity.
   * @param input - Immutable subject, ancestor and resource policy.
   * @param authorize - Rechecked trusted authority before durable creation.
   * @returns Current scope snapshot; conflicting reuse rejects.
   */
  abstract createScope(input: BudgetScopeInput, authorize: BudgetAuthority): Promise<BudgetSnapshot>
  /**
   * Read current usage; exact references reject changed scope definitions.
   * @param reference - Scope id or exact owner-issued reference.
   * @returns Current cumulative usage, holds and policy.
   */
  abstract inspect(reference: BudgetReference | string): BudgetSnapshot
  /**
   * Find the immutable scope bound to an owner-derived subject.
   * @param subject - Subject identity obtained from its runtime owner.
   * @returns Current scope snapshot, or undefined when no scope is bound.
   */
  abstract scopeFor(subject: BudgetSubject): BudgetSnapshot | undefined
  /**
   * Permanently revoke a scope; descendants and pending dispatches observe it.
   * @param scopeId - Existing scope to revoke.
   * @param authorize - Trusted authority rechecked before persistence.
   */
  abstract revoke(scopeId: string, authorize: BudgetAuthority): Promise<void>
  /**
   * Read one retained reservation for operator/evaluation evidence.
   * @param requestId - Stable logical request identity.
   * @param attemptId - Exact paid dispatch attempt identity.
   * @returns Retained reservation, or undefined when none exists.
   */
  abstract reservation(requestId: string, attemptId: string): BudgetReservationView | undefined
  /**
   * Read a durable admission decision, including denied cases that never reached a provider.
   * @param requestId - Stable logical request identity.
   * @param attemptId - Exact dispatch attempt identity.
   * @returns Retained decision, or undefined before admission.
   */
  abstract decision(requestId: string, attemptId: string): BudgetDecisionRecord | undefined
  /**
   * Register the sole trusted interactive Consumer; absence of a handler never grants an exception.
   * @param approver - Host callback that obtains explicit Human approval.
   * @returns Disposer that removes this registration.
   */
  abstract registerApprover(approver: BudgetApprover): () => void
  /**
   * Settle an unknown attempt only after explicit operator verification; never automatically retry it.
   * @param requestId - Logical request holding unknown usage.
   * @param attemptId - Exact attempt to settle.
   * @param usage - Operator-verified actual input and output usage.
   * @param authorize - Trusted reconciliation authority rechecked before commit.
   */
  abstract reconcile(requestId: string, attemptId: string, usage: BudgetUsage, authorize: BudgetAuthority): Promise<void>
  /**
   * Register one owner-derived context source; registration is disposable and duplicate names reject.
   * @param owner - Stable runtime owner identity.
   * @param resolver - Callback deriving current subjects from trusted runtime state.
   * @returns Disposer; removal remains fail-closed for the required owner.
   */
  abstract registerSubjectResolver(owner: string, resolver: BudgetSubjectResolver): () => void
  /**
   * Run Host work under an exact grant; the operation must await all stream consumption.
   * @param reference - Exact owner-issued immutable scope reference.
   * @param operation - Work inheriting this scope for its asynchronous lifetime.
   * @returns The awaited operation result.
   */
  abstract withScope<T>(reference: BudgetReference, operation: () => Promise<T>): Promise<T>
  /**
   * Admit and account for one actual model dispatch and its entire iterator lifetime.
   * No callback is invoked on refusal; missing usage remains held for reconciliation.
   * @param request - Bounded input estimate, output ceiling and stable request/attempt identity.
   * @param dispatch - Invoked once after durable reservation, with the budget-owned cancellation signal.
   * @param observe - Extracts actual usage and completion from each provider chunk.
   * @param signal - Optional caller cancellation, combined with budget deadlines.
   * @returns Stream whose terminal result is published only after accounting settles.
   */
  abstract streamModel<T>(
    request: BudgetRequest,
    dispatch: (signal: AbortSignal) => AsyncIterable<T>,
    observe: (chunk: T) => BudgetChunkObservation,
    signal?: AbortSignal,
  ): AsyncIterable<T>
}

export default Budget
