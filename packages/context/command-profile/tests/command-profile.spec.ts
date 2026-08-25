import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'
import CommandProfiles, { COMMAND_PROFILES_SETTINGS_NAMESPACE } from '../src/index.ts'
import type {
  CommandProfilePluginContribution,
  CommandProfilesSettingsProfile,
} from '../src/index.ts'

/** Smallest real settings provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** A complete brand-new plugin contribution with default identity fields. */
function pluginContribution(profileId: string, fields: Partial<CommandProfilePluginContribution> = {}): CommandProfilePluginContribution {
  return {
    contributorId: 'plugin-a',
    profileId,
    displayName: `Profile ${profileId}`,
    description: `Description ${profileId}`,
    ...fields,
  }
}

/** A partial plugin contribution to an existing profile (no identity fields). */
function pluginPatch(profileId: string, fields: Partial<CommandProfilePluginContribution>): CommandProfilePluginContribution {
  return { contributorId: 'plugin-a', profileId, ...fields }
}

let ctx: Context | undefined
let fiber: Awaited<ReturnType<Context['plugin']>> | undefined

afterEach(async () => {
  await fiber?.dispose()
  fiber = undefined
  ctx = undefined
})

async function boot(config: { includeBuiltins?: boolean } = {}): Promise<{ ctx: Context; fiber: Awaited<ReturnType<Context['plugin']>> }> {
  ctx = new Context()
  fiber = await ctx.plugin(CommandProfiles, config)
  return { ctx, fiber }
}

async function bootUser(config: { includeBuiltins?: boolean } = {}): Promise<{ ctx: Context; fiber: Awaited<ReturnType<Context['plugin']>> }> {
  ctx = new Context()
  await ctx.plugin(MemorySettings)
  fiber = await ctx.plugin(CommandProfiles, config)
  return { ctx, fiber }
}

/** Apply a user settings section through the real settings plane. */
async function setUserProfiles(userCtx: Context, profiles: CommandProfilesSettingsProfile[]): Promise<void> {
  await userCtx.settings.update(COMMAND_PROFILES_SETTINGS_NAMESPACE, { profiles })
}

describe('candidate grammar (B3)', () => {
  beforeEach(async () => {
    ctx = new Context()
    fiber = await ctx.plugin(CommandProfiles)
  })

  it.each([
    'npx foo',
    'python -m foo',
    'gh --hostname x',
    'foo | bar',
    'foo && bar',
    'C:\\Program Files\\foo.exe',
    '/usr/bin/foo',
    '--flag',
    'gh repo',
  ])('rejects the non-bare candidate %s', (command) => {
    expect(() => ctx!.commandProfiles.contribute(pluginContribution('my-cli', { candidates: [command] })))
      .toThrow(/bare executable token/)
  })

  it('accepts bare executable candidates', () => {
    expect(() => ctx!.commandProfiles.contribute(pluginContribution('my-cli', {
      candidates: ['gh', 'my-company-cli', 'foo.bar', 'opencode'],
    }))).not.toThrow()
  })
})

describe('authority boundary', () => {
  it('fixes the public contribution source to plugin and omits user-only flags', async () => {
    const { fiber } = await boot()
    // Compile-time pin: the public parameter is the plugin contribution type —
    // no `source`, `candidateMode`, or `disabled` entry.
    expectTypeOf<Parameters<CommandProfiles['contribute']>[0]>().toEqualTypeOf<CommandProfilePluginContribution>()
    await fiber.dispose()
  })

  it('produces builtin provenance only from the built-in seed', async () => {
    const { ctx, fiber } = await boot()
    const gh = ctx.commandProfiles.resolve('github-cli')?.candidates.find(candidate => candidate.command === 'gh')
    expect(gh?.provenance).toEqual([
      { source: 'builtin', contributorId: 'dsh-command-profiles-builtin' },
    ])
    await fiber.dispose()
  })

  it('produces user provenance only from the settings adapter', async () => {
    const { ctx, fiber } = await bootUser()
    await setUserProfiles(ctx, [{ id: 'github-cli', candidates: ['gh'] }])
    const gh = ctx.commandProfiles.resolve('github-cli')?.candidates.find(candidate => candidate.command === 'gh')
    expect(gh?.provenance).toContainEqual({ source: 'user', contributorId: 'settings' })
    expect(gh?.provenance).not.toContainEqual({ source: 'user', contributorId: 'plugin-a' })
    await fiber.dispose()
  })
})

