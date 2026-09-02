import { describe, expect, it } from 'vitest'
import { mergeIntervals, summarizeIntervals } from '../src/projection.ts'

describe('Work Observatory interval projection', () => {
  it('unions concurrent browser and agent intervals before measuring overlap', () => {
    const result = summarizeIntervals({
      from: 0,
      to: 100,
      humanActive: [{ start: 10, end: 30 }, { start: 20, end: 40 }],
      pageVisible: [{ start: 0, end: 50 }, { start: 25, end: 60 }],
      agentRunning: [{ start: 25, end: 55 }, { start: 45, end: 70 }],
    })

    expect(result).toEqual({
      summary: {
        humanActiveMs: 30,
        pageVisibleMs: 60,
        agentRunningMs: 45,
        togetherMs: 15,
        agentSoloMs: 30,
      },
      timeline: {
        humanActive: [{ start: 10, end: 40 }],
        pageVisible: [{ start: 0, end: 60 }],
        agentRunning: [{ start: 25, end: 70 }],
      },
    })
  })

  it('clips half-open intervals to the requested range and drops empty rows', () => {
    expect(mergeIntervals([
      { start: -10, end: 20 },
      { start: 20, end: 20 },
      { start: 80, end: 120 },
    ], 0, 100)).toEqual([
      { start: 0, end: 20 },
      { start: 80, end: 100 },
    ])
  })

  it('rejects an invalid or unbounded query instead of scanning forever', () => {
    expect(() => summarizeIntervals({
      from: 10,
      to: 10,
      humanActive: [],
      pageVisible: [],
      agentRunning: [],
    })).toThrow(/from.*to/i)

    expect(() => summarizeIntervals({
      from: 0,
      to: 32 * 24 * 60 * 60 * 1_000,
      humanActive: [],
      pageVisible: [],
      agentRunning: [],
    })).toThrow(/31 days/i)
  })
})
