# Agent Note: DSH Skill 交接与多代理编排

Status: implemented

[English](2026-08-31-dsh-skill-handoff-and-multi-agent-orchestration.md) | 中文

## Problem

DSH Feature Skill 单独使用时能做出可靠决定，但多阶段运行中，后续 Skill 无法消费有界的上游结果，因此可能重复 Charter、仓库发现、文档义务和未变化的测试。高推理 subagent 会放大成本：多个 Agent 扫描同一棵目录、拥有重叠文件、各自运行 broad check，或在集成候选稳定前开始审查。

## Decision

[`dsh-feature-delivery`](../../../skills/dsh-feature-delivery/SKILL.md) 拥有轻量路由、任务级 receipt、evidence freshness、并行工作准入和集成 checkpoint。Receipt 可以存在 task artifact 或 DSH durable metadata 中；它不是新的仓库 Registry，也不是必须提交的格式。没有有效 receipt 时，单个 Skill 仍可独立使用并完成最小发现。

Feature 决定保持串行：Charter、reuse/current-contract ownership、Issue DAG、集成、authority 和最终 acceptance。共享合同冻结后，不同的只读 evidence question 和 implementation lane 可以并行。主代理拥有集成和完成声明；worker 拥有不重叠的文件/包和 focused check；独立 reviewer 等待稳定的集成候选。

每个 governed implementation 在执行前记录显式 `agentPlan`。该计划命名每个独立 question 或 exclusive file lane，选择足够完成任务的最低成本 role/model class，并只在候选稳定后安排 review。跨存储 lifecycle、recovery、陌生 subsystem 与不相交 evidence question 正向触发只读探索；security、authority、persistence、recovery、concurrency 与公共 contract 候选通常接受独立 reviewer。Worker 仍以合同冻结和不重叠 ownership 为前提，architect 只用于高风险架构或重复失败。`agentPlan: none` 必须给出具体比例理由，不能静默省略。

共享 evidence ledger 记录 claim/layer、command 或 observation、input 与 environment identity、有界证明、排除边界、side effect 和 freshness。比较所需的 identity 未被观察时，evidence 永远不可复用；time-bound evidence 同时记录观察时间和失效时间。后续 Skill 复用匹配的 evidence，只让 source、manifest、composition、documentation、environment、time 或 diagnosis 变化使相关记录失效。Worker 运行 authoring check，integrator 统一运行一次跨包检查，Feature acceptance 观察真实纵切，pre-push check 只覆盖发布状态。

中断后的运行先从 Codex 原生 task 与 tool state 恢复，再查询 Skill receipt。已完成的 tool result 保持可用；返回的 execution handle 继续执行；只有明确标记为 unknown 且没有 handle 的 mutating call 才进行一次 exact-target reconciliation。Tool-level ambiguity 不会重新打开 Feature phase，也不构成新增 recovery Skill、receipt kind、Registry 或 architecture mechanism 的理由。

Feature Delivery 提供三种并存的任务模式：`native` 用于有界、owner 已知的工作；`adaptive` 是默认路径，并在出现风险时就地升级；`governed` 用于内核、跨域、耐久状态、安全边界或显式要求完整流程的交付。显式选择的模式不能被静默削弱。模式只改变流程深度，不改变权限或 evidence 含义；升级会复用已完成决定与 fresh evidence，而不是重启 phase。

每次启用模式时，在 `.artifacts/dsh-feature-delivery/` 下生成一条被忽略的本地学习记录。辅助脚本捕获开始时间，写入一条独占的 terminal claim，并把完整记录原子提升到 `completed/`；参数相同的 retry 恢复同一记录，不同 terminal value 不能覆盖它。记录包含 duration、汇总 action、outcome、最高 evidence、review finding、复用 evidence、escalation、保守的 `improved`/`neutral`/`worse`/`unknown` effect，以及每个 delegated role 观测到的 model、reasoning level、finding 数量和 decision impact。路由仍按 role 与风险进行，而不是硬编码历史 model 名称。主代理每个任务只写一次；worker 不生成竞争记录。辅助脚本在持久化前拒绝可识别的 credential、绝对路径、URL、prompt 形态和未知参数；调用方仍须排除语法无法识别的个人数据或 payload。记录是 advisory，不是 receipt、完成证明、telemetry stream、公共持久化合同或恢复机制；记录失败不能使产品任务失败。

Charter、Issue Stack、Change Verification、Runtime Composition Debug 与 Self Development Skill 各自发布 receipt 与失效边界。Issue card 携带条件化文档和生成物义务。Self Development 保持 trust overlay；Runtime Composition Debug 保持异常分支。

## Alternatives considered

**只保留自然语言交接。** 否决，因为后续 Skill 无法从叙述上下文中区分冻结决定和 fresh evidence，安全默认仍会是重复发现。

**创建更多两两编排 Skill。** 否决，因为触发图会重复规则并增加上下文与维护成本。一个 router 引用 owning Skill，不复制其流程。

**把每个小任务交给 subagent，并在每条 lane 跑完整验证。** 否决，因为协调、冲突设计和重复检查会主导小改动，昂贵推理时尤其如此。并行工作必须有独立价值、不重叠 ownership，并由一个 integrator 验证。

**把 Codex 中断建模成新的 DSH recovery subsystem。** 否决，因为 Codex 已经保留 task history、已完成 tool result 与可恢复 execution handle。Skill 只为明确 unknown 的最后一次 mutation 提供窄 fallback；DSH runtime recovery 仍由实际持有中断后存续状态的产品 subsystem 拥有。

**创建中央学习数据库，或根据评分自动重写 Skill。** 否决，因为第一阶段真正有用的问题只有各模式做了什么、花了多久、到达哪层 evidence，以及产生了什么可观察效果。本地有界 JSONL 可检查也可丢弃；自动评分会混淆不同任务，并让流程 telemetry 覆盖风险边界。

## Consequences

单个 Skill 保留独立路由和最小发现。联动运行可以从有效 receipt 恢复、复用未变化 evidence，并把 broad check 留到集成阶段。Native、adaptive 与 governed 工作并存，而不是坍缩成一种折中流程。Governed 工作不再默认省略 delegation：它显式做出 role/model 决定，但不要求浪费性的 fan-out。近期模式与 Agent 记录可以辅助不确定的选择，但不能覆盖用户显式选择、风险触发器、authority 或 acceptance。原生 interruption recovery 防止重新打开已完成 phase 或 check，exact-target reconciliation 则限制唯一未解决的 mutation。Receipt producer 必须精确说明 identity 与 invalidation；receipt 不完整或过期时只做 focused rediscovery，而不是盲目信任。验证采用代表性正例、近邻反例、联动、中断、agent-plan、学习记录和真实 self-development 场景，不在每次措辞改动后运行穷举 benchmark。
