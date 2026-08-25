import { Context } from '@deepseek-ai/cordis'
import CommandProfiles, { COMMAND_PROFILES_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-command-profile'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import * as ToolCommandProfile from '../src/index.ts'

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

async function boot(): Promise<{
  ctx: Context
  fiber: Awaited<ReturnType<Context['plugin']>>
  call: (args: unknown) => Promise<ToolExecutionResult>
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(MemorySettings)
  await ctx.plugin(CommandProfiles)
  const fiber = await ctx.plugin(ToolCommandProfile)
  let n = 0
  const call = (args: unknown) => ctx.tools.execute({
    signal: new AbortController().signal,
    callId: `command-profile-${++n}` as never,
    name: 'command_profile',
    arguments: args,
  })
  return { ctx, fiber, call }
}

describe('command_profile schema and prompt', () => {
  it('registers a flat object-rooted parameter schema and stable guidance', async () => {
    const { ctx, fiber } = await boot()
    const schema = ctx.tools.schemas().find(candidate => candidate.name === 'command_profile')
    expect(schema?.parameters).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string' },
      },
    })
    const assembled = await ctx.systemPrompt.assemble()
    expect(assembled.sections.find(section => section.name === 'tool:command-profile')?.text)
      .toBe(ToolCommandProfile.COMMAND_PROFILE_SYSTEM_PROMPT)
    await fiber.dispose()
  })

  it('rejects missing query and out-of-range limit', async () => {
    const { call, fiber } = await boot()
    const missing = await call({})
    expect(missing.isError).toBe(true)
    const badLimit = await call({ query: 'github-cli', limit: 11 })
    expect(badLimit.isError).toBe(true)
    await fiber.dispose()
  })
})

describe('command_profile execution', () => {
  it('returns built-in profile candidates with provenance, without availability', async () => {
    const { call, fiber } = await boot()
    const result = await call({ query: 'github-cli' })
    expect(result.isError).toBe(false)
    const value = result.value
    expect(value).toMatchObject({
      matches: [{
        id: 'github-cli',
        displayName: 'GitHub CLI',
        candidates: [{ command: 'gh' }],
      }],
    })
    const json = JSON.stringify(value).toLowerCase()
    for (const banned of ['available', 'installed', 'resolved', 'authenticated', 'version']) {
      expect(json).not.toContain(banned)
    }
    await fiber.dispose()
  })

  it('supports lexical lookup of a user-defined profile by alias and description', async () => {
    const { ctx, call, fiber } = await boot()
    await ctx.settings.update(COMMAND_PROFILES_SETTINGS_NAMESPACE, {
      profiles: [{
        id: 'my-feishu',
        displayName: 'My Feishu CLI',
        description: 'My Feishu automation CLI',
        aliases: ['feishu-sync'],
        candidates: ['feishu-sync'],
      }],
    })
    const byAlias = await call({ query: 'feishu-sync' })
    expect(byAlias.isError).toBe(false)
    expect(byAlias.value).toMatchObject({ matches: [{ id: 'my-feishu' }] })
    await fiber.dispose()
  })
})
