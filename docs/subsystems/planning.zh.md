# 项目规划

[English](planning.md) | 中文

Planning 为每个 Workspace 持有一个持久 Board。Board 记录人工安排的事项、不可变版本、依赖链接、复盘、草稿、来源溯源和交接引用。它帮助项目保留决策，但不会把计划卡当作执行权限。

## Board 与版本边界

每次写入都携带当前 Board 版本并通过 compare-and-set 提交。事项版本创建后不可变。后续版本会改变 head，但保留旧版本、其来源、复盘和 Delivery 交接。复盘指向精确事项和版本，因此旧 Packet 在事项已有新 head 后仍可追溯和复盘。

本地 provider 自行捕获来源。它把手动和链接引用视为未验证，校验 Workspace 所有的已存储 Session event，并在 Content 可用时读取精确保存版本。Board provider 缺失或不可用时操作失败；调用方不得用合成 Board 替代，也不得从 handoff 推断执行状态。

## 正式工作对象

Plan 仍是拥有不可变当前修订的条目。可选状态条目具有稳定 ID，种类为目标、已接受或未解决；旧意图、范围与验收字段继续保留，不通过迁移虚构内容。Focus 是一个 Plan 中可独立选择的可选部分，拥有自己的版本和状态。它不是执行任务，done 不会完成父对象。

Subject 引用明确指定 Plan 或 Focus。资源链接只保留可扩展的 kind/id/provider/revision/label 定位信息。外部系统继续拥有 Session 聊天记录、SBC 数据、solver 结果、浏览器事实和 Delivery 状态。上下文包投影当前正式条目和引用，不展开这些外部资源。

现有 Proposal 代次可以携带作用对象、基础修订、操作、来源及证据组成的 delta。采纳先校验精确代次和当前基础修订，再在一次 Board 提交内应用全部操作并生成新修订。基础修订过期时拒绝；调用方刷新后准备新提案。Session 绑定独立于浏览器选择，保留原始作用对象和基础修订。

## 权限与复盘

可选 FC27 SBC 设计案例将既有 Plan 修订和选中 Focus 冻结为独立探索记录。选择、坐标和移动撤销属于该记录，不属于 Board。读取将保留的基础标识与当前 Planning 事实比较，展示漂移而不替换投影或布局。[Planning Remote](../../packages/planning/planning-remote/README.zh.md) 拥有受容量约束的持久化；[Planning UI](../../packages/client/ui-planning/README.zh.md) 拥有交互。

浏览器 Remote 使用已认证的本地人工身份。模型工具推导发起 Agent、其当前 Workspace 和最新直接用户消息。调用方都不能提供另一个 actor、Workspace、来源哈希或持久 receipt。Planning 记录 completed review 只是一项复盘事实；它不会作出 Delivery 接纳决定。

## Delivery 边界

可选 bridge 冻结一个精确已采纳版本，并创建可恢复的 Delivery shaping Case。它将版本来源和稳定映射标识带入 Delivery。只有 Delivery 拥有需求批准、Packet 就绪、派发、执行、验证、证据发布和人工接纳。

浏览器 snapshot 可以将已链接的 Delivery 摘要作为只读 `executions` 加入。未组合 Delivery 时返回空列表。已链接 shaping Case 不是完成证明。只有所选 Plan 的已链接 packet 声明精确证据 id 时，Planning Remote 才能读取 Packet 证据；Delivery 负责校验字节读取。

## 延伸阅读

- [Planning 包组](../../packages/planning/README.zh.md)
- [Delivery 子系统](delivery.zh.md)

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxplanning--planning-abstract-seam"></a>

### `ctx.planning` — `Planning` (abstract seam)

Trusted Host-only planning seam. A trusted composition supplies PlanningAccess; this contract does not isolate callers from a malicious Host plugin. Providers reauthorize that supplied access before source reads and commits so a stale legitimate caller cannot write.

