# Eval 契约

[English](eval.md) | 中文

本参考页描述可信 Plan 来源、Attempt 工作区及纯 [Eval 库](../../packages/eval/eval/README.zh.md)：评测意图、记录的执行身份及内部一致的决策。此库不执行观测、凭据访问、证据读取、预算准入或激活。现有 Suite/Run/report runner 保持确定性回放语义。

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

上下文验证要求 pass 时观测到的 subject commit 和 route 与 Plan 一致；非通过决策保留这些偏差作为失败证据。Repeat index 必须在 Plan 规定次数内，且每份 manifest 与决策使用相同的 run、Plan、Suite 和冻结的 verifier 策略。Manifest id 和 cell-attempt 元组必须唯一。复用的 execution id 必须在所有提供的角色和 manifest 中具有相同观测。这些属于结构约束，不证明进程隔离或实际 Provider 配置。

## EvalGateDecision

决策记录 `pass`、`block`、`retry` 或 `needs-attention`、稳定原因、run/Plan/Suite 引用、精确 manifest 引用、报告引用及所报告的结果、可选 verifier 结果、证据完整性与预算回执、可选基线差异引用和时间戳。Verifier 结果记录其 execution、冻结策略、精确报告与 manifest 集合、证据引用，以及 approved/rejected/unknown 结果。

`pass` 要求非空 manifest 引用、批准的 verifier 结果、附带回执的完整证据，以及预算授权/结算引用或显式豁免。Invalid 或 infrastructure-uncertain 报告结果永不通过。Plan 的必需预算不能替换为豁免；基线 Plan 必须有比较结果引用。每份通过的 manifest 都必须绑定作出决策的 verifier execution。非通过记录可以保留未知证据、缺失 verifier 和空 manifest，允许在执行前拒绝而不捏造观测。

`criteria-satisfied` 仅用于 pass。其他稳定原因为 `criteria-failed`、`invalid-result`、`infrastructure-uncertain`、`identity-mismatch`、`evidence-missing`、`evidence-corrupt`、`verifier-missing`、`verifier-rejected`、`budget-unknown`、`budget-exhausted`、`non-comparable` 和 `pending-verification`。此库拒绝矛盾声明，不选择统计阈值，也不将每种失败映射为固定决策。任务失败样本本身不决定回归策略。Retry 永不授予额外模型调用或支出权限。

决策上下文检查提供的 manifest 内容哈希是否对应引用身份，以及 verifier 的报告/manifest 引用是否与决策一致。它不读取报告、证明摘要、检查 case 完整性、重算基线统计、执行过期检查或认证回执。这些仍归可信生产者/Consumer 负责。JSON 与 Markdown 格式化器暴露相同的完整归一化记录；Markdown 包含决策摘要和明确的仅结构验证限制。

## 规范化身份

`serializeEvalContract` 拒绝非 JSON 值，对对象键排序并保留数组顺序。哈希前先解析契约：解析器只在重复检查后排序入口、能力和 manifest 引用集合。Route 顺序、参数数组和提供的 manifest 序列仍有意义。SHA-256 覆盖完整规范化解析记录，包括 kind 和 schema version；事实变化会产生不同的内容引用。不支持的格式直接拒绝，不经兼容垫片升级。

## 归属

Eval 拥有这些值及现有 runner/report 计算。RepoWorkspace、执行 Provider 和 Host 组合提供观测；证据 Consumer 校验保留的产物；预算 owner 提供资源决策；Activation 拥有继续运行的权限。此纯库不发布 Cordis 服务、配置项、Storage Domain、模型工具或运行时授权工厂。因此它不产生新的 Cordis/config/persistence 目录条目。

## 可信来源与运行准入

[Plan 来源](../../packages/eval/eval-plans-local/README.zh.md)拥有受信根目录下的完整 Host 固定内容和持久运行准入。发现结果返回相同的路径无关摘要；解析保留声明的 keyless/live 模式及最新预检。准入只接受本 owner 签发的不可变解析对象，并在写入前重新检查当前来源与预算祖先链。相同请求和相同解析身份恢复同一运行，变化则冲突。解析和准入均不启动 Queue 或模型。