describe('contribution storage and provenance (B1)', () => {
  it('retracts exactly one plugin provenance when a contributor disposes', async () => {
    const { ctx, fiber } = await boot()
    const pluginA = ctx.commandProfiles.contribute({
      contributorId: 'plugin-a',
      profileId: 'github-cli',
      candidates: ['gh'],
    })
    const pluginB = ctx.commandProfiles.contribute({
      contributorId: 'plugin-b',
      profileId: 'github-cli',
      candidates: ['gh'],
    })

    const gh = (candidates: ReturnType<CommandProfiles['resolve']>) =>
      candidates?.candidates.find(candidate => candidate.command === 'gh')
    expect(gh(ctx.commandProfiles.resolve('github-cli'))?.provenance.map(item => item.contributorId))
      .toEqual(['dsh-command-profiles-builtin', 'plugin-a', 'plugin-b'])

    pluginA()
    expect(gh(ctx.commandProfiles.resolve('github-cli'))?.provenance.map(item => item.contributorId))
      .toEqual(['dsh-command-profiles-builtin', 'plugin-b'])

    pluginB()
    expect(gh(ctx.commandProfiles.resolve('github-cli'))?.provenance.map(item => item.contributorId))
      .toEqual(['dsh-command-profiles-builtin'])
    await fiber.dispose()
  })

  it('merges duplicate candidates with full provenance instead of overriding', async () => {
    const { ctx, fiber } = await bootUser()
    ctx.commandProfiles.contribute({
      contributorId: 'plugin-a',
      profileId: 'github-cli',
      candidates: ['gh'],
    })
    await setUserProfiles(ctx, [{ id: 'github-cli', candidates: ['gh'] }])

    const resolved = ctx.commandProfiles.resolve('github-cli')
    const ghCandidates = resolved?.candidates.filter(candidate => candidate.command === 'gh')
    expect(ghCandidates).toHaveLength(1)
    // Provenance sorts user > builtin > plugin, then contributor id.
    expect(ghCandidates![0]?.provenance).toEqual([
      { source: 'user', contributorId: 'settings' },
      { source: 'builtin', contributorId: 'dsh-command-profiles-builtin' },
      { source: 'plugin', contributorId: 'plugin-a' },
    ])
    await fiber.dispose()
  })

  it('creates a brand-new user profile through settings and rejects one missing identity fields', async () => {
    const { ctx, fiber } = await bootUser()
    await setUserProfiles(ctx, [{
      id: 'my-feishu',
      displayName: 'My Feishu CLI',
      description: 'My Feishu automation CLI',
      aliases: ['feishu-sync'],
      tags: ['feishu'],
      candidates: ['feishu-sync'],
    }])
    expect(ctx.commandProfiles.query({ query: 'feishu-sync' })[0]?.id).toBe('my-feishu')
    expect(ctx.commandProfiles.query({ query: 'My Feishu' })[0]?.id).toBe('my-feishu')

    await expect(setUserProfiles(ctx, [{ id: 'my-broken', candidates: ['broken'] }]))
      .rejects.toThrow(/requires displayName, description, and at least one candidate/)
    await fiber.dispose()
  })

  it('orders candidates user > builtin > plugin regardless of registration order (B4)', async () => {
    const { ctx, fiber } = await bootUser()
    // Builtin candidates register at service construction; the plugin registers
    // later but must still sort after the builtin candidate.
    ctx.commandProfiles.contribute({
      contributorId: 'plugin-a',
      profileId: 'github-cli',
      candidates: ['gh-alt'],
    })
    await setUserProfiles(ctx, [{ id: 'github-cli', candidates: ['gh-user'] }])

    expect(ctx.commandProfiles.resolve('github-cli')?.candidates.map(candidate => candidate.command))
      .toEqual(['gh-user', 'gh', 'gh-alt'])
    await fiber.dispose()
  })

  it('sorts same-rank candidates lexically by command, not registration order', async () => {
    const { ctx, fiber } = await boot({ includeBuiltins: false })
    // plugin-b registers first with later-lexical commands; plugin-a registers
    // later. Same plugin rank must sort by command name.
    ctx.commandProfiles.contribute({
      contributorId: 'plugin-b',
      profileId: 'my-cli',
      displayName: 'My CLI',
      description: 'd',
      candidates: ['z-cmd', 'a-cmd'],
    })
    ctx.commandProfiles.contribute({
      contributorId: 'plugin-a',
      profileId: 'my-cli',
      candidates: ['m-cmd'],
    })
    expect(ctx.commandProfiles.resolve('my-cli')?.candidates.map(candidate => candidate.command))
      .toEqual(['a-cmd', 'm-cmd', 'z-cmd'])
    await fiber.dispose()
  })

  it('sorts provenance by source rank then contributor id lexically', async () => {
    const { ctx, fiber } = await bootUser()
    ctx.commandProfiles.contribute({ contributorId: 'zeta-plugin', profileId: 'github-cli', candidates: ['gh'] })
    ctx.commandProfiles.contribute({ contributorId: 'alpha-plugin', profileId: 'github-cli', candidates: ['gh'] })
    await setUserProfiles(ctx, [{ id: 'github-cli', candidates: ['gh'] }])
    const gh = ctx.commandProfiles.resolve('github-cli')?.candidates.find(candidate => candidate.command === 'gh')
    expect(gh?.provenance.map(item => item.contributorId))
      .toEqual(['settings', 'dsh-command-profiles-builtin', 'alpha-plugin', 'zeta-plugin'])
    await fiber.dispose()
  })

  it('lets user candidateMode replace cut all lower layers', async () => {
    const { ctx, fiber } = await bootUser()
    await setUserProfiles(ctx, [{ id: 'github-cli', candidates: ['mygh'], candidateMode: 'replace' }])
    expect(ctx.commandProfiles.resolve('github-cli')?.candidates.map(candidate => candidate.command))
      .toEqual(['mygh'])
    await fiber.dispose()
  })

  it('hides a user-disabled profile from query and resolve', async () => {
    const { ctx, fiber } = await bootUser()
    expect(ctx.commandProfiles.resolve('github-cli')).toBeDefined()
    await setUserProfiles(ctx, [{ id: 'github-cli', disabled: true }])
    expect(ctx.commandProfiles.resolve('github-cli')).toBeUndefined()
    expect(ctx.commandProfiles.query({ query: 'github-cli' })).toEqual([])
    expect(ctx.commandProfiles.list().some(profile => profile.id === 'github-cli')).toBe(false)
    await fiber.dispose()
  })
})

