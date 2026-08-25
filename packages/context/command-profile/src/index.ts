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

/** One stored contribution. */
interface ContributionRecord {
  readonly contribution: CommandProfileContribution
}

/** A contributor identity used by merge rules. */
interface ContributorIdentity {
  readonly source: CommandProfileSource
  readonly contributorId: string
}

/** The fields that determine whether one contribution can define a profile by itself. */
interface DefinitionFields {
  readonly displayName?: string
  readonly description?: string
  readonly candidates?: readonly string[]
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

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'commandProfiles')
    this.includeBuiltins = config.includeBuiltins ?? true
    if (this.includeBuiltins) {
      for (const contribution of BUILTIN_COMMAND_PROFILE_CONTRIBUTIONS) this.registerContribution(contribution)
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

  /** Register one plugin knowledge record; public provenance is always plugin authority. */
  contribute(contribution: CommandProfilePluginContribution): () => void {
    return this.registerContribution({ ...contribution, source: 'plugin' })
  }

  /** Resolve one effective profile, hiding absent, disabled, and orphaned contributions. */
  resolve(id: string): ResolvedCommandProfile | undefined {
    const records = this.contributions.get(id)
    if (records === undefined || records.length === 0) return undefined
    const userRecords = records.filter(record => record.contribution.source === 'user')
    if (userRecords.some(record => record.contribution.disabled === true)) return undefined

    const owner = this.definitionOwner(records)
    if (owner === undefined) return undefined
    const ownerRecord = records.find(record => record.contribution.source === owner.source
      && record.contribution.contributorId === owner.contributorId
      && isCompleteDefinition(record.contribution))
    if (ownerRecord === undefined) return undefined

    const userDisplayName = userRecords.map(record => record.contribution.displayName).find(value => value !== undefined)
    const userDescription = userRecords.map(record => record.contribution.description).find(value => value !== undefined)
    const displayName = userDisplayName ?? ownerRecord.contribution.displayName
    const description = userDescription ?? ownerRecord.contribution.description
    if (displayName === undefined || description === undefined) return undefined

    return {
      id,
      displayName,
      description,
      aliases: this.mergeTokens(records, ownerRecord, 'aliases'),
      tags: this.mergeTokens(records, ownerRecord, 'tags'),
      candidates: this.mergeCandidates(records),
    }
  }

  /** Deterministic lexical query over effective profiles. */
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

  /** Every active profile's effective view in id order. */
  list(): ResolvedCommandProfile[] {
    return [...this.contributions.keys()]
      .map(id => this.resolve(id))
      .filter((profile): profile is ResolvedCommandProfile => profile !== undefined)
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  }

  /** Register one owned record with full provenance. */
  private registerContribution(contribution: CommandProfileContribution): () => void {
    this.validateContribution(contribution)
    const record: ContributionRecord = { contribution }
    const dispose = this.ctx.effect(() => {
      const existing = this.contributions.get(contribution.profileId)
      if (existing === undefined) this.contributions.set(contribution.profileId, [record])
      else existing.push(record)
      return () => {
        const current = this.contributions.get(contribution.profileId)
        if (current === undefined) return
        const index = current.indexOf(record)
        if (index >= 0) current.splice(index, 1)
        if (current.length === 0) this.contributions.delete(contribution.profileId)
      }
    }, `commandProfiles.contribute(${JSON.stringify(contribution.profileId)}, ${JSON.stringify(contribution.contributorId)})`)
    return () => {
      void dispose()
    }
  }

  /** Settings admission gate: reject bad shapes before persistence. */
  private validateSettingsSection(value: CommandProfilesSettingsSection): void {
    const seen = new Set<string>()
    for (const profile of value.profiles) {
      if (seen.has(profile.id)) {
        throw new Error(`commandProfiles settings contain duplicate user profile id ${JSON.stringify(profile.id)}`)
      }
      seen.add(profile.id)
      this.validateProfileFields(
        profile.id,
        profile.displayName,
        profile.description,
        profile.aliases,
        profile.tags,
        profile.candidates,
      )
      if (!this.hasLowerLayerDefinition(profile.id) && !isCompleteDefinition(profile)) {
        throw new Error(
          `new user command profile ${JSON.stringify(profile.id)} requires displayName, description, and at least one candidate`,
        )
      }
    }
  }

  /** Whether a complete non-user definition currently anchors this profile. */
  private hasLowerLayerDefinition(profileId: string): boolean {
    return (this.contributions.get(profileId) ?? []).some(record =>
      record.contribution.source !== 'user' && isCompleteDefinition(record.contribution))
  }

  private validateContribution(contribution: CommandProfileContribution): void {
    if (!CONTRIBUTOR_ID_PATTERN.test(contribution.contributorId)) {
      throw new TypeError(
        `contributorId ${JSON.stringify(contribution.contributorId)} must be a valid contributor id`
        + ' (alphanumeric start, then alphanumeric, dot, underscore, or dash)',
      )
    }
    this.validateProfileFields(
      contribution.profileId,
      contribution.displayName,
      contribution.description,
      contribution.aliases,
      contribution.tags,
      contribution.candidates,
    )
    if (contribution.source !== 'user') {
      if (contribution.candidateMode !== undefined) throw new TypeError('candidateMode is only valid for user contributions')
      if (contribution.disabled !== undefined) throw new TypeError('disabled is only valid for user contributions')
    }

    const existing = this.contributions.get(contribution.profileId) ?? []
    if (contribution.source === 'builtin') {
      if (existing.some(record => record.contribution.source === 'builtin')) {
        throw new Error(`builtin command profile ${JSON.stringify(contribution.profileId)} is already registered`)
      }
      if (!isCompleteDefinition(contribution)) {
        throw new Error(`builtin command profile ${JSON.stringify(contribution.profileId)} must be a complete definition`)
      }
    }

    const owner = this.definitionOwner(existing)
    if (contribution.source === 'plugin') {
      if (existing.length === 0 && !isCompleteDefinition(contribution)) {
        throw new Error(
          `new command profile ${JSON.stringify(contribution.profileId)} requires displayName, description, and at least one candidate`,
        )
      }
      if (owner === undefined
        && (contribution.displayName !== undefined || contribution.description !== undefined)
        && !isCompleteDefinition(contribution)) {
        throw new Error(
          `plugin ${JSON.stringify(contribution.contributorId)} must provide a complete definition to claim orphaned profile `
          + JSON.stringify(contribution.profileId),
        )
      }
      if (owner !== undefined && (contribution.displayName !== undefined || contribution.description !== undefined)) {
        if (owner.source === 'builtin'
          || (owner.source === 'plugin' && owner.contributorId !== contribution.contributorId)) {
          throw new Error(
            `plugin ${JSON.stringify(contribution.contributorId)} may not redefine identity fields for profile `
            + `${JSON.stringify(contribution.profileId)} owned by ${owner.source}/${owner.contributorId}`,
          )
        }
        if (owner.source === 'user' && !isCompleteDefinition(contribution)) {
          throw new Error(
            `plugin ${JSON.stringify(contribution.contributorId)} must provide a complete definition to supersede user-owned profile `
            + JSON.stringify(contribution.profileId),
          )
        }
      }
    }
  }

  /** Validate fields shared by settings admission and contribution registration. */
  private validateProfileFields(
    profileId: string,
    displayName?: string,
    description?: string,
    aliases?: readonly string[],
    tags?: readonly string[],
    candidates?: readonly string[],
  ): void {
    if (!PROFILE_ID_PATTERN.test(profileId)) {
      throw new TypeError(`profileId ${JSON.stringify(profileId)} must match ${String(PROFILE_ID_PATTERN)}`)
    }
    if (displayName !== undefined && !isNonBlank(displayName)) {
      throw new TypeError(`displayName ${JSON.stringify(displayName)} must be non-blank with no surrounding whitespace`)
    }
    if (description !== undefined && !isNonBlank(description)) {
      throw new TypeError(`description ${JSON.stringify(description)} must be non-blank with no surrounding whitespace`)
    }
    for (const alias of aliases ?? []) {
      if (!isNonBlank(alias)) throw new TypeError(`alias ${JSON.stringify(alias)} must be non-blank with no surrounding whitespace`)
    }
    for (const tag of tags ?? []) {
      if (!isNonBlank(tag)) throw new TypeError(`tag ${JSON.stringify(tag)} must be non-blank with no surrounding whitespace`)
    }
    for (const candidate of candidates ?? []) validateCandidate(candidate)
  }

  /** Select an owner only from contributions that can define the profile alone. */
  private definitionOwner(records: readonly ContributionRecord[]): ContributorIdentity | undefined {
    const builtin = records.find(record =>
      record.contribution.source === 'builtin' && isCompleteDefinition(record.contribution))
    if (builtin !== undefined) return { source: 'builtin', contributorId: builtin.contribution.contributorId }
    const plugin = records.find(record =>
      record.contribution.source === 'plugin' && isCompleteDefinition(record.contribution))
    if (plugin !== undefined) return { source: 'plugin', contributorId: plugin.contribution.contributorId }
    const user = records.find(record =>
      record.contribution.source === 'user' && isCompleteDefinition(record.contribution))
    if (user !== undefined) return { source: 'user', contributorId: user.contribution.contributorId }
    return undefined
  }

  /** Merge candidates with full provenance and deterministic attempt order. */
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
    ownerRecord: ContributionRecord,
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
    for (const value of ownerRecord.contribution[field] ?? []) add(value)
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
    for (const profile of this.userSource().profiles) {
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

/** Whether one contribution can stand alone as the profile's definition owner. */
function isCompleteDefinition(value: DefinitionFields): boolean {
  return value.displayName !== undefined
    && value.description !== undefined
    && (value.candidates?.length ?? 0) > 0
}

function isNonBlank(value: string): boolean {
  return value.length > 0 && value.trim() === value
}

export default CommandProfiles