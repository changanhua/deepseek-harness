/** One browser-document activity snapshot delivered to the Host. */
export interface ClientObservation {
  /** Fresh identity for one document lifecycle. */
  readonly clientId: string
  /** Monotonic producer sequence used for duplicate and reordering rejection. */
  readonly seq: number
  /** Whether the DSH main document is currently visible. */
  readonly visible: boolean
  /** Whether the visible, focused document has recent interaction. */
  readonly active: boolean
  /** Browser timestamp retained only for diagnostics; never used for accounting. */
  readonly clientObservedAt: number
}

/** Acceptance result for one browser observation. */
export interface ClientObservationAck {
  /** False when the sequence was duplicate or older than accepted state. */
  readonly accepted: boolean
}

/** Inclusive start and exclusive end in Host epoch milliseconds. */
export interface WorkInterval {
  readonly start: number
  readonly end: number
}

/** Host range query over one non-empty epoch interval. */
export interface WorkObservatoryRangeRequest {
  readonly from: number
  readonly to: number
}

/** Normalized Work Observatory durations and source timelines for one range. */
export interface WorkObservatoryRange {
  readonly from: number
  readonly to: number
  readonly summary: {
    readonly humanActiveMs: number
    readonly pageVisibleMs: number
    readonly agentRunningMs: number
    readonly agentSoloMs: number
    readonly togetherMs: number
  }
  readonly timeline: {
    readonly humanActive: readonly WorkInterval[]
    readonly pageVisible: readonly WorkInterval[]
    readonly agentRunning: readonly WorkInterval[]
  }
}

/** Persisted Human interval kind. */
export type HumanIntervalKind = 'visible' | 'active'