Tool 预检比较全局已注册契约，Preset digest 使用换行归一化的组合文本，Skill 身份包含指令内容和来源。精确执行组合和最终可见能力仍由执行器记录；Host 配置中的 keyless 模式不是执行证明。完整配置参见[指南](../cookbook/trusted-eval-and-budget.zh.md)。 仅供 Host 使用的 `resolvedRequirements.tools` 和 `.skills` 保留批准的产物身份，经过深冻结并纳入 `resolvedDigest`；下游调用方将其与 Manifest 的实际观测身份比对。真实调用的解析还要求每条 route 具有正数输出上限，以及 owner 验证的有限且有到期时间的预算授权；只有无密钥解析可以豁免。

## Attempt 工作目录

[RepositoryWorkspace 桥接](../../packages/eval/eval-repo-workspace/README.zh.md)先解析真实完整 commit，再使用 Queue 的 Attempt id 打开独立租约。准备策略包括空目录、受根目录和数量/字节限制的固定 commit fixture，以及仓库检出。输出记录 Provider 观察的 commit、准备 digest 和租约处置，不持久化绝对路径。

执行器在子任务静止后报告确定完成，桥接才移除租约。不确定执行、复用冲突或清理不确定不会变成成功；Queue 包装返回 unknown，并由 Queue 保留 Attention。已有准备标记阻止在重启后复用未知目录。此桥接不实现 subject/grader 或可信 GateDecision。

## 隔离 cell 执行

[隔离执行库](../../packages/eval/eval-isolated/README.zh.md) 消费 owner 签发的准入，把单个 cell 绑定到真实活动 Queue Attempt 和仓库租约。Host 分别锁定 Subject 与 Grader 的可信核心产物；Windows AppContainer 身份和 Job 隔离任务代码及角色私有状态。经过认证的核心注册表快照提供实际能力，Host 观测提供构建、配置、进程身份和经过最终 Budget guard 的模型派发事实。Agent 输出仍是不可信任务材料。

`IsolatedCellBinding` 是可持久化、无路径的选择数据，不是执行权限。`PreparedIsolatedCell.start` 要求匹配的活动 Attempt。`IsolatedCellResult` 区分执行状态与业务结果，包含可空的实际 Manifest 和已交接证据摘要。`ExecutionEvidenceBundle` 包含不可变且绑定角色的材料引用及内容；只有精确确认才允许释放。结算、进程静止或交接不确定时，返回 Queue unknown Attention 并保留托管责任。这些契约不认证任意修改核心，也不生成 GateDecision。

## 持久运行与决策

[EvalRuns](../../packages/eval/eval-runs/README.zh.md) 定义提交、查询、条件控制和安全证据读取。其[本地生产者](../../packages/eval/eval-runs-local/README.zh.md)复用原 Plan admission 和 Queue Batch，持久记录控制意图，并从原始材料、当前 Attempt 和 Budget 回执派生私有 Gate 快照。历史 Plan recover 不依赖模型可用性，不签发新的 admission。公开视图省略原始提示词、凭据和 Host 路径。

[EvalGates](../../packages/eval/eval-gates/README.zh.md) 将保留的 EvalGateDecision 与 current/stale 有效性分开。[本地 Gate 生产者](../../packages/eval/eval-gates-local/README.zh.md)串行处理同一 run 的评估，在独立 Profile 中运行固定检查器，保留原始输入、准确报告和 Host 身份材料。过期决策仍可查看；授权消费者必须检查当前有效性。首版仅支持无基线的确定性输出条件。

## 显式续跑

