/**
 * Command Knowledge Plane registry. Contributions are the storage unit;
 * resolved profiles are merged views. The registry never probes executables
 * and never depends on runtime facts — Knowledge and Reality stay parallel,
 * connected only by candidate names flowing into `runtime_inspect`.
 *
 * @module @deepseek-ai/dsh-command-profile
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { validateCandidate } from './candidate.ts'
import { BUILTIN_COMMAND_PROFILE_CONTRIBUTIONS } from './builtin.ts'
import type {
  CommandCandidateProvenance,
  CommandProfileCandidateMode,
  CommandProfileContribution,
  CommandProfilePluginContribution,
  CommandProfileQuery,
  CommandProfileSource,
  ResolvedCommandCandidate,
  ResolvedCommandProfile,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    commandProfiles: CommandProfiles
  }
}

/** Registry projection configuration. */
export interface Config {
  /** Register the built-in verified profiles when the service starts. */
  includeBuiltins?: boolean
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  includeBuiltins: z.boolean().default(true),
})

/** Settings namespace carrying user knowledge contributions; kebab-case because the settings platform requires it. */
export const COMMAND_PROFILES_SETTINGS_NAMESPACE = settingsNamespace('command-profiles')

/** Contributor id of every user settings contribution. */
export const USER_CONTRIBUTOR_ID = 'settings'

/** Profile id grammar: lowercase kebab-case, alphanumeric start. */
const PROFILE_ID_PATTERN = /^[a-z][a-z0-9-]*$/
/** Contributor id grammar: alnum start, then alnum, dot, underscore, or dash. */
const CONTRIBUTOR_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i
/** Default and maximum query result cap. */
const DEFAULT_QUERY_LIMIT = 5
const MAX_QUERY_LIMIT = 10
/** Attempt-order rank per contribution source (user first). */
const SOURCE_RANK: Record<CommandProfileSource, number> = { user: 0, builtin: 1, plugin: 2 }

/** One stored contribution. Array order is registration order. */
interface ContributionRecord {
  readonly contribution: CommandProfileContribution
}

/** A contributor identity used by merge rules. */
interface ContributorIdentity {
  readonly source: CommandProfileSource
  readonly contributorId: string
}

/** User-persistable partial profile contribution. */
export interface CommandProfilesSettingsProfile {
  /** Target profile id; must be unique within the settings section. */
  id: string
  displayName?: string
  description?: string
  aliases?: string[]
  tags?: string[]
  candidates?: string[]
  candidateMode?: CommandProfileCandidateMode
  disabled?: boolean
}

/** The `commandProfiles` settings section: an array of partial contributions. */
export interface CommandProfilesSettingsSection {
  profiles: CommandProfilesSettingsProfile[]
}

const PROFILE_SETTINGS_SCHEMA = z.object({
  id: z.string().required(),
  displayName: z.string(),
  description: z.string(),
  aliases: z.array(z.string()),
  tags: z.array(z.string()),
  candidates: z.array(z.string()),
  candidateMode: z.union(['append', 'replace'] as const),
  disabled: z.boolean(),
})

/** Schema resolving the `commandProfiles` settings namespace. */
export const COMMAND_PROFILES_SETTINGS_SCHEMA: z<CommandProfilesSettingsSection> = z.object({
  profiles: z.array(PROFILE_SETTINGS_SCHEMA).default([]),
})

const EMPTY_SETTINGS_SECTION: CommandProfilesSettingsSection = { profiles: [] }

/** Registry for command-knowledge contributions with merge and query. */
export class CommandProfiles extends Service {
  static Config = Config

  private readonly contributions = new Map<string, ContributionRecord[]>()
  private readonly includeBuiltins: boolean
  private readonly userDisposers: Array<() => void> = []
  private userSource: () => CommandProfilesSettingsSection = () => EMPTY_SETTINGS_SECTION

  /**
   * Create the registry, register the built-in profiles, and attach the user
   * settings namespace. Both registrations ride the owning fiber.
   * @param ctx - service owner context.
   * @param config - built-in seed control.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'commandProfiles')
    this.includeBuiltins = config.includeBuiltins ?? true
    if (this.includeBuiltins) {
      for (const contribution of BUILTIN_COMMAND_PROFILE_CONTRIBUTIONS) {
        this.registerContribution(contribution)
      }
    }
    installSettingsSection(ctx, COMMAND_PROFILES_SETTINGS_NAMESPACE, COMMAND_PROFILES_SETTINGS_SCHEMA, EMPTY_SETTINGS_SECTION, {
      setSource: (source) => {
        this.userSource = source
      },
      onChange: () => {
        this.reloadUserContributions()
      },
      validate: (value) => {
        this.validateSettingsSection(value)
      },
    })
  }

  /**
   * Register one plugin knowledge record for a profile. Provenance authority is
   * fixed to `plugin`; builtin and user records are produced only by the
   * registry's built-in seed and the settings adapter.
   * @param contribution - the plugin's record; source is implied.
   * @returns the effect disposer retracting exactly this record.
   * @throws TypeError or Error when the record is malformed or violates a merge rule.
   */
  contribute(contribution: CommandProfilePluginContribution): () => void {
    return this.registerContribution({ ...contribution, source: 'plugin' })
  }

