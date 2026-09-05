/** The `web-search-perplexity` settings section, credential resolution, and runtime facts. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { factKey } from '@changanhua/dsh-runtime-facts'
import RuntimeFacts from '@changanhua/dsh-runtime-facts'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as perplexityPlugin from '@deepseek-ai/dsh-web-search-perplexity'
import { PERPLEXITY_PROVIDER_ID, WEB_SEARCH_PERPLEXITY_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-web-search-perplexity'

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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** The smallest Perplexity-shaped answer the provider accepts. */
const ONE_RESULT = { choices: [{ message: { content: 'answer' } }], citations: ['https://a.test'] }

async function boot(config: perplexityPlugin.Config = {}): Promise<{
  ctx: Context
  settingsFiber: Fiber
  pluginFiber: Fiber
}> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, { searchProvider: PERPLEXITY_PROVIDER_ID })
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(RuntimeFacts, {})
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(perplexityPlugin, config)
  await pluginFiber.await()
  return { ctx, settingsFiber, pluginFiber }
}

/** Mount a fresh local credential store on `ctx` and seed one reference. */
async function withCredential(ctx: Context, ref: string, value: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-web-search-perplexity-'))
  const fiber = ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await fiber.await()
  await ctx.credentials.set(credentialRef(ref), value)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function requestUrl(input: RequestInfo | URL | undefined): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input?.url ?? ''
}

/** Run one search and return the request Perplexity received. */
async function searchOnce(ctx: Context): Promise<Record<string, unknown>> {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(jsonResponse(ONE_RESULT)))
  fetchSpy.mockClear()
  await ctx.web.search({ query: 'anything' })
  const body = fetchSpy.mock.calls.at(-1)?.[1]?.body
  if (typeof body !== 'string') throw new TypeError('Perplexity request body must be JSON text')
  return JSON.parse(body) as Record<string, unknown>
}

describe('web-search-perplexity settings section', () => {
  it('serves a stored base URL and model to the next search without re-registering', async () => {
    const bench = await boot({ baseURL: 'https://api.entry.test', apiKey: 'pplx-key' })
    expect(await searchOnce(bench.ctx)).toMatchObject({ model: 'sonar' })

    await bench.ctx.settings.update(WEB_SEARCH_PERPLEXITY_SETTINGS_NAMESPACE, {
      baseURL: 'https://api.stored.test',
      model: 'sonar-pro',
    })

    const next = await searchOnce(bench.ctx)
    expect(next).toMatchObject({ model: 'sonar-pro' })
    const fetchSpy = vi.mocked(globalThis.fetch)
    expect(requestUrl(fetchSpy.mock.calls.at(-1)?.[0])).toContain('https://api.stored.test')
    await bench.ctx.fiber.dispose()
  })

  it('rejects literal apiKey writes so a secret can never persist in user settings', async () => {
    const bench = await boot()
    const settings = bench.ctx.settings as MemorySettings

    await expect(bench.ctx.settings.update(WEB_SEARCH_PERPLEXITY_SETTINGS_NAMESPACE, {
      apiKey: 'pplx-stored-secret',
    })).rejects.toThrow()

    expect(JSON.stringify(settings.doc)).not.toContain('pplx-stored-secret')
    await bench.ctx.fiber.dispose()
  })

  it('rejects an invalid credential reference at the settings write boundary', async () => {
    const bench = await boot()
    await expect(bench.ctx.settings.update(WEB_SEARCH_PERPLEXITY_SETTINGS_NAMESPACE, {
      apiKeyEnv: 'not a credential ref',
    })).rejects.toThrow(/credential ref/)
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot({ baseURL: 'https://api.entry.test', apiKey: 'pplx-key' })
    await bench.ctx.settings.update(WEB_SEARCH_PERPLEXITY_SETTINGS_NAMESPACE, {
      baseURL: 'https://api.stored.test',
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(jsonResponse(ONE_RESULT)))
    fetchSpy.mockClear()
    await bench.ctx.web.search({ query: 'q' })
    expect(requestUrl(fetchSpy.mock.calls.at(-1)?.[0])).toContain('https://api.stored.test')

    await bench.settingsFiber.dispose()

    fetchSpy.mockClear()
    await bench.ctx.web.search({ query: 'q' })
    expect(requestUrl(fetchSpy.mock.calls.at(-1)?.[0])).toContain('https://api.entry.test')
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace when the plugin unloads', async () => {
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('web-search-perplexity')

    await bench.pluginFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('web-search-perplexity')
    await bench.ctx.fiber.dispose()
  })
})

describe('web-search-perplexity credential resolution', () => {
  it('resolves the stored key for every search and picks up a rotation', async () => {
    const bench = await boot()
    await withCredential(bench.ctx, 'PERPLEXITY_API_KEY', 'first-key')

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(jsonResponse(ONE_RESULT)))
    fetchSpy.mockClear()
    await bench.ctx.web.search({ query: 'q' })
    const first = fetchSpy.mock.calls.at(-1)?.[1] as RequestInit
    expect((first.headers as Record<string, string>)['authorization']).toBe('Bearer first-key')

    await bench.ctx.credentials.set(credentialRef('PERPLEXITY_API_KEY'), 'rotated-key')
    fetchSpy.mockClear()
    await bench.ctx.web.search({ query: 'q' })
    const second = fetchSpy.mock.calls.at(-1)?.[1] as RequestInit
    expect((second.headers as Record<string, string>)['authorization']).toBe('Bearer rotated-key')
    await bench.ctx.fiber.dispose()
  })

  it('lets a non-empty composition literal apiKey win over the stored credential', async () => {
    const bench = await boot({ apiKey: 'literal-key' })
    await withCredential(bench.ctx, 'PERPLEXITY_API_KEY', 'stored-key')

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(jsonResponse(ONE_RESULT)))
    await bench.ctx.web.search({ query: 'q' })
    const init = fetchSpy.mock.calls.at(-1)?.[1] as RequestInit
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer literal-key')
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the ambient environment when no credentials service is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: PERPLEXITY_PROVIDER_ID })
    const prev = process.env.PERPLEXITY_API_KEY
    process.env.PERPLEXITY_API_KEY = 'env-key'
    try {
      const fiber = ctx.plugin(perplexityPlugin, {})
      await fiber.await()
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockImplementation(() => Promise.resolve(jsonResponse(ONE_RESULT)))
      await ctx.web.search({ query: 'q' })
      const init = fetchSpy.mock.calls.at(-1)?.[1] as RequestInit
      expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer env-key')
      await fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.PERPLEXITY_API_KEY
      else process.env.PERPLEXITY_API_KEY = prev
    }
  })

  it('reports a missing credential instead of sending a blank key', async () => {
    const bench = await boot()
    await expect(bench.ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }))
    await bench.ctx.fiber.dispose()
  })
})

