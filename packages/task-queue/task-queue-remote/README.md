# Task Queue Remote

The browser panel's Host remote face over the durable task queue: a thin Typert
Remote service that exposes the read shapes (`list` / `stats` / `get`) and the
steering verbs (`cancel` / `retry` / `pause` / `resume`) of `ctx.taskQueue` as
plain JSON wire views.

The Client reaches it as `ctx.remote.taskQueue` (the wire namespace); the
Cordis service key stays `taskQueueRemote` so it never collides with the queue
backend itself. The service declares `inject: ['taskQueue']`, so it only
activates in a composition that mounts a queue backend
(`@deepseek-ai/dsh-task-queue-local`).

## Wire views

The client-safe payload vocabulary lives in the `./views` subpath, which
imports nothing from the host face — a browser program resolves it directly:

- `QueueTaskSummaryView` — one list row (status, executor, attempt, tags, owner).
- `QueueTaskView` — the full durable state (prompt, result, runs, receipt) for
  the detail panel.
- `QueueStatsView` — service state (`running` / `paused` / `faulted`), fault
  reason, and per-status / per-executor counters.
- `QueueCancelOutcomeView` — `'canceled'` (pending task) or `'stopping'`
  (cancel intent persisted for live work).

`faulted` is sticky and fail-closed: `resume` rejects it, and the UI treats it
as an operator-recovery state, never a per-task failure.

## Excluded surfaces

Enqueue, executor registration, and notification acks are deliberately not
exposed here — those belong to the tool surface
(`@deepseek-ai/dsh-tool-task-queue`) and the operator's `/queue` command
(`@deepseek-ai/dsh-command-task-queue`).

## Consumers

- `@deepseek-ai/dsh-client-ui-task-queue` — the Queue module workspace.
- `@deepseek-ai/dsh-api-remotes` — mounts the generated Remote contribution
  into the browser assembly (`ctx.remote.taskQueue`).

## Model Experience

None, as this browser panel wire face renders durable records and registers no model surface.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- Enqueue, executor registration, and notification acks are deliberately not exposed here; they belong to the tool surface and the operator's /queue command.
