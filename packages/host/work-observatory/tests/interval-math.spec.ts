import { describe, expect, it } from 'vitest'
import {
  clipIntervals,
  durationOfIntervals,
  intersectIntervals,
  mergeIntervals,
  subtractIntervals,
  type WorkInterval,
} from '../src/interval-math.ts'

describe('mergeIntervals', () => {
  it('returns [] for []', () => {
    expect(mergeIntervals([])).toEqual([])
  })

  it('keeps a single interval', () => {
    expect(mergeIntervals([{ start: 1, end: 2 }])).toEqual([{ start: 1, end: 2 }])
  })

  it('merges overlapping intervals', () => {
    expect(mergeIntervals([{ start: 1, end: 3 }, { start: 2, end: 4 }]))
      .toEqual([{ start: 1, end: 4 }])
  })

  it('merges touching half-open intervals', () => {
    expect(mergeIntervals([{ start: 1, end: 2 }, { start: 2, end: 3 }]))
      .toEqual([{ start: 1, end: 3 }])
  })

  it('keeps a containing interval when a nested one fits inside', () => {
    expect(mergeIntervals([{ start: 1, end: 10 }, { start: 2, end: 3 }]))
      .toEqual([{ start: 1, end: 10 }])
  })

  it('sorts unsorted input before merging', () => {
    expect(mergeIntervals([{ start: 4, end: 5 }, { start: 1, end: 3 }, { start: 2, end: 4 }]))
      .toEqual([{ start: 1, end: 5 }])
  })

  it('drops zero- and negative-length intervals', () => {
    expect(mergeIntervals([{ start: 3, end: 3 }, { start: 2, end: 1 }, { start: 1, end: 2 }]))
      .toEqual([{ start: 1, end: 2 }])
  })

  it('does not merge disjoint intervals and keeps ascending non-overlapping output', () => {
    const merged = mergeIntervals([{ start: 3, end: 4 }, { start: 1, end: 2 }])
    expect(merged).toEqual([{ start: 1, end: 2 }, { start: 3, end: 4 }])
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i]!.start).toBeGreaterThanOrEqual(merged[i - 1]!.end)
    }
  })
})

describe('clipIntervals', () => {
  const range = { from: 2, to: 8 }

  it('drops intervals entirely outside to the right and left', () => {
    expect(clipIntervals([{ start: 9, end: 10 }], range.from, range.to)).toEqual([])
    expect(clipIntervals([{ start: 0, end: 1 }], range.from, range.to)).toEqual([])
  })

  it('keeps an interval fully inside the range', () => {
    expect(clipIntervals([{ start: 5, end: 6 }], range.from, range.to))
      .toEqual([{ start: 5, end: 6 }])
  })

  it('clips a partial left overlap', () => {
    expect(clipIntervals([{ start: 0, end: 4 }], range.from, range.to))
      .toEqual([{ start: 2, end: 4 }])
  })

  it('clips a partial right overlap', () => {
    expect(clipIntervals([{ start: 5, end: 10 }], range.from, range.to))
      .toEqual([{ start: 5, end: 8 }])
  })

  it('keeps an interval covering the whole range', () => {
    expect(clipIntervals([{ start: 0, end: 10 }], range.from, range.to))
      .toEqual([{ start: 2, end: 8 }])
  })

  it('returns no duration for an exact boundary touch', () => {
    expect(clipIntervals([{ start: 0, end: 2 }], range.from, range.to)).toEqual([])
  })

  it('drops empty input intervals and clips each surviving fragment', () => {
    expect(clipIntervals([{ start: 2, end: 2 }, { start: 1, end: 4 }], range.from, range.to))
      .toEqual([{ start: 2, end: 4 }])
  })

  it('returns an empty range when from >= to', () => {
    expect(clipIntervals([{ start: 0, end: 10 }], 8, 8)).toEqual([])
    expect(clipIntervals([{ start: 0, end: 10 }], 8, 2)).toEqual([])
  })
})

