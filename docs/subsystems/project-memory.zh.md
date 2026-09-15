# Project Memory 子系统

[English](project-memory.md) | 中文

## 范围

Project Memory 在既有 Workspace 身份下保存简短的可复用命题。[包能力族](../../packages/memory/README.zh.md) 将 Definition 与本地来源检查和持久化分开。原文档和 Session 日志继续拥有各自内容的权威性。

## 记录与决策

[记录 schema](../../packages/memory/memory/src/schema.ts) 是字段与校验规则的事实来源。一个 `MemoryRecord` 包含不可变内容版本、生效与候选指针、人工决策及有序变更回执。记录版本保护每次原子变更；回执与数据变化同时提交。版本指针必须能从完整历史中推导出来。

| 操作 | 持久化效果 |
| --- | --- |
| 提出候选 | 追加一个候选，不替换尚未处理的候选，也不改变生效版本 |
| 接纳 | 激活精确候选或重新确认生效版本；记录命令证据和下次复核期限 |
| 拒绝 | 拒绝待处理候选，同时保留已有生效版本 |
| 撤回 | 清除生效指针，同时保留所有内容版本与决策 |

相同重试键和规范化输入返回首次变更结果；同一键对应不同输入时拒绝。写入失败保持旧投影不变。不提供跨记录事务或自动删除。

## 权限与来源有效性

Provider 从发起操作的活动 Session 与 Workspace Registry 推导项目。调用者无法区分外项目记录与不存在的记录。决策要求精确且仍在执行的人工记忆命令，以及成功完成的 Session 持久化检查点。仅创建候选不能激活记忆。

已接纳记忆可以处于 `usable`、`source-changed`、`source-unavailable`、`review-due`、`conflicted` 或 `withdrawn` 状态。来源观察区分指纹匹配、内容改变、数据不可读，以及因其他可用性条件失败而尚未检查。模型可见的不可用结果不包含历史命题正文或来源预览。IO 完成后，读取重新检查身份、版本、复核期限和冲突；搜索还会在返回前核对整个项目记录快照。快照改变时允许重试一次，持续变化则返回 `concurrent-change`。

文件指纹覆盖 Agent 文件系统执行世界中有界的完整字节。Session 来源保留物理存储前缀中的事件身份与文本摘要，排除恢复时合成的事件。接纳允许复用，但不证明真实，也不授予执行权限。

## 生命周期

[本地 provider](../../packages/memory/memory-local/README.zh.md) 拥有独占锁、`project_memory` domain 与未完成操作。卸载拒绝新工作，等待已准入操作完成，关闭存储，再释放匹配的锁。异常中断的 Host 留下锁，重启前需要操作者核验。Session 历史不是记忆数据库；Tool Consumer 通过普通工具结果记录其实际暴露的记忆正文。

## 请求与结果

[公开类型](../../packages/memory/memory/src/types.ts) 定义服务边界。`MemoryProposal` 包含候选、来源定位符与幂等键；修订还需目标 id 和预期记录版本。`MemoryDecisionRequest` 将确切内容版本和记录版本条件绑定到活动人工命令。两类写入均返回 `MemoryMutation`，包含持久 id、内容版本与记录版本。

`MemorySearchRequest` 限定文本查询与可选标签筛选。`MemorySearchResult` 包含可用的 `MemoryReadResult` 以及当前项目内的排除计数。读取结果包含来源状态、`checkedAt`、版本身份与可用性；只有可用结果才包含命题正文。

`MemoryInspectionRequest` 通过当前人工命令授权列表、指定版本查看或决策的确切目标。返回的 `MemoryInspectedRecord` 在分离的历史副本上增加被查看版本的来源观察与有界预览。查看不接纳候选，也不作为模型工具公开。

## Cordis API

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxprojectmemory--projectmemory-abstract-seam"></a>

### `ctx.projectMemory` — `ProjectMemory` (abstract seam)

Providers own durable records and reauthorize every call against the Agent's Workspace.

```ts cordis-catalog
/**
 * Search accepted claims after source, deadline and conflict checks.
 * @param agent - Real initiating Agent; never a caller-provided workspace id.
 * @param request - Bounded lexical query.
 * @param signal - Cooperative cancellation.
 * @returns usable claims and withheld counts within this project only.
 */
abstract search(agent: Agent, request: MemorySearchRequest, signal?: AbortSignal): Promise<MemorySearchResult>

/**
 * Read one currently usable revision; unavailable bodies remain withheld.
 * @param agent - Initiating Agent.
 * @param id - Memory id in the caller's project.
 * @param signal - Cooperative cancellation.
 * @returns a checked revision or an unavailable result; inaccessible ids reject identically to unknown ids.
 */
abstract read(agent: Agent, id: string, signal?: AbortSignal): Promise<MemoryReadResult>

/**
 * Persist a candidate and its receipt together, without activating it.
 * @param agent - Initiating Agent and provenance owner.
 * @param input - Candidate input; all fields are runtime validated.
 * @param signal - Cancellation before commit prevents admission; committed retries use the same key.
 * @returns the durable mutation identity; changed input under one key rejects.
 */
abstract propose(agent: Agent, input: MemoryProposal, signal?: AbortSignal): Promise<MemoryMutation>

/**
 * Apply a human command to an exact revision under a record-version fence.
 * @param agent - Agent whose session contains the authenticated command invocation.
 * @param request - Command evidence and exact decision target.
 * @param signal - Cooperative cancellation before the commit boundary.
 * @returns the durable decision receipt; fabricated commands, stale versions and invalid sources reject.
 */
abstract decide(agent: Agent, request: MemoryDecisionRequest, signal?: AbortSignal): Promise<MemoryMutation>

/**
 * Inspect candidate and historical content through a current human command.
 * @param agent - Receiving Agent.
 * @param request - Exact logged list/show command or decision target identity.
 * @param signal - Cooperative cancellation.
 * @returns detached records authorized for human inspection, never a model approval capability.
 */
abstract inspect(agent: Agent, request: MemoryInspectionRequest, signal?: AbortSignal): Promise<readonly MemoryInspectedRecord[]>
```

Types: [Agent](core.zh.md)

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
