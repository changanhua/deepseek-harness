# 跨会话持久任务队列

[English](task-queue.md) | 中文

host 平面的持久任务队列（`ctx.taskQueue`）。设计见 [docs/specs/2026-08-14-task-queue-design.md](../specs/2026-08-14-task-queue-design.md)；契约包是 [`packages/task-queue/task-queue`](../../packages/task-queue/task-queue/README.md)，持久后端是 [`dsh-task-queue-local`](../../packages/task-queue/task-queue-local/README.md)，模型面工具集是 [`dsh-tool-task-queue`](../../packages/task-queue/tool-task-queue/README.md)。

## Service

`ctx.taskQueue` 是由 `LocalTaskQueue`（`@deepseek-ai/dsh-task-queue-local`）实现的抽象 `TaskQueue` seam。受信入口（`enqueueFromTool`、inbox 扫描）是唯一分配 `source`/`receiptId` 的地方；调度器是唯一 spawn 进程的点、也是 live `SubprocessHandle` 的唯一持有者。所有 mutation 都经服务级 FIFO 串行化；append/fsync 失败进入粘滞的 `faulted` 状态，`resume()` 无法清除。

## 任务模型与状态机

`TaskStatus` 是 `'pending' | 'starting' | 'running' | 'stopping' | 'succeeded' | 'failed' | 'canceled'`。两阶段执行态（`starting` 在 spawn 之前、`running` 在 pid 持久化之后）存在的原因：pid 在 `ctx.subprocess.spawn` 返回前不可知；`stopping` 是终止之前持久化的取消意图。`attempt` 只在领取时递增一次。失败回 `pending`，退避 = `backoffMs * 2^(attempt-1)`；耗尽 `maxAttempts` 进入 `failed`。宿主崩溃时 `starting`/`running` 走失败路径恢复，`stopping` 恢复为 `canceled` 并标 `terminationUnverified`——持久化 pid 只作诊断，绝不是跨重启的终止授权。

## 持久日志

后端维护单写者 segment 日志（`active.jsonl`、封段 `segments/<first>-<last>.jsonl`、带校验的 `snapshot.json` 缓存）。每个 change 都是 append + fsync；折叠是 fail-closed 的（严格 `seq` 单调、任务 op 身份、终态通知一致性、CAS ack 语义）。只有 active 段的撕裂尾部可以截断修复；封段半行与非法完整行会让队列进入 faulted。

## 执行器

执行器是 prepare-only 适配器：每个只返回 `SubprocessSpawnSpec`，由调度器单独调用 `ctx.subprocess.spawn`、持有 handle 并结算该 attempt。内置 `claude`、`codex`、`opencode`、`arkcli` 与 `shell`。每个执行器默认禁用，必须在 host 行显式启用；`shell` 仅限 inbox，模型面工具永不接受。

## 事件

`task-queue/created`、`task-queue/starting`、`task-queue/running`、`task-queue/succeeded`、`task-queue/failed`、`task-queue/requeued`、`task-queue/canceled`、`task-queue/drained`、`task-queue/orphan-unknown` 与 `task-queue/faulted`——每个都在对应 change 完成 fsync 并折叠后才发布。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtaskqueue--taskqueue-abstract-seam"></a>

### `ctx.taskQueue` — `TaskQueue` (abstract seam)

Abstract durable task queue. Subclass, implement the abstract methods, and load the subclass as a plugin — it registers as `ctx.taskQueue` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior).

Mutations are serialized through the backend's service FIFO and are fail-closed on append error (the queue enters `faulted`); `resume()` must never clear `faulted`. `source`/`receiptId` are assigned only by the trusted entry points, so the tool-surface methods accept a spec without them.

