# Agent Note: Queue host admission and post-start ownership

Status: implemented

[English](2026-08-29-queue-host-admission-and-start-ownership.md) | 中文

## 问题

Queue v2 可以验证可信 host operator，但原有 operator facade 只能检查和变更由 Agent Session 准入的 work。因此 host-plane Delivery Consumer 若要入队持久 work，就必须伪造一个 Session，进而错误地产生 Session ownership 与 terminal Notification。

`WorkHandler.start()` 之后还存在一个 ownership gap：如果持久化 `attempt/running` 失败，Provider 会把 Attempt 记录为 unknown 并直接返回，却没有取消或等待 `LiveAttempt`。scheduler 随后会遗忘一个仍可能产生外部 side effect 的进程。

## 决策

只有 `TaskQueue.forOperator()` 验证已签发的 `VerifiedOperatorAuthority` 后，`OperatorWorkQueue` 才提供 `enqueue()` 与 `enqueueBatch()`。Operator admission 使用一个 Provider 本地的 `operator` 幂等 namespace，持久化 owner 与 source 都是 `operator` 的 Receipt，并创建 `ownerSessionId: null` 的 WorkItem。fold 会拒绝把 operator Receipt 绑定到 Session-owned work。ownerless terminal outcome 仍然不创建 Session Notification。

Agent admission 继续按 Session 划分 scope，行为不变。WorkKind resolution、持久化 policy 与 resource claims、原子 Batch admission、scheduling、cancellation、retry 和 unknown resolution 仍由 Queue Provider 持有；host Consumer 不会获得第二套 admission 状态机。

`start()` 已返回但 running ChangeSet 失败后，local Provider 会 abort execution signal，立即调用 `LiveAttempt.cancel()`，并同时等待该请求与 `LiveAttempt.done`。等待使用现有 `shutdownTimeoutMs` quiescence bound。只有在 settlement、rejection 或 deadline 后，Provider 才记录 `post-start-durability` unknown 与 Attention。cleanup rejection 或 timeout 会写入持久 failure diagnostic。如果第一次 unknown append attempt 在 commit 前失败，Provider 会重试一次，并把该失败写入重试记录。

execution method 会在调用 `start()` 前结束其 pre-start failure region。因此 `LiveAttempt.done` rejection、terminal settlement failure 或 post-start unknown persistence failure，都不能被捕获成 `prepare-threw`、标记为 `not-started` 或触发自动重试。缺少持久 phase boundary 时，Queue 绝不会把观测到的 live outcome 转成 success 或 safe retry。

## 考虑过的替代方案

**为 host work 创建隐藏 supervisor Session。** 拒绝，因为它会伪造用户 ownership、把 terminal message 路由到并未请求该工作的 Session，并让 Delivery durability 依赖 Session lifecycle。

**暴露不带 authority 的 `TaskQueue.enqueue()`。** 拒绝，因为 admission 会分配 host resource，必须位于已签发 capability 后面；现有 operator authority 是当前最窄的 owner。

**新增第二套 host admission service 或 inbox format。** 拒绝，因为 Queue 已持有 receipt idempotency、immutable admission facts、Batch atomicity 与 scheduling；复制这些规则会造成 Work identity split-brain。

**不做有界 cancellation 与 quiescence 就记录 unknown。** 拒绝，因为 unknown 是诚实的持久 outcome，不是 side effect 仍可能继续时立即丢弃 process ownership 的许可。

**running append 失败后接受 `LiveAttempt.done` outcome。** 拒绝，因为 Attempt 从未跨过持久 running boundary；在 persistence fault 后把返回值当作 terminal proof 会发明非法 transition。

## 测试

Provider 测试覆盖并发与已持久的 single 和 Batch operator idempotency、receipt namespace 与 ownership、冲突 intent、ownerless completion 不产生 Notification，以及 fold 的 operator-receipt ownership fence。fault-injected scheduler 测试会让 running append 和第一次 pre-commit unknown append attempt 都失败，再证明 cancellation 达到 quiescence、一个 unknown 与 Attention 保持持久、没有自动重试 event，且 handler 只启动一次。其他测试证明 live settlement rejection 和 terminal append failure 也会保持 unknown，不会重试。真实 Loader composition 会运行 ownerless allowlisted `operation.run@1` single 与 Batch work，重新打开 Queue root，并验证持久 operator receipt 与零 Session Notification。

## 后果

可信 host plugin 可以提交持久 work，而无需发明 Agent Session，因此 Delivery 和其他 host-plane Consumer 能直接复用 Queue。operator namespace 有意在一个 Queue root 内保持全局唯一；Consumer 必须选择稳定且带 domain qualifier 的 idempotency key。

`shutdownTimeoutMs` 现在约束两个 ownership-loss path，而不只约束 teardown。忽略 cancellation 的 handler 可能超过 bound 存活。deadline 之后，Queue 会保留持久不确定性，但会释放进程内 handle、resource claim、global concurrency slot 和 Batch slot。operator 在授权另一次 Attempt 前必须确认外部已 quiescent；否则不合作的 side effect 可能与新 work 重叠，并临时超出已声明 capacity。Work 会保持 unknown，并带有明确 Attention 与 diagnostic evidence，而不会伪装成 terminal 或 safe retry。
