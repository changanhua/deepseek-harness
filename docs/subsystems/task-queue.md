# Durable Cross-Session Task Queue

English | [中文](task-queue.zh.md)

The host-plane durable task queue (`ctx.taskQueue`). The design lives in [docs/specs/2026-08-14-task-queue-design.md](../specs/2026-08-14-task-queue-design.md); the contract package is [`packages/task-queue/task-queue`](../../packages/task-queue/task-queue/README.md), the durable backend is [`dsh-task-queue-local`](../../packages/task-queue/task-queue-local/README.md), and the model-facing toolkit is [`dsh-tool-task-queue`](../../packages/task-queue/tool-task-queue/README.md).

## Service

`ctx.taskQueue` is the abstract `TaskQueue` seam implemented by `LocalTaskQueue` (`@deepseek-ai/dsh-task-queue-local`). Every task-data call carries an opaque `TaskQueueAccess`: `taskQueueAgentAccess(sessionId)` restricts admission, reads, counters, notifications, and mutations to that exact owner session, while `TASK_QUEUE_HOST_ACCESS` gives trusted host-plane plugins the whole-queue view and is required for pause/resume. Ownership filtering precedes public filters and limits; unauthorized and nonexistent ids fail identically; supplied idempotency keys are namespaced by the authenticated actor. Trusted ingress is the only place `source`/`receiptId` are assigned; the scheduler is the only point that spawns processes and the only owner of live `SubprocessHandle`s. All mutations serialize through a service-level FIFO; an append/fsync failure enters the sticky `faulted` state, which `resume()` cannot clear.

## Task model and state machine

`TaskStatus` is `'pending' | 'starting' | 'running' | 'stopping' | 'succeeded' | 'failed' | 'canceled'`. The two-phase execution states (`starting` before the spawn, `running` after the pid is persisted) exist because a pid cannot be known before `ctx.subprocess.spawn` returns; `stopping` is the cancel intent persisted before termination. `attempt` increments exactly once, at claim. Failure requeues to `pending` with a backoff of `backoffMs * 2^(attempt-1)`; exhausting `maxAttempts` enters `failed`. A host crash recovers `starting`/`running` to the failure path and `stopping` to `canceled` with `terminationUnverified` — a persisted pid is diagnostic only and never a cross-restart kill token.

## Durable log

The backend keeps a single-writer segment log (`active.jsonl`, sealed `segments/<first>-<last>.jsonl`, and a validated `snapshot.json` cache). Every change is append + fsync; folding is fail-closed (strict `seq` monotonicity, task-op identity, terminal notification consistency, CAS ack semantics). Only the active segment's torn tail is repaired by truncation; sealed half-lines and invalid complete lines fault the queue.

## Executors

Executors are prepare-only adapters: each returns a `SubprocessSpawnSpec`, and the scheduler alone calls `ctx.subprocess.spawn`, owns the handle, and settles the attempt. Built-ins cover `claude`, `codex`, `opencode`, `arkcli`, and `shell`. Every executor is disabled by default and must be explicitly enabled in the host row; `shell` is inbox-only and never accepted by the model-facing tools.

## Events

`task-queue/created`, `task-queue/starting`, `task-queue/running`, `task-queue/succeeded`, `task-queue/failed`, `task-queue/requeued`, `task-queue/canceled`, `task-queue/drained`, `task-queue/orphan-unknown`, and `task-queue/faulted` — each emitted only after the corresponding change is fsynced and folded.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtaskqueue--taskqueue-abstract-seam"></a>

### `ctx.taskQueue` — `TaskQueue` (abstract seam)

Abstract durable task queue. Subclass, implement the abstract methods, and load the subclass as a plugin — it registers as `ctx.taskQueue` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior).

Task-data methods require an opaque access grant minted by this package. Agent grants see only their exact owner session; the singleton host grant is reserved for trusted host-plane consumers. Mutations are serialized through the backend's service FIFO and are fail-closed on append error (the queue enters `faulted`); `resume()` must never clear `faulted`.