```ts cordis-catalog
/**
 * Read a detached Board snapshot.
 * @param access - Trusted Host-derived caller authority for one Workspace.
 * @param signal - Optional caller lifetime; cancellation prevents a result from being returned.
 * @returns A consumer-safe current Board snapshot without provider-private replay receipts.
 * @throws {PlanningError} When the caller is no longer authorized, the Workspace is unavailable, or the provider is closed.
 */
abstract snapshot(access: PlanningAccess, signal?: AbortSignal): Promise<PlanningBoardSnapshot>

/**
 * Atomically apply one CAS-fenced command.
 * @param access - Trusted Host-derived caller authority rechecked before the durable commit.
 * @param command - Strict command carrying the expected Board version and idempotency request id.
 * @param signal - Optional caller lifetime checked before externally observed work and commit.
 * @returns The committed or replayed mutation receipt; an identical request id returns its original receipt.
 * @throws {PlanningError} When authorization, references, version, capacity, source capture, or provider lifetime prevents the mutation.
 */
abstract execute( access: PlanningAccess, command: PlanningCommand, signal?: AbortSignal, ): Promise<PlanningMutationResult>

/**
 * Freeze one exact current revision for deterministic Delivery mapping without creating external work.
 * @param access - Trusted Host-derived caller authority rechecked before the durable handoff record is written.
 * @param input - Exact revision, repository, mapping version, and stable request identity to freeze.
 * @param signal - Optional caller lifetime checked before the durable write.
 * @returns The prepared durable handoff; retries with the same identity return that frozen record.
 * @throws {PlanningError} When direct-user authorization, revision identity, mapping identity, or provider lifetime is invalid.
 */
abstract prepareDeliveryHandoff( access: PlanningAccess, input: PrepareDeliveryHandoffInput, signal?: AbortSignal, ): Promise<PlanningHandoff>

/**
 * Bind a prepared handoff to the exact Case and Contract revision returned by Delivery.
 * @param access - Trusted Host bridge authority; providers reject a direct user or Agent caller for this transition.
 * @param input - Stable handoff key plus the Case and Contract revision identities returned by Delivery.
 * @param signal - Optional caller lifetime checked before the durable link is committed.
 * @returns The linked durable handoff; an identical recovery retry returns the same record.
 * @throws {PlanningError} When the prepared handoff is absent, identities conflict, authorization is invalid, or the provider is closed.
 */
abstract linkDeliveryHandoff( access: PlanningAccess, input: LinkDeliveryHandoffInput, signal?: AbortSignal, ): Promise<PlanningHandoff>
```

Source: [`packages/planning/planning/src/index.ts`](../../packages/planning/planning/src/index.ts)

<a id="ctxplanningdelivery--planningdelivery"></a>

### `ctx.planningDelivery` — `PlanningDelivery`

Host-only Planning-to-Delivery bridge. It freezes a Planning revision before it creates or links a recoverable shaping Case; it neither approves requirements nor accepts execution.

```ts cordis-catalog
/**
 * Prepare and recoverably link one adopted Planning revision to a Delivery shaping Case.
 * @param access - Trusted Host-derived direct-user authority; the bridge switches only its final link to bridge authority.
 * @param input - Exact Planning item and revision selected for handoff.
 * @param signal - Optional caller lifetime checked before bridge-side work.
 * @returns The prepared or linked durable Planning handoff, including Delivery identities once linked.
 * @throws {PlanningError} When authorization, route, revision, digest, or Delivery linkage is unavailable or conflicts.
 */
async handoff( access: PlanningAccess, input: PlanningDeliveryHandoffInput, signal?: AbortSignal, ): Promise<PlanningHandoff>
```

Source: [`packages/planning/planning-delivery-bridge/src/index.ts`](../../packages/planning/planning-delivery-bridge/src/index.ts)

<a id="ctxthinkingcase--thinkingagentowner"></a>

### `ctx.thinkingCase` — `ThinkingAgentOwner`

Host capability restricted to the real bound Thinking Agent; model-supplied identities are not accepted.

```ts cordis-catalog
/** Read the admitted run's frozen input after revalidating its live Agent and binding.
 * @param agent - Exact live caller in the restricted Thinking preset.
 * @param signal - Caller cancellation.
 * @returns Detached frozen context; rejects stale scope or missing admission.
 */
context(agent: Agent, signal: AbortSignal): Promise<ThinkingContextPack>

/** Persist a versioned suggestion without applying it to Planning or the canvas.
 * @param agent - Exact live caller bound to the run.
 * @param input - Draft, expected result version and stable retry identity.
 * @param signal - Caller cancellation.
 * @returns Committed result or the original receipt on identical retry.
 */
submit( agent: Agent, input: Omit<SubmitThinkingInput, 'runId'>, signal: AbortSignal, ): Promise<ThinkingResultRecord>

/** Check current preset membership without admitting a read or write.
 * @param sessionId - Native Session to inspect.
 * @returns Whether the live Agent is composed with the Thinking preset.
 */
isThinkingSession(sessionId: string): Promise<boolean>
```

Types: [Agent](core.zh.md)

Source: [`packages/planning/planning-remote/src/thinking-types.ts`](../../packages/planning/planning-remote/src/thinking-types.ts)
<!-- END GENERATED cordis-surface -->

## 开发备注

无。
