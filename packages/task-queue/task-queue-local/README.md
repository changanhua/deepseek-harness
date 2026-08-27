# @deepseek-ai/dsh-task-queue-local

English | [中文](README.zh.md)

Durable local provider for the typed Queue v2 `ctx.taskQueue` service. `LocalTaskQueue` owns one schema-versioned Queue root, admission, dispatch, attempt lifecycle, and the operator facade. WorkKind packages register `WorkHandler`s through the service; they do not own the durable scheduler or attachment storage.

## Durable state

The configured `queueRoot` contains `manifest.json` with `schemaVersion: 3`, append-only `active.jsonl`, an optional digest-checked `snapshot.json`, and the owner lock. The provider acquires exclusive ownership before recovery. A live owner rejects a second host; a stale owner lock is quarantined before takeover. Other schema versions are rejected rather than decoded or migrated.

Every durable mutation is a `ChangeSet`. Admission persists caller intent, resolved facts, handler-derived retry policy, and validated resource claims before dispatch. The local transaction FIFO serializes the final receipt recheck and append, while `WorkHandler.resolveAdmission()` and `prepare()` stay outside it. Batch idempotency covers the WorkKind, ordered items, shared payload, and `maxParallel`, so reusing a key with any changed Batch-shaping input is a conflict. Startup turns persisted `starting` and `running` attempts into `unknown` with pending Attention records before dispatch; shutdown applies one `shutdownTimeoutMs` bound across cancellation requests and execution settlement, then marks unresolved attempts `unknown` before releasing the root lock.

## Scheduling

Handlers declare `ResourceClaim`s, and admission rejects claims missing from deployment `resourceCapacity`. `maxConcurrent`, persisted resource claims, and a Batch's `maxParallel` jointly bound dispatch; unused host capacity remains available to other eligible Batches. `pause()` stops new dispatch only: read, admission, cancellation, acknowledgement, and restricted unknown resolution remain available.

## Config

| key | default | meaning |
|---|---|---|
| `queueRoot` | required | Isolated schema-v3 Queue root |
| `maxConcurrent` | `8` | Maximum prepared or live attempts |
| `shutdownTimeoutMs` | `5000` | Time teardown waits before unresolved attempts become unknown |
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