```ts cordis-catalog
/**
 * Enqueue a single tool-originated task; rejects `executor: 'shell'`.
 * @param access - authenticated Agent-owner or host-plane access.
 * @param spec - the validated admission spec (source/receipt assigned by the entry).
 * @returns the minted task id.
 */
abstract enqueueFromTool(access: TaskQueueAccess, spec: EnqueueSpec): Promise<TaskId>

/**
 * Enqueue tool-originated tasks in one batch (bounded, e.g. 200).
 * @param access - authenticated Agent-owner or host-plane access.
 * @param specs - the validated admission specs; any `shell` rejects the whole batch.
 * @returns the minted task ids, in spec order.
 */
abstract enqueueBatchFromTool(access: TaskQueueAccess, specs: readonly EnqueueSpec[]): Promise<TaskId[]>

/**
 * List summary projections, filtered by status/executor/tags, bounded by limit.
 * @param access - access whose visible tasks may be returned.
 * @param filter - optional status/executor/tags filters and a result limit.
 * @returns fresh summary rows.
 */
abstract list(access: TaskQueueAccess, filter?: ListFilter): TaskSummary[]

/**
 * Return the full durable state of one task.
 * @param access - access that must be allowed to see the task.
 * @param id - the task id to look up.
 * @returns the durable task snapshot; throws for an unknown id.
 */
abstract get(access: TaskQueueAccess, id: TaskId): Task

/**
 * Cancel a task: pending → canceled; starting/running → stopping intent.
 * @param access - access that must be allowed to control the task.
 * @param id - the task id to cancel.
 * @returns `canceled` for a directly-canceled pending task, `stopping` when a cancel intent was persisted.
 */
abstract cancel(access: TaskQueueAccess, id: TaskId): Promise<'canceled' | 'stopping'>

/**
 * Retry a failed task; returns the (unchanged) task id.
 * @param access - access that must be allowed to control the task.
 * @param id - the failed task id to requeue.
 * @returns the same task id, now pending with `attempt` reset.
 */
abstract retry(access: TaskQueueAccess, id: TaskId): Promise<TaskId>

/**
 * Soft-conclude (or restore) a terminal task by toggling its `dismissed`
 * flag. Only succeeded/failed/canceled tasks may be dismissed; a non-
 * terminal task throws. Same-value dismiss is an idempotent no-op (no
 * change record, no event). The task's `status` and audit record are
 * unchanged; a dismissed task leaves the attention badge/filters but keeps
 * its record, and requeuing (retry) resets `dismissed` to false.
 * @param access - access that must be allowed to control the task.
 * @param id - the terminal task id to dismiss or restore.
 * @param dismissed - true to conclude, false to restore.
 */
abstract dismiss(access: TaskQueueAccess, id: TaskId, dismissed: boolean): Promise<void>

/**
 * Aggregate service state and per-status/per-executor counters.
 * @param access - access whose visible tasks contribute to the counters.
 * @returns the current service state, optional fault, and counters.
 */
abstract stats(access: TaskQueueAccess): QueueStats

/**
 * Register an executor adapter; returns a disposer that unregisters it.
 * @param name - the registry name tasks select with `executor`.
 * @param adapter - the prepare-only adapter producing spawn specs.
 * @returns a disposer removing exactly this registration.
 */
abstract registerExecutor(name: string, adapter: ExecutorAdapter): () => void

/**
 * List registered executors with their deployment gates. The model-facing
 * `task_queue_executors` tool projects this without exposing adapter code.
 * @returns one view per registered executor, name order.
 */
abstract listExecutors(): QueueExecutorView[]

/**
 * Pause the queue (running → paused only).
 * @param access - trusted host-plane access.
 */
abstract pause(access: TaskQueueHostAccess): void

/**
 * Resume the queue (paused → running only; faulted rejected).
 * @param access - trusted host-plane access.
 */
abstract resume(access: TaskQueueHostAccess): void

/**
 * Acknowledge a pending notification with a CAS (spec §7.4): only a
 * `pending` record whose `messageId` matches `messageId` transitions to
 * `acknowledged`. An already-acknowledged record with a matching message id
 * is an idempotent no-op.
 * @param access - access that must own the notification, or host access.
 * @param notificationId - the outbox record to acknowledge.
 * @param messageId - the stable message id the record must match.
 */
abstract ackNotification(access: TaskQueueAccess, notificationId: NotificationId, messageId: string): Promise<void>

/**
 * List visible notification outbox records ordered by `terminalSeq`
 * ascending. An Agent grant returns only its session's records; host access
 * returns the whole outbox.
 * @param access - access whose visible notifications may be returned.
 * @returns visible notification records in terminal order.
 */
abstract listNotifications(access: TaskQueueAccess): NotificationRecord[]
```

Source: [`packages/task-queue/task-queue/src/index.ts`](../../packages/task-queue/task-queue/src/index.ts)

<a id="task-queue-events"></a>

### `task-queue/*` events

<a id="task-queuecanceled--emit"></a>

#### `task-queue/canceled` — emit

A task reached the canceled terminal state.

```ts cordis-catalog
/**
 * A task reached the canceled terminal state.
 * @param payload.taskId - the canceled task id.
 * @mode emit
 */
'task-queue/canceled'(payload: { taskId: TaskId }): void
```

Source: [`packages/task-queue/task-queue/src/index.ts`](../../packages/task-queue/task-queue/src/index.ts)

<a id="task-queuecreated--emit"></a>

#### `task-queue/created` — emit

A task's `created` change committed (fsync + fold before emission).

```ts cordis-catalog
/**
 * A task's `created` change committed (fsync + fold before emission).
 * @param payload.taskId - the admitted task id.
 * @mode emit
 */
'task-queue/created'(payload: { taskId: TaskId }): void
```

Source: [`packages/task-queue/task-queue/src/index.ts`](../../packages/task-queue/task-queue/src/index.ts)

<a id="task-queuedismissed--emit"></a>

#### `task-queue/dismissed` — emit

