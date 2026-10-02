import { expect, test, vi } from 'vitest'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import Workflow from '@deepseek-ai/dsh-workflow-worker-thread'
import * as Bridge from '../src/index.ts'
import { setup } from '../../budget-agent/tests/harness.ts'

test('real concurrent Workflow children share one atomic budget and durable child scopes', async () => {
  const h = await setup(3, 'deny')
  try {
    await h.ctx.plugin(Subagents)
    await h.ctx.plugin(Spawn, { providerName: 'spawn' })
    await h.ctx.plugin(Workflow, {})
    await h.ctx.plugin(Bridge, { workflows: [{ name: 'bounded', onExhausted: 'deny',
      limits: { requests: 1, inputTokens: 100000, outputTokens: 100000, totalTokens: 200000, wallTimeMs: 60000 } }] })
    const run = h.ctx.workflowEngine.start({ parent: h.agent, meta: { name: 'bounded', description: 'Shared parent admission' },
      script: "return await parallel([() => agent('a'), () => agent('b')])" })
    const result = await run.result
    await run.dispose()
    expect(h.adapter.requests, JSON.stringify(result)).toHaveLength(1)
    expect(h.ctx.budget.scopeFor({ kind: 'workflow', id: run.id })?.consumed.requests).toBe(1)
    expect(h.ctx.budget.scopeFor({ kind: 'session', id: h.agent.id })?.consumed.requests).toBe(1)
    expect(h.ctx.budget.scopeFor({ kind: 'workflow', id: run.id })?.reserved.requests).toBe(0)
  } finally { await h.close() }
}, 30000)

test('unavailable Workflow policy never starts a child after the guard is removed', async () => {
  const h = await setup(3, 'deny')
  try {
    await h.ctx.plugin(Subagents)
    await h.ctx.plugin(Spawn, { providerName: 'spawn' })
    await h.ctx.plugin(Workflow, {})
    const bridge = h.ctx.plugin(Bridge, { workflows: [{ name: 'bounded', onExhausted: 'deny',
      limits: { requests: 1, inputTokens: 100000, outputTokens: 100000, totalTokens: 200000, wallTimeMs: 60000 } }] })
    await bridge
    await bridge.dispose()
    const starts = vi.spyOn(h.ctx.subagents, 'start')
    const run = h.ctx.workflowEngine.start({ parent: h.agent, meta: { name: 'bounded', description: 'Removed guard' }, script: "return await agent('denied')" })
    const result = await run.result
    await run.dispose()
    expect(result.stopReason).toBe('error')
    expect(starts).not.toHaveBeenCalled()
    expect(h.adapter.requests).toHaveLength(0)
  } finally { await h.close() }
}, 30000)
