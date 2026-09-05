# Task Queue Remote

English | [中文](README.zh.md)

Host Remote for the Queue v2 operator facade. The generated browser namespace is `ctx.remote.taskQueue`; the Cordis service key remains `taskQueueRemote` so it does not collide with the Queue provider.

## Remote methods

- `snapshot(input)` returns aggregate status counters, bounded WorkItem rows, and optional selected detail from one operator read. Each row includes the four-state operator projection (`queued`, `running`, `attention`, `done`) and a terminal outcome when done. An omitted limit still accepts an empty Queue.
- `cancel(id)` requests cancellation of one WorkItem.
- `retry(id)` retries one failed WorkItem.
- `resolveUnknown(id, resolution)` applies one restricted operator decision to an unknown attempt. Browser input can authorize another attempt or confirm failure; it cannot reconcile live ownership or supply an unverified success result.
- `pause()` and `resume()` control dispatch without disabling admission or operator actions.

The `./views` export owns JSON-compatible browser types: `QueueWorkSummaryView`, `QueueWorkAttemptView`, `QueueWorkView`, `QueueStatsView`, `QueueSnapshotInput`, `QueueSnapshotView`, and `QueueUnknownResolutionInput`. Result output is canonicalized before it crosses the Remote transport.

## Consumers

- `@changanhua/dsh-client-ui-task-queue` renders the Queue workbench.
- `@deepseek-ai/dsh-api-remotes` mounts the generated Remote contribution.

## Model Experience

None, as this browser Remote transports Queue records and registers no model surface.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- The Remote exposes operator reads, cancellation, retry, unknown resolution, and dispatch pause control; admission remains on typed host and model-tool entry points.
- Bulk UI actions currently issue one Remote mutation per WorkItem and refresh once afterward.
