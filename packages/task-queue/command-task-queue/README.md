# @deepseek-ai/dsh-command-task-queue

English | [中文](README.zh.md)

The human-facing `/queue` slash command over `ctx.taskQueue`: `list`, `stats`, `status`, `retry`, and `cancel` — rendered directly by the dispatching UI, with no model involvement. The backend is read optionally, so the command still registers without one and reports a load-guidance error on every execution instead of resolving a half-composed service.

## Commands

- `/queue list [limit]` lists summary projections (id, status, attempt, executor, title, tags); `limit` must be a positive integer. Call it before enqueuing to avoid duplicate work.
- `/queue stats` prints the service state (`running`/`paused`/`faulted`, with the fault reason), per-status counters, and per-executor counters.
- `/queue status <id>` prints one task's full durable record (status/attempt/backoff/timeout/delay/tags/owner session/last error/result/run records).
- `/queue retry <id>` sends a failed task back to `pending` (attempts reset) and returns the new task id.
- `/queue cancel <id>` cancels a pending task, or persists a stop intent for a starting/running one (`canceled` / `stopping`).

A bare or unknown subcommand returns the usage text; a missing or invalid id returns an error; without a backend the command returns load guidance naming `@deepseek-ai/dsh-task-queue-local`.

## Contract

- Command name `queue`, registered globally (the same host-plane pattern as `command-feedback`/`command-goal`).
- `recordInput` stays at its default `true`: command input is recorded in the `command/run` lifecycle event for audit.
- This package registers no model surface; for the agent-facing toolkit use `@deepseek-ai/dsh-tool-task-queue`.

## Known limitations

- **No backend, no operations** — without `@deepseek-ai/dsh-task-queue-local` mounted, every subcommand reports the load-guidance error.
- The command only projects and controls; it never enqueues (enqueueing belongs to the model tools or the inbox admission path).
