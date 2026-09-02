import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as GitHubPublisherInvariant from '../src/invariant.ts'

describe('GitHub Issue publisher invariant companion', () => {
  it('registers the package-owned empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(GitHubPublisherInvariant)

    await expect(fiber.await()).resolves.toBeDefined()
    await fiber.dispose()
    await expect(ctx.plugin(GitHubPublisherInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
