import { expect, test } from 'vitest'
import Commands from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as CommandBudget from '../src/index.ts'
import { setup } from '../../budget-agent/tests/harness.ts'

test('Human command reads, creates a Goal child budget and revokes it without starting a model', async () => {
  const h = await setup(4, 'deny')
  try {
    await h.ctx.plugin(Commands)
    const fiber = h.ctx.plugin(CommandBudget)
    await fiber
    const fresh = await h.ctx.agentLoop.create(SessionId('new-budget'), { provider: 'mock', model: 'mock', maxTokens: 32 })
    const configured = await h.ctx.commands.execute(fresh,
      '/budget {"action":"set","scope":"session","limits":{"requests":4,"inputTokens":100000,"outputTokens":20000,"totalTokens":120000,"wallTimeMs":600000},"onExhausted":"pause"}',
      [], new AbortController().signal)
    expect(configured?.result.kind, configured?.result.text).toBe('success')
    const execute = (input: unknown) => h.ctx.commands.execute(h.agent, `/budget ${JSON.stringify(input)}`, [], new AbortController().signal)
    const initial = await execute({ action: 'read', scope: 'session' })
    expect(initial?.result.kind).toBe('success')
    expect(JSON.parse(initial!.result.text!)).toMatchObject({ scope: { limits: { requests: 4 } } })
    const goal = h.ctx.goals.create(h.agent, { objective: 'a budgeted goal' })
    const created = await execute({ action: 'set', scope: 'goal', limits: { requests: 2, inputTokens: null, outputTokens: 50, totalTokens: 200, wallTimeMs: 5000 }, onExhausted: 'pause' })
    expect(created?.result.kind, created?.result.text).toBe('success')
    expect(h.ctx.budget.scopeFor({ kind: 'goal', id: goal.id })?.scope.parentId).toBe('session:parent')
    expect((await execute({ action: 'revoke', scope: 'goal' }))?.result.kind).toBe('success')
    expect(h.ctx.budget.scopeFor({ kind: 'goal', id: goal.id })?.scope.revoked).toBe(true)
    expect(h.adapter.requests).toHaveLength(0)
    await fiber.dispose()
    expect(await execute({ action: 'read', scope: 'session' })).toBeUndefined()
  } finally { await h.close() }
})
