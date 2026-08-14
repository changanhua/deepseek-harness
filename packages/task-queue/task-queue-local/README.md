# @deepseek-ai/dsh-task-queue-local

English | [中文](README.zh.md)

Durable host-plane implementation of the [`@deepseek-ai/dsh-task-queue`](../task-queue/README.md) contract: `LocalTaskQueue` keeps every task and notification in a single-writer segment log under `$DSH_HOME/task-queue/`, survives process restarts, and runs a scheduler that claims, spawns, and settles tasks at configurable concurrency. Load it as a plugin and it registers as `ctx.taskQueue`.

## Service

`LocalTaskQueue` extends the contract's `TaskQueue` service and registers as `ctx.taskQueue`. All reads return durable state; all writes go through one service-level mutation FIFO.

- `enqueueFromTool(spec) → TaskId` — the trusted tool ingress. It rejects `executor: 'shell'`, requires the executor to be explicitly enabled, and derives an idempotent receipt: `tool:key:<idempotencyKey>` when the caller supplies a key (a repeat returns the existing task id), otherwise `tool:auto:<uuid>` (single-admission identity, no cross-call dedup).
- `enqueueBatchFromTool(specs) → TaskId[]` — up to 200 specs per call.
- `list(filter?)` / `get(id)` — read summaries or a full task; `list` filters by status, executor, and tags.
- `cancel(id)` — `pending` cancels immediately; `starting`/`running` records the `stopping` intent and returns `'stopping'`; terminal tasks are a no-op returning `'canceled'`.
- `retry(id)` — returns a `failed` or `canceled` task to `pending` with a zeroed attempt.
- `stats()` — `serviceState` (with a fault reason when faulted), per-status counts, and per-executor counts.
- `registerExecutor(name, adapter)` — installs a prepare-only adapter; returns a disposer that removes it.
- `pause()` / `resume()` — `pause` only from `running`, `resume` only from `paused`. `resume()` on a faulted queue is rejected; faulted can only clear through the fault resolution protocol or an operator restart.
- `ackNotification(notificationId, messageId)` — CAS-acknowledges a `pending` notification born from a terminal change; a mismatched status or message id fails without touching any other record.
- `listNotifications({ ownerSessionId })` — reconstructs the pending-notification outbox for one session, ordered by terminal seq.

Events are published only after the corresponding change is fsynced and folded into memory: `task-queue/created`, `task-queue/starting`, `task-queue/running`, `task-queue/succeeded`, `task-queue/failed`, `task-queue/requeued`, `task-queue/canceled`, and `task-queue/orphan-unknown`, `task-queue/faulted` for recovery and failure signals.

## Durable Store

The queue root holds an append-only `active.jsonl`, sealed `segments/<first>-<last>.jsonl` files, a disposable `snapshot.json` cache, `inbox/`, `quarantine/`, `runs/<taskId>/`, and `output/<taskId>/`. Each new change is one JSON line, written with `open('a')` → write → `fsync(file)`, and the parent directory is fsynced on first creation. When the active segment crosses 10,000 rows or 8 MB it is fsynced, renamed into `segments/`, both parent directories fsynced across the rename, a fresh active is exclusively created and fsynced, and the snapshot is rewritten.

Boot folds the sealed segments plus the active tail, enforcing filename-range and seq continuity; a corrupt complete line, a sealed half-line, or any seq gap or duplicate fails closed with a `FaultedError`. Only the active segment's torn final line is repaired — truncated to the last complete newline and fsynced. The snapshot is only trusted when its sha256 state digest and per-line lastChange digest both match the durable log; any mismatch discards it and folds from the earliest segment.

## Mutation FIFO and the Faulted Protocol

Every durable mutation — enqueue, batch, inbox import, settlement, cancel intent, retry, notification ack — runs through one promise chain keyed by the service instance, so concurrent enqueues, inbox scans, and settlement callbacks cannot interleave. An append/fsync failure does not prove a transfer failed, so the service enters `faulted`, refuses new mutations, and re-reads the log to decide: committed (seq and payload present) → reconcile and clear; uncommitted with an intact prior tail → the transfer truly did not happen, the original error is preserved; undecidable → stays fail-closed with no automatic resume. The `running` publication after a spawn is the sole retry special case: the same canonical payload is retried under the next seq rather than spawning a second process.

