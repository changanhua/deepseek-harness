# Agent Note: Task-queue P0 business closure — owner, notifications, TaskOutcome, ownership lock, and authorization

Status: implemented

English | [中文](2026-08-26-task-queue-p0-business-closure.zh.md)

## Problem

An implementation review of the task-queue on current master identified four P0 defects, plus three additional gaps surfaced during a follow-up coherence review:

1. **Tool-enqueued tasks lost their owner session.** `task_queue_enqueue` and `task_queue_enqueue_batch` admitted tasks without `ownerSessionId`, so `commitTerminal` never created a notification and task results were never delivered back to the calling session.
2. **The append-before-ack crash window left notifications pinned.** The pre-step hook filtered out candidates whose marker was already present in the session — but never started the finalizer, so a persisted notification whose message was appended before the ack persisted was stuck in `pending` forever.
3. **`TaskResult.durationMs` was always `0` and the result carried no stdout/stderr/logPath.** The Agent had no consumable work output from `task_queue_status` beyond an exit code.
4. **`TaskQueueStore` assumed single-writer without cross-process mutual exclusion.** A second host on the same `queueRoot` would `recover()` the log and then `reclaimCrashed()` the first host's live starting/running tasks as crash leftovers.
5. **`TaskResult` was too process-oriented, not an Agent-consumable work outcome.** The result lacked a human-readable `summary` and the executor adapter had no normalization seam to produce one.
6. **`ownerSessionId` was a routing field, not an authorization boundary.** Other sessions could cancel, retry, or dismiss any task regardless of ownership.
7. **Notification messages carried only a status, not the outcome.** The Agent had to make an extra `task_queue_status` round-trip to learn what the task produced.

## Decision

### 1. Owner session binding

`dsh-tool-task-queue` derives an opaque access grant from `exec.agent?.session.id` and passes it to `enqueueFromTool` or `enqueueBatchFromTool`. The Service binds an Agent grant's exact session as `ownerSessionId`; `validateEnqueueSpec` also excludes the field from model input. A host-plane dispatch uses explicit host access and may produce an ownerless task that generates no notification. The placement and access contract are owned by [the Service authorization note](../architecture/2026-08-26-task-queue-service-authorization.md).

The downstream `createTask` and `commitTerminal` already had the `ownerSessionId ?? null` and `ownerSessionId === null → no notification` logic; no changes were needed there.

### 2. Append-before-ack crash recovery

The pre-step hook no longer silently skips candidates whose marker is already in the session. Instead, when it finds a pending notification whose marker already exists in the session's user messages, it adds the `messageId` to `inFlight` and immediately calls `finalize(session, notificationId, messageId)` — the same flush→CAS finalizer the `session/event` listener uses. The finalizer's CAS ack is idempotent: an already-acknowledged notification is a no-op. Uninjected candidates are unaffected and follow the normal inject→append→observe→finalize path.

### 3. TaskResult enrichment

