# Command Profiles

English | [中文](command-profiles.zh.md)

The command-profiles subsystem is a Command Knowledge Plane registry: stable knowledge about which executables a capability maps to. [`dsh-command-profile`](../../packages/context/command-profile) is the Service Definition, and [`dsh-tool-command-profile`](../../packages/extensions/tool-command-profile) is the model-facing Consumer. Knowledge stays parallel to Reality: the registry never probes executables and never depends on runtime facts, so a candidate name only connects the two planes through `runtime_inspect`.

Source: [`packages/context/command-profile/src/types.ts`](../../packages/context/command-profile/src/types.ts) and [`packages/context/command-profile/src/index.ts`](../../packages/context/command-profile/src/index.ts)

## Contribution storage and provenance

The registry stores `CommandProfileContribution` records — who contributed what to which profile — and computes the effective profile at read time. Each record carries its own provenance (`contributorId`, `source`, `profileId`), so there is no second entry point for identity, and disposing a contribution retracts only its own records.

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

The public plugin entry point pins authority to `plugin`: `contribute()` accepts only this record type, so a plugin cannot claim builtin or user provenance and never carries the user-only `candidateMode`/`disabled` flags.

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

## Merged view

A resolved profile is the merge of all active contributions. Identity fields resolve as user override > definition owner; aliases and tags union with case-normalized dedupe; candidates dedupe with full provenance and sort user > builtin > plugin.

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

## Query

`query({ query, limit? })` performs deterministic lexical matching: id exact/prefix, alias exact, displayName contains, tag exact, then description token. Matching trims and lowercases; same-rank matches sort by profile id; `limit` defaults to 5 and clamps to 1..10. Results never expose availability, so candidate ≠ existence stays explicit until `runtime_inspect` confirms presence.

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

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
