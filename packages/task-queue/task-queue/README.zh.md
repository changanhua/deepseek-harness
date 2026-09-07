# @changanhua/dsh-task-queue

[English](README.md) | 中文

持久化类型化工作 Queue 的 Service Definition（`ctx.taskQueue`）。具体工作类型通过声明合并扩展 `WorkKindMap`；Provider 注册 `WorkHandler`，依次解析 caller intent、推导重试 policy、在准入时声明资源需求、准备 dispatch，并同步启动 `LiveAttempt`。

Handler registration 默认立即生效。当 recovery 必须先使用 handler 执行 receipt lookup 或 admission，而 dispatch 尚不安全时，可信 composition 可以请求 staged registration。返回的 callable 持有该精确 registration：`activate()` 只开放一次 dispatch，disposal 会阻止后续 activation，且只移除该 registration。

## 领域模型

`WorkItem` 不可变，分别保存 title、准入时推导的 policy 和 resource claims、tags、可选 Batch 归属、canonical caller intent、SHA-256 digest 与 resolved execution spec。`BatchItem` 在准入 Batch 前保留每个成员的 title 和 tags。`WorkState`、`WorkAttempt`、`WorkResult`、`Batch`、`Attention`、`Notification`、`Receipt` 是独立持久记录。`unknown` 不是终态，并阻塞后续 Attempt，直到 operator 确认失败或授权重试。

`WorkFailure` 始终包含 `category`、`sideEffect`、`retriable` 与 `message`。只有 `retriable` 为 true 且 `sideEffect` 为 `not-started` 时，系统才可自动重试。

## 持久化与幂等

`ChangeSet { seq, changeId, at, events }` 是唯一持久化单位，其中的 `DomainEvent` 是一同提交的逻辑事实；caller 不能持久化 lifecycle snapshot。Fold 从 admission、Attempt、cancellation、retry 与 unknown-resolution event 推导 WorkState。它拒绝 seq 缺口、重复 change id、非原子或异质 Batch admission、错误的 Attempt 归属或 ordinal、错误的 Result 归属或 kind、冲突 Receipt、不安全自动重试，以及无效 Attention 或 Notification acknowledgement CAS，并确保失败时不部分更新投影。

Caller 在外部解析前 canonicalize intent 并计算 digest。相同 idempotency key 与 digest 返回原 Work id；同 key 不同 digest 是冲突。Agent receipt 按 owner Session 划分 scope。可信 operator 使用独立的单一 host namespace；其准入持久化 `ownerSessionId: null`、使用 operator receipt，且绝不创建 Session Notification。

## Authority

Provider 验证 initiator identity，再把 opaque `VerifiedAgentAuthority` 或 `VerifiedOperatorAuthority` 传给 `forAgent()` 或 `forOperator()`。Service Definition 不接受 caller 自报的 session id，也不暴露公共 operator facade。因此 `OperatorWorkQueue.enqueue()` 与 `enqueueBatch()` 是 host capability，而不是模型或浏览器权限。进程内 `dispatchState()` 会报告 running、paused 或 faulted 的派发状态，`waitReason()` 则解释一个 queued WorkItem，而不持久化另一份 Work state。确认 Attention 记录不会裁定 unknown Work。

<a id="stage-recovery-integration"></a>

## 阶段恢复接入

可信 Host caller 可以使用相同 WorkKind、canonical input 与幂等键再次调用 `enqueue()`，再通过 `get(workId)` 恢复阶段绑定。回执查询先于 Handler 解析，因此 Handler 不可用时也能找回已提交工作。同一个键对应不同输入会冲突。稳定的业务阶段标识应包含输入与执行配方版本；版本更新与审核退回后的修订是新工作，执行尝试则归 Queue 管理。键的作用域必须保持一致：不同 Agent Session 使用不同回执命名空间。无 Session 归属的接入必须把操作权限保留在可信 Host 内。

业务进度和 Queue 结果是独立的持久事实。业务 caller 在 Queue 准入或完成后崩溃，可以重新找到 Work 并读取保存的结果；通知用于唤醒，并非唯一恢复来源。调度下一阶段前，应幂等保存结果绑定。审核正常完成但输出要求修订，仍是成功的 Queue 执行。`unknown` 会阻止执行，直到 operator 处置；重复提交不会授权新尝试。Queue 不实现阶段图、发布审批或 worker 续跑。

## Model Experience

间接通过拥有工具 schema 与结果渲染的面向模型 Queue Consumer 产生影响。

#### KV Cache effect

无。

## 已知限制与待办

- 本包只定义并 fold 领域事实。Provider 负责持久化、资源容量、调度与 crash recovery。typed WorkKind result 可以引用由 Attachment 等其他服务持有的字节；Queue 不定义通用路径写入器。
