import { afterEach, describe, expect, it } from 'vitest'
import { WorkObservatoryDatabase } from '../src/database.ts'
import { HumanActivityTracker } from '../src/client-tracker.ts'
import type { ClientObservation } from '../src/types.ts'

const openDatabases: WorkObservatoryDatabase[] = []

function setup(staleAfterMs = 30_000) {
  const database = new WorkObservatoryDatabase(':memory:')
  openDatabases.push(database)
  return {
    database,
    tracker: new HumanActivityTracker(database, staleAfterMs),
  }
}

function observation(
  seq: number,
  visible: boolean,
  active: boolean,
  clientId = '00000000-0000-4000-8000-000000000001',
): ClientObservation {
  return { clientId, seq, visible, active, clientObservedAt: seq }
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close()
})

describe('HumanActivityTracker', () => {
  it('does not open an interval for an initially hidden client', () => {
    const { database, tracker } = setup()

    expect(tracker.observe(observation(0, false, false), 1_000)).toEqual({ accepted: true })
    expect(database.queryHumanIntervals('visible', 0, 10_000)).toEqual([])
    expect(database.queryHumanIntervals('active', 0, 10_000)).toEqual([])
  })

  it('opens visible and active intervals at Host receive time', () => {
    const { database, tracker } = setup()

    tracker.observe(observation(0, true, true), 1_000)

    expect(database.queryHumanIntervals('visible', 0, 10_000)).toEqual([{ start: 1_000, end: 1_000 }])
    expect(database.queryHumanIntervals('active', 0, 10_000)).toEqual([{ start: 1_000, end: 1_000 }])
  })

  it('closes active immediately while leaving visible open', () => {
    const { database, tracker } = setup()

    tracker.observe(observation(0, true, true), 1_000)
    tracker.observe(observation(1, true, false), 5_000)

    expect(database.queryHumanIntervals('active', 0, 10_000)).toEqual([{ start: 1_000, end: 5_000 }])
    expect(database.queryHumanIntervals('visible', 0, 10_000)).toEqual([{ start: 1_000, end: 5_000 }])
  })

  it('closes visible and active together when the document becomes hidden', () => {
    const { database, tracker } = setup()

    tracker.observe(observation(0, true, true), 1_000)
    tracker.observe(observation(1, false, false), 5_000)

    expect(database.queryHumanIntervals('active', 0, 10_000)).toEqual([{ start: 1_000, end: 5_000 }])
    expect(database.queryHumanIntervals('visible', 0, 10_000)).toEqual([{ start: 1_000, end: 5_000 }])
  })

  it('touches open intervals on a same-state heartbeat without opening another row', () => {
    const { database, tracker } = setup()

    tracker.observe(observation(0, true, true), 1_000)
    tracker.observe(observation(1, true, true), 2_000)

    expect(database.queryHumanIntervals('active', 0, 10_000)).toEqual([{ start: 1_000, end: 2_000 }])
    expect(database.queryHumanIntervals('visible', 0, 10_000)).toEqual([{ start: 1_000, end: 2_000 }])
  })

  it('ignores a duplicate sequence entirely even when its payload differs', () => {
    const { database, tracker } = setup()

    tracker.observe(observation(10, true, true), 1_000)
    expect(tracker.observe(observation(10, false, false), 5_000)).toEqual({ accepted: false })

    expect(database.queryHumanIntervals('active', 0, 10_000)).toEqual([{ start: 1_000, end: 1_000 }])
    expect(database.queryHumanIntervals('visible', 0, 10_000)).toEqual([{ start: 1_000, end: 1_000 }])
  })

  it('ignores an out-of-order sequence without moving state or evidence', () => {
    const { database, tracker } = setup()

    tracker.observe(observation(11, true, true), 1_000)
    expect(tracker.observe(observation(9, false, false), 5_000)).toEqual({ accepted: false })

    expect(database.queryHumanIntervals('active', 0, 10_000)).toEqual([{ start: 1_000, end: 1_000 }])
  })

  it('closes stale intervals at their last evidence rather than sweep time', () => {
    const { database, tracker } = setup(3_000)

    tracker.observe(observation(0, true, true), 1_000)
    tracker.observe(observation(1, true, true), 2_000)
    expect(tracker.sweepStale(10_000)).toBe(1)

    expect(database.queryHumanIntervals('active', 0, 20_000)).toEqual([{ start: 1_000, end: 2_000 }])
    expect(database.queryHumanIntervals('visible', 0, 20_000)).toEqual([{ start: 1_000, end: 2_000 }])
  })

  it('starts new intervals when a stale client reappears with a higher sequence', () => {
    const { database, tracker } = setup(3_000)

    tracker.observe(observation(0, true, true), 1_000)
    tracker.observe(observation(1, true, true), 2_000)
    tracker.sweepStale(10_000)
    tracker.observe(observation(2, true, true), 12_000)

    expect(database.queryHumanIntervals('active', 0, 20_000)).toEqual([
      { start: 1_000, end: 2_000 },
      { start: 12_000, end: 12_000 },
    ])
  })

  it('rejects active without visible before any state changes', () => {
    const { database, tracker } = setup()

    expect(() => tracker.observe(observation(0, false, true), 1_000)).toThrow(/active.*visible/i)
    expect(database.queryHumanIntervals('active', 0, 10_000)).toEqual([])
  })

  it.each([
    [{ ...observation(0, true, true), clientId: '' }, /clientId/],
    [{ ...observation(0, true, true), seq: -1 }, /seq/],
    [{ ...observation(0, true, true), clientObservedAt: Number.NaN }, /clientObservedAt/],
  ] as const)('rejects malformed observations', (input, message) => {
    const { tracker } = setup()
    expect(() => tracker.observe(input, 1_000)).toThrow(message)
  })
})
