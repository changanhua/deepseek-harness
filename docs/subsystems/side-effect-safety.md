# Side-effect safety

English | [中文](side-effect-safety.zh.md)

This Host-only subsystem admits actions against a durable human-approved scope, deterministic budget, and runtime lease. The [package reference](../../packages/guard/side-effect-safety/README.md) owns configuration and deployment limits. [Host contracts](../../packages/guard/side-effect-safety/src/types.ts) and [persisted schemas](../../packages/guard/side-effect-safety/src/state.ts) are the type authority.

## Authority and ownership

A lifecycle-bound Host adapter owns domain interpretation, authenticated human confirmation, the private sender, and evidence verification. The kernel owns action identity, digest binding, atomic admission, risk consumption, business lease, and durable outcome. It registers no model tools or Remote methods. `allowed-once` is consumed only by the activation request; the independently verified complete human approval artifact supplies durable authority. Planning adoption supplies none.

## Durable state

Storage Domain `side_effect_safety`, version 1, stores one global document with `approvals` and `executions`. Each execution carries its revision, immutable approval binding, target, control state, lease, hard blocker, and action ledger. Actions retain intent digests, risk costs, timestamps and opaque evidence references; no domain payload or evidence bytes are persisted. One approval funds one execution so creating a second execution cannot reset its budget. CAS and target exclusion share one serialized writer and one durable commit.

## Transitions and commit order

`PREPARED → SENT → CONFIRMED | NOT_APPLIED | UNKNOWN`; `UNKNOWN → RECONCILING → CONFIRMED | NOT_APPLIED | UNKNOWN`. Only unsent PREPARED can become CANCELLED. Terminal and unresolved action identities never return to PREPARED. Idempotent preparation returns the current record, not permission to execute again.

Preparation commits intent. Admission validates scope, payload, approval, current lease, budget, breaker and revision, and mints a short-lived process-local handle. Send consumes that handle, revalidates, and durably commits SENT and risk consumption together before calling the adapter. Readback then durably settles the ledger. A failed SENT commit invokes no sender. A failed settlement leaves an unresolved record. Restart marks orphaned SENT and RECONCILING as UNKNOWN and invalidates old leases without invoking the sender.

## Breaker and recovery

Any unresolved SENT, UNKNOWN or RECONCILING blocks additional sends to the same domain target, including other executions. Lookup-only reconciliation requires evidence for a terminal result; missing data, exceptions and malformed results remain UNKNOWN. Expired approvals, exhausted budgets, invalid leases, idempotency conflicts and inconsistent storage fail closed. Pause prevents admission; abort cancels only unsent actions. Completion requires nonempty, verified terminal actions and no hard blocker. Budgets conservatively retain all sent risk, including NOT_APPLIED attempts.

The ledger retains a unique `sentRevision` for every sent action. Consecutive-failure budgets follow that durable send order, independently of preparation order or equal clock timestamps.

## Existing owners

[BrowserTask](../../packages/browser/browser-task/README.md) and its extension journal retain transport-level intent and lookup-only recovery; this kernel adds no browser transport or competing journal. [Delivery](delivery.md) publication prepared/publishing/unknown maps to PREPARED/SENT/UNKNOWN, but its explicit confirm-not-created retry policy remains its own: this kernel permanently terminalizes the original action as NOT_APPLIED. [Session persistence](persistence.md) writer locks protect log writers; the execution lease here protects business admission. Evidence owners retain bytes; this subsystem stores only opaque references.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsideeffectsafety--sideeffectsafety"></a>

### `ctx.sideEffectSafety` — `SideEffectSafety`

One Storage Domain writer owns all business leases and durable action records.

```ts cordis-catalog
/**
 * Return detached committed state and a current-clock breaker projection.
 * @param id - Execution identity.
 * @returns bounded snapshot with no action payload or evidence bytes.
 */
snapshot(id: SafetyExecutionId): SafetySnapshot
```

Source: [`packages/guard/side-effect-safety/src/index.ts`](../../packages/guard/side-effect-safety/src/index.ts)
<!-- END GENERATED cordis-surface -->
