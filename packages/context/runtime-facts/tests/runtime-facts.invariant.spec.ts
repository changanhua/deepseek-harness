import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import * as RuntimeFactsInvariant from '@deepseek-ai/dsh-runtime-facts/invariant'
import { factKey } from '../src/index.ts'
import { describe, expect, it } from 'vitest'

function assembly(text: string): PromptAssembly {
  return {
    sections: [],
    contexts: [{ name: 'runtime-facts', text }],
    tools: [],
    variables: {},
  }
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  ctx.provide('runtimeFacts', {
    list: () => [
      {
        key: factKey('host.arch'),
        owner: 'runtime-facts-host',
        description: 'Host architecture.',
        evaluation: 'sync',
        freshness: 'static',
        exposure: 'baseline',
      },
      {
        key: factKey('host.os'),
        owner: 'runtime-facts-host',
        description: 'Host operating system.',
        evaluation: 'sync',
        freshness: 'static',
        exposure: 'baseline',
      },
    ],
  } as never)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(RuntimeFactsInvariant)
  return ctx
}

async function observe(ctx: Context, result: PromptAssembly): Promise<PromptAssembly> {
  return await ctx.waterfall(
    ctx as never,
    'system-prompt/assemble',
    { sections: [], contexts: [], tools: [], variables: {} },
    {},
    () => Promise.resolve(result),
  )
}

describe('runtime-facts invariant', () => {
  it('accepts a sorted projection containing registered synchronous baseline keys', async () => {
    const ctx = await setup()
    const result = assembly('Host runtime facts:\n- host.arch: x64\n- host.os: win32')
    await expect(observe(ctx, result)).resolves.toEqual(result)
  })

  it.each([
    ['Host facts:\n- host.arch: x64', /must start with/],
    ['Host runtime facts:\n- host.unknown: value', /unregistered key/],
    ['Host runtime facts:\n- host.os: win32\n- host.arch: x64', /must be sorted/],
    ['Host runtime facts:\ninvalid', /line must match/],
  ])('rejects a malformed runtime-facts projection', async (text, message) => {
    const ctx = await setup()
    await expect(observe(ctx, assembly(text))).rejects.toThrow(message)
  })
})
