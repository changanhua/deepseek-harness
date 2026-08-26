# @deepseek-ai/dsh-task-queue

English | [中文](README.zh.md)

The durable cross-session task-queue contract (`ctx.taskQueue`). The abstract `TaskQueue` service and its vocabulary — the task model, the two-phase state machine, the change-record schema, the fold and canonical digest rules, the executor adapter shape, and the `task-queue/*` event surface — let the durable backend in [`dsh-task-queue-local`](../task-queue-local/README.md) and the agent toolkit in [`dsh-tool-task-queue`](../tool-task-queue/README.md) share one identity and mutation semantics. The design lives in [docs/specs/2026-08-14-task-queue-design.md](../../../docs/specs/2026-08-14-task-queue-design.md).

## Service contract

- `enqueueFromTool(spec)` admits one task with `source: 'tool'`; the backend rejects `executor: 'shell'` and assigns the receipt. `enqueueBatchFromTool(specs)` is the bounded batch form (200 per call).
- `list(filter?)` and `get(id)` return read-only projections. `get` throws for an unknown id.
- `cancel(id)` resolves `'canceled'` (a pending task) or `'stopping'` (a cancel intent persisted on starting/running work). `retry(id)` resets `attempt` and requeues a failed task.
- `stats()` reports `serviceState` (`running`/`paused`/`faulted`), an optional `fault`, per-status counts, and per-executor counts.
- `registerExecutor(name, adapter)` adds a prepare-only adapter and returns its disposer. The adapter's optional `normalize()` method converts raw process output into an Agent-consumable `summary` and optional `assistantText` — the seam that turns a process queue into a work queue. The scheduler calls `normalize()` on exit code 0; when absent it provides a sensible default summary.
- `pause()`/`resume()` gate admission; `resume()` must reject a `faulted` queue.
- `ackNotification(notificationId, messageId)` acks a pending outbox record with a CAS; an already-acknowledged record with a matching message id is an idempotent no-op. `listNotifications({ ownerSessionId })` lists one session's records by `terminalSeq`.

All mutations serialize through the backend's service FIFO and are fail-closed on append error — the queue enters `faulted` and no caller may `resume()` it away.

## Task model

`Task` carries the full durable snapshot: status (`pending`/`starting`/`running`/`stopping`/`succeeded`/`failed`/`canceled`), `attempt`/`maxAttempts`, `backoffMs`, `delayUntil`, `timeoutMs`, optional `workspaceDir`, `outputDir`, tags, `lastError`, `result`, `ownerSessionId`, the trusted `source`/`receiptId`, and the per-attempt `RunRecord[]` (`runId`, attempt, diagnostic `pid`, timestamps, log path, command fingerprint, `terminationUnverified`). `workspaceDir` is the process working directory for executors that operate on an existing checkout, while `outputDir` remains the queue-owned artifact directory; old records without `workspaceDir` materialize it from `outputDir`.

`TaskResult` (populated on `succeeded`) carries a human-readable `summary` (e.g. "exit 0, 3.2s, 2 output files"), optional `assistantText` (the semantic result from coding-agent executors like DSH/Claude/Codex), `exitCode`/`signal`, wall-clock `durationMs`, optional `logPath` (this attempt's run log), bounded `stdoutTail`/`stderrTail` (up to 4 KiB each), and `outputFiles` (top-level artifact names in the output directory). Full output stays in the run log and output directory; the tails are an Agent-consumable projection only.

`attempt` increments exactly once, at claim (`pending → starting`). Failure requeues to `pending` with `attempt` unchanged and a backoff delay of `backoffMs * 2^(attempt-1)`; exhausting `maxAttempts` enters `failed`. A host crash recovers `starting`/`running` to the failure path and `stopping` to `canceled` with `terminationUnverified` — a persisted pid is diagnostic only and is never a cross-restart kill token.

## Change records and folding

`ChangeRecord` is a discriminated union: task ops (`created`/`starting`/`running`/`stopping`/`succeeded`/`failed`/`requeued`/`canceled`) carry a full post-op `state` snapshot plus an optional atomically-created `notification` on terminal transitions; the `notification-acknowledged` op carries a CAS triple (`notificationId`, `expectedStatus: 'pending'`, `expectedMessageId`).

`foldChanges` folds an ordered stream fail-closed: strict `seq` monotonicity (`lastSeq + 1`), task-op identity (`state.id === taskId`), terminal notification consistency, and CAS ack semantics all throw rather than skip a bad record. `applyChange` is the incremental single-change fold the backend uses after each committed append.

`canonicalJson` and `canonicalQueueState` serialize deterministically (UTF-8, no extra whitespace, recursive key sort, tasks/notifications by id ascending) so snapshot digests never depend on runtime object insertion order.

## Events

`task-queue/created`, `task-queue/starting`, `task-queue/running`, `task-queue/succeeded`, `task-queue/failed`, `task-queue/requeued`, `task-queue/canceled`, `task-queue/drained`, `task-queue/orphan-unknown`, `task-queue/faulted` — each emitted only after the corresponding change is fsynced and folded.

## Model Experience

Indirectly, through [`dsh-tool-task-queue`](../tool-task-queue/README.md), which renders the `task_queue_*` tools, the `tool:task-queue` prompt section, and the notification outbox notices; this contract registers no model surface of its own.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **At-least-once execution** — a crash between spawn and the running record may leave an unknown orphan; attempts and per-attempt logs make repeats traceable.
- **No segment GC** — sealed segments are never deleted in v1, so recovery never depends on a GC protocol.
- **`faulted` is sticky** — only a successful log redetermination or operator recovery + restart clears it.
