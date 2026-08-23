/** Web preference section layered over a real settings provider (B2/B5). */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import WebRuntime, { WEB_SETTINGS_NAMESPACE } from '../src/index.ts'
import type {
  WebFetchProvider,
  WebFetchResult,
  WebSearchProvider,
  WebSearchResult,
} from '../src/index.ts'

/** The smallest real settings provider: one in-memory document, always writable. */
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

function makeSearchProvider(id: string, search: () => WebSearchResult): WebSearchProvider {
  return { id, available: () => true, search: () => Promise.resolve(search()) }
}

function makeFetchProvider(id: string, fetch: () => WebFetchResult): WebFetchProvider {
  return { id, available: () => true, fetch: () => Promise.resolve(fetch()) }
}

function result(marker: string): WebSearchResult {
  return { content: marker, sources: [], truncated: false }
}

function fetchResult(marker: string): WebFetchResult {
  return {
    url: `https://example.com/${marker}`,
    statusCode: 200,
    body: { kind: 'text', content: marker },
    truncated: false,
  }
}

async function boot(withSettings = true): Promise<{
  ctx: Context
  settingsFiber: Context['fiber'] | undefined
  web: WebRuntime
}> {
  const ctx = new Context()
  const settingsFiber = withSettings ? ctx.plugin(MemorySettings) : undefined
  await settingsFiber?.await()
  await ctx.plugin(WebRuntime, { searchProvider: 'base', fetchProvider: 'http' })
  return { ctx, settingsFiber, web: ctx.web }
}

describe('WebRuntime settings live resolve', () => {
  it('resolves the user layer over the composition entry', async () => {
    const { ctx, settingsFiber, web } = await boot()
    web.registerSearchProvider(makeSearchProvider('base', () => result('base')))
    web.registerSearchProvider(makeSearchProvider('user', () => result('user')))

    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'base' })
    await settingsFiber!.ctx.settings.replace(WEB_SETTINGS_NAMESPACE, { searchProvider: 'user' })
    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'user' })
    await ctx.fiber.dispose()
  })

  it('snapshots the preference at each call boundary', async () => {
    const { ctx, settingsFiber, web } = await boot()
    const calls: string[] = []
    web.registerSearchProvider({
      id: 'base',
      available: () => true,
      search: async () => {
        calls.push('base')
        await new Promise(resolve => setTimeout(resolve, 10))
        return result('base')
      },
    })
    web.registerSearchProvider({
      id: 'user',
      available: () => true,
      search: async () => { calls.push('user'); return result('user') },
    })

    const inFlight = web.search({ query: 'q' })
    await settingsFiber!.ctx.settings.replace(WEB_SETTINGS_NAMESPACE, { searchProvider: 'user' })
    await expect(inFlight).resolves.toMatchObject({ content: 'base' })
    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'user' })
    expect(calls).toEqual(['base', 'user'])
    await ctx.fiber.dispose()
  })

  it('live-resolves fetchProvider on the next fetch call', async () => {
    const { ctx, settingsFiber, web } = await boot()
    web.registerFetchProvider(makeFetchProvider('http', () => fetchResult('base-fetch')))
    web.registerFetchProvider(makeFetchProvider('user-fetch', () => fetchResult('user-fetch')))

    await expect(web.fetch({ url: 'https://example.com' })).resolves.toMatchObject({
      body: { kind: 'text', content: 'base-fetch' },
    })
    await settingsFiber!.ctx.settings.replace(WEB_SETTINGS_NAMESPACE, { fetchProvider: 'user-fetch' })
    await expect(web.fetch({ url: 'https://example.com' })).resolves.toMatchObject({
      body: { kind: 'text', content: 'user-fetch' },
    })
    await ctx.fiber.dispose()
  })

  it('keeps omitted user fields on the composition base and restores overridden fields when cleared', async () => {
    const { ctx, settingsFiber, web } = await boot()
    web.registerSearchProvider(makeSearchProvider('base', () => result('base')))
    web.registerSearchProvider(makeSearchProvider('user', () => result('user')))
    web.registerFetchProvider(makeFetchProvider('http', () => fetchResult('http')))

    await settingsFiber!.ctx.settings.replace(WEB_SETTINGS_NAMESPACE, { searchProvider: 'user' })
    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'user' })
    await expect(web.fetch({ url: 'https://example.com' })).resolves.toMatchObject({
      body: { kind: 'text', content: 'http' },
    })

    await settingsFiber!.ctx.settings.replace(WEB_SETTINGS_NAMESPACE, {})
    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'base' })
    await expect(web.fetch({ url: 'https://example.com' })).resolves.toMatchObject({
      body: { kind: 'text', content: 'http' },
    })
    await ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const { ctx, settingsFiber, web } = await boot()
    web.registerSearchProvider(makeSearchProvider('base', () => result('base')))
    web.registerSearchProvider(makeSearchProvider('user', () => result('user')))

    await settingsFiber!.ctx.settings.replace(WEB_SETTINGS_NAMESPACE, { searchProvider: 'user' })
    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'user' })
    await settingsFiber!.dispose()
    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'base' })
    await ctx.fiber.dispose()
  })

  it('keeps the composition entry when no settings provider is mounted', async () => {
    const { ctx, web } = await boot(false)
    web.registerSearchProvider(makeSearchProvider('base', () => result('base')))
    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'base' })
    await ctx.fiber.dispose()
  })
})