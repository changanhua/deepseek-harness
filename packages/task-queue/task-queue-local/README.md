# @deepseek-ai/dsh-task-queue-local

English | [中文](README.zh.md)

Durable local provider for the typed Queue v2 `ctx.taskQueue` service. `LocalTaskQueue` owns one schema-versioned Queue root, admission, dispatch, attempt lifecycle, and the operator facade. WorkKind packages register `WorkHandler`s through the service; they do not own the durable scheduler or attachment storage.

## Durable state

The configured `queueRoot` contains `manifest.json` with `schemaVersion: 3`, append-only `active.jsonl`, an optional digest-checked `snapshot.json`, and the owner lock. The provider acquires exclusive ownership and finishes orphan recovery before its Cordis service plugin becomes available. A synchronous `list()` or `get()` after `await ctx.plugin(LocalTaskQueue, config)` therefore reads the recovered projection. A live owner rejects a second host; a stale owner lock is quarantined before takeover. Other schema versions are rejected rather than decoded or migrated.

Every durable mutation is a `ChangeSet`. Admission persists caller intent, resolved facts, handler-derived retry policy, and validated resource claims before dispatch. The local transaction FIFO serializes the final receipt recheck and append, while `WorkHandler.resolveAdmission()` and `prepare()` stay outside it. Agent and operator admissions use disjoint idempotency namespaces; operator work is ownerless and cannot produce Session Notifications. Batch idempotency covers the WorkKind, ordered items, shared payload, and `maxParallel`, so reusing a key with any changed Batch-shaping input is a conflict. Startup turns persisted `starting` and `running` attempts into `unknown` with pending Attention records before dispatch.

If `WorkHandler.start()` returns live ownership but the following `attempt/running` append fails, the provider immediately requests cancellation and waits for both cancellation and live settlement under `shutdownTimeoutMs` before recording `unknown` with Attention. If the first unknown append attempt fails before commit, the provider retries once and retains that failure in the durable diagnostic when the retry commits. No exception after `start()` may fall back into the pre-start `not-started` automatic-retry path; a rejected live settlement or failed terminal append is also resolved conservatively as unknown when the current durable state permits it. The same quiescence bound applies during shutdown. After the deadline, Queue preserves durable uncertainty but releases the in-process handle and scheduling claims; an operator must confirm external quiescence before authorizing another Attempt. Queue never guesses a terminal outcome after the side-effect boundary.

## Scheduling

Handlers declare `ResourceClaim`s, and admission rejects claims missing from deployment `resourceCapacity`. `maxConcurrent`, persisted resource claims, and a Batch's `maxParallel` jointly bound dispatch; unused host capacity remains available to other eligible Batches. `pause()` stops all new dispatch globally: read, admission, cancellation, acknowledgement, and restricted unknown resolution remain available.

A staged handler registration also permits admission and receipt lookup, but only its own `activate()` enables claims. Disposal before activation leaves queued Work without an Attempt. Disposal after claim aborts only that exact registration's execution while it is still before `start()`; once preparation returns, the aborted check records cancellation instead of calling `start()`. Disposal does not expand into cancellation of an already live Attempt.

## Config

| key | default | meaning |
|---|---|---|
| `queueRoot` | required | Isolated schema-v3 Queue root |
| `maxConcurrent` | `8` | Maximum prepared or live attempts |
| `shutdownTimeoutMs` | `5000` | Time teardown or post-start durability cleanup waits for execution quiescence before recording unknown |
| `resourceCapacity` | `{}` | Resource units available to handler claims |

The shipped base composition uses `$DSH_HOME/task-queue-v3`, global concurrency `3`, image-generation capacity `3`, and agent-run capacity `1`.

## Model Experience

Indirectly, through [`dsh-tool-task-queue`](../tool-task-queue/README.md) and WorkKind-specific tools that own admission schemas and results.

#### KV Cache effect

No direct invalidation; the named tools own model-visible changes.

## Known Limitations and Deferred Work

- The provider accepts only a schema-v3 root; it has no decoder or migrator for earlier schemas.
- `unknown` is intentionally non-terminal and cannot auto-retry.
- The owner lock is local-host coordination, not multi-host scheduling.