[EvalActivation](../../packages/eval/eval-activation/README.zh.md) 使用 Host 固定的 ContinuationPolicy 和从真实 Gate/Queue 派生的请求，最多认领一次 Grant。其[本地生产者](../../packages/eval/eval-activation-local/README.zh.md)核对目标 Session 工作区、Goal 版本和 Budget 父链，在专用无自动 Goal 驱动器的 Profile 中派发一轮。consumed 只证明准确消息的持久回执，不表示 Goal 完成；无法证实的恢复边界保持 needs-attention，不自动重发。[CLI 消费者](../../packages/eval/eval-app/README.zh.md)只接受已配置策略的标识，不接受这些私有授权事实。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxevalactivation--evalactivation-abstract-seam"></a>

### `ctx.evalActivation` — `EvalActivation` (abstract seam)

Durable, explicit bridge from one approved Eval terminal result to at most one Goal round.

```ts cordis-catalog
/**
 * Persist or recover one exact single-use continuation intent.
 * @param access Current Host-bound actor and Workspace authorization.
 * @param request Host-derived Grant, terminal Attempt and fixed continuation message.
 * @param signal Caller cancellation; committed claims remain recoverable.
 * @returns Durable receipt state; consumption never asserts Goal completion.
 */
abstract activate(access: EvalActivationAccess, request: EvalActivationRequest, signal?: AbortSignal): Promise<EvalActivationView>

/**
 * Read a path-free continuation projection without resuming an Agent or sending a follow-up.
 * @param access Current Workspace read authorization.
 * @param id Exact retained continuation identity.
 * @returns Safe receipt without private message text or filesystem locations.
 */
abstract get(access: EvalActivationAccess, id: string): Promise<EvalActivationView>

/**
 * Reconcile persisted intent after a restart; uncertain delivery stays needs-attention.
 * @param access Current authorization for the actor that owns the claimed Grant.
 * @param id Exact existing continuation identity.
 * @param signal Cancellation of recovery; an unproven dispatch is never repeated.
 * @returns Refreshed receipt based on exact persisted Goal message identity.
 */
abstract reconcile(access: EvalActivationAccess, id: string, signal?: AbortSignal): Promise<EvalActivationView>
```

Source: [`packages/eval/eval-activation/src/index.ts`](../../packages/eval/eval-activation/src/index.ts)

<a id="ctxevalgates--evalgates-abstract-seam"></a>

### `ctx.evalGates` — `EvalGates` (abstract seam)

Gate producer contract for CLI and later Activation Consumers.

```ts cordis-catalog
/**
 * Re-read original Host facts, evaluate one frozen policy idempotently, and retain the conclusion.
 * @param access Current Workspace and principal authorization.
 * @param runId Existing admitted run whose original evidence is available to the Host.
 * @param policyId Host-approved fixed verifier policy.
 * @param signal Cancellation of verification; no partial pass is retained.
 * @returns Retained decision and independently refreshed evidence validity.
 */
abstract evaluate(access: EvalRunAccess, runId: string, policyId: string, signal?: AbortSignal): Promise<EvalGateView>

/**
 * Read one previously retained conclusion without re-running the verifier.
 * @param access Current Workspace read authorization.
 * @param id Exact retained decision identity.
 * @returns Historical decision with current or stale validity; neither implies permission to act.
 */
abstract get(access: EvalRunAccess, id: string): Promise<EvalGateView>
```

Source: [`packages/eval/eval-gates/src/index.ts`](../../packages/eval/eval-gates/src/index.ts)

<a id="ctxevalplans--evalplans-abstract-seam"></a>

### `ctx.evalPlans` — `EvalPlans` (abstract seam)

Trusted project Plan source. This owner does not execute, grade, enqueue or attest model outcomes.

