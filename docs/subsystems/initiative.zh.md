# Initiative

[English](initiative.md) | 中文

Initiative 拥有 Human 与 Agent proposer 共用的 Planning 前 Candidate。immutable origin 与 append-only revision 区分最初假设和后续调查。支持证据与反证保留为指向原 owner 的独立引用；提供 locator 或 digest 不等于核实。

## Authority and persistence

provider 从 live Agent/Session 派生 Workspace 和 actor。人工操作必须具有 exact unfinished Commands event。Agent 可 propose、refine 和记录调查 recommendation，但不能 defer、drop 或 promote。调查不执行工具、不创建 Agent、不改变可用权限。Candidate 数据是参考材料，不是可执行 policy。

Storage Domain 保留单个原子 Workspace 记录。Record/head CAS 和 payload-bound receipt 跨重启保留。人工晋升先持久化 intent，只调用 Planning propose，再记录稳定 Proposal 关系。恢复重放固定 Planning 请求，即便 Proposal 之后已被处置。pending promotion 冻结 Candidate 编辑；确定的 Planning CAS 拒绝可以更新尝试，同时保留原 Candidate key。canonical Planning items/revisions 与 Delivery 状态不变，但聚合 Board version 会增加。

## Queries and dependencies

读取投射使用独立 CandidateSummary 类型，另含所选 immutable revision、revision count、对应调查和最新 disposition。summary metadata 保留 origin、lineage 和 promotion 关系。旧 revision 显式读取；drift 比较所选版本与当前 head。过滤和分页限制 Candidate 列表。真实 RIR owner 缺失，因此 RIR availability 明确为 unavailable，assessment history 为空。这不代表 RIR bridge 已实现，也不证明真实模型自主 vertical。

参见 [Candidate 包与可选配置](../../packages/initiative/README.zh.md)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxinitiative--initiative-abstract-seam"></a>

### `ctx.initiative` — `Initiative` (abstract seam)

Candidate owner; callers supply a live Agent, never a claimed actor or Workspace.

```ts cordis-catalog
/**
 * Commit an authorized Candidate fact or explicit Human promotion.
 * @param agent - Exact live runtime caller, revalidated at durable commits.
 * @param input - Strict mutation with idempotency key and exact versions where required.
 * @param invocation - Commands-owned identity for Human calls; absent for model Tools.
 * @param signal - Caller cancellation, checked before commits.
 * @returns Original durable receipt on an identical authorized replay.
 */
abstract execute( agent: Agent, input: InitiativeCommand, invocation?: InitiativeInvocation, signal?: AbortSignal, ): Promise<InitiativeReceipt>

/**
 * Read detached Candidate history in the caller's current Workspace.
 * @param agent - Exact live runtime caller.
 * @param query - Exact revision or bounded filters.
 * @param invocation - Active Human command identity when outside an Agent turn.
 * @param signal - Caller cancellation.
 * @returns Candidate facts and explicitly unavailable RIR relations, never inferred verification.
 */
abstract read(agent: Agent, query: InitiativeQuery, invocation?: InitiativeInvocation, signal?: AbortSignal): Promise<InitiativePage>
```

Types: [Agent](core.zh.md)

Source: [`packages/initiative/initiative/src/index.ts`](../../packages/initiative/initiative/src/index.ts)
<!-- END GENERATED cordis-surface -->

## Dev Note

None.
