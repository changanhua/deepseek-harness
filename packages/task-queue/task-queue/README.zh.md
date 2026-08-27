# @deepseek-ai/dsh-task-queue

[English](README.md) | 中文

持久化类型化工作 Queue 的 Service Definition（`ctx.taskQueue`）。具体工作类型通过声明合并扩展 `WorkKindMap`；Provider 注册 `WorkHandler`，依次解析 caller intent、推导重试 policy、在准入时声明资源需求、准备 dispatch，并同步启动 `LiveAttempt`。

## 领域模型

`WorkItem` 不可变，分别保存 title、准入时推导的 policy 和 resource claims、tags、可选 Batch 归属、canonical caller intent、SHA-256 digest 与 resolved execution spec。`BatchItem` 在准入 Batch 前保留每个成员的 title 和 tags。`WorkState`、`WorkAttempt`、`WorkResult`、`Batch`、`Attention`、`Notification`、`Receipt` 是独立持久记录。`unknown` 不是终态，并阻塞后续 Attempt，直到 operator 确认失败或授权重试。

`WorkFailure` 始终包含 `category`、`sideEffect`、`retriable` 与 `message`。只有 `retriable` 为 true 且 `sideEffect` 为 `not-started` 时，系统才可自动重试。

## 持久化与幂等

`ChangeSet { seq, changeId, at, events }` 是唯一持久化单位，其中的 `DomainEvent` 是一同提交的逻辑事实；caller 不能持久化 lifecycle snapshot。Fold 从 admission、Attempt、cancellation、retry 与 unknown-resolution event 推导 WorkState。它拒绝 seq 缺口、重复 change id、非原子或异质 Batch admission、错误的 Attempt 归属或 ordinal、错误的 Result 归属或 kind、冲突 Receipt、不安全自动重试，以及无效 Attention 或 Notification acknowledgement CAS，并确保失败时不部分更新投影。

Caller 在外部解析前 canonicalize intent 并计算 digest。相同 idempotency key 与 digest 返回原 Work id；同 key 不同 digest 是冲突。

## Authority

Provider 验证 initiator identity，再把 opaque `VerifiedAgentAuthority` 或 `VerifiedOperatorAuthority` 传给 `forAgent()` 或 `forOperator()`。Service Definition 不接受 caller 自报的 session id，也不暴露公共 operator facade。确认 Attention 记录不会裁定 unknown Work。

## Model Experience

间接通过拥有工具 schema 与结果渲染的面向模型 Queue Consumer 产生影响。

#### KV Cache effect

无。

## 已知限制与待办

- 本包只定义并 fold 领域事实。Provider 负责持久化、资源容量、调度与 crash recovery。typed WorkKind result 可以引用由 Attachment 等其他服务持有的字节；Queue 不定义通用路径写入器。
