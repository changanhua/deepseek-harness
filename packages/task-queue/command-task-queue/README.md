# @deepseek-ai/dsh-command-task-queue

English | [中文](README.zh.md)

The human-facing `/queue` slash command over `ctx.taskQueue`: `list`, `stats`, `status`, `retry`, `cancel`, `pause`, and `resume`, rendered directly by the dispatching UI with no model involvement. The backend is read optionally, so the command still registers without one and reports that Queue v2 is not mounted instead of capturing a half-composed service.

## Commands

- `/queue list [limit]` lists Work id, status, attempt count and limit, WorkKind, and title; `limit` must be a positive integer.
- `/queue stats` prints counts for queued, starting, running, unknown, succeeded, failed, and canceled WorkItems.
- `/queue status <id>` prints the list summary plus creation/update timestamps and the current structured failure message when present.
- `/queue retry <id>` authorizes another attempt for an existing failed WorkItem and preserves its durable identity and attempt history.
- `/queue cancel <id>` cancels queued work atomically or records cancellation intent for starting/running work before requesting live cancellation.
- `/queue pause` and `/queue resume` stop or restart dispatch; admission and operator inspection remain available while paused.

A bare or unknown subcommand returns the usage text; a missing or invalid id returns an error; without a backend every subcommand reports that Queue v2 is not mounted.

## Contract

- Command name `queue`, registered globally (the same host-plane pattern as `command-feedback`/`command-goal`).
- `recordInput` stays at its default `true`: command input is recorded in the `command/run` lifecycle event for audit.
- This package registers no model surface; for the agent-facing toolkit use `@deepseek-ai/dsh-tool-task-queue`.

## Model Experience

None, as the human-facing /queue command renders records directly and registers no model surface.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **No backend, no operations** — without a `ctx.taskQueue` Provider mounted, every subcommand reports that Queue v2 is unavailable.
- The command exposes the trusted operator facade but does not admit WorkItems or resolve unknown outcomes; WorkKind Consumers own admission and Remote/UI own the restricted unknown-resolution flow.
