# @deepseek-ai/dsh-tool-task-queue

English | [中文](README.zh.md)

The model-facing toolkit for `ctx.taskQueue`: eight `task_queue_*` tools, one tool-guidance prompt section, a pre-step candidate-notification hook, and the append→flush→CAS-ack notification finalizer. One apply registers everything — the hooks are never split across duplicate-listening mounts. The host Service is read optionally through `ctx.get('taskQueue')`: with no backend composed the tools still register, but their `execute` rejects with a clear load message, and the pre-step/finalizer hooks no-op.

## Tools

- `task_queue_enqueue(spec)` enqueues one durable, cross-session task. `spec` requires `title`, `prompt`, and `executor`, and optionally carries `priority`, `maxAttempts`, `backoffMs`, `delayUntil`, `timeoutMs`, `outputDir`, `tags`, and `idempotencyKey`. It rejects `executor: 'shell'` (inbox-only) and validates `idempotencyKey` as 1–128 bytes without NUL.
- `task_queue_enqueue_batch(specs)` enqueues up to 200 tasks in one batch. Any spec whose `executor` is `shell` rejects the whole call.
- `task_queue_list(status?, executor?, tags?, limit?)` lists summary projections, filtered by status/executor/tags and bounded by limit. Use it before enqueueing to avoid duplicate work.
- `task_queue_status(id)` returns the full durable task record, projecting the nullable `delayUntil`/`lastError`/`result` fields away so the closed output schema stays clean.
- `task_queue_cancel(id)` cancels a pending task (or requests stop of a starting/running one), returning `{ outcome: 'canceled' | 'stopping' }`.
- `task_queue_retry(id)` returns a failed task to pending (attempts reset).
- `task_queue_stats()` returns service state (`running`/`paused`/`faulted`), per-status counts, an optional fault reason, and per-executor counts. Use it at session start to see the backlog.
- `task_queue_executors()` lists the registered executors with their enabled gates and whether the model tools may submit each (`shell` is inbox-only). Call it before enqueueing to pick a valid executor.

`enqueue` and `batch` use a `execute`-kind card; `list`, `status`, and `stats` use a `read`-kind card; `cancel` and `retry` use an `execute`-kind card.

The tools surface the queue's use-when semantics: enqueue when you have three or more independent tasks, long-running work, something that may need retry, or anything that should survive the session; inline a single quick interaction instead.

## System prompt

The plugin registers one independently ordered section, `tool:task-queue` (order `107`, after `tool:jobs`):

```markdown
Use the task_queue_* tools for durable cross-session work. Enqueue a batch first, then report the queued ids — do not inline a batch of 3 or more independent tasks, long-running jobs, or anything that may need retry or should survive the session. At session start, call task_queue_stats to see the backlog, and task_queue_executors to see which executors this deployment enables. For batch LLM/script work use the node executor with a local script (prompt JSON { script, args? }); use claude/codex/opencode/arkcli only for full coding-agent jobs. Never submit shell (inbox-only). When a task is failed, report it proactively and suggest task_queue_retry. Do not re-enqueue duplicate work: call task_queue_list first to check for an existing matching task. Your responsibilities are delivery (enqueue), monitoring (list/status/stats/executors), failure triage (retry/cancel), and reporting results.
```

## Pre-step notification candidates

The pre-step hook reads the session's pending outbox notifications via `listNotifications`, sorts them by `terminalSeq`, and proposes candidate notice messages. It skips records that are already `inFlight`, whose marker is already present in the session's user messages (an append happened before the ack, e.g. a crash), or that are no longer `pending`. Each proposed message embeds a stable marker line:

```
[task-queue-notification <notificationId> <messageId>]
```

The chosen `messageId`s are marked `inFlight` so a later pre-step does not re-propose them. The hook only prepares messages — it never flushes and never acks. The agent loop appends the proposed messages after the waterfall returns; durability is asserted by the finalizer, not by this hook.

## Notification finalizer

A `session/event` listener watches `user/message` appends for the marker line. On a match the listener returns immediately (no append reentry) and starts a controlled asynchronous finalizer:

1. `await ctx.sessions.flush(session)`. If no persistence listener participates, the flush fails, or the session is no longer live, the finalizer clears the messageId from `inFlight` and leaves the notification pending — it does not ack.
2. On a successful flush, it acks with `ackNotification(notificationId, messageId)`, a CAS that only transitions a still-`pending` record with the matching message id. Ack is idempotent: an already-acknowledged record with a matching id is a no-op.

## turn/end reconciliation

On `turn/end`, the listener reconciles `inFlight`: any `messageId` that was marked but whose marker never reached a session `user/message` (a pre-step decision that was aborted or rejected before its messages appended) is cleared, so the next pre-step can propose it again. Without this, an aborted pre-step would pin the notification forever.

## Config

| key | default | meaning |
|---|---|---|
| _(none)_ | — | `Config` is an empty object; the plugin declares it for loader symmetry only |

Config values fail validation loudly at load when malformed.

## Model Experience

Indirectly, through its own registered surface — the eight `task_queue_*` tools whose canonical schemas are catalogued in [docs/tool-catalog.md](../../../docs/tool-catalog.md), the `tool:task-queue` prompt section declared above under "System prompt", and marker-bearing `user/message` notices whose durability the finalizer asserts.

#### KV Cache effect

No direct invalidation; this package owns its tool descriptions and prompt-section text, and the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **No backend, no delivery** — with no `@deepseek-ai/dsh-task-queue-local` composed, the tools reject with a clear load message and the pre-step/finalizer hooks no-op; no notifications are produced.
- **`shell` is inbox-only** — the model-facing tools can never enqueue a `shell` task, by design (authorization §6.3); only the inbox admission path may.
- **Notification at-least-once** — a crash between append and ack re-injects the notice (deduped by the stable marker), which may surface a completion twice.