```ts cordis-catalog
/**
 * Enqueue a single tool-originated task; rejects `executor: 'shell'`.
 * @param spec - the validated admission spec (source/receipt assigned by the entry).
 * @returns the minted task id.
 */
abstract enqueueFromTool(spec: EnqueueSpec): Promise<TaskId>

/**
 * Enqueue tool-originated tasks in one batch (bounded, e.g. 200).
 * @param specs - the validated admission specs; any `shell` rejects the whole batch.
 * @returns the minted task ids, in spec order.
 */
abstract enqueueBatchFromTool(specs: EnqueueSpec[]): Promise<TaskId[]>

/**
 * List summary projections, filtered by status/executor/tags, bounded by limit.
 * @param filter - optional status/executor/tags filters and a result limit.
 * @returns fresh summary rows.
 */
abstract list(filter?: ListFilter): TaskSummary[]

/**
 * Return the full durable state of one task.
 * @param id - the task id to look up.
 * @returns the durable task snapshot; throws for an unknown id.
 */
abstract get(id: TaskId): Task

/**
 * Cancel a task: pending → canceled; starting/running → stopping intent.
 * @param id - the task id to cancel.
 * @returns `canceled` for a directly-canceled pending task, `stopping` when a cancel intent was persisted.
 */
abstract cancel(id: TaskId): Promise<'canceled' | 'stopping'>

/**
 * Retry a failed task; returns the (unchanged) task id.
 * @param id - the failed task id to requeue.
 * @returns the same task id, now pending with `attempt` reset.
 */
abstract retry(id: TaskId): Promise<TaskId>

/**
 * Soft-conclude (or restore) a terminal task by toggling its `dismissed`
 * flag. Only succeeded/failed/canceled tasks may be dismissed; a non-
 * terminal task throws. Same-value dismiss is an idempotent no-op (no
 * change record, no event). The task's `status` and audit record are
 * unchanged; a dismissed task leaves the attention badge/filters but keeps
 * its record, and requeuing (retry) resets `dismissed` to false.
 * @param id - the terminal task id to dismiss or restore.
 * @param dismissed - true to conclude, false to restore.
 */
abstract dismiss(id: TaskId, dismissed: boolean): Promise<void>

/**
 * Aggregate service state and per-status/per-executor counters.
 * @returns the current service state, optional fault, and counters.
 */
abstract stats(): QueueStats

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
 */
abstract pause(): void

/**
 * Resume the queue (paused → running only; faulted rejected).
 */
abstract resume(): void

/**
 * Acknowledge a pending notification with a CAS (spec §7.4): only a
 * `pending` record whose `messageId` matches `messageId` transitions to
 * `acknowledged`. An already-acknowledged record with a matching message id
 * is an idempotent no-op.
 * @param notificationId - the outbox record to acknowledge.
 * @param messageId - the stable message id the record must match.
 */
abstract ackNotification(notificationId: NotificationId, messageId: string): Promise<void>

/**
 * List notification outbox records for one owner session, ordered by
 * `terminalSeq` ascending. The pre-step hook consumes this to propose
 * candidate notice messages (spec §7.4 step 4).
 * @param filter.ownerSessionId - the session whose outbox records to list.
 * @returns the session's notification records in terminal order.
 */
abstract listNotifications(filter: { ownerSessionId: string }): NotificationRecord[]
```

Source: [`packages/task-queue/task-queue/src/index.ts:167`](../../packages/task-queue/task-queue/src/index.ts)

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

Source: [`packages/task-queue/task-queue/src/index.ts:124`](../../packages/task-queue/task-queue/src/index.ts)

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

Source: [`packages/task-queue/task-queue/src/index.ts:85`](../../packages/task-queue/task-queue/src/index.ts)

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

Source: [`packages/task-queue/task-queue/src/index.ts:132`](../../packages/task-queue/task-queue/src/index.ts)

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

Source: [`packages/task-queue/task-queue/src/index.ts:138`](../../packages/task-queue/task-queue/src/index.ts)

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

Source: [`packages/task-queue/task-queue/src/index.ts:111`](../../packages/task-queue/task-queue/src/index.ts)

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

Source: [`packages/task-queue/task-queue/src/index.ts:152`](../../packages/task-queue/task-queue/src/index.ts)

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

Source: [`packages/task-queue/task-queue/src/index.ts:146`](../../packages/task-queue/task-queue/src/index.ts)

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

Source: [`packages/task-queue/task-queue/src/index.ts:118`](../../packages/task-queue/task-queue/src/index.ts)

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

Source: [`packages/task-queue/task-queue/src/index.ts:98`](../../packages/task-queue/task-queue/src/index.ts)

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

Source: [`packages/task-queue/task-queue/src/index.ts:92`](../../packages/task-queue/task-queue/src/index.ts)

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

Source: [`packages/task-queue/task-queue/src/index.ts:104`](../../packages/task-queue/task-queue/src/index.ts)
<!-- END GENERATED cordis-surface -->
