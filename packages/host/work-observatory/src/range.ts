/** Range query normalization and Work Observatory metric derivation. */

import {
  clipIntervals,
  durationOfIntervals,
  intersectIntervals,
  mergeIntervals,
  subtractIntervals,
} from './interval-math.ts'
import type { WorkObservatoryDatabase } from './database.ts'
import type {
  WorkObservatoryRange,
  WorkObservatoryRangeRequest,
} from './types.ts'

/** Reads persisted interval candidates and derives one internally consistent result. */
export class WorkObservatoryRangeReader {
  /** @param database - package-owned interval store. */
  constructor(private readonly database: WorkObservatoryDatabase) {}

  /**
   * Derive normalized timelines and summaries for one half-open query range.
   * @param request - non-empty Host epoch range.
   * @param now - Host query timestamp used only for confirmed live Agent rows.
   * @returns timelines and durations computed from the same normalized sets.
   */
  read(request: WorkObservatoryRangeRequest, now: number): WorkObservatoryRange {
    validateRange(request)
    assertEpoch(now, 'now')
    const { from, to } = request
    const pageVisible = mergeIntervals(clipIntervals(
      this.database.queryHumanIntervals('visible', from, to),
      from,
      to,
    ))
    const humanActive = mergeIntervals(clipIntervals(
      this.database.queryHumanIntervals('active', from, to),
      from,
      to,
    ))
    const agentRunning = mergeIntervals(clipIntervals(
      this.database.queryAgentIntervals(from, to, now),
      from,
      to,
    ))

    if (subtractIntervals(humanActive, pageVisible).length !== 0) {
      throw new Error('work observatory invariant violated: Human Active must be a subset of Page Visible')
    }

    const together = intersectIntervals(humanActive, agentRunning)
    const agentSolo = subtractIntervals(agentRunning, humanActive)
    const agentRunningMs = durationOfIntervals(agentRunning)
    const togetherMs = durationOfIntervals(together)
    const agentSoloMs = durationOfIntervals(agentSolo)
    if (agentSoloMs + togetherMs !== agentRunningMs) {
      throw new Error('work observatory invariant violated: Agent Solo plus Together must equal Agent Running')
    }

    return {
      from,
      to,
      summary: {
        humanActiveMs: durationOfIntervals(humanActive),
        pageVisibleMs: durationOfIntervals(pageVisible),
        agentRunningMs,
        agentSoloMs,
        togetherMs,
      },
      timeline: {
        humanActive,
        pageVisible,
        agentRunning,
      },
    }
  }
}

function validateRange(request: WorkObservatoryRangeRequest): void {
  const candidate: unknown = request
  if (typeof candidate !== 'object' || candidate === null) {
    throw new TypeError('range request must be an object')
  }
  assertEpoch(request.from, 'from')
  assertEpoch(request.to, 'to')
  if (request.from >= request.to) throw new TypeError('from must be less than to')
}

function assertEpoch(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe epoch millisecond`)
  }
}