describe('web-search-perplexity runtime facts', () => {
  it('registers local-available and credential-configured with inspect exposure', async () => {
    const bench = await boot()
    const registered = bench.ctx.runtimeFacts.list().map(fact => fact.key)
    expect(registered).toContain('web-search.perplexity.local-available')
    expect(registered).toContain('web-search.perplexity.credential-configured')
    await bench.ctx.fiber.dispose()
  })

  it('reports local-available from provider availability and never leaks a key', async () => {
    const bench = await boot()
    await expect(bench.ctx.runtimeFacts.inspect([factKey('web-search.perplexity.local-available')]))
      .resolves.toEqual({
        'web-search.perplexity.local-available': { status: 'ok', value: true },
      })
    await bench.ctx.fiber.dispose()
  })

  it('reports credential-configured from the credentials service', async () => {
    const bench = await boot()
    await withCredential(bench.ctx, 'PERPLEXITY_API_KEY', 'stored-key')
    await expect(bench.ctx.runtimeFacts.inspect([factKey('web-search.perplexity.credential-configured')]))
      .resolves.toEqual({
        'web-search.perplexity.credential-configured': { status: 'ok', value: true },
      })
    await bench.ctx.fiber.dispose()
  })

  it('reports credential-configured false while nothing is stored', async () => {
    const bench = await boot()
    await expect(bench.ctx.runtimeFacts.inspect([factKey('web-search.perplexity.credential-configured')]))
      .resolves.toEqual({
        'web-search.perplexity.credential-configured': { status: 'ok', value: false },
      })
    await bench.ctx.fiber.dispose()
  })

  it('withdraws both facts when the plugin unloads (HMR-safe)', async () => {
    const bench = await boot()
    expect(await bench.ctx.runtimeFacts.inspect([factKey('web-search.perplexity.local-available')]))
      .toMatchObject({ 'web-search.perplexity.local-available': { status: 'ok' } })

    await bench.pluginFiber.dispose()

    await expect(bench.ctx.runtimeFacts.inspect([factKey('web-search.perplexity.local-available')]))
      .resolves.toEqual({ 'web-search.perplexity.local-available': { status: 'unknown' } })
    await bench.ctx.fiber.dispose()
  })

  it('tracks runtimeFacts service unload and reload while the provider keeps working', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: PERPLEXITY_PROVIDER_ID })
    await ctx.plugin(SystemPrompt, {})
    const providerFiber = ctx.plugin(perplexityPlugin, { apiKey: 'pplx-key' })
    await providerFiber.await()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(jsonResponse(ONE_RESULT)))

    await expect(ctx.web.search({ query: 'before-facts' })).resolves.toMatchObject({ content: 'answer' })

    const factsFiber = ctx.plugin(RuntimeFacts, {})
    await factsFiber.await()
    expect(ctx.runtimeFacts.list().map(info => info.key)).toContain('web-search.perplexity.local-available')

    await factsFiber.dispose()
    await expect(ctx.web.search({ query: 'after-unload' })).resolves.toMatchObject({ content: 'answer' })

    const factsFiber2 = ctx.plugin(RuntimeFacts, {})
    await factsFiber2.await()
    expect(ctx.runtimeFacts.list().map(info => info.key)).toContain('web-search.perplexity.local-available')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    await ctx.fiber.dispose()
  })

  it('keeps the provider fully working without a runtime-facts service', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: PERPLEXITY_PROVIDER_ID })
    const fiber = ctx.plugin(perplexityPlugin, { apiKey: 'pplx-key' })
    await fiber.await()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(jsonResponse(ONE_RESULT)))
    await expect(ctx.web.search({ query: 'q' }))
      .resolves.toMatchObject({ content: 'answer', sources: [{ url: 'https://a.test' }] })
    expect(fetchSpy).toHaveBeenCalledOnce()
    await fiber.dispose()
  })
})
