# Resource budgets

English | [中文](budget.zh.md)

The [budget packages](../../packages/budget/README.md) apply one durable resource policy to Session, Goal and Workflow model requests. Token Meter remains a measurement reader; Queue resource capacity remains a concurrency limit. Neither grants additional model spending.

## Scope and accounting

Each immutable scope identifies its owner, parent, request/input/output/total Token ceilings, wall-clock lifetime and exhaustion action. A null ceiling adds no local restriction. Every request is checked against its entire parent chain. The [schemas](../../packages/budget/budget/src/schema.ts) and [public views](../../packages/budget/budget/src/types.ts) own the exact values.

The owner serializes reservation, dispatch claim and settlement in one versioned Storage Domain. The medium must promise single-writer ownership, synchronous commits and a private root. Scope references bind immutable definitions and creation time, while usage and revocation remain mutable owner facts. Requests are keyed by request/attempt identity; changed inputs conflict, and retained attempts are not dispatched again.

Before calling an adapter, the owner persists a reservation and an exact dispatch claim, then rechecks live context and current policy. The final LLM guard covers direct and prepared calls. Provider usage settles the attempt before its terminal chunk is published. A canceled request proven unsent releases its reservation. Missing or malformed usage stays unknown; restart releases unsent reservations, preserves dispatched uncertainty and never issues work. Storage ambiguity closes further admission until recovery.

Text input reservations are explicitly estimated from serialized bytes. Output reservations require an explicit positive cap. Images without a trustworthy bound are refused. Actual usage includes cache input when the Provider reports a total or complete cache buckets; omitted buckets are not zero. This is resource accounting, not monetary or billing-grade reconciliation.

## Approval and lifecycle

An ask decision is durable before the existing approval waterfall runs. Only a direct Human turn on a live root Agent can ask. An allowed-once exception covers the exact attempt and only exhausted ask scopes; it cannot override a denying ancestor, revocation, time expiry or unknown usage. Unused exception allowance cannot fund another request. An interrupted or unanswered question remains paused/denied across restart.

Agent bindings come from the live registry and Goal owner, never a claimed request session id. Workflow children share their run scope and persist a Session child binding before model dispatch. Goal continuation records `budget-exhausted` when no further autonomous request can be admitted. Removing an installed context resolver or final dispatch guard fails closed until its owner is restored.

## Operator interface and limits

The [Human command](../../packages/budget/command-budget/README.md) configures, reads, revokes and reconciles the caller's budget. An Agent cannot raise or disable its own limits. Scope definitions are immutable, and account capacity is explicit; exhaustion does not prune receipts or reset history. External Agent services outside the local LLM boundary require their own accounting bridge.

The budget service supplies an admission and receipt interface for Eval and future Activation consumers. It does not implement automatic activation, a scheduler, independent grading or a trusted Eval decision. The [setup guide](../cookbook/trusted-eval-and-budget.md) and [decision record](../../.agents/notes/implemented/architecture/2026-10-02-trusted-eval-producers-and-resource-budgets.md) explain composition and ownership.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbudget--budget-abstract-seam"></a>

### `ctx.budget` — `Budget` (abstract seam)

Durable user resource policy; no model-facing mutation or monetary accounting.

```ts cordis-catalog
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
abstract streamModel<T>( request: BudgetRequest, dispatch: (signal: AbortSignal) => AsyncIterable<T>, observe: (chunk: T) => BudgetChunkObservation, signal?: AbortSignal, ): AsyncIterable<T>
```

Source: [`packages/budget/budget/src/index.ts`](../../packages/budget/budget/src/index.ts)
<!-- END GENERATED cordis-surface -->
