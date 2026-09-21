import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '../src/types.ts'
import { closedToolCallGaps } from '../src/tool-protocol.ts'

/** Partial logical fixtures isolate the read-only relation from payload codecs. */
function event(seq: number, type: string, data: unknown, surfaceOp?: 'append' | 'replace'): SessionEvent {
  return { seq, time: seq, type, data, ...surfaceOp ? { surfaceOp } : {} } as SessionEvent
}
const request = (seq: number, turn = 1, step = 1, id = 'c') => event(seq, 'assistant/message', {
  turn, step, message: { content: [{ type: 'tool-call', id, name: 'x', arguments: '{}' }] },
}, 'append')
const call = (seq: number, turn = 1, step = 1, callId = 'c') => event(seq, 'tool/call', { turn, step, callId })
const result = (seq: number, turn = 1, step = 1, callId = 'c', op: 'append' | 'replace' = 'append') => event(seq, 'tool/result', {
  turn, step, message: { source: { callId } },
}, op)
const end = (seq: number, turn = 1, step = 1) => event(seq, 'step/end', { turn, step })

describe('closedToolCallGaps', () => {
  it('reports a recorded call once at the first closing boundary', () => {
    const log = [request(0), call(1), end(2), event(3, 'turn/end', { turn: 1 })]
    expect(closedToolCallGaps(log)).toEqual([
      { turn: 1, step: 1, callId: 'c', requestSeq: 0, callSeq: 1, closedAt: 2 },
    ])
  })

  it('includes an assistant request which never reached tool/call', () => {
    expect(closedToolCallGaps([request(0), end(1)])).toEqual([
      { turn: 1, step: 1, callId: 'c', requestSeq: 0, closedAt: 1 },
    ])
  })

  it('leaves open-tail repair unchanged and accepts balanced logs', () => {
    expect(closedToolCallGaps([])).toEqual([])
    expect(closedToolCallGaps([request(0), call(1)])).toEqual([])
    expect(closedToolCallGaps([request(0), call(1), result(2), end(3)])).toEqual([])
  })

  it('does not match a reused call id from a different turn or step', () => {
    expect(closedToolCallGaps([request(0), call(1), result(2, 2), end(3)])).toHaveLength(1)
    expect(closedToolCallGaps([request(0), call(1), result(2, 1, 2), end(3)])).toHaveLength(1)
  })

  it('does not mistake surface rewrites for new execution or a missing result', () => {
    expect(closedToolCallGaps([request(0), call(1), result(2, 1, 1, 'c', 'replace'), end(3)])).toHaveLength(1)
    const rewrite = { ...request(0), surfaceOp: 'replace' } as SessionEvent
    expect(closedToolCallGaps([rewrite, end(1)])).toEqual([])
  })

  it('reports unrequested recorded calls and missing step/end at the turn boundary', () => {
    expect(closedToolCallGaps([call(0), event(1, 'turn/end', { turn: 1 })])).toEqual([
      { turn: 1, step: 1, callId: 'c', requestSeq: 0, callSeq: 0, closedAt: 1 },
    ])
  })

  it('retains model order across multiple pending requests and ignores unrelated endings', () => {
    const log = [request(0, 1, 1, 'a'), request(1, 1, 1, 'b'), end(2, 2), end(3, 1, 2), end(4)]
    expect(closedToolCallGaps(log).map(gap => gap.callId)).toEqual(['a', 'b'])
    expect(closedToolCallGaps(log).map(gap => gap.closedAt)).toEqual([4, 4])
  })

  it('never mutates input or invents events on repeated inspection', () => {
    const log = Object.freeze([request(0), call(1), end(2)].map(item => Object.freeze(item)))
    const before = JSON.stringify(log)
    expect(closedToolCallGaps(log)).toEqual(closedToolCallGaps(log))
    expect(JSON.stringify(log)).toBe(before)
  })
})
