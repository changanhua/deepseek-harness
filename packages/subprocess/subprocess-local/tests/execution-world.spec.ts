import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { describe, expect, it } from 'vitest'

describe('LocalSubprocessRuntime execution world', () => {
  it('identifies host executables and processes as local', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    expect(ctx.subprocess.executionWorld).toBe('local')
    await fiber.dispose()
  })
})
