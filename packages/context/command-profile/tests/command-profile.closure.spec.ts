import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { afterEach, describe, expect, it } from 'vitest'
import CommandProfiles, { COMMAND_PROFILES_SETTINGS_NAMESPACE } from '../src/index.ts'

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

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

async function boot(includeBuiltins = false): Promise<Context> {
  ctx = new Context()
  await ctx.plugin(MemorySettings)
  await ctx.plugin(CommandProfiles, { includeBuiltins })
  return ctx
}

async function setProfiles(subject: Context, profiles: unknown[]): Promise<void> {
  await subject.settings.update(COMMAND_PROFILES_SETTINGS_NAMESPACE, { profiles })
}

describe('settings admission closure', () => {
  it('rejects an invalid candidate before persistence and preserves the last good effective profile', async () => {
    const subject = await boot()
    await setProfiles(subject, [{
      id: 'my-cli',
      displayName: 'My CLI',
      description: 'valid profile',
      candidates: ['my-cli'],
    }])
    expect(subject.commandProfiles.resolve('my-cli')?.candidates.map(candidate => candidate.command))
      .toEqual(['my-cli'])

    await expect(setProfiles(subject, [{
      id: 'my-cli',
      displayName: 'My CLI',
      description: 'valid profile',
      candidates: ['npx foo'],
    }])).rejects.toThrow(/bare executable token/)

    expect(subject.commandProfiles.resolve('my-cli')?.candidates.map(candidate => candidate.command))
      .toEqual(['my-cli'])
    expect((subject.settings as MemorySettings).doc[COMMAND_PROFILES_SETTINGS_NAMESPACE])
      .toEqual({
        profiles: [{
          id: 'my-cli',
          displayName: 'My CLI',
          description: 'valid profile',
          candidates: ['my-cli'],
        }],
      })
  })

  it('rejects an invalid profile id before persistence', async () => {
    const subject = await boot()
    await expect(setProfiles(subject, [{
      id: 'Bad Profile',
      displayName: 'Bad Profile',
      description: 'invalid id',
      candidates: ['bad-profile'],
    }])).rejects.toThrow(/profileId/)
    expect(subject.commandProfiles.list()).toEqual([])
  })
})

describe('definition-owner lifecycle closure', () => {
  it('keeps partial overlays dormant instead of throwing when the owner unloads', async () => {
    const subject = await boot()
    const disposeOwner = subject.commandProfiles.contribute({
      contributorId: 'plugin-a',
      profileId: 'my-cli',
      displayName: 'My CLI',
      description: 'owned by plugin A',
      candidates: ['my-cli'],
    })
    subject.commandProfiles.contribute({
      contributorId: 'plugin-b',
      profileId: 'my-cli',
      aliases: ['my-cli-b'],
      candidates: ['my-cli-b'],
    })
    await setProfiles(subject, [{ id: 'my-cli', tags: ['user-tag'] }])

    expect(subject.commandProfiles.resolve('my-cli')).toBeDefined()
    disposeOwner()

    expect(() => subject.commandProfiles.resolve('my-cli')).not.toThrow()
    expect(subject.commandProfiles.resolve('my-cli')).toBeUndefined()
    expect(subject.commandProfiles.query({ query: 'my-cli' })).toEqual([])
    expect(subject.commandProfiles.list()).toEqual([])
  })

  it('reactivates dormant overlays when a new complete plugin definition appears', async () => {
    const subject = await boot()
    const disposeOwner = subject.commandProfiles.contribute({
      contributorId: 'plugin-a',
      profileId: 'my-cli',
      displayName: 'My CLI',
      description: 'owned by plugin A',
      candidates: ['my-cli'],
    })
    subject.commandProfiles.contribute({
      contributorId: 'plugin-b',
      profileId: 'my-cli',
      aliases: ['my-cli-b'],
      candidates: ['my-cli-b'],
    })
    await setProfiles(subject, [{ id: 'my-cli', tags: ['user-tag'] }])
    disposeOwner()
    expect(subject.commandProfiles.resolve('my-cli')).toBeUndefined()

    subject.commandProfiles.contribute({
      contributorId: 'plugin-c',
      profileId: 'my-cli',
      displayName: 'My CLI Reborn',
      description: 'owned by plugin C',
      candidates: ['my-cli-c'],
    })

    const resolved = subject.commandProfiles.resolve('my-cli')
    expect(resolved?.displayName).toBe('My CLI Reborn')
    expect(resolved?.aliases).toContain('my-cli-b')
    expect(resolved?.tags).toContain('user-tag')
    expect(resolved?.candidates.map(candidate => candidate.command))
      .toEqual(['my-cli-b', 'my-cli-c'])
  })

  it('falls back to a complete user definition when the plugin definition unloads', async () => {
    const subject = await boot()
    const disposeOwner = subject.commandProfiles.contribute({
      contributorId: 'plugin-a',
      profileId: 'my-cli',
      displayName: 'Plugin CLI',
      description: 'plugin definition',
      candidates: ['plugin-cli'],
    })
    await setProfiles(subject, [{
      id: 'my-cli',
      displayName: 'User CLI',
      description: 'user standalone definition',
      candidates: ['user-cli'],
    }])

    expect(subject.commandProfiles.resolve('my-cli')?.displayName).toBe('User CLI')
    disposeOwner()

    const resolved = subject.commandProfiles.resolve('my-cli')
    expect(resolved?.displayName).toBe('User CLI')
    expect(resolved?.description).toBe('user standalone definition')
    expect(resolved?.candidates.map(candidate => candidate.command)).toEqual(['user-cli'])
  })

  it('allows a complete plugin definition to become lower-layer owner after a user-only definition', async () => {
    const subject = await boot()
    await setProfiles(subject, [{
      id: 'my-cli',
      displayName: 'User CLI',
      description: 'user definition',
      candidates: ['user-cli'],
    }])

    subject.commandProfiles.contribute({
      contributorId: 'plugin-a',
      profileId: 'my-cli',
      displayName: 'Plugin CLI',
      description: 'plugin canonical definition',
      candidates: ['plugin-cli'],
    })

    const overlaid = subject.commandProfiles.resolve('my-cli')
    expect(overlaid?.displayName).toBe('User CLI')
    expect(overlaid?.candidates.map(candidate => candidate.command))
      .toEqual(['user-cli', 'plugin-cli'])

    await setProfiles(subject, [])
    const pluginOnly = subject.commandProfiles.resolve('my-cli')
    expect(pluginOnly?.displayName).toBe('Plugin CLI')
    expect(pluginOnly?.candidates.map(candidate => candidate.command)).toEqual(['plugin-cli'])
  })
})
