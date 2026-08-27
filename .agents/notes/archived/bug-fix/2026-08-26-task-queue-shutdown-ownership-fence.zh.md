# Agent Note: 任务队列 shutdown ownership fence——drain 顺序与 FIFO key bug

Status: implemented
Archived: 2026-08-27

[English](2026-08-26-task-queue-shutdown-ownership-fence.md) | 中文

## Problem

`queueRoot` 的单写者不变式要求 `owner.lock` 覆盖所属 `LocalTaskQueue` 一切仍可能发生的 durable write。第一版 shutdown 实现从同步 disposer 里 fire-and-forget 地释放锁，留下一个竞态：Host A 释放 `owner.lock`，Host B 获取并 `recover()`，而 A 仍在途的操作（某个 detached execution 的 settle，或排队中的服务 mutation）随后在 B 恢复出的状态之上再 commit 一次 append——重复 seq、丢失更新或损坏。

后续的 fence 提交（`987b3b62b7`）加入了 drain 机制：async Cordis disposer、`disposed` 准入闸、`TaskScheduler.executing` + `drain()`、以及 `waitForMutationDrain`。对这套机制的验证暴露了第二个更深的 bug：FIFO owner key 不稳定，导致 `waitForMutationDrain(this)` 等待的 WeakMap 条目与 `runMutationTransaction(this, …)` 写入的条目不是同一个。

## Decision

### 1. Shutdown 顺序

disposer 是一个 async Cordis effect。Cordis `_unload()` 会 await 每一个 effect disposer（`await runDisposable(dispose)`），因此下述顺序是真实的 fence，而不是 fire-and-forget 意图：

1. `disposed = true`——所有公开准入/控制路径（`assertAdmitting`）拒绝新工作；`claim` 与 `spawnAndMark` 在 FIFO 内部复查 `disposed`，使已通过准入的 tick 也无法在 shutdown 之后 spawn。
2. `scheduler.stop()` + terminate 所有 live handle。
3. `await bootPromise`——boot（所有权获取、`recover`、`reclaimCrashed`）会做 durable write，锁必须活过它。
4. `await scheduler.drain()`——等待每个 tick 与 detached execution。循环在每次 await 后重新快照，因为某个 tick 可能在 `stop()` 之前刚通过 running 检查、完成一次 claim，并注册最后一个 execution。
5. `await waitForMutationDrain(fifoKey)`——等待服务 mutation FIFO 静止。循环重读 tail，因为在途操作可以在自己的 tail 清空之前入队后继。
6. `liveHandles.clear()`，然后 `ownership.release()`——只有到这一步，另一个宿主才能获取。

`runClaims` 另外在 `stop()` 与已 await 的 claim 竞态时拒绝启动新 execution（`claim()` 之后的 `if (!this.running) return`）：已持久化的 `starting` 任务留给下一个宿主的 crash recovery，绝不会在 stop 之后或锁释放之后被 spawn。

### 2. FIFO key bug 与修复

Cordis 通过 tracing proxy（`createTraceable`）暴露服务。经 `ctx.taskQueue` 调用服务方法时，方法的 `this` 被替换成每次调用独立的 shadow 对象（见 vendored Cordis 的 `createShadowMethod`），而不是所属实例。FIFO 用 `this` 作为 WeakMap key：

- 外部调用（`enqueueFromTool`、`cancel`、`ackNotification`、……）进入 `runMutationTransaction(shadow, …)`——owner = shadow。
- disposer 执行 `waitForMutationDrain(this)`，用的是真实实例——owner = instance。

两者永远不匹配，因此外部 mutation 还卡在 FIFO 里时 `waitForMutationDrain` 就立即返回了。shutdown fence 对所有面向模型的 mutation 路径静默失效（scheduler 内部路径用真实实例，不受影响）。同样的不匹配还意味着跨调用的外部 mutation 之间失去了串行化。

修复：私有 `fifoKey: object`，在构造函数里创建一次，`mutate()` 与 disposer 都用它作为 FIFO owner key。普通对象经任何 Cordis shadow 读回都解析为同一引用（它不带 tracker，`getTraceable` 原样返回），使 key 对所有调用方稳定。

### 为什么 key 用专用 token，而不是 `this.store` 或其他字段

任何经 proxy 可达且自带 tracker 的对象，每次访问都会被重新包装。不带 `symbols.tracker` 的普通对象完全绕过 `createTraceable` 并原样返回，因此 scheduler 内部（真实 `this`）、外部工具（shadow `this`）与 disposer 共享唯一一个身份。

## Consequences

- 所有权锁现在覆盖旧宿主一切可能的 durable write；第二个宿主只能在上一宿主的 boot、execution 与 FIFO mutation 全部静止之后获取。
- 外部与内部 mutation 现在共享一条 FIFO 链，恢复了 shadow `this` 不匹配所静默破坏的串行化。
- `disposed` 拒绝新准入，但不拦阻已在运行的 execution 的合法终态 settle——disposer 是 drain，不是 abort。
- 已 claim 但尚未 spawn 时 `stop()` 赢得竞态的任务在磁盘上保持 `starting`，由下一个宿主的 crash recovery 接管；绝不会在 stop 之后或锁释放之后被 spawn。

## Testing

- `packages/task-queue/task-queue-local/tests/shutdown-ownership.spec.ts`（新建，4 个测试）：running execution 尚在 settle 时持有 `owner.lock`、仅当 dispose 完成后才释放；在途 FIFO mutation（gate 住的 `created` append）完成前不释放所有权——该测试在没有 `fifoKey` 修复时失败；dispose 后拒绝一切公开 mutation 同时放行在途 settle；owner handoff 保留持久状态（status/result/runs/ownerSessionId/attempt 与 notification 一致、seq 严格连续、无重复 seq）。
- `packages/task-queue/task-queue-local/tests/fifo.spec.ts` 验证 shutdown drain 会继续等待在途 operation 入队的 successor，而不是在原 tail 完成后过早返回。
- `packages/task-queue/task-queue-local/tests/scheduler.spec.ts`（+2 个测试）：stop 与已 await 的 claim 竞态时绝不 spawn 或 prepare；`drain()` 在已停止的 tick 与其 execution 全部落定后 resolve。
- `packages/task-queue/tool-task-queue/tests/vertical-integration.spec.ts`（新建，2 个测试）：黄金纵向链路——真实 LocalTaskQueue + LocalSubprocessRuntime + 工具入队绑定 `ownerSessionId`，任务 settle 出 summary，为 owner session 生成持久通知，pre-step 注入带 outcome summary 的 marker 消息，session append 驱动 flush → CAS ack，通知转 acknowledged，第二次 pre-step 不再注入；append-before-ack 恢复——marker 已持久在 session 而通知仍 pending 时不重复注入，但仍由 pre-step 启动的 finalizer 完成 flush 与 CAS ack。

## Alternatives considered

**继续用 `this` 作为 FIFO key 并接受不匹配。** 拒绝：shutdown fence 对所有外部 mutation 路径静默失效，外部 mutation 的跨调用串行化丢失；两者都已被修复前的 FIFO-fence 测试失败所实证。

**在构造时把所有方法 bind 到实例。** 拒绝：侵入面大，且与 proxy tracing 层为代码库其余部分所做的行为重复。

**用 store 而不是 token 作为等待对象。** 拒绝：`this.store` 经 shadow 读出同样被重新包装；只有不带 tracker 的普通对象才是稳定的。