A terminal task's `dismissed` flag was toggled (soft-conclude or restore). The task's `status` and audit record are unchanged.

```ts cordis-catalog
/**
 * A terminal task's `dismissed` flag was toggled (soft-conclude or restore).
 * The task's `status` and audit record are unchanged.
 * @param payload.taskId - the dismissed/restored task id.
 * @param payload.dismissed - the new dismissed flag value.
 * @mode emit
 */
'task-queue/dismissed'(payload: { taskId: TaskId; dismissed: boolean }): void
```

Source: [`packages/task-queue/task-queue/src/index.ts`](../../packages/task-queue/task-queue/src/index.ts)

<a id="task-queuedrained--emit"></a>

#### `task-queue/drained` — emit

The queue drained (no live starting/running/stopping work remains).

```ts cordis-catalog
/**
 * The queue drained (no live starting/running/stopping work remains).
 * @param payload.pending - the pending count at drain time.
 * @mode emit
 */
'task-queue/drained'(payload: { pending: number }): void
```

Source: [`packages/task-queue/task-queue/src/index.ts`](../../packages/task-queue/task-queue/src/index.ts)

<a id="task-queuefailed--emit"></a>

#### `task-queue/failed` — emit

A task exhausted its attempts or failed without retry.

```ts cordis-catalog
/**
 * A task exhausted its attempts or failed without retry.
 * @param payload.taskId - the failed task id.
 * @param payload.reason - the failure summary.
 * @mode emit
 */
'task-queue/failed'(payload: { taskId: TaskId; reason: string }): void
```

Source: [`packages/task-queue/task-queue/src/index.ts`](../../packages/task-queue/task-queue/src/index.ts)

<a id="task-queuefaulted--emit"></a>

#### `task-queue/faulted` — emit

The queue entered `faulted`; operator recovery or restart required.

```ts cordis-catalog
/**
 * The queue entered `faulted`; operator recovery or restart required.
 * @param payload.reason - the fault summary.
 * @mode emit
 */
'task-queue/faulted'(payload: { reason: string }): void
```

Source: [`packages/task-queue/task-queue/src/index.ts`](../../packages/task-queue/task-queue/src/index.ts)

<a id="task-queueorphan-unknown--emit"></a>

#### `task-queue/orphan-unknown` — emit

A crash left a possibly-orphaned child or an unrecognized inbox entry.

```ts cordis-catalog
/**
 * A crash left a possibly-orphaned child or an unrecognized inbox entry.
 * @param payload.taskId - the recovered task id, when known.
 * @param payload.priorStatus - the pre-recovery status, when known.
 * @param payload.reason - the diagnostic detail, when known.
 * @mode emit
 */
'task-queue/orphan-unknown'(payload: { taskId?: TaskId; priorStatus?: TaskStatus; reason?: string }): void
```

Source: [`packages/task-queue/task-queue/src/index.ts`](../../packages/task-queue/task-queue/src/index.ts)

<a id="task-queuerequeued--emit"></a>

#### `task-queue/requeued` — emit

A failed attempt requeued to pending with backoff.

```ts cordis-catalog
/**
 * A failed attempt requeued to pending with backoff.
 * @param payload.taskId - the requeued task id.
 * @param payload.reason - the failure summary.
 * @mode emit
 */
'task-queue/requeued'(payload: { taskId: TaskId; reason: string }): void
```

Source: [`packages/task-queue/task-queue/src/index.ts`](../../packages/task-queue/task-queue/src/index.ts)

<a id="task-queuerunning--emit"></a>

#### `task-queue/running` — emit

A task entered `running` (pid persisted).

```ts cordis-catalog
/**
 * A task entered `running` (pid persisted).
 * @param payload.taskId - the spawned task id.
 * @mode emit
 */
'task-queue/running'(payload: { taskId: TaskId }): void
```

Source: [`packages/task-queue/task-queue/src/index.ts`](../../packages/task-queue/task-queue/src/index.ts)

<a id="task-queuestarting--emit"></a>

#### `task-queue/starting` — emit

A task entered `starting` (attempt incremented).

```ts cordis-catalog
/**
 * A task entered `starting` (attempt incremented).
 * @param payload.taskId - the claimed task id.
 * @param payload.attempt - the attempt ordinal that just started.
 * @mode emit
 */
'task-queue/starting'(payload: { taskId: TaskId; attempt: number }): void
```

Source: [`packages/task-queue/task-queue/src/index.ts`](../../packages/task-queue/task-queue/src/index.ts)

<a id="task-queuesucceeded--emit"></a>

#### `task-queue/succeeded` — emit

A task settled successfully.

```ts cordis-catalog
/**
 * A task settled successfully.
 * @param payload.taskId - the succeeded task id.
 * @mode emit
 */
'task-queue/succeeded'(payload: { taskId: TaskId }): void
```

Source: [`packages/task-queue/task-queue/src/index.ts`](../../packages/task-queue/task-queue/src/index.ts)
<!-- END GENERATED cordis-surface -->
