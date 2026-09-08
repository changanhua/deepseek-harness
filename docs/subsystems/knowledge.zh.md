# 知识库

[English](knowledge.md) | 中文

[知识包族](../../packages/knowledge/README.zh.md)拥有基于来源的可编辑知识库，将内容与业务提交同 Queue 执行分开。[决策记录](../../.agents/notes/implemented/feature/2026-09-08-knowledge-base-native-codex.zh.md)说明了该归属边界，各包 README 维护配置和用户操作。

## 业务值

[模型 schema](../../packages/knowledge/knowledge-base/src/model.ts)拒绝未知字段。项目、种子、来源和条目 ID 使用有界小写标识符，能够安全映射为受管理文件名。来源内容版本和产物摘要相互独立：`snapshotId` 对规范化文本的规范表示计算哈希，产物哈希覆盖精确 UTF-8 字节。

| 值 | 契约 |
|---|---|
| `ProjectSpec` | 标题、读者任务、语言和种子；各种子声明目标、类型、允许来源、必需覆盖及无环内容依赖。 |
| `SourceSnapshot` | 不可变逻辑来源/版本身份、文本、URL、采集时间、原始及规范化哈希和提取器版本；无法取得的追溯信息明确表示。 |
| `KnowledgeEntry` | 封闭 frontmatter 和 Markdown 正文、适用条件、绑定来源快照的字面引用；`depends` 传播输入变化，`related` 仅关联阅读内容。 |
| `KnowledgeCheck` | 当前输入指纹、必需/覆盖数量、无必需种子时为 null 的覆盖率、发布资格及各条目问题。 |

[状态 schema](../../packages/knowledge/knowledge-base/src/state.ts)定义 `knowledge_base` Domain。项目记录保存已确认规格、来源历史与可用性观察、当前条目提交、阶段绑定及不可变发布记录。control 表保存原生 Codex 的持久停止原因。同一受信 Profile 内的项目由其会话共享，业务 Domain 不提供 session 私有 ACL。Queue 状态只被引用，不从 Markdown 重建。

## 阶段和审查身份

`PreparedStage` 固定项目、条目、操作、预期工作文件哈希、输入指纹和完整提示词。Queue 桥接拥有 `knowledge.stage@1`，稳定准入将阶段绑定到一个 Work。`StageRecord` 在接收候选前保留返回响应哈希及其 Work/Attempt 归属。prepared/publishing/completed 描述业务提交进度，不代表 Queue 执行状态。

`EntryCommit` 绑定精确 Markdown 字节、不可变内容、输入身份、便于阅读的修订序号和可选审查。审查结论为 pass/fail/unresolved；工作文件或任何被判断输入变化后，仅有通过结论仍不足以发布。指纹包含生成/审查配方及可观察执行配置。一轮临时原生适配器不暴露继承后的模型解析结果或用量，因此这些值保留 unknown，也不承诺恢复远程会话。

## 发布和恢复

正式版本包含已检查条目、项目与地图视图、来源元数据、审查/检查摘要以及文件哈希清单。部分草稿列出缺失或未验证工作，不改变当前发布版本。来源全文保留在本地不可变历史中，发布元数据不包含完整来源正文。

Domain 拥有 `currentRelease`。仓库打开时核验选定版本并重建 `current-release.json`，其中允许 null 选择，从而修复跨存储中断后的文件投影。回退选择已经核验的不可变发布版本，保留工作文件。文件替换检查读取后的变更，在冲突时保留候选产物，不承诺跨存储事务或断电耐久。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [WorkView](task-queue.zh.md)

Source: [`packages/knowledge/knowledge-base-task-queue/src/index.ts`](../../packages/knowledge/knowledge-base-task-queue/src/index.ts)
<!-- END GENERATED cordis-surface -->
