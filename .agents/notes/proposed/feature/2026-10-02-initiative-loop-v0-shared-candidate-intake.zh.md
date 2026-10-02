# Agent Note: Initiative Loop v0 共享候选入口

Status: proposed

[English](2026-10-02-initiative-loop-v0-shared-candidate-intake.md) | 中文

## Problem

DSH 已有 Planning、Delivery、Queue、副作用安全，以及 Trusted Eval、Budget、Authorized Activation 的路线，但这些 owner 之前的 initiative 仍通常来自用户。直接复用 Planning Proposal 会把很早期的假设强行塑造成计划；让 Agent 直接创建工作又会混淆 initiative 与 execution authority。系统需要一个廉价、durable 的位置，让 Human 或 Agent 都能提出并调查“可能值得做什么”，而不会把每个观察都变成 backlog。

## Proposal

[Initiative Loop v0 规格](../../../../docs/specs/2026-10-02-initiative-loop-v0-shared-candidate-intake.md)应增加一个很小的 Candidate owner。Human 与 Agent proposer 共用同一 durable contract 与 provenance 规则。Candidate origin 保持 immutable；investigation 通过新 revision 追加 evidence、counter-evidence、uncertainty 与 refined claim。现有 Agent、Tool、Session、Storage、RIR 与 Planning owner 继续保留各自 authority。Candidate 可以交给 RIR 评估，但只有显式 Human promotion 才能创建 non-canonical Planning Proposal。Candidate 创建、调查或 RIR route 都不能产生新的 execution authority。

## Alternatives considered

**直接使用 Planning Proposal 保存 Candidate。** 不采用，因为非常早期的问题、机会、简化或删除假设应比包含 scope、acceptance、estimate 与 Planning lifecycle 的 plan-shaped draft 更廉价。

**只把 initiative 写在 Session 文本中。** 不采用，因为 lineage、revision、disposition、restart recovery 与 Human/Agent provenance 会继续隐含在文本中，难以查询或连接 RIR。

**让 RIR 拥有 Candidate。** 不采用，因为 RIR 拥有 investment assessment，不拥有更早期的 initiative hypothesis 与 investigation lifecycle。

**建立通用 Governance / Experience Plane。** 不采用，因为当前 owner 已覆盖执行、评估、规划、权限与 durable facts；v0 需要窄的组合对象，而不是新的 canonical control system。

**立即允许 Agent promotion。** v0 不采用，因为 initiative 质量尚未校准，而 promotion 已进入工程承诺。设计先扩大 Agent 的 initiative，同时在有证据支持更宽 policy 前保留 Human 的最终 promotion authority。

## Acceptance criteria

Human 与 Agent 分别通过不同的 trusted entry 创建 Candidate，最终汇入同一 durable contract。Agent 可以追加 bounded investigation evidence 而不获得新能力，Human 可以在调查前或调查中 defer / drop Candidate。Candidate 历史可跨重启恢复且 stale write 失败。exact Candidate revision 可由真实 RIR owner 评估。真实 Human entry 将 exact revision 晋升为 pending Planning Proposal；独立读取确认两个 owner 的关联，重启后以同一 key 重试返回原结果且不重复创建。promotion 不自动 accept Proposal 或 dispatch Delivery。负面测试必须证明 Agent initiative、RIR route 与 investigation 都不能绕过现有 authority owner。

## Risks

如果 Candidate 出生很便宜但 pruning 与 counter-evidence 很弱，Candidate inbox 会退化成新的 backlog 或架构点子生成器。因此 v0 将 Candidate 保持在 Planning 之前，把 simplify/remove 设为一等 kind，保存反证，并排除自动扫描、冷启动、promotion、portfolio scoring 与 outcome learning。另一风险是重复 provenance 或 artifact store；实现应优先复用已有 reference，确有需要时也只增加 Candidate owner 所需的最小 opaque locator。
