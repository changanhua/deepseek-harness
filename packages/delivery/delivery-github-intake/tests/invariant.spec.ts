import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as GitHubIssueIntakeInvariant from '../src/invariant.ts'

describe('GitHub Issue intake invariant companion', () => {
  it('registers the package-owned empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(GitHubIssueIntakeInvariant)

    await expect(fiber.await()).resolves.toBeDefined()
    await fiber.dispose()
    await expect(ctx.plugin(GitHubIssueIntakeInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
