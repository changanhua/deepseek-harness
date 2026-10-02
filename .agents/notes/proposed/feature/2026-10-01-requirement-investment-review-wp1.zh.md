# Agent Note: Requirement Investment Review WP1 职责划分

Status: proposed

[English](2026-10-01-requirement-investment-review-wp1.md) | 中文

## Problem

投资评估必须在 subject 改变后仍可读取，且不能成为 Planning 决策或执行批准。现有 Planning resource-link mutation 会推进 Plan revision，而历史 Plan revision 不保留旧的可变 Focus 字段。通过该 mutation 挂接评估，或用当前上下文重建旧输入，都会破坏只读评估的边界。

## Proposal

[RIR-WP1 规格](../../../../docs/specs/2026-10-01-requirement-investment-review-wp1.md)拥有目标要求与验收案例。本分支已实现 domain 持久化、有界评估 runner、可信 Remote 与可选 UI；真实模型质量验收仍未验证。RIR 应拥有不可变评估、每次判断实际使用的输入，以及 subject-to-assessment 关联。复用 opaque ResourceRef identity 与现有 runtime 机制，通过只读投影向 Planning 展示关联。另一条线的 Planning UI 重构不是前置条件。

## Alternatives considered

**自动写入 Planning resource link。** 不采用，因为现有命令即使只修改链接也会推进 canonical state，可能使刚完成的评估立即 stale。

**只保留 subject id，事后重建上下文。** 不采用，因为当前 Focus 与人工文本可以改变，旧判断将被错误地放在另一份输入下展示。

**强制三个案例命中特定 route 或改变原决定。** 不采用，因为这会奖励复述预期结论。真实输入、实际输出与人工审阅的推理应支持改变决定或有依据地维持原选择。

## Acceptance criteria

实现必须通过规格规定的自动化检查与三个真实案例评估。尤其需要证明评估操作不改变 Planning、subject 修改及 reload 后旧输入仍保留，以及真实模型证据不足时明确 unverified 而不是用 schema tests 顶替。本提案不宣称这些验收已经通过。

## Risks

固定输入增加保留的数据，也可能保存未经核验的用户陈述。必须明确来源、排除秘密，并且只固定判断实际使用且有权读取的输入。不得把输入保留扩为第二套 Planning 历史库、自动研究流水线或 WP2/WP3 Outcome Learning 系统。
