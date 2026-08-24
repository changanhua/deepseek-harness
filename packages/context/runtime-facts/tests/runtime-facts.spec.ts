import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import RuntimeFacts, { factKey } from '../src/index.ts'
import type { RuntimeFact, RuntimeFactKey } from '../src/index.ts'

async function boot(config: { includeInRuntimeContext?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  const fiber = await ctx.plugin(RuntimeFacts, config)
  return { ctx, fiber }
}

function syncFact(
  key: string,
  value: string | boolean | number | undefined,
  overrides: Partial<RuntimeFact> = {},
): RuntimeFact {
  return {
    key: factKey(key),
    owner: 'test-owner',
    description: `Fact ${key}.`,
    evaluation: 'sync',
    freshness: 'dynamic',
    exposure: 'baseline',
    resolveSync: () => value,
    ...overrides,
  }
}

describe('factKey', () => {
  it.each(['host.os', 'runtime.execution-world', 'web-search.exa.local-available'])(
    'accepts the dotted kebab key %s',
    (key) => {
      expect(factKey(key)).toBe(key)
    },
  )

  it.each(['executionWorld', 'host.OS', 'host..os', '.host', 'host.', 'host._os', 'host.2fa'])(
    'rejects the invalid key %s',
    (key) => {
      expect(() => factKey(key)).toThrow(/runtime fact key/)
    },
  )
})

describe('RuntimeFacts registry', () => {
  it('fails loud when two owners register the same fact', async () => {
    const { ctx } = await boot()
    ctx.runtimeFacts.registerFact(syncFact('host.os', 'win32', { owner: 'first' }))
    expect(() => ctx.runtimeFacts.registerFact(syncFact('host.os', 'linux', { owner: 'second' })))
      .toThrow('runtime fact "host.os" is already owned by "first"; "second" cannot also own it')
  })

  it('validates branded keys again at the registration boundary', async () => {
    const { ctx } = await boot()
    expect(() => ctx.runtimeFacts.registerFact(syncFact('host.os', 'win32', {
      key: 'executionWorld' as RuntimeFactKey,
    }))).toThrow(/runtime fact key/)
  })

  it('lists detached declarations in deterministic key order without resolving dynamic facts', async () => {
    const { ctx } = await boot()
    let resolutions = 0
    const tools = ['web_search']
    ctx.runtimeFacts.registerFact(syncFact('web.search-selected', 'exa', {
      relevance: { tools },
      resolveSync: () => { resolutions += 1; return 'exa' },
    }))
    ctx.runtimeFacts.registerFact(syncFact('host.arch', 'x64'))

    const listed = ctx.runtimeFacts.list()
    tools.push('later_mutation')

    expect(listed.map(info => info.key)).toEqual(['host.arch', 'web.search-selected'])
    expect(listed[1]?.relevance).toEqual({ tools: ['web_search'] })
    expect(resolutions).toBe(0)
  })

  it('renders only available synchronous baseline facts in deterministic order', async () => {
    const { ctx } = await boot()
    ctx.runtimeFacts.registerFact(syncFact('runtime.execution-world', 'local'))
    ctx.runtimeFacts.registerFact(syncFact('host.os', 'win32'))
    ctx.runtimeFacts.registerFact(syncFact('host.arch', 'x64'))
    ctx.runtimeFacts.registerFact(syncFact('host.missing', undefined))
    ctx.runtimeFacts.registerFact(syncFact('host.pid', 42, { exposure: 'inspect' }))
    ctx.runtimeFacts.registerFact({
      key: factKey('net.reachable'),
      owner: 'test-owner',
      description: 'Network probe.',
      evaluation: 'async',
      freshness: 'dynamic',
      exposure: 'inspect',
      resolveAsync: async () => true,
    })

    expect(ctx.runtimeFacts.render({})).toBe([
      'Host runtime facts:',
      '- host.arch: x64',
      '- host.os: win32',
      '- runtime.execution-world: local',
    ].join('\n'))
  })

  it('contains a throwing synchronous resolver and keeps rendering sibling facts', async () => {
    const { ctx } = await boot()
    ctx.runtimeFacts.registerFact(syncFact('host.bad', 'unused', {
      resolveSync: () => { throw new Error('sync probe failed') },
    }))
    ctx.runtimeFacts.registerFact(syncFact('host.os', 'linux'))

    expect(ctx.runtimeFacts.render({})).toBe('Host runtime facts:\n- host.os: linux')
    await expect(ctx.runtimeFacts.inspect([factKey('host.bad')])).resolves.toEqual({
      'host.bad': { status: 'unavailable' },
    })
  })

  it('uses tool visibility for relevant facts and the contributor receives the assembly scope', async () => {
    const { ctx } = await boot()
    const scope = {}
    let visible = false
    ctx.provide('tools', {
      get: (name: string, candidate?: object) =>
        visible && name === 'web_search' && candidate === scope ? { name } : undefined,
    } as never)
    ctx.runtimeFacts.registerFact(syncFact('host.os', 'linux'))
    ctx.runtimeFacts.registerFact(syncFact('web.search-selected', 'exa', {
      relevance: { tools: ['web_search'] },
    }))

    expect(ctx.runtimeFacts.render({})).not.toContain('web.search-selected')
    expect(ctx.runtimeFacts.render({ scope })).not.toContain('web.search-selected')
    visible = true
    expect(ctx.runtimeFacts.render({ scope })).toContain('- web.search-selected: exa')
    const assembly = await ctx.systemPrompt.assemble({ scope })
    expect(assembly.contexts.find(entry => entry.name === 'runtime-facts')?.text)
      .toContain('- web.search-selected: exa')
  })

  it('removes a fact through its exact disposer and through owner-fiber disposal', async () => {
    const { ctx } = await boot()
    const dispose = ctx.runtimeFacts.registerFact(syncFact('host.os', 'linux'))
    expect(ctx.runtimeFacts.list()).toHaveLength(1)
    await dispose()
    expect(ctx.runtimeFacts.list()).toHaveLength(0)

    const owner = ctx.plugin({
      inject: ['runtimeFacts'],
      apply: (child: Context) => {
        child.runtimeFacts.registerFact(syncFact('host.arch', 'x64'))
      },
    })
    await owner
    expect(ctx.runtimeFacts.list().map(info => info.key)).toEqual(['host.arch'])
    await owner.dispose()
    expect(ctx.runtimeFacts.list()).toHaveLength(0)
  })

  it('removes the context contributor when the service unloads', async () => {
    const { ctx, fiber } = await boot()
    ctx.runtimeFacts.registerFact(syncFact('host.os', 'linux'))
    expect((await ctx.systemPrompt.assemble()).contexts.some(entry => entry.name === 'runtime-facts')).toBe(true)
    await fiber.dispose()
    expect((await ctx.systemPrompt.assemble()).contexts.some(entry => entry.name === 'runtime-facts')).toBe(false)
  })

  it('can disable automatic projection without disabling inspection', async () => {
    const { ctx } = await boot({ includeInRuntimeContext: false })
    ctx.runtimeFacts.registerFact(syncFact('host.os', 'linux'))
    expect(ctx.runtimeFacts.render({})).toBe('')
    await expect(ctx.runtimeFacts.inspect([factKey('host.os')])).resolves.toEqual({
      'host.os': { status: 'ok', value: 'linux' },
    })
  })
})
