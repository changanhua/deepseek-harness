/** Half-open wall-clock interval in Unix epoch milliseconds. */
export interface WorkInterval {
  readonly start: number
  readonly end: number
}

/** Maximum range accepted by one Work Observatory query. */
export const MAX_QUERY_SPAN_MS = 31 * 24 * 60 * 60 * 1_000

/** Time totals presented by Work Observatory. */
export interface WorkSummary {
  readonly humanActiveMs: number
  readonly pageVisibleMs: number
  readonly agentRunningMs: number
  readonly togetherMs: number
  readonly agentSoloMs: number
}

/** Normalized timelines and their derived totals. */
export interface WorkProjection {
  readonly summary: WorkSummary
  readonly timeline: {
    readonly humanActive: readonly WorkInterval[]
    readonly pageVisible: readonly WorkInterval[]
    readonly agentRunning: readonly WorkInterval[]
  }
}

interface ProjectionInput {
  readonly from: number
  readonly to: number
  readonly humanActive: readonly WorkInterval[]
  readonly pageVisible: readonly WorkInterval[]
  readonly agentRunning: readonly WorkInterval[]
}

/**
 * Clip, sort, and union intervals inside one bounded query range.
 * @param input - Candidate half-open intervals.
 * @param from - Inclusive lower bound in Unix epoch milliseconds.
 * @param to - Exclusive upper bound in Unix epoch milliseconds.
 * @returns normalized non-overlapping intervals inside the bounds.
 */
export function mergeIntervals(
  input: readonly WorkInterval[],
  from = Number.NEGATIVE_INFINITY,
  to = Number.POSITIVE_INFINITY,
): WorkInterval[] {
  const clipped = input
    .map(({ start, end }) => ({ start: Math.max(start, from), end: Math.min(end, to) }))
    .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && start < end)
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const result: WorkInterval[] = []
  for (const interval of clipped) {
    const last = result.at(-1)
    if (last === undefined || interval.start > last.end) {
      result.push(interval)
    } else if (interval.end > last.end) {
      result[result.length - 1] = { start: last.start, end: interval.end }
    }
  }
  return result
}

function duration(intervals: readonly WorkInterval[]): number {
  return intervals.reduce((total, interval) => total + interval.end - interval.start, 0)
}

function intersect(left: readonly WorkInterval[], right: readonly WorkInterval[]): WorkInterval[] {
  const result: WorkInterval[] = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftInterval = left[leftIndex]
    const rightInterval = right[rightIndex]
    if (leftInterval === undefined || rightInterval === undefined) break
    const start = Math.max(leftInterval.start, rightInterval.start)
    const end = Math.min(leftInterval.end, rightInterval.end)
    if (start < end) result.push({ start, end })
    if (leftInterval.end <= rightInterval.end) leftIndex += 1
    else rightIndex += 1
  }
  return result
}

/**
 * Derive user-facing totals from the same normalized interval algebra.
 * @param input - Bounded human, page, and Agent interval sets.
 * @returns normalized timelines and their derived duration totals.
 */
export function summarizeIntervals(input: ProjectionInput): WorkProjection {
  if (!Number.isFinite(input.from) || !Number.isFinite(input.to) || input.from >= input.to) {
    throw new Error('Work Observatory range requires finite from < to')
  }
  if (input.to - input.from > MAX_QUERY_SPAN_MS) {
    throw new Error('Work Observatory range cannot exceed 31 days')
  }
  const humanActive = mergeIntervals(input.humanActive, input.from, input.to)
  const pageVisible = mergeIntervals(input.pageVisible, input.from, input.to)
  const agentRunning = mergeIntervals(input.agentRunning, input.from, input.to)
  const togetherMs = duration(intersect(humanActive, agentRunning))
  const agentRunningMs = duration(agentRunning)
  return {
    summary: {
      humanActiveMs: duration(humanActive),
      pageVisibleMs: duration(pageVisible),
      agentRunningMs,
      togetherMs,
      agentSoloMs: agentRunningMs - togetherMs,
    },
    timeline: { humanActive, pageVisible, agentRunning },
  }
}
