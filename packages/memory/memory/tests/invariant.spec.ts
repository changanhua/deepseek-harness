import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as Companion from '../src/invariant.ts'

describe('memory Definition diagnostic ownership', () => {
  it('reserves its package without a concrete memory service and releases that reservation on unload', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(InvariantRegistry)
      const companion = await ctx.plugin(Companion)
      expect(ctx.get('projectMemory')).toBeUndefined()
      expect(() => ctx.invariants.register('@changanhua/dsh-memory', () => {})).toThrow('already registered')
      await companion.dispose()
      const reloaded = await ctx.plugin(Companion)
      await reloaded.dispose()
    } finally { await ctx.fiber.dispose() }
  })
})
