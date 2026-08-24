/**
 * Pure interval algebra for the Work Observatory.
 *
 * This module is the single source of truth for range math in V1. It has no
 * dependency on SQLite, Cordis, or React. Every interval is half-open
 * `[start, end)`; a zero- or negative-length interval is empty and carries no
 * time. Functions that return interval lists return normalized lists: sorted
 * by ascending start, merged, and mutually non-overlapping.
 */

import type { WorkInterval } from './types.ts'

export type { WorkInterval } from './types.ts'

/** True when the interval is non-empty (`end > start`). */
const nonEmpty = ({ start, end }: WorkInterval): boolean => end > start

/**
 * Normalizes intervals: drops empty ranges, sorts by ascending start, merges
 * overlapping and touching neighbors. Touching `[a,b)` + `[b,c)` merge into
 * `[a,c)` because the half-open union has no gap. The output is ascending,
 * merged, and mutually non-overlapping.
 * @param intervals - input intervals, allowed to be unsorted and overlapping.
 * @returns normalized intervals.
 */
export function mergeIntervals(intervals: readonly WorkInterval[]): WorkInterval[] {
  const sorted = intervals.filter(nonEmpty).sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = []
  let last: { start: number; end: number } | undefined
  for (const { start, end } of sorted) {
    if (last !== undefined && start <= last.end) {
      if (end > last.end) last.end = end
    } else {
      last = { start, end }
      merged.push(last)
    }
  }
  return merged
}

/**
 * Clips each input interval to `[from, to)` and returns the surviving
 * non-empty fragments. Clipping does not merge neighbors: the caller decides
 * whether to normalize the result (range derivation applies `merge(clip(...))`).
 * @param intervals - input intervals, allowed to be unsorted and overlapping.
 * @param from - inclusive range start (epoch ms).
 * @param to - exclusive range end (epoch ms); a non-empty result requires `to > from`.
 * @returns the clipped fragments, in input order.
 */
export function clipIntervals(intervals: readonly WorkInterval[], from: number, to: number): WorkInterval[] {
  const out: WorkInterval[] = []
  for (const { start, end } of intervals) {
    if (end <= start) continue
    const clippedStart = Math.max(start, from)
    const clippedEnd = Math.min(end, to)
    if (clippedEnd > clippedStart) out.push({ start: clippedStart, end: clippedEnd })
  }
  return out
}

/**
 * Returns the intersection of two interval sets as normalized intervals.
 * @param left - first interval set.
 * @param right - second interval set.
 * @returns the intersection of `left` and `right`, normalized.
 */
export function intersectIntervals(left: readonly WorkInterval[], right: readonly WorkInterval[]): WorkInterval[] {
  const leftNormalized = mergeIntervals(left)
  const rightNormalized = mergeIntervals(right)
  const out: WorkInterval[] = []
  for (const a of leftNormalized) {
    for (const b of rightNormalized) {
      const start = Math.max(a.start, b.start)
      const end = Math.min(a.end, b.end)
      if (end > start) out.push({ start, end })
    }
  }
  return mergeIntervals(out)
}

/**
 * Returns `left` minus `right` as normalized intervals.
 * @param left - the interval set being subtracted from.
 * @param right - the interval set to remove.
 * @returns `left` with every point of `right` removed, normalized.
 */
export function subtractIntervals(left: readonly WorkInterval[], right: readonly WorkInterval[]): WorkInterval[] {
  const leftNormalized = mergeIntervals(left)
  const rightNormalized = mergeIntervals(right)
  const out: WorkInterval[] = []
  for (const a of leftNormalized) {
    let cursor = a.start
    for (const b of rightNormalized) {
      if (b.end <= cursor) continue
      if (b.start >= a.end) break
      if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, a.end) })
      cursor = Math.max(cursor, b.end)
      if (cursor >= a.end) break
    }
    if (cursor < a.end) out.push({ start: cursor, end: a.end })
  }
  return mergeIntervals(out)
}

/**
 * Sums the duration of an interval set in milliseconds. The input need not be
 * normalized: overlapping and touching intervals are merged before summing, so
 * each covered wall-clock moment is counted once.
 * @param intervals - interval set to measure.
 * @returns total duration in milliseconds.
 */
export function durationOfIntervals(intervals: readonly WorkInterval[]): number {
  let total = 0
  for (const { start, end } of mergeIntervals(intervals)) total += end - start
  return total
}
