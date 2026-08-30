# Agent Note: Queue host admission and post-start ownership

Status: implemented

English | [中文](2026-08-29-queue-host-admission-and-start-ownership.zh.md)

## Problem

Queue v2 can verify a trusted host operator, but its operator facade originally could only inspect and mutate work admitted by an Agent Session. A host-plane Delivery consumer would therefore have to synthesize a Session merely to enqueue durable work, incorrectly creating Session ownership and terminal Notifications.

There was also an ownership gap after `WorkHandler.start()`: if persisting `attempt/running` failed, the provider recorded the Attempt as unknown and returned without canceling or awaiting the `LiveAttempt`. The scheduler then forgot a process that could still produce external side effects.

## Decision

`OperatorWorkQueue` exposes `enqueue()` and `enqueueBatch()` only after `TaskQueue.forOperator()` verifies an issued `VerifiedOperatorAuthority`. Operator admissions use one provider-local `operator` idempotency namespace, persist a Receipt whose owner and source are both `operator`, and create WorkItems with `ownerSessionId: null`. The fold rejects an operator Receipt attached to Session-owned work. Ownerless terminal outcomes continue to create no Session Notification.

Agent admission remains Session-scoped and unchanged. WorkKind resolution, persisted policy and resource claims, atomic Batch admission, scheduling, cancellation, retry, and unknown resolution remain provider-owned Queue behavior; host Consumers do not gain a second admission state machine.

After `start()` returns but the running ChangeSet fails, the local provider aborts the execution signal, immediately calls `LiveAttempt.cancel()`, and awaits both that request and `LiveAttempt.done`. This wait uses the existing `shutdownTimeoutMs` quiescence bound. Only after settlement, rejection, or deadline does the provider record `post-start-durability` unknown plus Attention. Cleanup rejection or timeout is included in the durable failure diagnostic. If the first unknown append attempt fails before commit, the provider retries it once and includes that failure in the retried record.

The execution method ends its pre-start failure region before calling `start()`. A rejected `LiveAttempt.done`, a failed terminal settlement, or failed post-start unknown persistence therefore cannot be caught as `prepare-threw`, labeled `not-started`, or automatically retried. Queue never converts the observed live outcome into success or safe retry when its durable phase boundary is missing.

## Alternatives considered

**Create a hidden supervisor Session for host work.** Rejected because it fabricates user ownership, routes terminal messages to a Session that did not request them, and makes Delivery durability depend on Session lifecycle.

**Expose a naked `TaskQueue.enqueue()` without authority.** Rejected because admission allocates host resources and must remain behind an issued capability. Existing operator authority is the narrow current owner.

**Add a second host admission service or inbox format.** Rejected because Queue already owns receipt idempotency, immutable admission facts, Batch atomicity, and scheduling. Duplicating those rules would create split-brain Work identity.

**Record unknown without bounded cancellation and quiescence.** Rejected because unknown is an honest durable outcome, not permission to discard process ownership immediately while side effects may continue.

**Accept the `LiveAttempt.done` outcome after the running append fails.** Rejected because the Attempt never crossed its durable running boundary; treating a returned value as terminal proof would invent an invalid transition after a persistence fault.

## Testing

Provider tests cover concurrent and persisted single and Batch operator idempotency, receipt namespace and ownership, conflicting intent, ownerless completion without Notifications, and the fold's operator-receipt ownership fence. A fault-injected scheduler test makes both the running append and the first pre-commit unknown append attempt fail, then proves cancellation reaches quiescence, one unknown plus Attention remains durable, no automatic-retry event appears, and the handler starts only once. Additional cases prove that a rejected live settlement and a failed terminal append also remain unknown without retry. A real Loader composition runs ownerless allowlisted `operation.run@1` single and Batch work, reopens the Queue root, and verifies durable operator receipts and zero Session Notifications.

## Consequences

Trusted host plugins can submit durable work without inventing an Agent Session, so Delivery and other host-plane Consumers reuse Queue rather than wrapping it. The operator namespace is intentionally global within one Queue root; a Consumer must choose stable, domain-qualified idempotency keys.

`shutdownTimeoutMs` now bounds two ownership-loss paths instead of teardown alone. A handler that ignores cancellation can outlive the bound. After that deadline, Queue preserves durable uncertainty but releases the in-process handle, resource claims, global concurrency slot, and Batch slot. An operator must confirm external quiescence before authorizing another Attempt; otherwise the uncooperative side effect can overlap new work and temporarily exceed declared capacity. The Work remains unknown with explicit Attention and diagnostic evidence rather than appearing terminal or safely retryable.
