# Eval 契约

[English](eval.md) | 中文

本参考页描述纯 [Eval 库](../../packages/eval/eval/README.zh.md)：评测意图、记录的执行身份及内部一致的决策。此库不执行观测、凭据访问、证据读取、预算准入或激活。现有 Suite/Run/report runner 保持确定性回放语义。

## 信任边界

`parseEvalPlan`、`parseResolvedExecutionManifest` 和 `parseEvalGateDecision` 检查结构。`validateEvalDecisionContext` 额外检查内容引用与执行绑定。它们都不认证生产者，也不会将调用方 JSON 升级为可信观测。Consumer 必须经可信 owner 获取记录，解析观测、报告、完整性和预算引用，并验证已批准的 verifier 计划在 subject 执行前冻结。哈希相同只证明内容身份相同。

各契约具有独立的 `kind` 判别字段和 `schemaVersion: 1`。未知版本与额外字段会被拒绝。现有 `EvalSuite`、`EvalRun` 和 `EvalReport` 保留各自版本 1 的语义；其中的源码 revision、route 和仅含名称的 `visibleSurface` 不是执行证明。不提供从这些字段填补缺失观测身份的转换。

## EvalPlan

| 字段 | 含义 |
|---|---|
| `id`、`version`、`suiteRef` | Plan 身份与精确 Suite 引用 |
| `repository` | 请求的 revision 标签及预期完整小写 Git commit；拒绝缩写 revision |
| `routes` | 有序的 Provider/model、preset 产物及非秘密参数要求 |
| `repeatPolicy` | 显式次数、可空 seed 与 route/case/repeat 顺序 |
| `baselineRef`、`workspacePolicy` | 可选精确基线与逐 cell 工作区策略 |
| `allowedEntrypoints` | 唯一且归一化的 web/cli/ci 集合；解析不授予任何入口权限 |
| `credentialAuthorizationRef`、`budget` | 外部授权引用；必需预算携带引用，显式豁免不携带引用 |
| `verifierPlanRef` | 由 Host 在执行前批准并冻结的精确 verifier 策略 |

引用包含 `id`、`version` 和小写 SHA-256 `digest`。Plan 内容引用使用其 id/version 与 `evalContractDigest(parseEvalPlan(input))`；不存在自引用的 digest 字段。Plan 验证不会解析 Suite 成员或批准调用方提供的预算豁免。

## ResolvedExecutionManifest

每份 manifest 将 id/version 绑定到 `planRef`、`suiteRef`、`runId`，以及一个 cell 的 `caseId`、`routeId`、从零开始的 `repeatIndex` 和正整数 `attempt`。Subject 观测必需，grader 与 verifier 观测可以为 null。Cell 的 subject route 必须与其 route id 一致。Grader/verifier 不得复用 subject execution id。

每个记录的角色身份包含 execution id、observer 与 evidence 引用、完整观测 commit 与 workspace lease 引用、build/config digest、Profile 产物身份、可空模型 route，以及 Tool/Skill 产物集合。Subject 必须有模型 route。非模型 grader/verifier 可以使用 null route。产物身份包含 id、source 与内容 digest；仅有名称不够。Config 正文、凭据与产物字节不属于这些身份记录；生产者必须将 route 参数限制为非秘密值。

上下文验证要求观测到的 subject commit 和 route 与 Plan 一致，repeat index 在规定次数内，且每份 manifest 与决策使用相同的 run、Plan、Suite 和冻结的 verifier 策略。Manifest id 和 cell-attempt 元组必须唯一。复用的 execution id 必须在所有提供的角色和 manifest 中具有相同观测。这些属于结构约束，不证明进程隔离或实际 Provider 配置。

## EvalGateDecision

决策记录 `pass`、`block`、`retry` 或 `needs-attention`、稳定原因、run/Plan/Suite 引用、精确 manifest 引用、报告引用及所报告的结果、可选 verifier 结果、证据完整性与预算回执、可选基线差异引用和时间戳。Verifier 结果记录其 execution、冻结策略、精确报告与 manifest 集合、证据引用，以及 approved/rejected/unknown 结果。

`pass` 要求非空 manifest 引用、批准的 verifier 结果、附带回执的完整证据，以及预算授权/结算引用或显式豁免。Invalid 或 infrastructure-uncertain 报告结果永不通过。Plan 的必需预算不能替换为豁免；基线 Plan 必须有比较结果引用。每份通过的 manifest 都必须绑定作出决策的 verifier execution。非通过记录可以保留未知证据、缺失 verifier 和空 manifest，允许在执行前拒绝而不捏造观测。

`criteria-satisfied` 仅用于 pass。其他稳定原因为 `criteria-failed`、`invalid-result`、`infrastructure-uncertain`、`identity-mismatch`、`evidence-missing`、`evidence-corrupt`、`verifier-missing`、`verifier-rejected`、`budget-unknown`、`budget-exhausted`、`non-comparable` 和 `pending-verification`。此库拒绝矛盾声明，不选择统计阈值，也不将每种失败映射为固定决策。任务失败样本本身不决定回归策略。Retry 永不授予额外模型调用或支出权限。

决策上下文检查提供的 manifest 内容哈希是否对应引用身份，以及 verifier 的报告/manifest 引用是否与决策一致。它不读取报告、证明摘要、检查 case 完整性、重算基线统计、执行过期检查或认证回执。这些仍归可信生产者/Consumer 负责。JSON 与 Markdown 格式化器暴露相同的完整归一化记录；Markdown 包含决策摘要和明确的仅结构验证限制。

## 规范化身份

`serializeEvalContract` 拒绝非 JSON 值，对对象键排序并保留数组顺序。哈希前先解析契约：解析器只在重复检查后排序入口、能力和 manifest 引用集合。Route 顺序、参数数组和提供的 manifest 序列仍有意义。SHA-256 覆盖完整规范化解析记录，包括 kind 和 schema version；事实变化会产生不同的内容引用。不支持的格式直接拒绝，不经兼容垫片升级。

## 归属

Eval 拥有这些值及现有 runner/report 计算。RepoWorkspace、执行 Provider 和 Host 组合提供观测；证据 Consumer 校验保留的产物；预算 owner 提供资源决策；Activation 拥有继续运行的权限。此纯库不发布 Cordis 服务、配置项、Storage Domain、模型工具或运行时授权工厂。因此它不产生新的 Cordis/config/persistence 目录条目。
