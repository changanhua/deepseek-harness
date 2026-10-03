# Agent Note: Eval 恢复、独立决策与显式续跑

Status: implemented

[English](2026-10-03-eval-recovery-decisions-and-continuation.md) | 中文

## Problem

Subject 成功不能证明独立决策，也不能授权另一轮 Goal。进程丢失会切开 Queue 提交、证据交接、决策保留和消息投递。用 Agent 叙述重建这些边界，或重放其副作用，会同时丢失权限和幂等性。

## Decision

EvalRuns 保留协调意图和已确认的私有材料，Queue 仍是唯一 Attempt owner。历史 Plan 恢复返回原始源事实，不签发新的执行权限。条件式 Queue 控制在变更事务内比较观测到的状态、Attempt 数及活动 Attempt。不确定的执行使用新获得显式授权的 Attempt 和全新世界，不复用不确定目录。

EvalGates 通过 Host 私有能力读取原始材料。单独启动的固定检查器根据实际输出重新计算受支持条件，将持久 Session、完整锁定核心、批准的构建来源、Profile、配置及准确报告与决策一起保留。Verifier 构建来源不使用 Subject 仓库提交替代。并发评估串行处理；重复决策不再启动检查器。历史决策与当前有效性分离，使过期后仍保留历史，但不能授权新动作。

EvalActivation 在恢复目标 Session 前认领一次性 Grant。Host 组合固定目标、Goal 版本、Budget 和消息；公开调用者不能编造 Queue 终态事实。Host 在投递前重新检查当前 Gate 有效性、终态 Attempt、工作区归属、预算父链和权限。只有准确的持久 Goal 消息回执能证明消耗。在不确定的恢复或投递边界重启时产生 needs-attention，不重发消息。

本地续跑生产者在不挂载自动 Goal round driver 的专用 Profile 中独占一轮。它复用标准 Goal 提示渲染器，但不挂载该驱动器。原 Agent loop、Goal 服务、Session 持久化和 Budget 仍是权威来源。冷句柄属于续跑操作，在静止后释放。

续跑按目标 Session 而非 Grant id 串行处理，因为独立 Grant 可能指向同一个可变 Goal。授权是异步操作，因此投递时再次检查过期时间、Goal 状态和 Agent 空闲状态。owner 卸载会中止其活动轮次，并在释放持久化资源前等待排空。保留的 pass 也会重新核验准确的原始 verifier 材料；证据缺失或互相矛盾时，不能只凭决策标签继续认定通过。

## Alternatives considered

**将安全报告或 Agent 成功输出当作权限依据。** 拒绝，因为安全投影省略私有证据、准确 Attempt 和回执完整性。它们适合展示，不适合授权。

**重放不确定操作直到成功。** 拒绝，因为确认丢失不能证明模型调用或 Goal 消息尚未发生。恢复读取已提交 owner；不确定副作用需要显式核对。

**在没有认领契约时共享自动 Goal 驱动器。** 推迟，因为两个独立 owner 可能投递同一下一轮。专用 Profile 是明确的当前部署边界，不代表所有既有 Host 均受支持。

## Consequences

[CLI 流程](../../../../packages/eval/eval-app/README.zh.md)需要显式 Host 组合和私有同步存储。构建后 Profile 测试使用确定性 adapter 和真实 DeepSeek Flash/Pro adapter，覆盖隔离 Subject/Grader 执行、独立检查器、冷 Session 续跑、持久回执、重复请求和预算撤销。在线 case 确认五次已结算模型请求和一条持久 Goal 消息；它不证明任务质量基线、Web 可用性、文件系统配额，也不认证任意修改的 Harness 核心。

[可信生产者决策](2026-10-02-trusted-eval-producers-and-resource-budgets.zh.md)、[隔离核心决策](2026-10-03-pinned-core-isolated-eval.zh.md)和 [Eval 契约决策](2026-08-31-deterministic-eval-contract-and-snapshot-adapter.zh.md)继续有效。其准入、隔离和纯值职责没有改变；本决策负责恢复，以及决策到显式续跑的连接。没有既有笔记被完全取代。
