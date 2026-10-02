# Initiative

[English](initiative.md) | 中文

Initiative 拥有 Human 与 Agent proposer 共用的 Planning 前 Candidate。immutable origin 与 append-only revision 区分最初假设和后续调查。支持证据与反证保留为指向原 owner 的独立引用；提供 locator 或 digest 不等于核实。

## Authority and persistence

provider 从 live Agent/Session 派生 Workspace 和 actor。人工操作必须具有 exact unfinished Commands event。Agent 可 propose、refine 和记录调查 recommendation，但不能 defer、drop 或 promote。调查不执行工具、不创建 Agent、不改变可用权限。Candidate 数据是参考材料，不是可执行 policy。

Storage Domain 保留单个原子 Workspace 记录。绑定 actor/payload 的 receipt 跨重启保留。Human assess 通过现有 RIR owner 和 runner 捕获精确不可变 Candidate revision。Human promotion 在 Planning propose 前预留持久 intent；可选 assessmentId 选择已验证的固定 Assessment，包括旧 revision，并将完整 baseline 与 Human rationale 一起冻结。恢复重放该请求，不重新评估或替换 baseline。pending promotion 冻结 Candidate 编辑；确定的 Planning CAS 拒绝可以刷新 Planning 尝试。canonical Planning items/revisions 和 Delivery 状态不变，聚合 Board version 增加。

可选的 [Planning Review 消费者](../../packages/initiative/tool-initiative-review/README.zh.md)为每条 Review 持久保存一个新建、补充或不行动决策，其上下文摘要绑定 Planning 输入 heads 和完整 Candidate 比较快照。`InitiativePage.snapshotDigest` 标识 Workspace 全部 Candidate 记录，不受过滤或分页影响，也不包含外部 RIR 关联。propose/investigate 接受可选的 `expectedSnapshotDigest`；owner 在自身写队列内、回执回放之后检查它。可信 Host 的 `InitiativeInvocation.validateIntake` 可通过重新核对其他 owner 来拒绝新的入口写入，但不授予权限或重入 Initiative。准入是乐观检查，不跨 owner 冻结 Planning。

## Queries and dependencies

读取投影使用 CandidateSummary，以及所选不可变 revision、revision count、调查和最新 disposition。可选 RIR 关系校验 Workspace、Candidate id、精确 revision、digest 和保存文本。fresh 表示评估内容匹配当前 head，drift 表示有效旧 revision；缺失 revision 为 unavailable，不一致记录为 unknown。这些状态不认证当前 DSH 能力、后端身份或证据真实性。缺失或关闭的 Assessment provider 保持 unavailable。

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
 * @returns Candidate facts and bounded exact-subject RIR relations, never inferred evidence verification.
 */
abstract read(agent: Agent, query: InitiativeQuery, invocation?: InitiativeInvocation, signal?: AbortSignal): Promise<InitiativePage>
```

Types: [Agent](core.zh.md)

Source: [`packages/initiative/initiative/src/index.ts`](../../packages/initiative/initiative/src/index.ts)
<!-- END GENERATED cordis-surface -->

## Dev Note

None.
