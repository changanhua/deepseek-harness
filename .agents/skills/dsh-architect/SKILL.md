---
name: dsh-architect
description: Use when turning a deepseek-harness requirement into a machine-checked Architecture Decision Packet (ADP) before implementation — classify the task, resolve DSH placement, bound retrieval, compare alternatives, and hand a review-ready ADP to the validator.
---

# DSH Architect

把需求转成可检查的 ADP。本 Skill 是**流程策略 + 检索入口 + 停止条件**，不是事实库：具体 API、包名、Case 一律按需检索，不复制进正文。

## 输入

- 原始需求（raw requirement）
- 范围（scope）与明确非目标（non-goals）
- Evidence Capsule ID（由 `snapshot.ts` 生成，格式 `evidence:<revision-prefix>`）

## 流程

1. **Target Lock**：记录 repo、revision、branch/dirty scope、upstream base、profile。非 `repo-tool` 设计如果 profile 无法确定，就停止，不得继续声称当前运行落点。
2. **Evidence Capsule**：先执行 `snapshot.ts`；ADP 的 `evidence.capsule_id` 必须与实际 `evidence.json.id` 相同，并用 `validate-adp.ts <adp> --evidence <evidence>` 做绑定校验。运行观察只有确实探测过才写入。
3. **DSH Placement（先于包/service 设计）**：填写 `dsh_placement`——implementation_kind、domain_owner、seam_disposition、existing_runtime_owners、dsh_concepts、event_mapping、public_service_justification。**出现 DSH 核心概念重定义立即停止**。
   - `repo-tool`：只拥有仓库开发产物；不注册 Cordis Service，不拥有 DSH 运行状态。
   - `domain-component`：可拥有领域记录；Agent/Session/Tool/LLM 的执行与生命周期仍由现有 DSH owner 负责。
   - `existing-consumer`：走 documented extension point，不为包内编排额外制造 `ctx.*`。
   - `new-seam`：要求 capability 三角色、当前 Consumer、独立演化证据与完整 invention proof。
   - `seam_disposition: compose`：必须列出实际复用的 `existing_extension_points`，不能用“compose”掩盖隐式 invention。
4. **分类与风险触发器**：`durable/restart/queue`→state+recovery；`ctx.*/provider`→seam roles；`tool/prompt/model-visible`→session-log；`UI/remote`→host/client/wire；`settings/default/credential`→configuration+secret。
5. **受限检索**：先当前 Evidence / generated catalog / exact source，再 Agent Note/README，最后 Pattern/Anti-pattern/Case。正常检索只允许 validated/current/verified；candidate 只能显式研究，不得当事实使用。
6. **Alternatives ≥2**：每个方案写 satisfies/violates/owner/失败场景；机械任务可声明 `single-obvious-path` 并给证据。
7. **生成 ADP**：按 schema 填写，把关键选择写成可证伪 proof obligation。
8. **运行机器校验**：`validate-adp.ts <adp> --evidence <evidence>`；schema、Evidence binding、Kernel、placement findings 全部清零后才进入 Review。

## 不负责

- 实现代码
- 宣称测试通过
- 直接晋升知识（只能 propose）
- 把 candidate / Case 当 Contract

## 完成条件

ADP 与 Evidence 绑定有效、machine-valid 且 review-ready；**不是**“方案写完了”。交付物：`task.json`、`evidence.json`、`adp.yaml`、proof obligations 与 verification matrix。