```ts cordis-catalog
/**
 * Read safe source summaries under the caller's exact live Workspace authority.
 * @param access - Exact live Workspace and trusted entrypoint authorization.
 * @param signal - Optional caller cancellation.
 * @returns Safe Plan summaries without Host paths or credential material.
 */
abstract discover(access: EvalPlanAccess, signal?: AbortSignal): Promise<readonly EvalPlanSummary[]>

/**
 * Resolve approved immutable source and fresh runtime preflight. The returned object is Host-only.
 * @param access - Exact live Workspace and trusted entrypoint authorization.
 * @param selection - Only the configured Plan id and version.
 * @param signal - Optional caller cancellation.
 * @returns Owner-minted resolution with current readiness evidence.
 */
abstract resolve(access: EvalPlanAccess, selection: EvalPlanSelection, signal?: AbortSignal): Promise<ResolvedEvalPlan>

/**
 * Revalidate one Provider-minted resolution and durably mint/recover the same run identity.
 * @param access - Current Workspace authority, rechecked before persistence.
 * @param resolved - Exact resolution object issued by this Provider.
 * @param requestId - Stable admission identity; changed resolution reuse rejects.
 * @param signal - Optional caller cancellation.
 * @returns Durable admission receipt; replay recovers the original run identity.
 */
abstract admit(access: EvalPlanAccess, resolved: ResolvedEvalPlan, requestId: string, signal?: AbortSignal): Promise<EvalPlanAdmission>

/**
 * Recover original admitted facts without requiring current Provider availability or remaining Budget.
 * @param access - Current read authority for the exact live Workspace and an originally allowed entrypoint.
 * @param requestId - Original admission request identity in that Workspace.
 * @param signal - Read cancellation; this operation performs no execution or new admission.
 * @returns Frozen historical snapshot, or null when this Workspace has no matching admission.
 */
abstract recover(access: EvalPlanAccess, requestId: string, signal?: AbortSignal): Promise<RecoveredEvalPlan | null>

/**
 * Atomically publish a complete configured source generation, or retain the prior generation on error.
 * @param authorize - Host reload authority, rechecked before publication.
 * @param signal - Optional caller cancellation.
 */
abstract reload(authorize: () => void | Promise<void>, signal?: AbortSignal): Promise<void>
```

Source: [`packages/eval/eval-plans/src/index.ts`](../../packages/eval/eval-plans/src/index.ts)

<a id="ctxevalruns--evalruns-abstract-seam"></a>

### `ctx.evalRuns` — `EvalRuns` (abstract seam)

Shared run-control and report contract for CLI and future Web Consumers.

```ts cordis-catalog
/**
 * Admit or reconcile one exact request through the Plan owner and Queue.
 * @param access Current Workspace and principal authority.
 * @param input Stable request, approved Plan selection and Host policy id.
 * @param signal Caller cancellation; committed intent remains recoverable.
 * @returns Safe current view; repeated intent resolves the original run.
 */
abstract start(access: EvalRunAccess, input: StartEvalRun, signal?: AbortSignal): Promise<EvalRunView>

/**
 * Read one run without dispatching work or requiring unspent model budget.
 * @param access Current read authority.
 * @param runId Exact admitted run identity.
 * @returns Current Queue-derived status and checked evidence availability.
 */
abstract get(access: EvalRunAccess, runId: string): Promise<EvalRunView>

/**
 * List bounded run projections for one authorized Workspace.
 * @param access Current Workspace read authority.
 * @returns Views without private evidence bodies, raw Queue payloads or Host paths.
 */
abstract list(access: EvalRunAccess): Promise<readonly EvalRunView[]>

/**
 * Verify and inspect one historical Attempt without executing or exposing private material.
 * @param access Current Workspace read authority.
 * @param runId Exact admitted run identity.
 * @param cellId Exact cell identity from the run view.
 * @param attemptId Real Queue Attempt identity from that cell.
 * @returns Evidence availability, material identities and allowlisted role/accounting facts.
 */
abstract evidence(access: EvalRunAccess, runId: string, cellId: string, attemptId: string): Promise<EvalEvidenceView>

/**
 * Persist an operator action and conditionally apply it to the observed Queue state.
 * @param access Current operator identity and authority.
 * @param input Exact operation and expected safe-view revision.
 * @returns Reconciled view; uncertainty is retained instead of replaying against a later Attempt.
 */
abstract control(access: EvalRunAccess, input: EvalRunControl): Promise<EvalRunView>
```

Source: [`packages/eval/eval-runs/src/index.ts`](../../packages/eval/eval-runs/src/index.ts)
<!-- END GENERATED cordis-surface -->
