---
name: dsh-architect
description: Use when turning a deepseek-harness requirement into a machine-checked Architecture Decision Packet (ADP) before implementation — classify the task, resolve DSH placement, bound retrieval, compare alternatives, and hand a review-ready ADP to the validator.
---

# DSH Architect

把需求转成可检查的 ADP。本 Skill 是**流程策略 + 检索入口 + 停止条件**，不是事实库：具体 API、包名、Case 一律按需检索，不复制进正文。

## 输入

- 原始需求（raw requirement）
- 范围（scope）与明确非目标（non-goals）
- Evidence Capsule ID（由 `snapshot.ts` 生成）

## 流程

1. **Target Lock**：记录 repo、revision、branch/dirty scope、upstream base、profile。无法确定的字段写 `unavailable`，此时不进入设计。
2. **Evidence Capsule**：确认 `evidence-*` 新鲜且关键事实有来源；运行观察只在确实探测时写入，并保存 scope 与时间。
3. **DSH Placement（先于一切包/service 设计）**：填写 `dsh_placement`——implementation_kind、domain_owner、seam_disposition、existing_runtime_owners、dsh_concepts（references/redefines）、event_mapping（domain mutation / model-visible projection / live signal 分开）、public_service_justification。**出现 DSH 核心概念重定义立即停止**。
   - `repo-tool`：只拥有仓库开发产物与调用进程内文件操作；不注册 Cordis Service，不拥有 DSH 运行状态。
   - `domain-component`：可拥有领域记录，但对 Agent/Session/Tool/Skill 只保存引用；执行/历史/工具注册/推理仍由 `ctx.agents`/`ctx.sessions`/`ctx.tools`/`ctx.llm` 负责。
   - `existing-consumer`：走 documented extension point，不为包内编排额外制造 `ctx.*`。
   - `new-seam`：才要求 capability 三角色、当前 Consumer、独立演化证据与完整 invention proof；单个包内调用方默认私有 capability closure。
4. **分类与风险触发器**：`durable/restart/queue`→state+recovery；`ctx.*/provider`→seam roles；`tool/prompt/model-visible`→session-log；`UI/remote`→host/client/wire；`settings/default/credential`→configuration+secret。
5. **受限检索**：先 generated catalog，再 exact source symbol，再 Agent Note/README，最后 Pattern/Anti-pattern/Case。precedent ≤3，一次 step 片段 ≤6。
6. **Alternatives ≥2**：每个方案写 satisfies/violates/owner/失败场景；机械任务可声明 `single-obvious-path` 并给证据。
7. **生成 ADP**：按 schema 填写，把每个关键选择写成可证伪的 proof obligation。
8. **运行 `validate-adp.ts`**：schema 与机器检查全部清零；不允许用说明文字豁免。

## 不负责

- 实现代码
- 宣称测试通过
- 直接晋升知识（只能 propose）
- 把 Case 当 Contract

## 完成条件

ADP machine-valid 且 review-ready；**不是**“方案写完了”。交付物：`task.json`、`evidence.json`、`adp.yaml`、proof obligations 与 verification matrix。
