# Agent Note: 不产生 authority 的 durable initiative

Status: implemented

[English](2026-10-02-initiative-candidate-core.md) | 中文

## Problem

早期观察需要 durable 调查历史，同时不能成为 canonical Planning 承诺。Human 与 Agent 入口需要不同权限，但共用一个 Candidate owner。

## Decision

[Candidate owner](../../../../packages/initiative/README.zh.md) 在 Planning 前保留 Human 和 Agent initiative。严格的无 caller JSON 与 live runtime 检查让模型无法控制 actor identity。人工命令绑定 exact active command event；provider 中由 Host 配置的 operator 标签跨重启保持稳定。immutable origin、revision 与独立反证避免改写最初假设。有界读取投射选择单个 revision，而非重复输出累积历史。

晋升使用 Planning 现有 pending Proposal 操作。prepared intent 在 Planning 调用前预留请求 key 与最终完成的存储空间。固定的下游请求可恢复已提交但 Candidate finalize 失败的结果。只有确定的 CAS 拒绝且不存在匹配 Proposal，才更新下游尝试。聚合 Board version 改变，canonical items、Plan revisions 和 Delivery handoffs 不变。

## Alternatives considered

用 Planning Item 保存早期假设会过早产生承诺。第二 Agent runtime 或扫描器会混淆 initiative 与 activation。由调用者提供 human 标签或 verified evidence 标志会把非可信 JSON 变为 authority。简化 RIR scorer 会冒充不可用的 owner。这些替代方案均排除。

## Consequences

[完整 Initiative 提案](../../proposed/feature/2026-10-02-initiative-loop-v0-shared-candidate-intake.zh.md) 仍比本 core 广。无密钥集成测试不证明真实 RIR 或真实模型自主 initiative。来源引用明确保持 unverified、unknown 或 unavailable；owner 不抓取来源，也不检测 secret。prepared promotion 阻止 Candidate 后续编辑，直到原操作恢复。provider 拒绝超过完整单 revision 视图上限的写入；consumer 输出上限须高于此值加响应封装。

Loader 测试使用 inert Agent handle，验证真实 Commands、Tools、Storage、Planning，覆盖 restart、CAS、actor spoofing 和 promotion failure windows。它们证明组合入口合同，不代表真实 provider 对话。默认 profile 不启用此功能。
