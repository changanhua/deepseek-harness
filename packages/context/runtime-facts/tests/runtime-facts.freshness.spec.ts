import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import RuntimeFacts, { factKey } from '../src/index.ts'

async function registry() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(RuntimeFacts, {})
  return ctx.runtimeFacts
}

describe('RuntimeFacts freshness', () => {
  it('evaluates a static synchronous fact once at registration and reuses the observation', async () => {
    const facts = await registry()
    let calls = 0
    facts.registerFact({
      key: factKey('host.os'),
      owner: 'test-owner',
      description: 'Host operating system.',
      evaluation: 'sync',
      freshness: 'static',
      exposure: 'baseline',
      resolveSync: () => { calls += 1; return 'linux' },
    })

    expect(calls).toBe(1)
    expect(facts.render({})).toContain('host.os: linux')
    await facts.inspect([factKey('host.os')])
    expect(facts.render({})).toContain('host.os: linux')
    expect(calls).toBe(1)
  })

  it('re-evaluates a dynamic fact for every render and inspection', async () => {
    const facts = await registry()
    let selected = 'exa'
    let calls = 0
    facts.registerFact({
      key: factKey('web.search-selected'),
      owner: 'web',
      description: 'Selected search provider.',
      evaluation: 'sync',
      freshness: 'dynamic',
      exposure: 'baseline',
      resolveSync: () => { calls += 1; return selected },
    })

    expect(facts.render({})).toContain('web.search-selected: exa')
    selected = 'perplexity'
    expect(facts.render({})).toContain('web.search-selected: perplexity')
    await expect(facts.inspect([factKey('web.search-selected')])).resolves.toEqual({
      'web.search-selected': { status: 'ok', value: 'perplexity' },
    })
    expect(calls).toBe(3)
  })

  it('caches one static asynchronous observation after the first inspection', async () => {
    const facts = await registry()
    let calls = 0
    facts.registerFact({
      key: factKey('remote.platform'),
      owner: 'test-owner',
      description: 'Remote platform.',
      evaluation: 'async',
      freshness: 'static',
      exposure: 'inspect',
      resolveAsync: async () => { calls += 1; return 'linux' },
    })

    await facts.inspect([factKey('remote.platform')])
    await facts.inspect([factKey('remote.platform')])
    expect(calls).toBe(1)
  })
})
