# Agent Note: Downstream project understanding context

Status: implemented

English | [中文](2026-09-13-downstream-project-understanding-context.zh.md)

## Problem

个人 fork 的跨包分析会在代码只发生小范围变化时，反复重新探索稳定的仓库结构。把分析缓存放在外部聊天或助手资料库虽然可以复用，但它脱离 Git 历史，默认也不能被其他仓库 Agent 使用，并且容易被误认为当前仓库权威。反过来，如果在 `docs/` 再复制一份大型架构基线，又会与已有的 architecture、subsystem、package、生成目录和 Agent Note 文档层产生重复事实所有权。

## Decision

downstream fork 在 [`downstream/PROJECT-CONTEXT.md`](../../../../downstream/PROJECT-CONTEXT.md) 保存一份小型分析缓存。它记录已审查领域及对应审查提交、跨模块导航结论、待确认问题和增量复核协议。详细事实仍链接到仓库自己的权威来源；如果它与源码、生成目录、subsystem reference、package README 或 active implemented Agent Note 冲突，后者始终胜出。

根 [`AGENTS.md`](../../../../AGENTS.md) 要求在仓库级或跨包分析前先读取 downstream context。目标 ref 与记录的审查边界不同时，分析先比较相关历史，把变化映射到事实所有者、契约和依赖边界，只重新阅读那些可能被变化推翻的结论。复核范围按语义影响决定，而不是按提交数量决定。

这份 context 不是生成目录、Agent Note 索引、运行时状态缓存或项目管理数据库。它不复制完整 package inventory 或实现过程。实际本机 Profile、凭据、浏览器连接、CI 状态和 Provider quota 等运行时事实仍是即时观察，任务依赖它们时必须重新检查。

## Alternatives considered

**只把基线保存在助手或外部知识库。** 不作为主本，因为缓存不会随代码一起演化，不参与仓库 review，也不会天然提供给 Codex、DSH 或其他仓库 Agent。

**在 `docs/` 放一份大型基线。** 拒绝，因为 `docs/architecture.md`、subsystem reference、package README、生成目录和 active Agent Notes 已分别拥有项目事实和设计理由；第二份叙述式基线会漂移，并破坏一条事实一个归属的规则。

**只使用根 `AGENTS.md`。** 拒绝，因为 standing order 应保持很短并长期进入上下文；把已审查领域、失效条件、未决问题和版本边界都塞进去，会让根文件逐渐变成分析历史。

**每次跨包问题都重新扫描仓库。** 拒绝，因为已有证据且没有被相关变更影响的结论，不会因为重复探索而更可靠。复核应该只为相关变化引入的新不确定性付费。

## Consequences

跨会话和跨 Agent 的项目分析可以复用一份随仓库版本演进的理解缓存，同时正式项目文档继续保持权威。小而无关的提交不再触发全仓调查；如果共享契约发生变化，仍然可以按其实际影响扩大复核。

当稳定的跨模块理解发生变化时，需要更新相应的审查边界或结论。缓存仍可能过期，因此文件明确写出 authority boundary，并要求复用前核对目标 ref。新增 context 文件刻意保持小型；详细设计决定继续放在 Agent Notes，详细契约继续放在各自已有文档层。