  /**
   * Resolve one profile's effective view, or `undefined` when the profile is
   * absent or explicitly disabled by the user.
   * @param id - stable profile id.
   * @returns the merged profile with candidates carrying full provenance.
   */
  resolve(id: string): ResolvedCommandProfile | undefined {
    const records = this.contributions.get(id)
    if (records === undefined || records.length === 0) return undefined
    const userRecords = records.filter(record => record.contribution.source === 'user')
    if (userRecords.some(record => record.contribution.disabled === true)) return undefined

    const owner = this.definitionOwner(records)
    const ownerRecord = owner === undefined
      ? undefined
      : records.find(record => record.contribution.source === owner.source
        && record.contribution.contributorId === owner.contributorId)
    const userDisplayName = userRecords.map(record => record.contribution.displayName).find(value => value !== undefined)
    const userDescription = userRecords.map(record => record.contribution.description).find(value => value !== undefined)
    const displayName = userDisplayName ?? ownerRecord?.contribution.displayName
    const description = userDescription ?? ownerRecord?.contribution.description
    if (displayName === undefined || description === undefined) {
      throw new Error(`command profile ${JSON.stringify(id)} resolved without displayName or description`)
    }

    return {
      id,
      displayName,
      description,
      aliases: this.mergeTokens(records, ownerRecord, 'aliases'),
      tags: this.mergeTokens(records, ownerRecord, 'tags'),
      candidates: this.mergeCandidates(records),
    }
  }

