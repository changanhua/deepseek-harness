# @deepseek-ai/dsh-task-queue-local

[English](README.md) | 中文

typed Queue v2 `ctx.taskQueue` 服务的本地持久 Provider。`LocalTaskQueue` 持有一个 schema-versioned Queue root、准入、派发、attempt 生命周期与 operator facade。WorkKind 包通过服务注册 `WorkHandler`，不持有持久 scheduler 或 attachment 存储。

## 持久状态

配置的 `queueRoot` 包含带 `schemaVersion: 3` 的 `manifest.json`、append-only `active.jsonl`、可选的 digest-checked `snapshot.json` 与 owner lock。Provider 会取得独占所有权并完成 orphan recovery，然后 Cordis service plugin 才可用。因此，`await ctx.plugin(LocalTaskQueue, config)` 之后同步调用 `list()` 或 `get()` 会读取已恢复 projection。live owner 会拒绝第二个 host；stale owner lock 在接管前移入 quarantine。其他 schema 版本会被拒绝，不会被解码或迁移。

每个持久 mutation 都是一个 `ChangeSet`。准入会在派发前持久化 caller intent、resolved facts、Handler 推导的重试 policy 与已校验的 resource claims。local transaction FIFO 串行化最终 receipt 复查和 append，而 `WorkHandler.resolveAdmission()` 与 `prepare()` 在 FIFO 外执行。Agent 与 operator 准入使用互不重叠的幂等 namespace；operator work 没有 owner，不能产生 Session Notification。Batch 幂等 digest 覆盖 WorkKind、有序 items、shared payload 与 `maxParallel`；复用 key 时任一 Batch-shaping input 改变都会冲突。启动时会先把持久化的 `starting` 和 `running` Attempt 转为带 pending Attention 的 `unknown`，再派发。

如果 `WorkHandler.start()` 已返回 live ownership，但随后 `attempt/running` append 失败，Provider 会立即请求取消，并在 `shutdownTimeoutMs` 内同时等待 cancellation 与 live settlement，随后再记录带 Attention 的 `unknown`。如果第一次 unknown append attempt 在 commit 前失败，Provider 会重试一次；重试成功时，首次失败会保留在持久 diagnostic 中。`start()` 之后的异常绝不能回退到 pre-start 的 `not-started` 自动重试路径；live settlement rejection 或 terminal append failure 在当前持久状态允许时也会保守地解析为 unknown。关闭流程使用同一个 quiescence bound。deadline 之后，Queue 会保留持久不确定性，但会释放进程内 handle 和 scheduling claim；operator 在授权另一次 Attempt 前必须确认外部已 quiescent。跨越 side-effect boundary 后，Queue 绝不猜测 terminal outcome。

## 调度

Handler 声明 `ResourceClaim`，准入会拒绝未在部署 `resourceCapacity` 声明的 claim。`maxConcurrent`、持久化 resource claims 与 Batch 的 `maxParallel` 共同限制派发；未使用的 host capacity 仍可供其他符合条件的 Batch 使用。`pause()` 会全局暂停所有新派发：读取、准入、取消、acknowledgement 与受限 unknown resolution 仍可用。

Staged handler registration 也允许 admission 与 receipt lookup，但只有它自己的 `activate()` 才会开放 claim。在 activation 前 disposal 会让 queued Work 保持无 Attempt。claim 之后的 disposal 只会中止该精确 registration 仍处于 `start()` 之前的 execution；preparation 返回后，aborted check 会记录 cancellation，而不会调用 `start()`。Disposal 不会扩张为取消已经 live 的 Attempt。

## 配置

| key | 默认值 | 含义 |
|---|---|---|
| `queueRoot` | 必填 | 隔离的 schema-v3 Queue root |
| `maxConcurrent` | `8` | prepared 或 live attempt 的最大数量 |
| `shutdownTimeoutMs` | `5000` | teardown 或 post-start durability cleanup 在记录 unknown 前等待 execution quiescence 的时间 |
| `resourceCapacity` | `{}` | handler claim 可用的资源 units |

shipped base composition 使用 `$DSH_HOME/task-queue-v3`、全局并发 `3`、image-generation capacity `3` 与 agent-run capacity `1`。

## 模型体验

间接通过拥有准入 schema 与结果的 [`dsh-tool-task-queue`](../tool-task-queue/README.zh.md) 及 WorkKind 专属工具产生影响。

#### KV Cache 影响

不直接失效；模型可见变更由上述工具持有。

## 已知限制与延后工作

- Provider 只接受 schema-v3 root，不提供早期 schema 的 decoder 或 migrator。
- `unknown` 有意保持非终态，不能自动重试。
- owner lock 是 local-host coordination，不是 multi-host scheduling。