describe('new-profile completeness (fail loud)', () => {
  it('rejects a plugin defining a new profile without identity fields or candidates', async () => {
    const { ctx, fiber } = await boot({ includeBuiltins: false })
    expect(() => ctx.commandProfiles.contribute({ contributorId: 'plugin-a', profileId: 'my-cli', candidates: ['my-cli'] }))
      .toThrow(/requires displayName and description/)
    expect(() => ctx.commandProfiles.contribute(pluginContribution('my-cli', { candidates: [] })))
      .toThrow(/requires at least one candidate/)
    await fiber.dispose()
  })
})

describe('metadata merge (B5)', () => {
  it('protects the definition owner from a second plugin defining identity fields', async () => {
    const { ctx, fiber } = await boot({ includeBuiltins: false })
    ctx.commandProfiles.contribute(pluginContribution('my-cli', { candidates: ['my-cli'] }))
    expect(() => ctx.commandProfiles.contribute({
      contributorId: 'plugin-b',
      profileId: 'my-cli',
      displayName: 'Stolen',
      description: 'B',
      candidates: ['my-cli'],
    })).toThrow(/may not redefine identity fields/)
    // The owner plugin may still append candidates.
    expect(() => ctx.commandProfiles.contribute(pluginPatch('my-cli', { candidates: ['my-cli-alt'] })))
      .not.toThrow()
    await fiber.dispose()
  })

  it('rejects a plugin redefining a builtin profile identity', async () => {
    const { ctx, fiber } = await boot()
    expect(() => ctx.commandProfiles.contribute({
      contributorId: 'plugin-a',
      profileId: 'github-cli',
      displayName: 'Evil',
    })).toThrow(/may not redefine identity fields/)
    await fiber.dispose()
  })

  it('lets user identity fields override the definition owner', async () => {
    const { ctx, fiber } = await bootUser()
    expect(ctx.commandProfiles.resolve('github-cli')?.description).toBe('Official GitHub command-line interface')
    await setUserProfiles(ctx, [{ id: 'github-cli', description: 'User description' }])
    expect(ctx.commandProfiles.resolve('github-cli')?.description).toBe('User description')
    expect(ctx.commandProfiles.resolve('github-cli')?.displayName).toBe('GitHub CLI')
    await fiber.dispose()
  })

  it('unions aliases and tags with canonical spelling and deterministic order', async () => {
    const { ctx, fiber } = await bootUser({ includeBuiltins: false })
    ctx.commandProfiles.contribute(pluginContribution('my-cli', {
      aliases: ['alpha', 'BETA'],
      tags: ['tag'],
      candidates: ['my-cli'],
    }))
    await setUserProfiles(ctx, [{ id: 'my-cli', aliases: ['beta'], tags: ['user-tag'] }])
    ctx.commandProfiles.contribute({
      contributorId: 'plugin-b',
      profileId: 'my-cli',
      aliases: ['Gamma'],
      tags: ['plugin-tag'],
    })

    const resolved = ctx.commandProfiles.resolve('my-cli')
    // Case-normalized 'beta'/'BETA' dedupe keeps the first (user) canonical spelling.
    expect(resolved?.aliases).toEqual(['beta', 'alpha', 'Gamma'])
    expect(resolved?.tags).toEqual(['user-tag', 'tag', 'plugin-tag'])
    await fiber.dispose()
  })
})

