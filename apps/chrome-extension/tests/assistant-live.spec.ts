import { describe, expect, test } from 'vitest'
import { createAssistantLive } from '../src/assistant-live.js'

const attemptId = 'attempt-1'
type LiveState = { revision: number; active: null | { chunks: unknown[] } }
type LiveProjection = {
  read(): LiveState
  replace(baseline: Record<string, unknown>): void
  accept(frame: Record<string, unknown>): 'accepted' | 'ignored' | 'rebaseline'
}
const liveProjection: () => LiveProjection = createAssistantLive
const start = (revision = 1) => ({ type: 'start', attemptId, revision, startedAfterSeq: -1, turn: 1, step: 1 })
const chunk = (revision: number, index: number, text: string) => ({
  type: 'chunk', attemptId, revision, index, time: 20 + index,
  chunk: { type: 'text-delta', index: 0, text },
})

describe('assistant live projection', () => {
  test('reconstructs the exact reconnect prefix and advances dense frames', () => {
    const live = liveProjection()
    live.replace({ revision: 2, activeAttempt: {
      attemptId, startedAfterSeq: -1, turn: 1, step: 1, nextIndex: 1,
      stream: [{ type: 'text-chunks', time0: 20, index: 0, dt: [1], texts: ['a', 'b'] }],
    } })
    expect(live.read()).toEqual({ revision: 2, active: {
      attemptId, startedAfterSeq: -1, turn: 1, step: 1, nextIndex: 1,
      chunks: [{ time: 20, chunk: { type: 'text-delta', index: 0, text: 'a' } }],
    } })

    expect(live.accept(chunk(3, 1, 'c'))).toBe('accepted')
    expect(live.read().active?.chunks).toHaveLength(2)
    expect(live.accept({ type: 'end', attemptId, revision: 4, index: 2,
      outcome: { kind: 'committed', eventType: 'assistant/message', seq: 3 } })).toBe('accepted')
    expect(live.read()).toEqual({ revision: 4, active: null })
  })

  test('requests rebaseline without erasing the last visible prefix on a revision or index gap', () => {
    const live = liveProjection()
    expect(live.accept(start())).toBe('accepted')
    expect(live.accept(chunk(2, 0, 'visible'))).toBe('accepted')
    const before = live.read()

    expect(live.accept(chunk(4, 1, 'gap'))).toBe('rebaseline')
    expect(live.read()).toEqual(before)
    expect(live.accept(chunk(3, 2, 'wrong index'))).toBe('rebaseline')
    expect(live.read()).toEqual(before)
  })
})
