/** Command Knowledge Plane public types. @module @deepseek-ai/dsh-command-profile/src/types */

/** Who contributed a knowledge record. */
export type CommandProfileSource = 'builtin' | 'plugin' | 'user'

/** How a user contribution combines with lower-layer candidates. */
export type CommandProfileCandidateMode = 'append' | 'replace'

/** A candidate executable identifier: a bare executable token, never an invocation recipe. */
export type CommandCandidateName = string

/**
 * One contributor's knowledge record for one profile. The storage unit: the
 * registry keeps contributions, never the merged profile, so provenance
 * survives every merge and a contributor's disposal retracts only its own
 * records. `candidateMode` and `disabled` are valid only for `source: 'user'`.
 */
export interface CommandProfileContribution {
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

/** Provenance of one candidate: who contributed it. */
export interface CommandCandidateProvenance {
  readonly source: CommandProfileSource
  readonly contributorId: string
}

/** One merged candidate with its complete provenance. */
export interface ResolvedCommandCandidate {
  /** The candidate executable name. Never implies installation. */
  readonly command: CommandCandidateName
  /** Every contribution that named this candidate, deduplicated. */
  readonly provenance: readonly CommandCandidateProvenance[]
}

/** The effective profile after all contributions merge. */
export interface ResolvedCommandProfile {
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

/** Lexical profile query: deterministic, no semantic search. */
export interface CommandProfileQuery {
  /** Query text matched against id, aliases, displayName, tags, and description. */
  readonly query: string
  /** Result cap; default 5, clamped to 1..10. */
  readonly limit?: number
}
