import { expect, test } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { setup } from './harness.ts'

test('real Agent requests derive Session authority and record exact provider usage', async () => {
  const h = await setup(1, 'deny')
  try {
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }))
    await h.agent.whenIdle()
    expect(h.adapter.requests, JSON.stringify(h.agent.session.events.filter(event => event.type === 'turn/end'))).toHaveLength(1)
    expect(h.ctx.budget.scopeFor({ kind: 'session', id: h.agent.id })?.consumed).toMatchObject({ requests: 1, inputTokens: 10, outputTokens: 5 })
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } }))
    await h.agent.whenIdle()
    expect(h.adapter.requests).toHaveLength(1)
  } finally { await h.close() }
})

test('ask uses the existing approval waterfall once and writes the Session audit pair', async () => {
  const h = await setup(0, 'ask')
  try {
    let questions = 0
    h.ctx.on('approval/request', async () => { questions++; return 'allowed-once' })
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'allow one request' }], source: { kind: 'user' } }))
    await h.agent.whenIdle()
    expect(questions).toBe(1)
    expect(h.adapter.requests).toHaveLength(1)
    expect(h.agent.session.events.filter(event => event.type === 'approval/asked')).toHaveLength(1)
    expect(h.agent.session.events.filter(event => event.type === 'approval/decided')).toHaveLength(1)
  } finally { await h.close() }
})

test('missing answerer makes no provider call and exhausted Goal continuation records budget-exhausted', async () => {
  const h = await setup(0, 'ask')
  try {
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'no answerer' }], source: { kind: 'user' } }))
    await h.agent.whenIdle()
    expect(h.adapter.requests).toHaveLength(0)
    const created = h.ctx.goals.create(h.agent, { objective: 'continue only within budget' })
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'next goal round' }],
      source: { kind: 'goal', goalId: created.id, revision: created.revision, round: 1 } }))
    await h.agent.whenIdle()
    expect(h.ctx.goals.get(h.agent)).toMatchObject({ phase: 'blocked', blockedReason: { code: 'budget-exhausted' } })
    expect(h.adapter.requests).toHaveLength(0)
  } finally { await h.close() }
})