## Inbox

External producers drop a task by writing `inbox/<uuid>.tmp` (exclusive), fsyncing it, renaming to `<uuid>.json`, and fsyncing the inbox directory — both fsyncs are part of the power-loss-durable protocol, so the scheduler only ever sees a complete file. The basename must be a strict UUID; content must pass the strict enqueue schema. Non-UUID basenames are ignored, and invalid content is moved to `quarantine/` rather than enqueued. `receiptId` is the UUID basename: a repeated scan of an already-committed receipt deletes the file without creating a second task, and the file is removed only after the `created` change commits.

## Scheduling

The tick loop (default 1 s) ingests the inbox, then claims eligible `pending` tasks in priority-ascending, same-priority FIFO order, bounded by a global `maxConcurrent` (default 2) and per-executor `maxConcurrentPerExecutor` (default 1). Claiming is two-phase: inside the FIFO it writes `starting` (the only place `attempt` increments, with a run record holding no pid), then outside the FIFO the adapter's `prepare(task, run, signal)` produces the spawn spec, and finally back inside the FIFO it atomically re-checks the task is still `starting`, spawns via `ctx.subprocess.spawn(spec)`, and writes `running` with the real pid. A task canceled while preparing is never spawned. `exitCode === 0` settles `succeeded`; anything else takes the failure path — requeue with `backoffMs * 2^(attempt-1)` until `maxAttempts`, then `failed`. An attempt scoped `AbortSignal` (also fed to the spec's `signal`) enforces `timeoutMs` by escalating into tree termination.

Crash reclaim runs exactly once at boot: `starting`/`running`/`stopping` tasks are leftovers of the previous host process, so they are settled per the recovery matrix (never signaling a recovered pid) and each emits `task-queue/orphan-unknown`. Normal ticks never reclaim, or a live spawned task would be reverted every second.

## Executors

Adapters are prepare-only: they return a fully-specified `SubprocessSpawnSpec` and never touch `child_process` — the scheduler alone spawns, terminates, and waits through `ctx.subprocess`. Built-ins are `claude`, `codex`, `opencode`, `arkcli`, and `shell`. All run with `cwd` set to the task's output directory, collect stdout/stderr with a bounded spill, and leave `env` unset so the subprocess service's scrubbed parent environment applies. `shell` executes an argv array parsed from the task prompt's `{ "argv": string[] }` JSON and is refused by every tool ingress — only inbox admission may enqueue it, so a prompt from a model can never become an arbitrary command. Executors must be explicitly enabled in host config; an unknown or disabled executor is rejected at admission, and a spawn `ENOENT` fails the attempt immediately rather than entering a retry storm.

## Permissions

Queue directories (`task-queue/`, `segments/`, `inbox/`, `quarantine/`, `runs/`, `output/`) are created `0o700`; files (`active.jsonl`, sealed segments, `snapshot.json`, run logs) are created `0o600`. Every untrusted id entering a path goes through `encodeSegment` first. On Windows these modes are not enforced; ownership relies on the current user's directory ACL.

## Model Experience

Indirectly, through [`dsh-tool-task-queue`](../tool-task-queue/README.md), which renders the seven `task_queue_*` tools, the `tool:task-queue` prompt section, and the notification outbox notices; this backend registers no model surface of its own.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **At-least-once execution** — a crash between `spawn` and the `running` commit can run an attempt twice; `attempt` increments only at claim and recovered pids are diagnostics, never cross-restart kill authorization.
- **Segment GC is not implemented** — sealed segments are never deleted, so recovery never depends on an undefined base-segment protocol, but the queue directory grows without bound.
- **The faulted state is intentionally sticky** — an undecidable commit stays fail-closed until operator recovery and restart; `resume()` cannot clear it, by design.
