# Command Profiles

[English](command-profiles.md) | 中文

命令知识平面子系统：关于"某个能力可能对应哪些可执行程序"的稳定知识注册表。[`dsh-command-profile`](../../packages/context/command-profile) 是 Service Definition，[`dsh-tool-command-profile`](../../packages/extensions/tool-command-profile) 是模型侧 Consumer。知识与现实保持平行：注册表从不探测可执行程序、从不依赖 runtime facts，两条平面只通过候选名经 `runtime_inspect` 相连。

Source: [`packages/context/command-profile/src/types.ts`](../../packages/context/command-profile/src/types.ts) 与 [`packages/context/command-profile/src/index.ts`](../../packages/context/command-profile/src/index.ts)

## 贡献存储与 provenance

注册表存 `CommandProfileContribution` 记录——谁、向哪个 profile 贡献了什么——并在读取时计算有效 profile。每条记录自带 provenance（`contributorId`、`source`、`profileId`），因此不存在第二个身份入口；释放一条贡献只撤回它自己的记录。

```ts type-equiv
/**
 * One contributor's knowledge record for one profile. The storage unit: the
 * registry keeps contributions, never the merged profile, so provenance
 * survives every merge and a contributor's disposal retracts only its own
 * records. `candidateMode` and `disabled` are valid only for `source: 'user'`.
 */
interface CommandProfileContribution {
  /** Who contributed this record (builtin package id, plugin id, or `'settings'`). */
  readonly contributorId: string
  /** The contribution authority. */
  readonly source: CommandProfileSource
  /** The target profile's stable id. */
  readonly profileId: string
  /** Human display name; required to define a brand-new profile. */
  readonly displayName?: string
  /** One-line description; required to define a brand-new profile. */
  readonly description?: string
  /** Additional lookup names for this profile. */
  readonly aliases?: readonly string[]
  /** Free-form discovery tags. */
  readonly tags?: readonly string[]
  /** Candidate executable names for this profile. */
  readonly candidates?: readonly CommandCandidateName[]
  /** How candidates combine with lower layers; user contributions only. */
  readonly candidateMode?: CommandProfileCandidateMode
  /** Hide the whole profile from query results; user contributions only. */
  readonly disabled?: boolean
}
```

公共 plugin 入口把 authority 钉死为 `plugin`：`contribute()` 只接受这一记录类型，因此 plugin 不能声称 builtin 或 user provenance，也绝不携带仅用户可用的 `candidateMode`/`disabled` 标志。

```ts type-equiv
/**
 * A public plugin knowledge record. `source` is fixed to `plugin`: plugins may
 * not claim builtin or user authority, and the user-only `candidateMode` and
 * `disabled` flags are absent from the public API.
 */
interface CommandProfilePluginContribution {
  /** Who contributed this record (a plugin id). */
  readonly contributorId: string
  /** The target profile's stable id. */
  readonly profileId: string
  /** Human display name; required to define a brand-new profile. */
  readonly displayName?: string
  /** One-line description; required to define a brand-new profile. */
  readonly description?: string
  /** Additional lookup names for this profile. */
  readonly aliases?: readonly string[]
  /** Free-form discovery tags. */
  readonly tags?: readonly string[]
  /** Candidate executable names for this profile; at least one to define a brand-new profile. */
  readonly candidates?: readonly CommandCandidateName[]
}
```

```ts type-equiv
/** Who contributed a knowledge record. */
type CommandProfileSource = 'builtin' | 'plugin' | 'user'
```

```ts type-equiv
/** A candidate executable identifier: a bare executable token, never an invocation recipe. */
type CommandCandidateName = string
```

```ts type-equiv
/** How a user contribution combines with lower-layer candidates. */
type CommandProfileCandidateMode = 'append' | 'replace'
```

## 合并视图

有效 profile 是全部活跃贡献的合并。身份字段解析为用户覆盖 > definition owner；别名与标签做不区分大小写的去重并集；候选去重并完整保留 provenance，按用户 > 内置 > plugin 排序。

```ts type-equiv
/** Provenance of one candidate: who contributed it. */
interface CommandCandidateProvenance {
  readonly source: CommandProfileSource
  readonly contributorId: string
}
```

```ts type-equiv
/** One merged candidate with its complete provenance. */
interface ResolvedCommandCandidate {
  /** The candidate executable name. Never implies installation. */
  readonly command: CommandCandidateName
  /** Every contribution that named this candidate, deduplicated. */
  readonly provenance: readonly CommandCandidateProvenance[]
}
```

```ts type-equiv
/** The effective profile after all contributions merge. */
interface ResolvedCommandProfile {
  /** Stable profile id. */
  readonly id: string
  /** Resolved display name (user override wins over the definition owner). */
  readonly displayName: string
  /** Resolved description (user override wins over the definition owner). */
  readonly description: string
  /** Union of active aliases, ordered user → owner → remaining plugins. */
  readonly aliases: readonly string[]
  /** Union of active tags, ordered user → owner → remaining plugins. */
  readonly tags: readonly string[]
  /** Merged candidates in attempt order: user → builtin → plugin. */
  readonly candidates: readonly ResolvedCommandCandidate[]
}
```

## 查询

`query({ query, limit? })` 做确定性词法匹配：id 精确/前缀、alias 精确、displayName 包含、tag 精确、description token。匹配时 trim 并忽略大小写；同档结果按 profile id 排序；`limit` 默认 5，钳制在 1..10。结果从不暴露可用性，因此"候选 ≠ 存在"保持显式，直到 `runtime_inspect` 确认存在。

```ts type-equiv
/** Lexical profile query: deterministic, no semantic search. */
interface CommandProfileQuery {
  /** Query text matched against id, aliases, displayName, tags, and description. */
  readonly query: string
  /** Result cap; default 5, clamped to 1..10. */
  readonly limit?: number
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcommandprofiles--commandprofiles"></a>

### `ctx.commandProfiles` — `CommandProfiles`

Registry for command-knowledge contributions with merge and query.

```ts cordis-catalog
/**
 * Register one plugin knowledge record for a profile. Provenance authority is
 * fixed to `plugin`; builtin and user records are produced only by the
 * registry's built-in seed and the settings adapter.
 * @param contribution - the plugin's record; source is implied.
 * @returns the effect disposer retracting exactly this record.
 * @throws TypeError or Error when the record is malformed or violates a merge rule.
 */
contribute(contribution: CommandProfilePluginContribution): () => void

/**
 * Resolve one profile's effective view, or `undefined` when the profile is
 * absent or explicitly disabled by the user.
 * @param id - stable profile id.
 * @returns the merged profile with candidates carrying full provenance.
 */
resolve(id: string): ResolvedCommandProfile | undefined

/**
 * Deterministic lexical query over profiles, bounded by {@link CommandProfileQuery.limit}.
 * @param input - query text and optional result cap.
 * @returns matched effective profiles in rank order, then id order.
 */
query(input: CommandProfileQuery): ResolvedCommandProfile[]

/**
 * Every active profile's effective view in id order.
 * @returns profiles that are neither absent nor user-disabled.
 */
list(): ResolvedCommandProfile[]
```

Source: [`packages/context/command-profile/src/index.ts`](../../packages/context/command-profile/src/index.ts)
<!-- END GENERATED cordis-surface -->
