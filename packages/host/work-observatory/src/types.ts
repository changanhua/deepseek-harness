import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Browser-owned identity, monotonically sequenced for one document lifecycle. */
export interface ClientObservation {
  readonly clientId: string
  readonly seq: number
  readonly visible: boolean
  readonly active: boolean
  readonly sessionId?: SessionId
}

/** One bounded epoch range, optionally limited to a canonical project path. */
export interface WorkObservatoryRangeRequest {
  readonly from: number
  readonly to: number
  readonly projectPath?: string
}

/** Half-open wall-clock interval in Unix epoch milliseconds. */
export interface WorkObservatoryInterval {
  readonly start: number
  readonly end: number
}

/** Work Observatory totals. Agent time means open Session-step wall time, not CPU time. */
export interface WorkObservatorySummary {
  readonly humanActiveMs: number
  readonly pageVisibleMs: number
  readonly agentRunningMs: number
  readonly togetherMs: number
  readonly agentSoloMs: number
}

/** Per-Session attribution for range drilldown. */
export interface WorkObservatorySessionSummary {
  readonly sessionId: SessionId
  readonly projectPath?: string
  readonly humanActiveMs: number
  readonly agentRunningMs: number
  readonly togetherMs: number
}

/** Bounded, read-only Work Observatory projection. */
export interface WorkObservatoryRange {
  readonly from: number
  readonly to: number
  readonly projectPath?: string
  readonly summary: WorkObservatorySummary
  readonly timeline: {
    readonly humanActive: readonly WorkObservatoryInterval[]
    readonly pageVisible: readonly WorkObservatoryInterval[]
    readonly agentRunning: readonly WorkObservatoryInterval[]
  }
  readonly sessions: readonly WorkObservatorySessionSummary[]
}
