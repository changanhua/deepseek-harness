import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Invariants from '@deepseek-ai/dsh-invariants'
import * as companion from '../src/invariant.ts'

describe('content invariant ownership', () => {
  it('releases the package reservation when its companion unloads', async () => {
    const ctx = new Context()
    const registry = await ctx.plugin(Invariants)
    const fiber = await ctx.plugin(companion)
    try {
      expect(() => ctx.invariants.register('@changanhua/dsh-content', () => {})).toThrow(/already registered/u)
      await fiber.dispose()
      const dispose = ctx.invariants.register('@changanhua/dsh-content', () => {})
      await dispose()
    } finally {
      await fiber.dispose()
      await registry.dispose()
    }
  })
})
