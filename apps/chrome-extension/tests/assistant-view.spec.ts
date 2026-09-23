import { describe, expect, test } from 'vitest'
import { projectAssistantView } from '../src/assistant-view.js'

const text = (value: string) => [{ type: 'text', text: value }]
const event = (seq: number, type: string, data: Record<string, unknown>, surfaceOp: unknown = 'append') => ({
  type: 'event', event: { type, seq, time: seq + 1, data, surfaceOp },
})

describe('assistant V2 view projection', () => {
  test('shows one live Assistant prefix instead of its staged durable settlement', () => {
    const state = { session: {
      binding: null, phase: 'live', pending: null, pendingCreate: null, modelSelection: null,
      records: [event(0, 'assistant/message', {
        turn: 2, step: 1, message: { role: 'assistant', content: text('complete but not settled') },
      })],
      assistantLive: { revision: 2, active: {
        attemptId: 'attempt-1', startedAfterSeq: -1, turn: 2, step: 1, nextIndex: 1,
        chunks: [{ time: 2, chunk: { type: 'text-delta', index: 0, text: 'visible prefix' } }],
      } },
    } }

    expect(projectAssistantView({ surfaceId: 'surface-1', state }).session.transcript).toEqual([
      { key: 'assistant-live:attempt-1', role: 'assistant', text: 'visible prefix', images: [], live: true },
    ])
  })

  test('projects only append-origin conversation messages and never invents function state', () => {
    const state = {
      connection: { phase: 'connected' },
      session: {
        binding: { baseUrl: 'https://dsh.test', installationId: 'installation-1', sessionId: 'session-1' },
        phase: 'error', error: { code: 'network_error', message: 'network failed' }, pending: null, pendingCreate: null, modelSelection: null,
        records: [
          event(0, 'user/message', { role: 'user', source: { kind: 'user' }, content: text('question') }),
          event(1, 'assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: text('visible answer') } }),
          event(2, 'assistant/message', { turn: 1, step: 2, message: { role: 'assistant', content: text('model-only replacement') } },
            { op: 'replace', startSeq: 0, endSeq: 1 }),
        ],
      },
    }

    const view = projectAssistantView({ surfaceId: 'surface-1', state })

    expect(view.surface).toEqual({ id: 'surface-1' })
    expect(view.session.error).toEqual({ code: 'network_error', message: 'network failed' })
    expect(view.session.transcript).toEqual([
      { key: 'user:0', role: 'user', text: 'question', images: [] },
      { key: 'assistant:1', role: 'assistant', text: 'visible answer', images: [] },
    ])
    expect(view.target).toEqual({ availability: 'unavailable', revision: null, selected: null, candidates: [] })
    expect(view.cognition).toEqual({ status: 'unread', pages: [], refreshPolicy: 'manual-or-agent-request', refresh: { status: 'idle' } })
    expect(view.functions).toEqual({ availability: 'unavailable', items: [] })
  })
})