describe('intersectIntervals', () => {
  it('returns [] when disjoint', () => {
    expect(intersectIntervals([{ start: 1, end: 3 }], [{ start: 5, end: 7 }])).toEqual([])
  })

  it('returns the exact overlap for identical intervals', () => {
    expect(intersectIntervals([{ start: 1, end: 5 }], [{ start: 1, end: 5 }]))
      .toEqual([{ start: 1, end: 5 }])
  })

  it('keeps the contained interval when one side contains the other', () => {
    expect(intersectIntervals([{ start: 1, end: 10 }], [{ start: 3, end: 5 }]))
      .toEqual([{ start: 3, end: 5 }])
  })

  it('intersects multiple alternating intervals', () => {
    expect(intersectIntervals(
      [{ start: 1, end: 3 }, { start: 5, end: 7 }],
      [{ start: 2, end: 6 }],
    )).toEqual([{ start: 2, end: 3 }, { start: 5, end: 6 }])
  })

  it('returns [] against an empty set', () => {
    expect(intersectIntervals([{ start: 1, end: 3 }], [])).toEqual([])
  })
})

describe('subtractIntervals', () => {
  it('keeps the left set when there is no subtraction', () => {
    expect(subtractIntervals([{ start: 1, end: 5 }], [])).toEqual([{ start: 1, end: 5 }])
    expect(subtractIntervals([{ start: 1, end: 5 }], [{ start: 6, end: 9 }]))
      .toEqual([{ start: 1, end: 5 }])
  })

  it('splits into two when removing a middle interval', () => {
    expect(subtractIntervals([{ start: 1, end: 10 }], [{ start: 3, end: 5 }]))
      .toEqual([{ start: 1, end: 3 }, { start: 5, end: 10 }])
  })

  it('removes a prefix', () => {
    expect(subtractIntervals([{ start: 1, end: 10 }], [{ start: 0, end: 3 }]))
      .toEqual([{ start: 3, end: 10 }])
  })

  it('removes a suffix', () => {
    expect(subtractIntervals([{ start: 1, end: 10 }], [{ start: 8, end: 12 }]))
      .toEqual([{ start: 1, end: 8 }])
  })

  it('cuts multiple holes', () => {
    expect(subtractIntervals([{ start: 1, end: 10 }], [{ start: 2, end: 3 }, { start: 5, end: 6 }]))
      .toEqual([{ start: 1, end: 2 }, { start: 3, end: 5 }, { start: 6, end: 10 }])
  })

  it('returns [] when the right set fully covers the left', () => {
    expect(subtractIntervals([{ start: 1, end: 10 }], [{ start: 0, end: 20 }])).toEqual([])
  })

  it('ignores right intervals entirely left of a left interval', () => {
    expect(subtractIntervals([{ start: 10, end: 20 }], [{ start: 0, end: 5 }]))
      .toEqual([{ start: 10, end: 20 }])
  })
})

describe('durationOfIntervals', () => {
  it('returns 0 for an empty set', () => {
    expect(durationOfIntervals([])).toBe(0)
  })

  it('sums non-overlapping half-open intervals', () => {
    expect(durationOfIntervals([{ start: 1, end: 2 }, { start: 5, end: 7 }])).toBe(3)
  })

  it('merges overlapping and touching input before summing', () => {
    expect(durationOfIntervals([{ start: 1, end: 10 }, { start: 5, end: 12 }])).toBe(11)
    expect(durationOfIntervals([{ start: 1, end: 2 }, { start: 2, end: 3 }])).toBe(2)
  })

  it('stays within safe integer range for large durations', () => {
    const big = durationOfIntervals([{ start: 0, end: 1_000_000_000 }, { start: 2_000_000_000, end: 4_000_000_000 }])
    expect(big).toBe(3_000_000_000)
    expect(Number.isSafeInteger(big)).toBe(true)
  })

  it('counts each covered wall-clock moment once for non-normalized input', () => {
    const input: WorkInterval[] = [{ start: 1, end: 10 }, { start: 3, end: 4 }]
    expect(durationOfIntervals(input)).toBe(9)
  })
})
