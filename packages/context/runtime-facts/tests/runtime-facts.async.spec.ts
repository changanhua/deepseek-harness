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

describe('RuntimeFacts asynchronous inspection', () => {
  it('returns ok, unavailable, probe-failure, and unknown without one failure stopping siblings', async () => {
    const facts = await registry()
    facts.registerFact({
      key: factKey('probe.ok'),
      owner: 'test-owner',
      description: 'Successful probe.',
      evaluation: 'async',
      freshness: 'dynamic',
      exposure: 'inspect',
      resolveAsync: async () => true,
    })
    facts.registerFact({
      key: factKey('probe.missing'),
      owner: 'test-owner',
      description: 'Unavailable probe.',
      evaluation: 'async',
      freshness: 'dynamic',
      exposure: 'inspect',
      resolveAsync: async () => undefined,
    })
    facts.registerFact({
      key: factKey('probe.failed'),
      owner: 'test-owner',
      description: 'Failing probe.',
      evaluation: 'async',
      freshness: 'dynamic',
      exposure: 'inspect',
      resolveAsync: async () => { throw new Error('provider secret must not escape') },
    })

    await expect(facts.inspect([
      factKey('probe.ok'),
      factKey('probe.missing'),
      factKey('probe.failed'),
      factKey('probe.unknown'),
    ])).resolves.toEqual({
      'probe.ok': { status: 'ok', value: true },
      'probe.missing': { status: 'unavailable' },
      'probe.failed': { status: 'probe-failure', reason: 'probe failed' },
      'probe.unknown': { status: 'unknown' },
    })
  })

  it('classifies an aborted async probe without exposing the abort reason', async () => {
    const facts = await registry()
    facts.registerFact({
      key: factKey('probe.slow'),
      owner: 'test-owner',
      description: 'Abortable probe.',
      evaluation: 'async',
      freshness: 'dynamic',
      exposure: 'inspect',
      resolveAsync: async (_context, signal) => {
        await new Promise<void>((resolve) => {
          signal?.addEventListener('abort', () => { resolve() }, { once: true })
        })
        return true
      },
    })
    const controller = new AbortController()
    const pending = facts.inspect([factKey('probe.slow')], { signal: controller.signal })
    controller.abort(new Error('secret abort detail'))

    await expect(pending).resolves.toEqual({
      'probe.slow': { status: 'probe-failure', reason: 'aborted' },
    })
  })

  it('never evaluates an asynchronous fact during automatic rendering', async () => {
    const facts = await registry()
    let calls = 0
    facts.registerFact({
      key: factKey('probe.async-baseline'),
      owner: 'test-owner',
      description: 'Asynchronous baseline declaration reserved for inspection.',
      evaluation: 'async',
      freshness: 'dynamic',
      exposure: 'baseline',
      resolveAsync: async () => { calls += 1; return true },
    })

    expect(facts.render({})).toBe('')
    expect(calls).toBe(0)
  })
})