describe('user settings section', () => {
  it('rejects duplicate profile ids at the settings validation stage', async () => {
    const { ctx, fiber } = await bootUser()
    await expect(setUserProfiles(ctx, [
      { id: 'dup', displayName: 'A', description: 'a', candidates: ['a'] },
      { id: 'dup', displayName: 'B', description: 'b', candidates: ['b'] },
    ])).rejects.toThrow(/duplicate user profile id/)
    await fiber.dispose()
  })

  it('rejects a second partial update of a pure user-defined profile', async () => {
    const { ctx, fiber } = await bootUser()
    await setUserProfiles(ctx, [{ id: 'my-cli', displayName: 'My CLI', description: 'd', candidates: ['my-cli'] }])
    expect(ctx.commandProfiles.resolve('my-cli')).toBeDefined()
    // The profile has no lower-layer (builtin/plugin) definition, so a partial
    // update that drops identity fields must be rejected prospectively — the
    // old user contribution must not mask the malformed new section.
    await expect(setUserProfiles(ctx, [{ id: 'my-cli', candidates: ['my-cli-2'] }]))
      .rejects.toThrow(/requires displayName, description, and at least one candidate/)
    await fiber.dispose()
  })

  it('reloads user contributions live on settings change', async () => {
    const { ctx, fiber } = await bootUser()
    await setUserProfiles(ctx, [{ id: 'my-feishu', displayName: 'My Feishu CLI', description: 'd', candidates: ['feishu-sync'] }])
    expect(ctx.commandProfiles.query({ query: 'my-feishu' })[0]?.candidates.map(candidate => candidate.command))
      .toEqual(['feishu-sync'])
    await setUserProfiles(ctx, [])
    expect(ctx.commandProfiles.query({ query: 'my-feishu' })).toEqual([])
    await fiber.dispose()
  })
})