`TaskResult` gained three optional fields: `logPath` (this attempt's run log), `stdoutTail` (last 4 KiB of stdout, UTF-8 safe), and `stderrTail` (last 4 KiB of stderr). `durationMs` changed from `0` to the actual wall-clock span computed from `actualStartedAt`. `outputFiles` lists top-level artifacts in the output directory. All new fields are optional, so no existing snapshot or schema validation is broken. The full output stays in the run log and output directory; the tails are an Agent-consumable projection only.

### 4. Cross-process single-writer ownership lock

`lock.ts` exports `acquireQueueOwnership(root)`, which writes a complete `owner.lock` temporary file, fsyncs it, and atomically `link(2)` creates it at the queue root. The lock file carries `{version, pid, bootId, hostname, acquiredAt}`. A failed link reads the existing lock: a live pid (or same process) refuses startup; a dead pid is archived to `quarantine/` and one retry is attempted. A different hostname always refuses. `LocalTaskQueue.boot()` calls `acquireQueueOwnership` before `store.recover()` and `reclaimCrashed()`, so a second host is refused before it can read the durable log. The lock is released on teardown (best-effort); a leftover file is recovered by the stale-takeover path on the next acquire.

### Why `link(2)` instead of `flock`

Node.js does not expose `flock()`. `proper-lockfile` and similar libraries use `rename` or `open('wx')`, but on Windows `rename` overwrites an existing target with POSIX semantics that NTFS does not guarantee. `link(2)` is atomic on NTFS (a hard link cannot overwrite an existing target) and requires no extra dependency.

### Why no heartbeat in the lock

A heartbeat introduces timers and extra I/O. Pid-liveness with `kill(pid, 0)` is sufficient for single-machine scenarios: the OS reclaims the pid when the process dies, and `bootId` (a UUID) distinguishes different sessions even if the pid is reused.

### Why TaskResult carries tails, not full output

Full stdout can be large (up to 256 KiB × 2 streams per the collect cap). Writing it into a change record would bloat the durable log and snapshot. A 4 KiB tail is enough for the Agent to decide whether the task produced useful output; the complete output is always available in the run log and output directory.

### Superseded owner-binding placement

The original P0 closure bound the owner in the tool wrapper because tool and inbox admission have different ownership semantics. That placement is superseded by [Service authorization](../architecture/2026-08-26-task-queue-service-authorization.md): the caller now supplies an explicit Agent or host grant, and the Service resolves owned versus ownerless admission without depending on the Agent lifecycle.

### 5. TaskOutcome: summary and normalize seam

`TaskResult` gained a required `summary` field — a human-readable one-liner the owner Agent can consume directly from the notification, without an extra `task_queue_status` round-trip. `assistantText` is an optional field for coding-agent executors (DSH/Claude/Codex) that produce semantic results.

`ExecutorAdapter` gained an optional `normalize(task, stdout, stderr)` method that produces `{ summary, assistantText? }`. The scheduler calls it on exit code 0; when the adapter omits it, the scheduler generates a sensible default summary from the exit code, duration, tail presence, and output file count (e.g. "exit 0, 3.2s, stdout captured, 2 output files").

### 6. Owner authorization on cancel / retry / dismiss

Every task-data Service operation now requires opaque Agent-owner or host access. Agent access is restricted to an exact `ownerSessionId`; host access can operate on owned and ownerless tasks. Missing and unauthorized ids fail identically.

The Service enforces the rule for admission, list/status/stats, cancel/retry/dismiss, and notification list/ack. The tool wrapper only derives access from trusted execution metadata; command and Remote consumers pass explicit host access. See [the superseding authorization decision](../architecture/2026-08-26-task-queue-service-authorization.md).

### 7. Notification outcome summary

The notification message now includes the task's outcome `summary` when the task succeeded with one. The pre-step hook extracts `task.result.summary` from the task record and passes it through `NotificationCandidate` to `renderNotification`. The message format changed from:

```
Background task "X" reached succeeded.
Inspect it with task_queue_status, or retry with task_queue_retry if it failed.
```

to:

```
Background task "X" reached succeeded.
Outcome: exit 0, 3.2s, stdout captured, 2 output files
Inspect it with task_queue_status for details.
```

Failed tasks omit the `Outcome:` line since they have no `result`.

## Alternatives considered

**Inject `ownerSessionId` inside `enqueueFromTool` instead of the tool layer.** The original P0 change rejected this because a raw session id would couple the service to the Agent lifecycle and tool/inbox callers have different semantics. [Service authorization](../architecture/2026-08-26-task-queue-service-authorization.md) later superseded that placement with an opaque Agent-or-host grant, preserving the caller distinction without passing a synthetic session.

**Use `flock` or `proper-lockfile` for the cross-process lock.** Rejected because `flock` is not exposed by Node.js and `proper-lockfile`'s `rename`-based approach does not guarantee atomicity on Windows NTFS. `link(2)` is a single syscall with the right semantics on every platform the queue runs on.

**Include full stdout/stderr in `TaskResult`.** Rejected because the durable change record is not the right place for unbounded output. The run log already preserves the complete output; the tails are a diagnostic snapshot.

**Re-inject the already-appended message in the append-before-ack case.** Rejected because it would produce a duplicate notice in the session. The marker is stable and the CAS ack is idempotent, so starting the finalizer directly is both correct and non-duplicating.

**Push owner authorization into the Service seam.** Originally deferred because the Service received plain ids and a raw session parameter would force host callers to synthesize identity. This alternative was later adopted in a different form: [the superseding decision](../architecture/2026-08-26-task-queue-service-authorization.md) uses a closed Agent-or-host access grant and requires every direct consumer to propagate it.

**Make `summary` optional with a default.** Rejected. Every `succeeded` task should produce a human-readable summary; a default is always generated when the adapter omits `normalize`, so `summary` is never absent in practice. Making it optional would hide the invariant that every succeeded task has a summary.

## Consequences

- Tool-enqueued tasks now carry their owner session and produce notifications on terminal transitions. Inbox tasks remain ownerless and silent.
- The append-before-ack crash window is closed: a notification whose message was appended before the ack persisted is handed to the finalizer in the next pre-step and consumed without a duplicate.
- `task_queue_status` now returns a meaningful `durationMs`, a `logPath` for audit, consumable output tails, and a human-readable `summary`. The Agent can inspect task results without reading the run log.
- A second host process on the same `queueRoot` is refused before it can read the durable log, preventing the silent corruption of live tasks. The lock is released on teardown and recovered by the stale-takeover path.
- The same-process re-entry that the original `lock.ts` would have silently taken over (treating its own lock as stale) is now explicitly refused.
- `ExecutorAdapter` now has a `normalize` seam that turns raw process output into an Agent-consumable outcome. The scheduler generates a sensible default when the adapter omits it.
- Notification messages now include the outcome `summary` for succeeded tasks, so the owner Agent can consume the result without an extra `task_queue_status` round-trip.
- The Service enforces owner authorization across reads, counters, mutations, notifications, and admission. Agent callers see only their own tasks; explicit host consumers retain whole-queue access. The exact access decision lives in [the Service authorization note](../architecture/2026-08-26-task-queue-service-authorization.md).

## Testing

- `packages/task-queue/tool-task-queue/tests/index.spec.ts` (44 tests): the append-before-ack test verifies the finalizer is started (flush called, ack completed, inFlight cleared). Admission tests verify owner binding on `enqueue`, `enqueue_batch`, and host-plane dispatch; authorization tests verify scoped list/status/stats plus owner and host mutations through Service access; notification summary tests verify the outcome line.
- `packages/task-queue/task-queue-local/tests/lock.spec.ts` (7 tests): first acquire, second-acquire refusal, unreadable content, cross-host refusal, live-pid refusal, stale-takeover, and release-then-reacquire.
- `packages/task-queue/task-queue-local/tests/lifecycle.spec.ts` (9 tests): a real `node` task produces stdout, stderr, and an output file, and asserts `summary` matches the expected pattern, `durationMs > 0`, `logPath` matches, `stdoutTail`/`stderrTail` contain the expected strings, and `outputFiles` lists the artifact.
