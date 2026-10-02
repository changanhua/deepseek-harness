# Agent Note: 不激活执行的 Planning Review 反馈

Status: implemented

[English](2026-10-02-planning-review-feedback.md) | 中文

## Problem

执行结果可以暴露值得改进的问题，但为每个结果生成 Candidate 会制造未经筛选的工作。重试结果不确定的跨 owner 写入也可能产生重复假设。

## Decision

[Review 消费者](../../../../packages/initiative/tool-initiative-review/README.zh.md)在显式启动且工具受限的 Session 中读取一条选定的 Planning Review，持久保存新建、补充和不行动决策。Review 事实保持未核验，不继承 Trusted Eval 权限。Candidate 写入复用[已有 Candidate owner](2026-10-02-initiative-candidate-core.zh.md)，其所有权与晋升理由仍独立适用。

消费者在 Candidate 写入前保存冻结意图。由于 Candidate 回执绑定 actor，恢复使用原 Session 和 key；已完成结果可由其他已授权 Session 读取。确定的 CAS 冲突允许重新决策，不确定的结果不能被覆盖。能力限制由 Tool 执行器落实，并在决策提交时再次检查。

新鲜度依据实际比较上下文，而非只看 Review：关联 Planning heads 和完整 Candidate 集合都可能改变不行动或新建决策。Candidate owner 内的检查避免桥接检查与实际写入之间竞争。回执回放必须先于这些检查，因为已确认写入的恢复不是新的决策；过期且尚未提交的意图则变为 conflict，防止永远锁住 Review。消费者采用乐观准入而非跨 owner 事务锁，保留各自的所有权和恢复边界。

## Alternatives considered

**通用 Signal 和 Observer 服务**在单一反馈来源证明价值之前增加生命周期和调度契约。桥接使用已有 Review 契约，只拥有消费结果。

**总是生成 Candidate**奖励活动而非筛选。持久的不行动结果保留原因，防止重试变成新的提案。

**用替代 Agent 回放**与绑定 actor 的 Candidate 回执冲突。要求原已授权 Session 恢复，可以避免伪造身份或为恢复便利扩大 Candidate 权限。

## Consequences

反馈不会修改 Planning 或激活执行。失去调用方的 prepared 决策需要原 Session 恢复；消费者不会唤醒它或转移所有权。上下文身份覆盖关联 follow-up heads 和 Candidate 比较。比较依据变化时要求重新读取；已提交结果仍保持稳定。Loader 测试覆盖重启、回执丢失、CAS 和能力拒绝；有界真实提供方验收使用给定的隔离场景评估决策行为，不证明生产发生频率或长期筛选质量。