describe('lexical query', () => {
  it('matches across id, alias, displayName, tag, and description domains', async () => {
    const { ctx, fiber } = await bootUser()
    await setUserProfiles(ctx, [{
      id: 'my-feishu',
      displayName: 'My Feishu CLI',
      description: 'My Feishu automation CLI',
      aliases: ['feishu-sync'],
      tags: ['feishu', 'sync'],
      candidates: ['feishu-sync'],
    }])
    const first = (query: string) => ctx.commandProfiles.query({ query })[0]?.id
    expect(first('my-feishu')).toBe('my-feishu')        // id exact
    expect(first('my-fei')).toBe('my-feishu')           // id prefix
    expect(first('FEISHU-SYNC')).toBe('my-feishu')      // alias exact, case-insensitive
    expect(first('  My Feishu  ')).toBe('my-feishu')    // displayName contains, trimmed
    expect(first('sync')).toBe('my-feishu')             // tag exact
    expect(first('automation')).toBe('my-feishu')       // description token
    await fiber.dispose()
  })

  it('breaks same-rank matches by profile id lexically', async () => {
    const { ctx, fiber } = await bootUser({ includeBuiltins: false })
    await setUserProfiles(ctx, [
      { id: 'aaa-cli', displayName: 'AAA CLI', description: 'a', candidates: ['a'] },
      { id: 'bbb-cli', displayName: 'BBB CLI', description: 'b', candidates: ['b'] },
    ])
    const matches = ctx.commandProfiles.query({ query: 'CLI' })
    expect(matches.map(match => match.id)).toEqual(['aaa-cli', 'bbb-cli'])
    await fiber.dispose()
  })

  it('caps query results at the limit with default and clamp', async () => {
    const { ctx, fiber } = await bootUser()
    await setUserProfiles(ctx, [
      { id: 'my-cli', displayName: 'My CLI', description: 'm', candidates: ['m'] },
      { id: 'our-cli', displayName: 'Our CLI', description: 'o', candidates: ['o'] },
      { id: 'your-cli', displayName: 'Your CLI', description: 'y', candidates: ['y'] },
    ])
    // github-cli, codex-cli, my-cli, our-cli, your-cli all contain "CLI".
    const all = ctx.commandProfiles.query({ query: 'CLI' })
    expect(all.length).toBe(5)
    expect(ctx.commandProfiles.query({ query: 'CLI', limit: 2 }).map(match => match.id))
      .toEqual(['codex-cli', 'github-cli'])
    // A limit above the cap clamps to 10; a limit below 1 clamps to 1.
    expect(ctx.commandProfiles.query({ query: 'CLI', limit: 0 }).length).toBe(1)
    await fiber.dispose()
  })

  it('never exposes availability fields in query results', async () => {
    const { ctx, fiber } = await boot()
    const json = JSON.stringify(ctx.commandProfiles.query({ query: 'github-cli' })).toLowerCase()
    for (const banned of ['available', 'installed', 'resolved', 'authenticated', 'version']) {
      expect(json).not.toContain(banned)
    }
    await fiber.dispose()
  })
})

describe('lifecycle', () => {
  it('seeds the four built-in profiles and retracts them on fiber disposal', async () => {
    const { ctx, fiber } = await boot()
    expect(ctx.commandProfiles.list().map(profile => profile.id).sort())
      .toEqual(['claude-code', 'codex-cli', 'github-cli', 'opencode-cli'])
    expect(ctx.commandProfiles.resolve('github-cli')?.candidates.map(candidate => candidate.command))
      .toEqual(['gh'])
    await fiber.dispose()
  })

  it('retracts a contribution through owner-fiber disposal', async () => {
    const { ctx } = await boot()
    const owner = ctx.plugin({
      inject: ['commandProfiles'],
      apply: (child: Context) => {
        child.commandProfiles.contribute(pluginContribution('plugin-cli', { candidates: ['plugin-cli'] }))
      },
    })
    await owner
    expect(ctx.commandProfiles.list().some(profile => profile.id === 'plugin-cli')).toBe(true)
    await owner.dispose()
    expect(ctx.commandProfiles.list().some(profile => profile.id === 'plugin-cli')).toBe(false)
  })
})
