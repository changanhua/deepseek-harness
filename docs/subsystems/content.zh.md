# 内容

[English](content.md) | 中文

[内容包](../../packages/content/README.zh.md) 让文本独立于会话保留下来。[定义包](../../packages/content/content/README.zh.md) 拥有 schema 和提供方无关的编辑约定；[content-domain](../../packages/content/content-domain/README.zh.md) 通过 Storage Domain 负责持久化。

## 记录与修订

[ContentEntrySchema](../../packages/content/content/src/schema.ts) 是派生记录类型的运行时 schema。一条内容包含不可变版本、可选工作草稿、来源身份、项目引用和已提交操作回执。内容库不拥有 Project、Work、Attempt 或 Acceptance 状态。

原文带有首个不可变版本。新想法从草稿开始，没有头版本。开始草稿时复制头版本；保存编辑只改变草稿。提交草稿会创建一个版本并移除草稿。每次成功修改都会推进条目修订；文本写入比较草稿修订和基础版本，元数据写入比较条目修订。因此，元数据变化无需使独立的文本编辑失效。

版本保留原样标题和正文。文本不裁剪、不正规化；孤立的 UTF-16 代理码点无法经 UTF-8 往返保存，因此会被拒绝。已存 SHA-256 摘要描述 UTF-8 正文文本，不代表未经观察的网络字节。来源身份与已保存内容彼此独立，因此失去来源访问权限不会移除已保存原文。

## 命令与权限

[ContentCommandSchema](../../packages/content/content/src/schema.ts) 接受手动创建、文本导入、草稿操作和元数据编辑。每次修改都携带操作身份。近期回执、创建记录和版本操作可区分相同请求重试与同一身份被用于另一请求。回执返回当次提交的修订，不是条目当前快照。没有回执表示结果未知，旧预期修订仍会被拒绝。

捕获操作只接收 Session 和消息引用。可信宿主代码同时提供来源解析器与同步授权回调。准备工作发生在写入链之外；提供方在提交前再次检查权限。手动提供的文本保持 `user-provided` 标记。读取、快照和回执方法同样要求授权。提供方返回独立数据副本，消费方不能通过保留的引用修改持久状态。

## 持久化与可用性

提供方在版本 1 的 `content_library` 中为每条内容保存一个聚合记录，使用 `entries` 表和 `single` 布局。它要求 `single-writer`、`commit-sync` 和 `private-root`；[存储](storage.zh.md) 拥有执行这些保证的责任。内容提供方拥有 Domain 句柄，后端插件拥有数据库连接。

存储不可用时仍可查询内容状态。保存成功必须以 Domain 写入完成为准。不确定的存储失败会禁止继续从可疑缓存读取或写入；恢复需要重新打开提供方及其后端。[提供方参考](../../packages/content/content-domain/README.zh.md) 拥有大小预算和操作限制。人类传输、Session 授权和浏览器工作流验收归其消费方负责。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcontent--content-abstract-seam"></a>

### `ctx.content` — `Content` (abstract seam)

Providers own atomic entries, serial mutations and immutable versions behind this service.

```ts cordis-catalog
/**
 * Return payload-free state even when storage cannot open.
 * @returns Current availability and configured byte limits.
 */
abstract status(): ContentStatus

/**
 * Authorize a read; unavailable reads reject.
 * @param id - Stored entry identity.
 * @param authorize - Trusted synchronous access check.
 * @returns A detached committed entry, or undefined when absent.
 */
abstract get(id: string, authorize: ContentAccess): ContentEntry | undefined

/**
 * Authorize and copy a consistent logical snapshot.
 * @param authorize - Trusted synchronous access check.
 * @returns Every committed entry, including drafts and original versions.
 */
abstract snapshot(authorize: ContentAccess): ContentSnapshot

/**
 * Query a known committed outcome; absence never proves non-commit.
 * @param entryId - Stored entry identity.
 * @param operationId - Original command identity.
 * @param authorize - Trusted synchronous access check.
 * @returns The saved outcome, or undefined when unknown.
 */
abstract receipt(entryId: string, operationId: string, authorize: ContentAccess): ContentReceipt | undefined

/**
 * Validate and commit one mutation after checking authorization at admission and execution.
 * Identical retries return the stored receipt; reused identities or stale revisions reject.
 * Inputs and results are detached. A resolved promise confirms durable storage.
 * @param command - Exact command retained by the caller across retries.
 * @param authorize - Trusted access check, repeated inside the write chain.
 * @returns The original or newly committed receipt.
 */
abstract execute(command: ContentCommand, authorize: ContentAccess): Promise<ContentReceipt>

/**
 * Authorize before resolving completed text outside the write chain, then authorize again and commit.
 * Only trusted host code supplies resolveSource; the request cannot supply verified body text.
 * Repeated source identity and body return the canonical creation receipt, even under a new
 * operation id. This is a lookup, not another accepted mutation; its id is not echoed or retained.
 * A changed body rejects. Independently generated titles never overwrite the first saved title.
 * @param command - Session and message references with a retained command identity.
 * @param resolveSource - Trusted host callback that reads completed source text.
 * @param authorize - Trusted access check, before source reading and inside the write chain.
 * @returns The canonical creation receipt for the captured source.
 */
abstract capture( command: CaptureCommand, resolveSource: ContentSourceResolver, authorize: ContentAccess, ): Promise<ContentReceipt>
```

Source: [`packages/content/content/src/index.ts`](../../packages/content/content/src/index.ts)
<!-- END GENERATED cordis-surface -->
