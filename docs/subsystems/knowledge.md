# Knowledge libraries

English | [中文](knowledge.zh.md)

The [knowledge package group](../../packages/knowledge/README.md) owns source-grounded, editable libraries. It separates content and business commits from Queue execution. The [decision record](../../.agents/notes/implemented/feature/2026-09-08-knowledge-base-native-codex.md) explains that ownership boundary; package READMEs own configuration and user operations.

## Business values

The [model schemas](../../packages/knowledge/knowledge-base/src/model.ts) reject unknown fields. Project, seed, source and entry IDs use bounded lowercase identifiers that are safe as managed filenames. Source content versions and artifact digests remain separate: `snapshotId` hashes canonical normalized text, while artifact hashes cover exact UTF-8 bytes.

| Value | Contract |
|---|---|
| `ProjectSpec` | Title, reader task, language and seeds; each seed declares its goal, type, allowed sources, required coverage and acyclic content dependencies. |
| `SourceSnapshot` | Immutable logical source/version identity, text, URL, capture time, raw and normalized hashes, and extractor version. Unavailable provenance is explicit. |
| `KnowledgeEntry` | Closed frontmatter plus Markdown body, applicable conditions and literal citations bound to source snapshots. `depends` propagates input changes; `related` only links reading material. |
| `KnowledgeCheck` | Current input fingerprint, required/covered counts, coverage or null when no seeds are required, publishability and per-entry problems. |

The [state schemas](../../packages/knowledge/knowledge-base/src/state.ts) define the `knowledge_base` Domain. Project records hold approved specifications, source history and availability observations, current entry commits, stage bindings and immutable release records. Its control table holds the persistent native-Codex stop reason. A project is shared by sessions in the same trusted Profile; the business Domain has no session-private ACL. Queue state is referenced, never reconstructed from Markdown.

## Stage and review identity

`PreparedStage` freezes the project, entry, action, expected working-file hash, input fingerprint and complete prompt. The Queue bridge owns `knowledge.stage@1`; stable admission binds the stage to one Work. A `StageRecord` retains the returned response hash and Work/Attempt owner before accepting a candidate. Its prepared/publishing/completed values describe business commit progress rather than Queue execution status.

`EntryCommit` binds exact Markdown bytes, immutable content, input identity, a readable revision number and an optional review. Review decisions are pass/fail/unresolved; a passing decision alone is insufficient when the working file or any judged input changed. The fingerprint includes the generator/reviewer recipe and observable execution configuration. The one-shot native adapter does not expose inherited model resolution or usage, so those values remain unknown; it does not promise replay of a remote thread.

## Publication and recovery

Formal releases include checked entry versions, project/map views, source metadata, review/check summaries and a manifest of file hashes. A partial draft lists missing or unverified work and does not update the current release. Source text remains in local immutable history; release metadata excludes the full source text.

The Domain owns `currentRelease`. Opening the repository validates the selected release and reconstructs `current-release.json`, including a null selection. This repairs the file projection after a cross-store interruption. Rollback selects a verified immutable release and preserves working files. File replacement detects changes since reading, retains candidate artifacts on conflict and does not claim a cross-store transaction or power-loss durability.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxknowledgebase--knowledgebaseservice"></a>

### `ctx.knowledgeBase` — `KnowledgeBaseService`

Domain 和内容文件的唯一业务 owner。

Source: [`packages/knowledge/knowledge-base/src/index.ts`](../../packages/knowledge/knowledge-base/src/index.ts)

<a id="ctxknowledgequeue--knowledgequeueservice"></a>

### `ctx.knowledgeQueue` — `KnowledgeQueueService`

将知识阶段绑定到持久 Queue，并维护项目级生成停止门。

```ts cordis-catalog
/**
 * 准备并准入一个新阶段；全局生成已停止时拒绝写入 Queue。
 *
 * @param projectId - 受管理项目 ID。
 * @param entryId - 目标条目或规划阶段 ID。
 * @param action - 该阶段执行的业务动作。
 * @returns Queue 工作及持久阶段身份。
 */
async enqueueStage( projectId: string, entryId: string, action: PreparedStage['action'], ): Promise<{ workId: string; stageId: string }>

/**
 * 返回已绑定知识阶段的 Queue 视图，拒绝其他工作种类或失配绑定。
 *
 * @param workId - Queue 工作 ID。
 * @returns 经项目阶段绑定核验的工作视图。
 */
status(workId: string): WorkView

/** 显式停止整个知识生成器，等待已知在途调用清理并保留未知结果。 */
async stopGeneration(): Promise<void>

/**
 * 请求取消已绑定的知识阶段。
 *
 * @param workId - Queue 工作 ID。
 * @returns Queue 接受取消请求后完成。
 */
cancel(workId: string): Promise<void>

/**
 * 仅为本地校验拒绝的响应创建修正阶段；未知结果不得绕过恢复核验。
 *
 * @param workId - 失败的 Queue 工作 ID。
 * @returns 新修正阶段的 Queue 工作及阶段身份。
 */
async correctStage(workId: string): Promise<{ workId: string; stageId: string }>

/**
 * 仅重试确定尚未发起模型请求的失败工作。
 *
 * @param workId - 可重试的 Queue 工作 ID。
 * @returns Queue 接受重试请求后完成。
 */
async retryStage(workId: string): Promise<void>

/**
 * 只在仓库存在可验证完成记录时授权未知工作重新调度。
 *
 * @param workId - 状态为 unknown 的 Queue 工作 ID。
 * @returns Queue 接受恢复授权后完成。
 */
async resumeStage(workId: string): Promise<void>
```

Types: [WorkView](task-queue.md)

Source: [`packages/knowledge/knowledge-base-task-queue/src/index.ts`](../../packages/knowledge/knowledge-base-task-queue/src/index.ts)
<!-- END GENERATED cordis-surface -->
