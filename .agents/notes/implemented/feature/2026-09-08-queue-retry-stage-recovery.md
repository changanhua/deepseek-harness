# Agent Note: Queue retry timing and stage recovery

Status: implemented

English | [中文](2026-09-08-queue-retry-stage-recovery.zh.md)

## Problem

A transient preparation failure can exhaust attempts before its dependency recovers. A business stage caller can also lose its Work binding after admission or its business progress after Queue completion. Recovery must preserve the original execution and must not convert uncertain side effects into automatic retries.

## Decision

The local provider delays safe automatic retries by 1, 2, 4, 8, 16, then at most 30 seconds. The existing fold identifies automatic authorization as queued state retaining a retriable `not-started` failure; its `updatedAt` stores authorization time and `attemptCount` selects the delay. Manual retry and unknown resolution clear the failure. These persisted facts reconstruct eligibility after log or snapshot recovery without adding a second durable clock or changing schema 3. Changing this timing rule must preserve already-authorized deadlines or explicitly change the storage contract.

A single referenced timer owns the next wake-up. Waiting work holds no execution or resource claim. Pause and shutdown clear the timer; resume and handler registration rebuild it. Expiry rechecks current state and capacity, including an expiry racing the end of a scheduler turn. Invalid automatic-retry timing is rejected by the fold, including snapshot hydration. Operator and browser reads expose `retry-backoff` with `eligibleAt`.

Recovery reuses scoped `enqueue()` and `get()`. Receipt lookup precedes handler lookup, including Batch admission. Single-work receipts must match the requested kind and cannot refer to a Batch; pending admission coalescing also binds the kind. The persisted input digest and schema remain unchanged. A business caller stores its stage identity, input/recipe revision and result binding, while Queue owns attempts and results. Review rejection is a business result, not an execution failure. Unknown execution requires operator resolution.

The [ownership decision](../architecture/2026-08-27-queue-v2-reuse-boundaries.md) remains active: Queue owns durable execution, while Workflow and business modules own orchestration semantics. The [image canary decision](../architecture/2026-08-26-queue-v2-image-canary.md) retains format isolation and artifact ownership. Neither decision is superseded.

## Alternatives considered

- Persist another deadline field and replace the Queue root: unnecessary while the existing immutable authorization facts determine the deadline.
- Sleep inside the live attempt: holds execution capacity while no work can progress.
- Recover only from completion notifications: loses progress when the business caller misses delivery.
- Add a persistent stage graph or resumable worker protocol: exceeds the bounded Queue contract; a business caller can submit finite stages with saved inputs and results.

## Consequences

Retries remain bounded by handler policy and side-effect safety. A restart, repeated submission, or elapsed deadline cannot authorize unknown work. The fixed delay policy is intentionally small; provider quota windows, fairness, cost accounting and business publication are separate decisions. Recovery preserves execution facts, not an arbitrary worker's intermediate memory or exactly-once external effects.

## Testing

Focused tests exercise deadline preservation through snapshot recovery, capacity release, capped delay, pause, cancellation, scheduler-boundary expiry, missing-handler receipt recovery and concurrent kind conflicts. Built `dsh --profile queue-stages` tests run research, draft and review across separate owning processes, inspect durable events and execution artifacts, recover after a killed process, and verify idle retry timers keep the owner alive. The worker is deterministic test code; these checks do not measure generated content quality or model usage.
