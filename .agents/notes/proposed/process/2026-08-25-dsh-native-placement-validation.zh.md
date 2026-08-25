# Agent Note: DSH 架构智能系统的原生落点校验

Status: proposed

[English](2026-08-25-dsh-native-placement-validation.md) | 中文

## 问题

架构指导系统可能引用了 DSH 规则，却仍然产出一套平行运行时。类似 “Cognitive Kernel” 的总括抽象会悄然接管本应由 DSH 拥有的 Agent、Session、Tool、LLM 和事件生命周期。仅靠 prose 提醒无法阻止这种设计进入实现，因此，一个本来用于教授 DSH 原生架构的系统可能无法通过自己的 dogfood 任务。

第一版 Architecture Intelligence 已正确地把 V0 放在 `.agents/` 和 `scripts/` 下作为仓库工具，但 Architecture Decision Packet 没有把该落点作为一等决策。Validator 虽检查 seam 完整性和 model-visible logging，却不能确定性拒绝 DSH 概念重定义、被压成 Session event 的领域 mutation、仅用于界面展示却被称为 Session fork 的分支、存入 Settings 的领域记录，或为单个内部调用方创建的无必要 public Service。

## 提案

Architecture Intelligence V0 保持为仓库开发工具。它只拥有可审查知识、命令实现和可重建 Run 产物；不注册 Cordis Service，也不拥有 DSH Agent、Session、Tool、LLM 或事件状态。仓库提交一份自用 ADP，记录 `implementation_kind: repo-tool`、`seam_disposition: none`、现有 DSH runtime owner、空的概念重定义集合和 V0 实际拥有的仓库产物。

每份 ADP 在设计包或 service 前必须填写 `dsh_placement`。它记录实现类型、领域 owner、`none/reuse/compose/invent` seam disposition、现有 runtime owner、引用与重定义的 DSH 概念、事件映射、当前 Consumer，以及 seam 角色必须独立演化的证据。领域组件可以拥有自己的记录并引用 DSH 身份，但不得重新拥有这些身份的执行或生命周期。

Deterministic Validator 在语义 Review 前拒绝以下情况：

- `placement.parallel-runtime`：领域抽象重新拥有 Agent、Session、Tool registry、LLM 或其生命周期。
- `placement.unjustified-public-service`：public Service 只有内部调用方，且没有当前替换需要或角色独立演化理由。
- `placement.event-domain-collapse`：普通领域 mutation 被变成通用 DSH event，或 model-visible projection 缺少可回放的 Session 历史。
- `placement.visual-branch-fork`：仅用于展示的分支在没有 durable history divergence 时声称 Session fork。
- `placement.settings-domain-data`：领域记录或 workspace 结果被放入 Settings。
- `placement.redefined-dsh-concept`：ADP 声明了任何被重定义的 DSH 核心概念。

Phase 0 固定包含 Thinking Workspace mutation task，并故意给出 “Cognitive Kernel” 诱因。合格设计把 inquiry、hypothesis、evidence link 和 branch relation 留在 workspace 领域，复用 DSH 执行 owner，只把选中的 model-visible 内容映射进现有 Session 历史，并拒绝总括运行时。该任务与自用 ADP 是验证切片的发布条件，不是说明性示例。

## 流程范围

本 Note 管理 Architecture Intelligence 的仓库工作流、ADP 字段、校验规则和 dogfood 评测。它不批准 runtime package、新 `ctx.*` service、事件类型、持久化格式或 Web surface。未来任何 runtime 落点都必须有独立 ADP、invention proof、proposed Agent Note、当前 Consumer、完整 seam 角色和 focused negative controls。

## 考虑过的替代方案

**只在 Contract Kernel 和 Reviewer checklist 中保留落点指导。** 否决，因为问题正是流畅 prose 可以与非 DSH 原生决策同时存在。落点必须进入结构化表示，并在 Review 前被机器拒绝。

**把 Architecture Intelligence 实现为 DSH runtime service，以便直接 dogfood plugin。** V0 否决，因为仓库 snapshot、retrieval、ADP validation 和 eval 不需要 live product capability 或 runtime state owner。建立 service 会制造本系统本应阻止的无理由 seam。

**每个 public Service 都机械要求第二个 Consumer。** 否决，因为 Consumer 数量只是风险信号，不是架构规则。即使一个包最初承担多个角色，当前 Consumer 也可能需要替换能力，角色也可能确需独立演化；ADP 应记录这些具体理由。

**禁止所有新 seam。** 否决，因为现有 extension point 和 composition 无法满足当前义务时，DSH 允许 invention。Validator 要求完整角色和证据，而不是用一刀切禁令代替有证据的创造。

## 验收标准

- Architecture Intelligence V0 有一份 schema-valid 自用 ADP，记录 repo-tool 落点、没有新 public service、没有重定义 DSH 概念，且只拥有仓库产物。
- 每个非机械 ADP 都填写 `dsh_placement`；条件 schema 只在 new/compose seam 时要求完整 capability roles。
- 每条 `placement.*` 规则都有确定性 invalid fixture 和有效 counterexample。
- Thinking Workspace holdout 拒绝拥有 DSH runtime 身份的 Cognitive Kernel，并接受引用现有 DSH owner 的领域模型。
- model-visible workspace projection 可从现有 Session 历史 replay，普通 workspace mutation 仍留在 workspace 领域。
- 只有一个调用方且缺少当前替换或独立演化证据的 public Service 校验失败，并指向私有 capability closure。

## 风险

落点 schema 有意保持 DSH-specific，不应扩张为跨框架 ontology。其稳定值应保持小而且绑定源码，避免词汇增长变成另一套知识库。

硬校验若输入过浅，可能拒绝合理的新 seam。因此 Validator 只拒绝明确的 ownership 矛盾和证据缺失，语义适用性仍交给 Reviewer；有证据的 invention 继续允许。

DSH package 演化后，仓库工具可能与 runtime ownership 发生漂移。自用 ADP 和 holdout evidence 必须绑定 revision，source-anchor 漂移必须使结果失效，而不是静默刷新。
