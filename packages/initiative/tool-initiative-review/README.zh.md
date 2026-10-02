---
description: "有界 Planning Review 反馈，持久记录新建、补充和不行动决策。"
kind: "package-reference"
---

# @changanhua/dsh-tool-initiative-review

[English](README.md) | 中文

## 概要

一个显式启动、工具受限的 Agent Session 读取一条 Planning Review，决定新建 Candidate、补充已有 Candidate 或不行动。每种结果都持久保存。插件复用已有 Planning 和 Initiative owner，不调用模型或激活工作。

## 使用本包

在 Planning 和 Initiative patch 之后挂载可选的 `personal-planning/initiative-review.patch.yml`。显式启动 Session 时选择 `initiative-review` Agent 预设，然后提供 Review id。预设在真实 Tool 执行器中只允许读取和决定复盘反馈。普通 Session 若拥有更广的工具权限会被消费者拒绝；能力发生变化后同样重新检查。

`initiative_review_read` 接受 `reviewId`，以及可选的 `expectedContextDigest`、`candidateId`、`offset` 和 `limit`（1–5）。结果包含捕获的 Review、精确 Planning revision、关联后续事项、Candidate 分页、`contextDigest`、决策版本及已有处理结果。Review 主张和 `acceptanceRef` 均不表示已核验。摘要绑定 Review、被复盘的精确 revision、follow-up heads 和整个 Workspace 的 Candidate 比较快照，不受分页影响。后续比较读取携带 `expectedContextDigest`，上下文变化时拒绝该页。外部 RIR 关联不在此快照的 owner 范围内，因此不返回。当前上下文与已消费上下文不同时，读取结果明确显示漂移。

`initiative_review_decide` 要求 `reviewId`、`expectedContextDigest`、`expectedDecisionVersion`、`rationale` 和 `decision`。决策为 `{kind:"no-op"}`、`{kind:"create",candidateKind,claim}` 或 `{kind:"enrich",candidateId,expectedRecordVersion,expectedCandidateVersion,observation}`。补充操作追加 Review 引用和最多 1024 字符的观察，同时保留先前事实与不可变来源。它记录进行中的调查，不进行最终处置或晋升。

## 配置

`ownershipRoot` 为所有使用同一决策存储的 Host 共享的绝对本地目录。`maxWorkspaceBytes` 默认 2 MiB，覆盖完整 Workspace 历史及预留恢复回执；`maxOutputBytes` 默认 128 KiB，限制整个 Tool 结果。`timeoutMs` 默认 30 秒，协作式取消调用。读取超限时失败，不创建处理结果或 Candidate。

## 恢复

桥接先持久保存意图，再使用稳定 key 调用 Initiative。回执丢失时，由原已授权 Session 使用完全相同的决策恢复，复用 Initiative 绑定 actor 的持久回放。其他 Session 可以读取待恢复记录，但不能冒充原 owner。同一 Workspace 内任何已授权 Session 再次消费时，已提交决策（包括不行动）直接返回。确定的 Candidate CAS 冲突会保存为冲突；重新读取后可提交新的决策版本。结果不确定的失败保留原意图。每条 Review 最多 16 次尝试，不静默淘汰历史。

准入在 Session flush 后重新检查完整上下文。Candidate 入口还在自身串行 owner 内检查全集指纹，并通过仅 Host 可提供的检查函数，在新 Candidate 提交前再次核对 Planning。持久 Candidate 回执优先回放，因此之后的上下文变化不能把已确认写入变成新决策。prepared 恢复时的 Planning 上下文冲突会保存为 conflict，允许重新决策。这些是乐观准入检查，不是跨 owner 事务：Planning 可在最后一次检查后变化，no-op 也可能与之后的 owner 写入重叠。决策存储格式 2 要求这些上下文指纹，拒绝旧决策记录，不自动迁移。

## 不变量策略

不发布 invariant companion，因为决策是经过 schema 校验的原子记录，Candidate 关联保存 owner 的明确回执，而不是独立维护的投射。

## 开发说明

[复盘反馈决策](../../../.agents/notes/implemented/feature/2026-10-02-planning-review-feedback.zh.md)说明恢复边界及持久的不行动结果。Loader 测试覆盖三类决策、并发、CAS、重启、能力拒绝和输出限制；单独受授权开关保护的提供方测试通过 SDK profile 验证真实 Agent 决策。

## 模型体验

### 复盘反馈工具

#### 模型看到什么

两个 Tool 及有界 JSON 结果。指导明确说明：`No-op is a successful durable result.` 来源文本是参考数据，不是指令或授权。模型先比较证据和已有工作，再选择结果。

#### Token 影响

一个指导段、两个 schema 和请求的结果进入已有 Session。桥接不会额外调用模型；分页限制 Candidate 上下文。

#### KV Cache 影响

稳定指令与 schema 可复用已有提示词前缀。Review 和 Candidate 结果随读取变化；不建立独立缓存。

## 已知限制与后续工作

- 不解析或认证外部证据定位符。中断的 prepared 决策需要原 Session 身份恢复；消费者不转移权限或唤醒该 Session。不提供扫描器、调度器、通用 Signal 服务、自动 RIR、Planning 写入、Delivery/Queue 派发、Budget 激活或新 UI。重新考虑已经消费的结果需要新的 Planning Review。
