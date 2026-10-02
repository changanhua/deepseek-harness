import { writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@changanhua/dsh-budget'
import type {} from '@deepseek-ai/dsh-agent'

export const name = 'budget-profile-fixture'
export const inject = ['llm', 'budget', 'agents']

/** External model boundary is recorded; dispatch, Agent, persistence and Loader remain real. */
export function apply(ctx: Context): void {
  let calls = 0
  let pending: Promise<void> = Promise.resolve()
  class Adapter extends LlmAdapter {
    async * stream(): AsyncIterable<StreamChunk> {
      calls++
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Budget fixture completed.' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Budget fixture completed.' } }
      yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 4, totalTokens: 11 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['budget-fixture'], new Adapter())
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (!ctx.budget.scopeFor({ kind: 'session', id: agent.id })) await ctx.budget.createScope({
      id: `session:${agent.id}`, kind: 'session', subjectId: agent.id, parentId: null,
      limits: { requests: 1, inputTokens: 1000000, outputTokens: 1000, totalTokens: 1001000, wallTimeMs: 60000 }, onExhausted: 'deny',
    }, () => {})
    return next()
  })
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    const agent = ctx.agents.get(session.id)
    if (!agent) return
    const evidence = { calls, snapshot: ctx.budget.scopeFor({ kind: 'session', id: agent.id }), terminal: event.data.reason }
    pending = pending.then(() => writeFile('budget-evidence.json', JSON.stringify(evidence)))
  })
  ctx.effect(() => () => pending, 'budgetFixture.report()')
}
