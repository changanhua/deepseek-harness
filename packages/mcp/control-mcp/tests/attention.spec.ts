import { describe, expect, it } from 'vitest'
import { ControlAttentions } from '../src/attention.ts'
import { DshControlPlane } from '../src/control-plane.ts'

describe('live control questions', () => {
  it('keeps concurrent questions distinct and retracts cancelled and disposed requests', async () => {
    const attention = new ControlAttentions()
    const abort = new AbortController()
    const questions = [{ id: 'choice', question: 'Choose', options: [{ label: 'yes' }] }]
    const first = attention.ask('one', { questions, signal: abort.signal })
    const firstRejected = expect(first).rejects.toThrow('cancelled')
    const second = attention.ask('one', { questions })
    const [a, b] = attention.list('one')
    expect(a?.attentionId).not.toBe(b?.attentionId)
    expect(() => attention.answer('two', b!.attentionId, { answers: [] })).toThrow('no longer pending')
    expect(() => attention.answer('one', b!.attentionId, { answers: [{ id: 'choice', selected: ['invented'] }] }))
      .toThrow('offered option labels')
    abort.abort(new Error('cancelled'))
    await firstRejected
    expect(() => attention.answer('one', a!.attentionId, { answers: [] })).toThrow('no longer pending')
    attention.answer('one', b!.attentionId, { answers: [{ id: 'choice', selected: ['yes'] }] })
    await expect(second).resolves.toEqual({ answers: [{ id: 'choice', selected: ['yes'] }] })
    const third = attention.ask('one', { questions })
    const disposed = expect(third).rejects.toThrow('disposed')
    attention.dispose()
    await disposed
    expect(attention.list('one')).toEqual([])
  })

  it('wakes an active wait on a real question and pages events without skipping', async () => {
    const attention = new ControlAttentions()
    const events = [0, 1, 2].map(seq => ({ seq, type: 'step/start' }))
    const plane = new DshControlPlane({
      runId: 'run', attention,
      sessions: {
        create: async () => ({ sessionId: 'one' }),
        prompt: async () => ({ accepted: true }),
        inspect: async () => ({ meta: {}, events }),
        getAgent: () => ({ status: 'running', whenIdle: async () => {} }),
        subscribe: () => () => {},
      },
    })
    const signal = new AbortController().signal
    const call = (method: Parameters<typeof plane.handle>[0]['method'], params: Record<string, unknown>) =>
      plane.handle({ runId: 'run', requestId: method, method, params }, signal)
    await call('session_open', { sessionId: 'one' })
    const waiting = call('session_wait', { sessionId: 'one', timeoutMs: 5000, limit: 1 })
    const answering = attention.ask('one', { questions: [{ id: 'next', question: 'Next?' }] })
    await expect(waiting).resolves.toMatchObject({
      timedOut: false, phase: 'waiting_for_attention', cursor: 0, latestSeq: 2, hasMore: true,
    })
    await expect(call('session_events', { sessionId: 'one', afterSeq: 0, limit: 1 }))
      .resolves.toMatchObject({ cursor: 1, hasMore: true, events: [{ seq: 1 }] })
    const rejection = expect(answering).rejects.toThrow('disposed')
    attention.dispose()
    await rejection
    await expect(call('session_observe', { sessionId: 'one' }))
      .resolves.toMatchObject({ phase: 'running', attention: [] })
  })
})
