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

  it('rejects asynchronous facts that claim baseline exposure', async () => {
    const facts = await registry()
    expect(() => facts.registerFact({
      key: factKey('probe.async-baseline'),
      owner: 'test-owner',
      description: 'Invalid asynchronous baseline declaration.',
      evaluation: 'async',
      freshness: 'dynamic',
      exposure: 'baseline',
      resolveAsync: async () => true,
    })).toThrow(/exposure "baseline" must use synchronous evaluation/)
  })

  it('does not cache an aborted static async observation', async () => {
    const facts = await registry()
    let calls = 0
    facts.registerFact({
      key: factKey('probe.static-abort'),
      owner: 'test-owner',
      description: 'Static probe that may be cancelled by one caller.',
      evaluation: 'async',
      freshness: 'static',
      exposure: 'inspect',
      resolveAsync: async (_context, signal) => {
        calls += 1
        if (signal !== undefined) {
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
        }
        return true
      },
    })

    const controller = new AbortController()
    const cancelled = facts.inspect([factKey('probe.static-abort')], { signal: controller.signal })
    controller.abort()
    await expect(cancelled).resolves.toEqual({
      'probe.static-abort': { status: 'probe-failure', reason: 'aborted' },
    })
    await expect(facts.inspect([factKey('probe.static-abort')])).resolves.toEqual({
      'probe.static-abort': { status: 'ok', value: true },
    })
    expect(calls).toBe(2)
  })

  it('does not let one scoped static async inspection seed the global cache', async () => {
    const facts = await registry()
    let calls = 0
    facts.registerFact({
      key: factKey('probe.static-scope'),
      owner: 'test-owner',
      description: 'Static probe whose caller scope must not become global state.',
      evaluation: 'async',
      freshness: 'static',
      exposure: 'inspect',
      resolveAsync: async (context) => {
        calls += 1
        return context.scope === undefined ? 'global' : 'scoped'
      },
    })

    await expect(facts.inspect([factKey('probe.static-scope')], { scope: {} })).resolves.toEqual({
      'probe.static-scope': { status: 'ok', value: 'scoped' },
    })
    await expect(facts.inspect([factKey('probe.static-scope')])).resolves.toEqual({
      'probe.static-scope': { status: 'ok', value: 'global' },
    })
    await expect(facts.inspect([factKey('probe.static-scope')])).resolves.toEqual({
      'probe.static-scope': { status: 'ok', value: 'global' },
    })
    expect(calls).toBe(2)
  })

  it('does not cache a transient probe failure for a static async fact', async () => {
    const facts = await registry()
    let calls = 0
    facts.registerFact({
      key: factKey('probe.static-retry'),
      owner: 'test-owner',
      description: 'Static probe that can recover from a transient failure.',
      evaluation: 'async',
      freshness: 'static',
      exposure: 'inspect',
      resolveAsync: async () => {
        calls += 1
        if (calls === 1) throw new Error('temporary failure')
        return true
      },
    })

    await expect(facts.inspect([factKey('probe.static-retry')])).resolves.toEqual({
      'probe.static-retry': { status: 'probe-failure', reason: 'probe failed' },
    })
    await expect(facts.inspect([factKey('probe.static-retry')])).resolves.toEqual({
      'probe.static-retry': { status: 'ok', value: true },
    })
    expect(calls).toBe(2)
  })
})
