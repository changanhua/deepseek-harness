# Agent Note: Task-queue shutdown ownership fence — drain ordering and the FIFO key bug

Status: implemented
Archived: 2026-08-27

English | [中文](2026-08-26-task-queue-shutdown-ownership-fence.zh.md)

## Problem

The single-writer invariant for `queueRoot` requires that the `owner.lock` covers every possible durable write the owning `LocalTaskQueue` can still make. The first shutdown implementation released the lock fire-and-forget from a synchronous disposer, which left a race: Host A could release `owner.lock`, Host B could acquire it and `recover()`, and a still-in-flight A operation (a detached execution's settle, or a queued service mutation) could then commit one more append on top of B's recovered state — duplicate seq, lost update, or corruption.

The follow-up fence commit (`987b3b62b7`) added the drain machinery: an async Cordis disposer, `disposed` admission fence, `TaskScheduler.executing` + `drain()`, and `waitForMutationDrain`. Verification of that machinery exposed a second, deeper bug: the FIFO owner key was not stable, so `waitForMutationDrain(this)` waited on a different WeakMap entry than the one `runMutationTransaction(this, …)` wrote.

## Decision

### 1. Shutdown ordering

The disposer is an async Cordis effect. Cordis `_unload()` awaits every effect disposer (`await runDisposable(dispose)`), so the ordering below is a real fence, not a fire-and-forget intent:

1. `disposed = true` — every public admission/control path (`assertAdmitting`) rejects new work; `claim` and `spawnAndMark` re-check `disposed` inside the FIFO so a tick that already passed admission cannot spawn after shutdown.
2. `scheduler.stop()` + terminate all live handles.
3. `await bootPromise` — boot (ownership acquisition, `recover`, `reclaimCrashed`) performs durable writes, so the lock must outlive it.
4. `await scheduler.drain()` — waits for every tick and detached execution. The loop re-snapshots after each await because a tick can pass its `running` check just before `stop()`, complete a claim, and register one final execution.
5. `await waitForMutationDrain(fifoKey)` — waits for the service mutation FIFO to quiesce. The loop re-reads the tail because an in-flight operation can enqueue a successor before its own tail clears.
6. `liveHandles.clear()`, then `ownership.release()` — only now can another host acquire.

`runClaims` additionally refuses to launch a new execution when `stop()` raced the awaited claim (`if (!this.running) return` after `claim()`): the persisted `starting` task is left for the next owner's crash recovery, never spawned post-stop.

### 2. The FIFO key bug and fix

Cordis exposes services through a tracing proxy (`createTraceable`). Calling a service method through `ctx.taskQueue` replaces the method's `this` with a per-call shadow object (see `createShadowMethod` in vendored Cordis), not the owning instance. The FIFO used `this` as its WeakMap key:

- External calls (`enqueueFromTool`, `cancel`, `ackNotification`, …) entered `runMutationTransaction(shadow, …)` — owner = shadow.
- The disposer ran `waitForMutationDrain(this)` with the real instance — owner = instance.

The two never matched, so `waitForMutationDrain` returned immediately while an external mutation was still stalled in the FIFO. The shutdown fence silently failed for every model-facing mutation path (scheduler-internal paths used the real instance and were unaffected). The same mismatch also meant external mutations were not serialized against each other across separate calls.

Fix: a private `fifoKey: object` created once in the constructor and used as the FIFO owner key by both `mutate()` and the disposer. A plain object read back through any Cordis shadow resolves to the same reference (it carries no tracker, so `getTraceable` returns it unchanged), which makes the key stable for every caller.

### Why the key is a dedicated token, not `this.store` or another field

Any object reachable through the proxy that itself carries a tracker would be re-wrapped per access. A plain object without `symbols.tracker` bypasses `createTraceable` entirely and returns identical, so exactly one identity is shared by scheduler internals (real `this`), external tools (shadow `this`), and the disposer.

## Consequences

- The ownership lock now outlives every possible old-owner durable write; a second host can only acquire after the previous host's boot, executions, and FIFO mutations have all quiesced.
- External and internal mutations now share one FIFO chain, restoring serialization that the shadow `this` mismatch had silently broken.
- `disposed` rejects new admission but does not block the legal terminal settle of an already-running execution — the disposer drains, it does not abort.
- A task claimed but not yet spawned when `stop()` wins the race stays `starting` on disk and is reclaimed by the next owner's crash recovery; it is never spawned after stop or after lock release.

## Testing

- `packages/task-queue/task-queue-local/tests/shutdown-ownership.spec.ts` (new, 4 tests): holds `owner.lock` while a running execution is settling and releases only after disposal completes; waits for an in-flight FIFO mutation (gated `created` append) before releasing ownership — this test fails without the `fifoKey` fix; rejects every public mutation once disposed while letting an in-flight settle finish; owner handoff preserves durable state (status/result/runs/ownerSessionId/attempt and notification identical, seq strictly contiguous, no duplicate seq).
- `packages/task-queue/task-queue-local/tests/fifo.spec.ts` verifies that the shutdown drain follows a successor enqueued by an operation already in flight instead of returning after the original tail.
- `packages/task-queue/task-queue-local/tests/scheduler.spec.ts` (+2 tests): stop racing an awaited claim never spawns or prepares; `drain()` resolves once the stopped tick and its executions settle.
- `packages/task-queue/tool-task-queue/tests/vertical-integration.spec.ts` (new, 2 tests): the golden vertical loop — real LocalTaskQueue + LocalSubprocessRuntime + tool enqueue binds `ownerSessionId`, the task settles with a summary, a durable notification for the owner session is created, the pre-step injects a marker-bearing message with the outcome summary, the session append drives flush → CAS ack, the notification is acknowledged, and a second pre-step injects nothing; append-before-ack recovery — a marker already durable in the session with the notification still pending is not re-injected but is still flushed and CAS-acked by the pre-step-launched finalizer.

## Alternatives considered

**Keep `this` as the FIFO key and accept the mismatch.** Rejected: the shutdown fence silently fails for every external mutation path, and cross-call serialization of external mutations is lost; both were demonstrated by the failing FIFO-fence test before the fix.

**Bind every method to the instance at construction.** Rejected: broad, invasive, and duplicates what the proxy tracing layer already does for the rest of the codebase.

**Wait on the store instead of a token.** Rejected: `this.store` read through a shadow is re-wrapped the same way; only a tracker-free plain object is stable.
