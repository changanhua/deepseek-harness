import { describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { callSubagent, disposeSetupProvider, fakeAgent, setup, text } from './harness.ts'

const userInput = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

describe('foreground delegation input revision', () => {
  it.each(['error', 'aborted', 'refusal', 'max-tokens'] as const)('withholds obsolete partial output from a %s result', async (stopReason) => {
    const parent = fakeAgent()
    const ctx = await setup({ provider: 'mock' }, {
      reply: 'obsolete partial action',
      stopReason,
      onStart: () => {
        parent.inbox.splice('next-step', 0, 0, [userInput('new requirements')])
      },
    })
    const result = await callSubagent(ctx, { description: 'draft', prompt: 'old requirements' }, { agent: parent })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('input changed')
    expect(text(result)).not.toContain('obsolete partial action')
    expect(parent.session.events.find(event => event.type === 'subagent/foreground-stale')?.data).toMatchObject({
      output: [{ type: 'text', text: 'obsolete partial action' }],
    })
    await disposeSetupProvider(ctx)
  })

  it('does not launch an old assignment when new parent input is already waiting', async () => {
    const onStart = vi.fn()
    const ctx = await setup({ provider: 'mock' }, { onStart })
    const parent = fakeAgent()
    parent.inbox.splice('next-step', 0, 0, [userInput('Use the new requirements')])
    const result = await callSubagent(ctx, { description: 'old assignment', prompt: 'old requirements' }, { agent: parent })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('pending input')
    expect(onStart).not.toHaveBeenCalled()
    await disposeSetupProvider(ctx)
  })

  it('archives an obsolete result without forwarding its text as a usable tool result', async () => {
    const parent = fakeAgent()
    const ctx = await setup({ provider: 'mock' }, {
      reply: 'obsolete proposed action',
      onStart: () => {
        parent.inbox.splice('next-step', 0, 0, [userInput('Changed requirements')])
      },
    })
    const result = await callSubagent(ctx, { description: 'draft', prompt: 'original requirements' }, { agent: parent })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('input changed')
    expect(text(result)).not.toContain('obsolete proposed action')
    const basis = parent.session.events.find(event => event.type === 'subagent/foreground-input')
    const stale = parent.session.events.find(event => event.type === 'subagent/foreground-stale')
    expect(basis?.data).toMatchObject({ provider: 'mock', inputRevision: -1 })
    expect(stale?.data).toMatchObject({
      basisSeq: basis?.seq,
      output: [{ type: 'text', text: 'obsolete proposed action' }],
    })
    await disposeSetupProvider(ctx)
  })

  it('retains the input change even if the queued message is later removed', async () => {
    const parent = fakeAgent()
    const ctx = await setup({ provider: 'mock' }, {
      onStart: () => {
        parent.inbox.splice('next-turn', 0, 0, [userInput('Changed requirements')])
        parent.inbox.clear()
      },
    })
    const result = await callSubagent(ctx, { description: 'draft', prompt: 'original requirements' }, { agent: parent })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('input changed')
    await disposeSetupProvider(ctx)
  })

  it('does not invalidate a result for unrelated session events', async () => {
    const parent = fakeAgent()
    const ctx = await setup({ provider: 'mock' }, {
      reply: 'current result',
      onStart: () => {
        parent.session.append('subagent/model-selection-policy', { allowedModels: [{ provider: 'p', model: 'm' }] })
      },
    })
    const result = await callSubagent(ctx, { description: 'draft', prompt: 'original requirements' }, { agent: parent })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('current result')
    expect(parent.session.events.filter(event => event.type === 'subagent/foreground-input')).toHaveLength(1)
    expect(parent.session.events.some(event => event.type === 'subagent/foreground-stale')).toBe(false)
    await disposeSetupProvider(ctx)
  })
})
