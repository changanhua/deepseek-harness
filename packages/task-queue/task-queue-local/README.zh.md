# @deepseek-ai/dsh-task-queue-local

[English](README.md) | 中文

typed Queue v2 `ctx.taskQueue` 服务的本地持久 Provider。`LocalTaskQueue` 持有一个 schema-versioned Queue root、准入、派发、attempt 生命周期与 operator facade。WorkKind 包通过服务注册 `WorkHandler`，不持有持久 scheduler 或 attachment 存储。

## 持久状态

配置的 `queueRoot` 包含带 `schemaVersion: 3` 的 `manifest.json`、append-only `active.jsonl`、可选的 digest-checked `snapshot.json` 与 owner lock。Provider 在恢复前获取独占所有权。live owner 会拒绝第二个 host；stale owner lock 在接管前移入 quarantine。其他 schema 版本会被拒绝，不会被解码或迁移。

每个持久 mutation 都是一个 `ChangeSet`。准入会在派发前持久化 caller intent、resolved facts、Handler 推导的重试 policy 与已校验的 resource claims。local transaction FIFO 串行化最终 receipt 复查和 append，而 `WorkHandler.resolveAdmission()` 与 `prepare()` 在 FIFO 外执行。Batch 幂等 digest 覆盖 WorkKind、有序 items、shared payload 与 `maxParallel`；复用 key 时任一 Batch-shaping input 改变都会冲突。启动时会先把持久化的 `starting` 和 `running` Attempt 转为带 pending Attention 的 `unknown`，再派发；关闭时会用一个 `shutdownTimeoutMs` 同时约束 cancel request 与 execution settlement，并在释放 root lock 前把未完成 Attempt 标为 `unknown`。

## 调度

Handler 声明 `ResourceClaim`，准入会拒绝未在部署 `resourceCapacity` 声明的 claim。`maxConcurrent`、持久化 resource claims 与 Batch 的 `maxParallel` 共同限制派发；未使用的 host capacity 仍可供其他符合条件的 Batch 使用。`pause()` 只暂停新派发：读取、准入、取消、acknowledgement 与受限 unknown resolution 仍可用。

## 配置

| key | 默认值 | 含义 |
|---|---|---|
| `queueRoot` | 必填 | 隔离的 schema-v3 Queue root |
| `maxConcurrent` | `8` | prepared 或 live attempt 的最大数量 |
| `shutdownTimeoutMs` | `5000` | teardown 将未完成 Attempt 标为 unknown 前等待的时间 |
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
