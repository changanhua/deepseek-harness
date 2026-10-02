# 资源预算

[English](budget.md) | 中文

[预算包组](../../packages/budget/README.zh.md)为 Session、Goal 和 Workflow 模型请求应用统一的持久资源策略。Token Meter 仍是测量读取方，Queue 资源容量仍是并发限制，两者都不授予额外模型开销。

## 作用域与记账

每个不可变作用域标识其 owner、父级、请求数及输入/输出/总 Token 上限、墙钟生命周期和耗尽动作。空上限不增加本层限制。每个请求都会检查完整父链。[Schema](../../packages/budget/budget/src/schema.ts) 和[公开视图](../../packages/budget/budget/src/types.ts)拥有确切取值定义。

owner 在一个版本化 Storage Domain 中串行处理预留、派发认领和结算。存储介质必须保证单写者、同步提交和私有根目录。作用域引用绑定不可变定义和创建时间，用量与撤销则是可变的 owner 事实。请求按 request/attempt 身份索引；输入变化会冲突，已保留的 attempt 不会重复派发。

调用适配器前，owner 持久化预留和确切派发认领，然后重新检查存活上下文和当前策略。LLM 最终检查覆盖直接请求及预备请求。Provider 用量在结束 chunk 发布前完成结算。确认未发出的取消请求会释放预留。缺失或无效用量保持 unknown；重启会释放未发出的预留、保留已派发的不确定性，并且不会主动派发工作。存储结果不确定时，后续准入关闭直到恢复。

文本输入预留明确标记为序列化字节估算。输出预留要求明确的正数上限。没有可信上界的图片会被拒绝。Provider 报告总量或完整缓存分桶时，实际用量包含缓存输入；缺失字段不等于零。这是资源记账，不是货币或账单级对账。

## 审批与生命周期

ask 决策在进入现有审批流程前已持久化。只有存活根 Agent 的直接人工回合可以询问。allowed-once 例外只覆盖确切 attempt 和耗尽的 ask 作用域，不能越过拒绝的祖先、撤销、时间到期或未知用量。未使用的例外额度不能供给后续请求。被中断或无人回答的问题在重启后仍保持暂停或拒绝。

Agent 绑定来自存活 registry 和 Goal owner，而非请求中声称的 session id。Workflow 子任务共享运行作用域，并在模型派发前持久化 Session 子级绑定。无法准入下一个自主请求时，Goal 续跑记录 `budget-exhausted`。已安装的上下文解析器或最终派发检查被移除后会拒绝调用，直到其 owner 恢复。

## 操作入口与限制

[人工命令](../../packages/budget/command-budget/README.zh.md)配置、读取、撤销和核对调用方的预算。Agent 不能提高或关闭自身上限。作用域定义不可变，账本容量明确；耗尽不会删除回执或重置历史。本地 LLM 边界之外的外部 Agent 服务需要单独的记账桥接。

预算服务为 Eval 及后续 Activation 调用方提供准入和回执接口，不实现自动激活、调度器、独立评分或可信 Eval 决策。[配置指南](../cookbook/trusted-eval-and-budget.zh.md)和[决策记录](../../.agents/notes/implemented/architecture/2026-10-02-trusted-eval-producers-and-resource-budgets.zh.md)说明组合方式与职责。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbudget--budget-abstract-seam"></a>

### `ctx.budget` — `Budget` (abstract seam)

Durable user resource policy; no model-facing mutation or monetary accounting.

```ts cordis-catalog
/**
 * Create immutable limits through a trusted Consumer, with idempotent scope identity.
 * @param input - Immutable subject, ancestor and resource policy.
 * @param authorize - Rechecked trusted authority before durable creation.
 * @returns Current scope snapshot; conflicting reuse rejects.
 */
abstract createScope(input: BudgetScopeInput, authorize: BudgetAuthority): Promise<BudgetSnapshot>

/**
 * Read current usage; exact references reject changed scope definitions.
 * @param reference - Scope id or exact owner-issued reference.
 * @returns Current cumulative usage, holds and policy.
 */
abstract inspect(reference: BudgetReference | string): BudgetSnapshot

/**
 * Find the immutable scope bound to an owner-derived subject.
 * @param subject - Subject identity obtained from its runtime owner.
 * @returns Current scope snapshot, or undefined when no scope is bound.
 */
abstract scopeFor(subject: BudgetSubject): BudgetSnapshot | undefined

/**
 * Permanently revoke a scope; descendants and pending dispatches observe it.
 * @param scopeId - Existing scope to revoke.
 * @param authorize - Trusted authority rechecked before persistence.
 */
abstract revoke(scopeId: string, authorize: BudgetAuthority): Promise<void>

/**
 * Read one retained reservation for operator/evaluation evidence.
 * @param requestId - Stable logical request identity.
 * @param attemptId - Exact paid dispatch attempt identity.
 * @returns Retained reservation, or undefined when none exists.
 */
abstract reservation(requestId: string, attemptId: string): BudgetReservationView | undefined

/**
 * Read a durable admission decision, including denied cases that never reached a provider.
 * @param requestId - Stable logical request identity.
 * @param attemptId - Exact dispatch attempt identity.
 * @returns Retained decision, or undefined before admission.
 */
abstract decision(requestId: string, attemptId: string): BudgetDecisionRecord | undefined

/**
 * Register the sole trusted interactive Consumer; absence of a handler never grants an exception.
 * @param approver - Host callback that obtains explicit Human approval.
 * @returns Disposer that removes this registration.
 */
abstract registerApprover(approver: BudgetApprover): () => void

/**
 * Settle an unknown attempt only after explicit operator verification; never automatically retry it.
 * @param requestId - Logical request holding unknown usage.
 * @param attemptId - Exact attempt to settle.
 * @param usage - Operator-verified actual input and output usage.
 * @param authorize - Trusted reconciliation authority rechecked before commit.
 */
abstract reconcile(requestId: string, attemptId: string, usage: BudgetUsage, authorize: BudgetAuthority): Promise<void>

/**
 * Register one owner-derived context source; registration is disposable and duplicate names reject.
 * @param owner - Stable runtime owner identity.
 * @param resolver - Callback deriving current subjects from trusted runtime state.
 * @returns Disposer; removal remains fail-closed for the required owner.
 */
abstract registerSubjectResolver(owner: string, resolver: BudgetSubjectResolver): () => void

/**
 * Run Host work under an exact grant; the operation must await all stream consumption.
 * @param reference - Exact owner-issued immutable scope reference.
 * @param operation - Work inheriting this scope for its asynchronous lifetime.
 * @returns The awaited operation result.
 */
abstract withScope<T>(reference: BudgetReference, operation: () => Promise<T>): Promise<T>

/**
 * Admit and account for one actual model dispatch and its entire iterator lifetime.
 * No callback is invoked on refusal; missing usage remains held for reconciliation.
 * @param request - Bounded input estimate, output ceiling and stable request/attempt identity.
 * @param dispatch - Invoked once after durable reservation, with the budget-owned cancellation signal.
 * @param observe - Extracts actual usage and completion from each provider chunk.
 * @param signal - Optional caller cancellation, combined with budget deadlines.
 * @returns Stream whose terminal result is published only after accounting settles.
 */
abstract streamModel<T>( request: BudgetRequest, dispatch: (signal: AbortSignal) => AsyncIterable<T>, observe: (chunk: T) => BudgetChunkObservation, signal?: AbortSignal, ): AsyncIterable<T>
```

Source: [`packages/budget/budget/src/index.ts`](../../packages/budget/budget/src/index.ts)
<!-- END GENERATED cordis-surface -->
