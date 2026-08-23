/** The `web.search-selected` derived fact and its capability-visible projection. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { factKey } from '@deepseek-ai/dsh-runtime-facts'
import RuntimeFacts from '@deepseek-ai/dsh-runtime-facts'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import WebRuntime from '../src/index.ts'
import { WEB_SETTINGS_NAMESPACE } from '../src/index.ts'
import type { WebSearchProvider, WebSearchResult } from '../src/types.ts'

/** The smallest real provider: one in-memory document, always writable. */
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

/** A minimal search provider that never touches the network. */
function mockSearchProvider(id: string, available = true): WebSearchProvider {
  return {
    id,
    available: () => available,
    search: async (): Promise<WebSearchResult> => ({ sources: [], truncated: false }),
  }
}

async function boot(config: { searchProvider?: string } = {}): Promise<{
  ctx: Context
  runtimeFactsFiber: Fiber
  settingsFiber: Fiber
}> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, config)
  await ctx.plugin(SystemPrompt, {})
  const runtimeFactsFiber = ctx.plugin(RuntimeFacts, {})
  await runtimeFactsFiber.await()
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  return { ctx, runtimeFactsFiber, settingsFiber }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('web.search-selected fact declaration', () => {
  it('registers with owner web, sync/dynamic/baseline, and web_search relevance', async () => {
    const bench = await boot({ searchProvider: 'exa' })
    bench.ctx.web.registerSearchProvider(mockSearchProvider('exa'))
    const info = bench.ctx.runtimeFacts.list().find(fact => fact.key === 'web.search-selected')
    expect(info).toMatchObject({
      owner: 'web',
      evaluation: 'sync',
      freshness: 'dynamic',
      exposure: 'baseline',
      relevance: { tools: ['web_search'] },
    })
    await bench.ctx.fiber.dispose()
  })

  it('resolves the selected provider id through the live settings source', async () => {
    const bench = await boot({ searchProvider: 'exa' })
    bench.ctx.web.registerSearchProvider(mockSearchProvider('exa'))
    await expect(bench.ctx.runtimeFacts.inspect([factKey('web.search-selected')]))
      .resolves.toEqual({ 'web.search-selected': { status: 'ok', value: 'exa' } })
    await bench.ctx.fiber.dispose()
  })
})

describe('web.search-selected dynamic freshness', () => {
  it('reflects a settings-layer preference change without re-registration', async () => {
    const bench = await boot({ searchProvider: 'exa' })
    bench.ctx.web.registerSearchProvider(mockSearchProvider('exa'))
    bench.ctx.web.registerSearchProvider(mockSearchProvider('perplexity'))

    await bench.ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: 'perplexity' })

    await expect(bench.ctx.runtimeFacts.inspect([factKey('web.search-selected')]))
      .resolves.toEqual({ 'web.search-selected': { status: 'ok', value: 'perplexity' } })
    await bench.ctx.fiber.dispose()
  })

  it('derives auto-selection through the same provider-resolution semantics', async () => {
    const bench = await boot()
    bench.ctx.web.registerSearchProvider(mockSearchProvider('exa'))

    await expect(bench.ctx.runtimeFacts.inspect([factKey('web.search-selected')]))
      .resolves.toEqual({ 'web.search-selected': { status: 'ok', value: 'exa' } })

    bench.ctx.web.registerSearchProvider(mockSearchProvider('perplexity'))
    await expect(bench.ctx.runtimeFacts.inspect([factKey('web.search-selected')]))
      .resolves.toEqual({ 'web.search-selected': { status: 'unavailable' } })
    await bench.ctx.fiber.dispose()
  })

  it('reports unavailable when no provider is unambiguously selected', async () => {
    const bench = await boot()
    await expect(bench.ctx.runtimeFacts.inspect([factKey('web.search-selected')]))
      .resolves.toEqual({ 'web.search-selected': { status: 'unavailable' } })
    await bench.ctx.fiber.dispose()
  })
})

describe('web.search-selected capability-visible projection', () => {
  it('does not project when the assembly scope is undefined', async () => {
    const bench = await boot({ searchProvider: 'exa' })
    bench.ctx.web.registerSearchProvider(mockSearchProvider('exa'))
    expect(bench.ctx.runtimeFacts.render({})).not.toContain('web.search-selected')
    await bench.ctx.fiber.dispose()
  })

  it('does not project when the declared tool is not visible to the scope', async () => {
    const bench = await boot({ searchProvider: 'exa' })
    bench.ctx.web.registerSearchProvider(mockSearchProvider('exa'))
    const scope = {}
    bench.ctx.provide('tools', {
      get: () => undefined,
    } as never)
    expect(bench.ctx.runtimeFacts.render({ scope })).not.toContain('web.search-selected')
    await bench.ctx.fiber.dispose()
  })

  it('projects the selected id when web_search is visible to the scope', async () => {
    const bench = await boot({ searchProvider: 'exa' })
    bench.ctx.web.registerSearchProvider(mockSearchProvider('exa'))
    const scope = {}
    bench.ctx.provide('tools', {
      get: (name: string, candidate?: object) =>
        name === 'web_search' && candidate === scope ? { name } : undefined,
    } as never)
    expect(bench.ctx.runtimeFacts.render({ scope })).toContain('- web.search-selected: exa')
    await bench.ctx.fiber.dispose()
  })

  it('passes the exact systemPrompt assembly scope into ctx.tools.get', async () => {
    const bench = await boot({ searchProvider: 'exa' })
    bench.ctx.web.registerSearchProvider(mockSearchProvider('exa'))
    const scope = {}
    let observedScope: object | undefined
    bench.ctx.provide('tools', {
      get: (name: string, candidate?: object) => {
        if (name === 'web_search') observedScope = candidate
        return name === 'web_search' && candidate === scope ? { name } : undefined
      },
    } as never)

    const assembly = await bench.ctx.systemPrompt.assemble({ scope })
    const entry = assembly.contexts.find(item => item.name === 'runtime-facts')

    expect(observedScope).toBe(scope)
    expect(entry?.text).toContain('- web.search-selected: exa')
    await bench.ctx.fiber.dispose()
  })
})

describe('runtimeFacts optional lifecycle', () => {
  it('keeps the web seam fully working without a runtime-facts service', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: 'exa' })
    const provider = mockSearchProvider('exa')
    ctx.web.registerSearchProvider(provider)
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [] })
    expect(ctx.get('runtimeFacts')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('tracks runtimeFacts unload and reload while the web seam keeps working', async () => {
    const bench = await boot({ searchProvider: 'exa' })
    bench.ctx.web.registerSearchProvider(mockSearchProvider('exa'))
    await expect(bench.ctx.runtimeFacts.inspect([factKey('web.search-selected')]))
      .resolves.toEqual({ 'web.search-selected': { status: 'ok', value: 'exa' } })

    await bench.runtimeFactsFiber.dispose()
    expect(bench.ctx.get('runtimeFacts')).toBeUndefined()
    await expect(bench.ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [] })

    const runtimeFactsFiber = bench.ctx.plugin(RuntimeFacts, {})
    await runtimeFactsFiber.await()
    await expect(bench.ctx.runtimeFacts.inspect([factKey('web.search-selected')]))
      .resolves.toEqual({ 'web.search-selected': { status: 'ok', value: 'exa' } })
    await bench.ctx.fiber.dispose()
  })
})
