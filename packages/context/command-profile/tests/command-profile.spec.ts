import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'
import CommandProfiles, { COMMAND_PROFILES_SETTINGS_NAMESPACE } from '../src/index.ts'
import type { CommandProfileContribution } from '../src/index.ts'

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

/** A complete brand-new user contribution with default identity fields. */
function userContribution(profileId: string, fields: Partial<CommandProfileContribution> = {}): CommandProfileContribution {
  return {
    contributorId: 'settings',
    source: 'user',
    profileId,
    displayName: `Profile ${profileId}`,
    description: `Description ${profileId}`,
    ...fields,
  }
}

/** A partial user patch to an existing profile (no identity fields). */
function userPatch(profileId: string, fields: Partial<CommandProfileContribution>): CommandProfileContribution {
  return { contributorId: 'settings', source: 'user', profileId, ...fields }
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
    expect(() => ctx!.commandProfiles.contribute(userContribution('my-cli', { candidates: [command] })))
      .toThrow(/bare executable token/)
  })

  it('accepts bare executable candidates', () => {
    expect(() => ctx!.commandProfiles.contribute(userContribution('my-cli', {
      candidates: ['gh', 'my-company-cli', 'foo.bar', 'opencode'],
    }))).not.toThrow()
  })
})

describe('contribution storage and provenance (B1)', () => {
  it('retracts exactly one plugin provenance when a contributor disposes', async () => {
    const { ctx, fiber } = await boot()
    const pluginA = ctx.commandProfiles.contribute({
      contributorId: 'plugin-a',
      source: 'plugin',
      profileId: 'github-cli',
      candidates: ['gh'],
    })
    const pluginB = ctx.commandProfiles.contribute({
      contributorId: 'plugin-b',
      source: 'plugin',
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
    const { ctx, fiber } = await boot()
    ctx.commandProfiles.contribute({
      contributorId: 'plugin-a',
      source: 'plugin',
      profileId: 'github-cli',
      candidates: ['gh'],
    })
    ctx.commandProfiles.contribute(userPatch('github-cli', { candidates: ['gh'] }))

    const resolved = ctx.commandProfiles.resolve('github-cli')
    const ghCandidates = resolved?.candidates.filter(candidate => candidate.command === 'gh')
    expect(ghCandidates).toHaveLength(1)
    expect(ghCandidates![0]?.provenance).toEqual([
      { source: 'builtin', contributorId: 'dsh-command-profiles-builtin' },
      { source: 'plugin', contributorId: 'plugin-a' },
      { source: 'user', contributorId: 'settings' },
    ])
    await fiber.dispose()
  })

  it('creates a brand-new user profile and rejects one missing identity fields', async () => {
    const { ctx, fiber } = await boot()
    ctx.commandProfiles.contribute(userContribution('my-feishu', {
      displayName: 'My Feishu CLI',
      aliases: ['feishu-sync'],
      tags: ['feishu'],
      candidates: ['feishu-sync'],
    }))
    expect(ctx.commandProfiles.query({ query: 'feishu-sync' })[0]?.id).toBe('my-feishu')
    expect(ctx.commandProfiles.query({ query: 'My Feishu' })[0]?.id).toBe('my-feishu')

    expect(() => ctx.commandProfiles.contribute({
      contributorId: 'settings',
      source: 'user',
      profileId: 'my-broken',
      candidates: ['broken'],
    })).toThrow(/requires displayName and description/)
    await fiber.dispose()
  })

  it('orders candidates user > builtin > plugin regardless of registration order (B4)', async () => {
    const { ctx, fiber } = await boot()
    // Builtin candidates register at service construction; the plugin registers
    // later but must still sort after the builtin candidate.
    ctx.commandProfiles.contribute({
      contributorId: 'plugin-a',
      source: 'plugin',
      profileId: 'github-cli',
      candidates: ['gh-alt'],
    })
    ctx.commandProfiles.contribute(userPatch('github-cli', { candidates: ['gh-user'] }))

    expect(ctx.commandProfiles.resolve('github-cli')?.candidates.map(candidate => candidate.command))
      .toEqual(['gh-user', 'gh', 'gh-alt'])
    await fiber.dispose()
  })

  it('lets user candidateMode replace cut all lower layers', async () => {
    const { ctx, fiber } = await boot()
    ctx.commandProfiles.contribute(userPatch('github-cli', { candidates: ['mygh'], candidateMode: 'replace' }))
    expect(ctx.commandProfiles.resolve('github-cli')?.candidates.map(candidate => candidate.command))
      .toEqual(['mygh'])
    await fiber.dispose()
  })

  it('hides a user-disabled profile from query and resolve', async () => {
    const { ctx, fiber } = await boot()
    expect(ctx.commandProfiles.resolve('github-cli')).toBeDefined()
    ctx.commandProfiles.contribute(userPatch('github-cli', { disabled: true }))
    expect(ctx.commandProfiles.resolve('github-cli')).toBeUndefined()
    expect(ctx.commandProfiles.query({ query: 'github-cli' })).toEqual([])
    expect(ctx.commandProfiles.list().some(profile => profile.id === 'github-cli')).toBe(false)
    await fiber.dispose()
  })
})

describe('metadata merge (B5)', () => {
  it('protects the definition owner from a second plugin defining identity fields', async () => {
    const { ctx, fiber } = await boot({ includeBuiltins: false })
    ctx.commandProfiles.contribute({
      contributorId: 'plugin-a',
      source: 'plugin',
      profileId: 'my-cli',
      displayName: 'My CLI',
      description: 'Owned by A',
      candidates: ['my-cli'],
    })
    expect(() => ctx.commandProfiles.contribute({
      contributorId: 'plugin-b',
      source: 'plugin',
      profileId: 'my-cli',
      displayName: 'Stolen',
      description: 'B',
    })).toThrow(/may not redefine identity fields/)
    // The owner plugin may still append candidates.
    expect(() => ctx.commandProfiles.contribute({
      contributorId: 'plugin-a',
      source: 'plugin',
      profileId: 'my-cli',
      candidates: ['my-cli-alt'],
    })).not.toThrow()
    await fiber.dispose()
  })

  it('rejects a plugin redefining a builtin profile identity', async () => {
    const { ctx, fiber } = await boot()
    expect(() => ctx.commandProfiles.contribute({
      contributorId: 'plugin-a',
      source: 'plugin',
      profileId: 'github-cli',
      displayName: 'Evil',
    })).toThrow(/may not redefine identity fields/)
    await fiber.dispose()
  })

  it('lets user identity fields override the definition owner', async () => {
    const { ctx, fiber } = await boot()
    expect(ctx.commandProfiles.resolve('github-cli')?.description).toBe('Official GitHub command-line interface')
    ctx.commandProfiles.contribute(userPatch('github-cli', { description: 'User description' }))
    expect(ctx.commandProfiles.resolve('github-cli')?.description).toBe('User description')
    expect(ctx.commandProfiles.resolve('github-cli')?.displayName).toBe('GitHub CLI')
    await fiber.dispose()
  })

  it('unions aliases and tags with canonical spelling and deterministic order', async () => {
    const { ctx, fiber } = await boot({ includeBuiltins: false })
    ctx.commandProfiles.contribute({
      contributorId: 'plugin-a',
      source: 'plugin',
      profileId: 'my-cli',
      displayName: 'My CLI',
      description: 'D',
      aliases: ['alpha', 'BETA'],
      tags: ['tag'],
      candidates: ['my-cli'],
    })
    ctx.commandProfiles.contribute(userPatch('my-cli', { aliases: ['beta'], tags: ['user-tag'] }))
    ctx.commandProfiles.contribute({
      contributorId: 'plugin-b',
      source: 'plugin',
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

describe('contribute interface (pinned)', () => {
  it('carries provenance identity solely on the contribution object (no second entry)', async () => {
    const { fiber } = await boot()
    // Compile-time pin: exactly one parameter, whose type is the contribution —
    // there is no second source/contributorId entry competing with it.
    expectTypeOf<Parameters<CommandProfiles['contribute']>[0]>().toEqualTypeOf<CommandProfileContribution>()
    await fiber.dispose()
  })
})

describe('user settings section', () => {
  it('rejects duplicate profile ids at the settings validation stage', async () => {
    const freshCtx = new Context()
    await freshCtx.plugin(MemorySettings)
    const freshFiber = await freshCtx.plugin(CommandProfiles)
    await expect(freshCtx.settings.update(COMMAND_PROFILES_SETTINGS_NAMESPACE, {
      profiles: [
        { id: 'dup', displayName: 'A', description: 'a' },
        { id: 'dup', displayName: 'B', description: 'b' },
      ],
    })).rejects.toThrow(/duplicate user profile id/)
    await freshFiber.dispose()
    await freshCtx.fiber.dispose()
  })

  it('rejects a brand-new user profile missing identity fields at the settings validation stage', async () => {
    const freshCtx = new Context()
    await freshCtx.plugin(MemorySettings)
    const freshFiber = await freshCtx.plugin(CommandProfiles)
    await expect(freshCtx.settings.update(COMMAND_PROFILES_SETTINGS_NAMESPACE, {
      profiles: [{ id: 'my-broken', candidates: ['broken'] }],
    })).rejects.toThrow(/requires displayName and description/)
    await freshFiber.dispose()
    await freshCtx.fiber.dispose()
  })

  it('reloads user contributions live on settings change', async () => {
    const freshCtx = new Context()
    await freshCtx.plugin(MemorySettings)
    const freshFiber = await freshCtx.plugin(CommandProfiles)
    await freshCtx.settings.update(COMMAND_PROFILES_SETTINGS_NAMESPACE, {
      profiles: [{ id: 'my-feishu', displayName: 'My Feishu CLI', description: 'd', candidates: ['feishu-sync'] }],
    })
    expect(freshCtx.commandProfiles.query({ query: 'my-feishu' })[0]?.candidates.map(candidate => candidate.command))
      .toEqual(['feishu-sync'])
    await freshCtx.settings.update(COMMAND_PROFILES_SETTINGS_NAMESPACE, { profiles: [] })
    expect(freshCtx.commandProfiles.query({ query: 'my-feishu' })).toEqual([])
    await freshFiber.dispose()
    await freshCtx.fiber.dispose()
  })
})

describe('lexical query', () => {
  it('matches across id, alias, displayName, tag, and description domains', async () => {
    const { ctx, fiber } = await boot()
    ctx.commandProfiles.contribute(userContribution('my-feishu', {
      aliases: ['feishu-sync'],
      tags: ['feishu', 'sync'],
      displayName: 'My Feishu CLI',
      description: 'My Feishu automation CLI',
      candidates: ['feishu-sync'],
    }))
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
    const { ctx, fiber } = await boot({ includeBuiltins: false })
    ctx.commandProfiles.contribute(userContribution('aaa-cli', { displayName: 'AAA CLI' }))
    ctx.commandProfiles.contribute(userContribution('bbb-cli', { displayName: 'BBB CLI' }))
    const matches = ctx.commandProfiles.query({ query: 'CLI' })
    expect(matches.map(match => match.id)).toEqual(['aaa-cli', 'bbb-cli'])
    await fiber.dispose()
  })

  it('caps query results at the limit with default and clamp', async () => {
    const { ctx, fiber } = await boot()
    ctx.commandProfiles.contribute(userContribution('my-cli', { displayName: 'My CLI' }))
    ctx.commandProfiles.contribute(userContribution('our-cli', { displayName: 'Our CLI' }))
    ctx.commandProfiles.contribute(userContribution('your-cli', { displayName: 'Your CLI' }))
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
  it('retracts built-in profiles when the registry fiber disposes', async () => {
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
        child.commandProfiles.contribute({
          contributorId: 'some-plugin',
          source: 'plugin',
          profileId: 'plugin-cli',
          displayName: 'Plugin CLI',
          description: 'd',
          candidates: ['plugin-cli'],
        })
      },
    })
    await owner
    expect(ctx.commandProfiles.list().some(profile => profile.id === 'plugin-cli')).toBe(true)
    await owner.dispose()
    expect(ctx.commandProfiles.list().some(profile => profile.id === 'plugin-cli')).toBe(false)
  })
})