  /**
   * Deterministic lexical query over profiles, bounded by {@link CommandProfileQuery.limit}.
   * @param input - query text and optional result cap.
   * @returns matched effective profiles in rank order, then id order.
   */
  query(input: CommandProfileQuery): ResolvedCommandProfile[] {
    const queryText = input.query.trim()
    if (queryText.length === 0) return []
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_QUERY_LIMIT, 1), MAX_QUERY_LIMIT)
    const scored: Array<{ rank: number; profile: ResolvedCommandProfile }> = []
    for (const id of this.contributions.keys()) {
      const profile = this.resolve(id)
      if (profile === undefined) continue
      const rank = this.matchRank(profile, queryText)
      if (rank !== undefined) scored.push({ rank, profile })
    }
    scored.sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank
      return left.profile.id < right.profile.id ? -1 : left.profile.id > right.profile.id ? 1 : 0
    })
    return scored.slice(0, limit).map(entry => entry.profile)
  }

  /**
   * Every active profile's effective view in id order.
   * @returns profiles that are neither absent nor user-disabled.
   */
  list(): ResolvedCommandProfile[] {
    return [...this.contributions.keys()]
      .map(id => this.resolve(id))
      .filter((profile): profile is ResolvedCommandProfile => profile !== undefined)
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  }

  /**
   * Register one owned record with full provenance. The only internal entry
   * point: the built-in seed and the settings adapter produce `builtin` and
   * `user` records here; the public {@link contribute} pins `source: 'plugin'`.
   * @param contribution - fully-attributed knowledge record.
   * @returns the effect disposer retracting exactly this record.
   * @throws TypeError or Error when the record is malformed or violates a merge rule.
   */
  private registerContribution(contribution: CommandProfileContribution): () => void {
    this.validateContribution(contribution)
    const record: ContributionRecord = { contribution }
    const dispose = this.ctx.effect(() => {
      const existing = this.contributions.get(contribution.profileId)
      if (existing === undefined) {
        this.contributions.set(contribution.profileId, [record])
      } else {
        existing.push(record)
      }
      return () => {
        const current = this.contributions.get(contribution.profileId)
        if (current === undefined) return
        const index = current.indexOf(record)
        if (index >= 0) current.splice(index, 1)
        if (current.length === 0) this.contributions.delete(contribution.profileId)
      }
    }, `commandProfiles.contribute(${JSON.stringify(contribution.profileId)}, ${JSON.stringify(contribution.contributorId)})`)
    // The effect disposer settles asynchronously; the retraction itself is
    // synchronous bookkeeping, so the public disposer is a plain void call.
    return () => {
      void dispose()
    }
  }

  /**
   * Prospective validation of a whole settings section before any old user
   * contribution is retracted. A partial update is legal only when a non-user
   * lower layer (builtin or plugin) already defines the profile; a pure
   * user-defined profile must supply the full identity and a candidate on
   * every update.
   * @param value - the resolved settings section, schema-valid by construction.
   * @throws Error when the section would leave a profile malformed.
   */
  private validateSettingsSection(value: CommandProfilesSettingsSection): void {
    const seen = new Set<string>()
    for (const profile of value.profiles) {
      if (seen.has(profile.id)) {
        throw new Error(`commandProfiles settings contain duplicate user profile id ${JSON.stringify(profile.id)}`)
      }
      seen.add(profile.id)
      if (!this.hasLowerLayerDefinition(profile.id)
        && (profile.displayName === undefined
          || profile.description === undefined
          || (profile.candidates?.length ?? 0) === 0)) {
        throw new Error(
          `new user command profile ${JSON.stringify(profile.id)} requires displayName, description, and at least one candidate`,
        )
      }
    }
  }

  /** Whether a non-user (builtin or plugin) contribution already defines the profile. */
  private hasLowerLayerDefinition(profileId: string): boolean {
    return (this.contributions.get(profileId) ?? []).some(record => record.contribution.source !== 'user')
  }

  private validateContribution(contribution: CommandProfileContribution): void {
    if (!CONTRIBUTOR_ID_PATTERN.test(contribution.contributorId)) {
      throw new TypeError(
        `contributorId ${JSON.stringify(contribution.contributorId)} must be a valid contributor id`
        + ' (alphanumeric start, then alphanumeric, dot, underscore, or dash)',
      )
    }
    if (!PROFILE_ID_PATTERN.test(contribution.profileId)) {
      throw new TypeError(
        `profileId ${JSON.stringify(contribution.profileId)} must match ${String(PROFILE_ID_PATTERN)}`,
      )
    }
    if (contribution.source !== 'user') {
      if (contribution.candidateMode !== undefined) {
        throw new TypeError('candidateMode is only valid for user contributions')
      }
      if (contribution.disabled !== undefined) {
        throw new TypeError('disabled is only valid for user contributions')
      }
    }
    if (contribution.displayName !== undefined && !isNonBlank(contribution.displayName)) {
      throw new TypeError(`displayName ${JSON.stringify(contribution.displayName)} must be non-blank with no surrounding whitespace`)
    }
    if (contribution.description !== undefined && !isNonBlank(contribution.description)) {
      throw new TypeError(`description ${JSON.stringify(contribution.description)} must be non-blank with no surrounding whitespace`)
    }
    for (const alias of contribution.aliases ?? []) {
      if (!isNonBlank(alias)) {
        throw new TypeError(`alias ${JSON.stringify(alias)} must be non-blank with no surrounding whitespace`)
      }
    }
    for (const tag of contribution.tags ?? []) {
      if (!isNonBlank(tag)) {
        throw new TypeError(`tag ${JSON.stringify(tag)} must be non-blank with no surrounding whitespace`)
      }
    }
    for (const candidate of contribution.candidates ?? []) validateCandidate(candidate)

    const existing = this.contributions.get(contribution.profileId) ?? []
    if (contribution.source === 'builtin' && existing.some(record => record.contribution.source === 'builtin')) {
      throw new Error(`builtin command profile ${JSON.stringify(contribution.profileId)} is already registered`)
    }
    // A brand-new profile must be complete at registration; a malformed record
    // is rejected here, never left to blow up at resolve time.
    if (existing.length === 0) {
      if (contribution.displayName === undefined || contribution.description === undefined) {
        throw new Error(
          `new command profile ${JSON.stringify(contribution.profileId)} requires displayName and description`,
        )
      }
      if ((contribution.candidates?.length ?? 0) === 0) {
        throw new Error(
          `new command profile ${JSON.stringify(contribution.profileId)} requires at least one candidate`,
        )
      }
    }
    if (contribution.displayName !== undefined || contribution.description !== undefined) {
      const owner = this.definitionOwner(existing)
      if (owner !== undefined && contribution.source === 'plugin') {
        if (owner.source !== 'plugin' || owner.contributorId !== contribution.contributorId) {
          throw new Error(
            `plugin ${JSON.stringify(contribution.contributorId)} may not redefine identity fields for profile `
            + `${JSON.stringify(contribution.profileId)} owned by ${owner.source}/${owner.contributorId}`,
          )
        }
      }
    }
  }

  private definitionOwner(records: readonly ContributionRecord[]): ContributorIdentity | undefined {
    const builtin = records.find(record => record.contribution.source === 'builtin')
    if (builtin !== undefined) {
      return { source: 'builtin', contributorId: builtin.contribution.contributorId }
    }
    const firstPlugin = records.find(record => record.contribution.source === 'plugin')
    if (firstPlugin !== undefined) {
      return { source: 'plugin', contributorId: firstPlugin.contribution.contributorId }
    }
    return undefined
  }

  /**
   * Merge candidates with full provenance. Candidates sort by their highest
   * source rank (user > builtin > plugin), then lexically by command name —
   * never by registration order. Each candidate's provenance sorts by source
   * rank, then contributor id lexically.
   */
  private mergeCandidates(records: readonly ContributionRecord[]): ResolvedCommandCandidate[] {
    const replaceMode = records
      .filter(record => record.contribution.source === 'user')
      .some(record => record.contribution.candidateMode === 'replace')
    const sources = replaceMode
      ? records.filter(record => record.contribution.source === 'user')
      : records
    const provenanceByCommand = new Map<string, Map<string, CommandCandidateProvenance>>()
    for (const record of sources) {
      for (const command of record.contribution.candidates ?? []) {
        let byContributor = provenanceByCommand.get(command)
        if (byContributor === undefined) {
          byContributor = new Map()
          provenanceByCommand.set(command, byContributor)
        }
        byContributor.set(
          `${record.contribution.source}:${record.contribution.contributorId}`,
          { source: record.contribution.source, contributorId: record.contribution.contributorId },
        )
      }
    }
    const candidates: ResolvedCommandCandidate[] = []
    for (const [command, byContributor] of provenanceByCommand) {
      candidates.push({
        command,
        provenance: [...byContributor.values()].sort((left, right) => {
          const rankDiff = SOURCE_RANK[left.source] - SOURCE_RANK[right.source]
          if (rankDiff !== 0) return rankDiff
          return left.contributorId < right.contributorId ? -1 : left.contributorId > right.contributorId ? 1 : 0
        }),
      })
    }
    candidates.sort((left, right) => {
      const leftRank = Math.min(...left.provenance.map(provenance => SOURCE_RANK[provenance.source]))
      const rightRank = Math.min(...right.provenance.map(provenance => SOURCE_RANK[provenance.source]))
      if (leftRank !== rightRank) return leftRank - rightRank
      return left.command < right.command ? -1 : left.command > right.command ? 1 : 0
    })
    return candidates
  }

  private mergeTokens(
    records: readonly ContributionRecord[],
    ownerRecord: ContributionRecord | undefined,
    field: 'aliases' | 'tags',
  ): string[] {
    const result: string[] = []
    const seen = new Set<string>()
    const add = (value: string): void => {
      const key = value.trim().toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      result.push(value)
    }
    for (const record of records.filter(item => item.contribution.source === 'user')) {
      for (const value of record.contribution[field] ?? []) add(value)
    }
    if (ownerRecord !== undefined) {
      for (const value of ownerRecord.contribution[field] ?? []) add(value)
    }
    const remaining = records
      .filter(record => record !== ownerRecord && record.contribution.source === 'plugin')
      .sort((left, right) => left.contribution.contributorId < right.contribution.contributorId ? -1
        : left.contribution.contributorId > right.contribution.contributorId ? 1 : 0)
    for (const record of remaining) {
      for (const value of record.contribution[field] ?? []) add(value)
    }
    return result
  }

  private matchRank(profile: ResolvedCommandProfile, queryText: string): number | undefined {
    const query = queryText.toLowerCase()
    if (profile.id.toLowerCase() === query) return 0
    if (profile.id.toLowerCase().startsWith(query)) return 1
    if (profile.aliases.some(alias => alias.toLowerCase() === query)) return 2
    if (profile.displayName.toLowerCase().includes(query)) return 3
    if (profile.tags.some(tag => tag.toLowerCase() === query)) return 4
    if (profile.description.toLowerCase().split(/\s+/).some(token => token.toLowerCase() === query)) return 5
    return undefined
  }

  private reloadUserContributions(): void {
    for (const dispose of this.userDisposers) dispose()
    this.userDisposers.length = 0
    const profiles = this.userSource().profiles
    const seen = new Set<string>()
    for (const profile of profiles) {
      if (seen.has(profile.id)) {
        throw new Error(`commandProfiles settings contain duplicate user profile id ${JSON.stringify(profile.id)}`)
      }
      seen.add(profile.id)
      this.userDisposers.push(this.registerContribution({
        contributorId: USER_CONTRIBUTOR_ID,
        source: 'user',
        profileId: profile.id,
        ...(profile.displayName !== undefined ? { displayName: profile.displayName } : {}),
        ...(profile.description !== undefined ? { description: profile.description } : {}),
        ...(profile.aliases !== undefined ? { aliases: profile.aliases } : {}),
        ...(profile.tags !== undefined ? { tags: profile.tags } : {}),
        ...(profile.candidates !== undefined ? { candidates: profile.candidates } : {}),
        ...(profile.candidateMode !== undefined ? { candidateMode: profile.candidateMode } : {}),
        ...(profile.disabled !== undefined ? { disabled: profile.disabled } : {}),
      }))
    }
  }
}

function isNonBlank(value: string): boolean {
  return value.length > 0 && value.trim() === value
}

export default CommandProfiles
