import { afterEach, describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { HumanActivityTracker } from '../src/client-tracker.ts'
import { WorkObservatoryDatabase } from '../src/database.ts'
import { WorkObservatoryRangeReader } from '../src/range.ts'
import type { ClientObservation, WorkObservatoryRange } from '../src/types.ts'

const databases: WorkObservatoryDatabase[] = []

function setup() {
  const database = new WorkObservatoryDatabase(':memory:')
  databases.push(database)
  return {
    database,
    human: new HumanActivityTracker(database, 30_000),
    range: new WorkObservatoryRangeReader(database),
  }
}

function observation(
  clientId: string,
  seq: number,
  visible: boolean,
  active: boolean,
): ClientObservation {
  return { clientId, seq, visible, active, clientObservedAt: seq }
}

function agentEvent(
  type: 'step/start' | 'step/end',
  time: number,
  turn = 1,
  step = 1,
): SessionEvent<'step/start' | 'step/end'> {
  return { type, seq: type === 'step/start' ? 0 : 1, time, data: { turn, step } }
}

function addHuman(
  human: HumanActivityTracker,
  clientId: string,
  visible: [number, number],
  active: [number, number],
): void {
  human.observe(observation(clientId, 0, true, false), visible[0])
  human.observe(observation(clientId, 1, true, true), active[0])
  human.observe(observation(clientId, 2, true, false), active[1])
  human.observe(observation(clientId, 3, false, false), visible[1])
}

function addAgent(
  database: WorkObservatoryDatabase,
  sessionId: string,
  start: number,
  end?: number,
): void {
  database.projectAgentEvent(sessionId, agentEvent('step/start', start))
  if (end !== undefined) database.projectAgentEvent(sessionId, agentEvent('step/end', end))
}

function expectTimelineMatchesSummary(result: WorkObservatoryRange): void {
  const duration = (intervals: readonly { start: number; end: number }[]) =>
    intervals.reduce((total, interval) => total + interval.end - interval.start, 0)
  expect(duration(result.timeline.humanActive)).toBe(result.summary.humanActiveMs)
  expect(duration(result.timeline.pageVisible)).toBe(result.summary.pageVisibleMs)
  expect(duration(result.timeline.agentRunning)).toBe(result.summary.agentRunningMs)
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('WorkObservatoryRangeReader', () => {
  it('derives Human, Visible, Running, Together, and Solo from one algebra', () => {
    const { database, human, range } = setup()
    addHuman(human, 'client-1', [0, 40], [10, 20])
    addAgent(database, 'session-1', 15, 30)

    expect(range.read({ from: 0, to: 50 }, 50)).toEqual({
      from: 0,
      to: 50,
      summary: {
        humanActiveMs: 10,
        pageVisibleMs: 40,
        agentRunningMs: 15,
        agentSoloMs: 10,
        togetherMs: 5,
      },
      timeline: {
        humanActive: [{ start: 10, end: 20 }],
        pageVisible: [{ start: 0, end: 40 }],
        agentRunning: [{ start: 15, end: 30 }],
      },
    })
  })

  it('unions overlapping Human intervals from multiple browser clients', () => {
    const { human, range } = setup()
    addHuman(human, 'client-1', [0, 40], [10, 25])
    addHuman(human, 'client-2', [5, 45], [20, 30])

    const result = range.read({ from: 0, to: 50 }, 50)
    expect(result.timeline.humanActive).toEqual([{ start: 10, end: 30 }])
    expect(result.summary.humanActiveMs).toBe(20)
  })

  it('unions overlapping Agent rows from multiple Sessions', () => {
    const { database, range } = setup()
    addAgent(database, 'session-1', 10, 30)
    addAgent(database, 'session-2', 20, 40)

    const result = range.read({ from: 0, to: 50 }, 50)
    expect(result.timeline.agentRunning).toEqual([{ start: 10, end: 40 }])
    expect(result.summary.agentRunningMs).toBe(30)
  })

  it('does not double-count a child step nested inside a parent step', () => {
    const { database, range } = setup()
    addAgent(database, 'parent', 10, 50)
    addAgent(database, 'child', 20, 30)

    expect(range.read({ from: 0, to: 60 }, 60).summary.agentRunningMs).toBe(40)
  })

  it('ends an open Human interval at its last Host evidence', () => {
    const { human, range } = setup()
    human.observe(observation('client-1', 0, true, true), 10)
    human.observe(observation('client-1', 1, true, true), 20)

    const result = range.read({ from: 0, to: 200 }, 100)
    expect(result.timeline.humanActive).toEqual([{ start: 10, end: 20 }])
  })

  it('ends a confirmed open Agent interval at min(now, to)', () => {
    const { database, range } = setup()
    addAgent(database, 'live', 15)

    expect(range.read({ from: 0, to: 200 }, 100).timeline.agentRunning)
      .toEqual([{ start: 15, end: 100 }])
  })

  it('clips candidates crossing both query boundaries', () => {
    const { database, human, range } = setup()
    addHuman(human, 'client-1', [0, 100], [5, 90])
    addAgent(database, 'session-1', 0, 100)

    const result = range.read({ from: 20, to: 40 }, 100)
    expect(result.timeline.humanActive).toEqual([{ start: 20, end: 40 }])
    expect(result.timeline.agentRunning).toEqual([{ start: 20, end: 40 }])
  })

  it('splits a cross-midnight interval according to each epoch query range', () => {
    const { database, range } = setup()
    addAgent(database, 'overnight', 90, 110)

    expect(range.read({ from: 0, to: 100 }, 200).timeline.agentRunning)
      .toEqual([{ start: 90, end: 100 }])
    expect(range.read({ from: 100, to: 200 }, 200).timeline.agentRunning)
      .toEqual([{ start: 100, end: 110 }])
  })

  it('accepts a 23-hour DST calendar-day epoch range without forcing 24 hours', () => {
    const { human, range } = setup()
    const from = Date.parse('2026-03-08T05:00:00Z')
    const to = from + 23 * 60 * 60 * 1_000
    human.observe(observation('dst', 0, true, false), from)
    human.observe(observation('dst', 1, false, false), to)

    expect(range.read({ from, to }, to).summary.pageVisibleMs).toBe(23 * 60 * 60 * 1_000)
  })

  it('returns timeline totals equal to summary and preserves algebraic invariants', () => {
    const { database, human, range } = setup()
    addHuman(human, 'client-1', [0, 80], [10, 40])
    addAgent(database, 'session-1', 20, 70)

    const result = range.read({ from: 0, to: 100 }, 100)
    expectTimelineMatchesSummary(result)
    expect(result.summary.humanActiveMs).toBeLessThanOrEqual(result.summary.pageVisibleMs)
    expect(result.summary.agentSoloMs + result.summary.togetherMs)
      .toBe(result.summary.agentRunningMs)
  })

  it('counts an open live step through a historical range end', () => {
    const { database, range } = setup()
    addAgent(database, 'live-across-boundary', 20)

    expect(range.read({ from: 0, to: 50 }, 100).timeline.agentRunning)
      .toEqual([{ start: 20, end: 50 }])
  })

  it.each([
    [{ from: 10, to: 10 }, /from.*to/i],
    [{ from: 20, to: 10 }, /from.*to/i],
    [{ from: Number.NaN, to: 10 }, /from/i],
  ])('rejects an invalid range before querying', (request, message) => {
    const { range } = setup()
    expect(() => range.read(request, 100)).toThrow(message)
  })
})
