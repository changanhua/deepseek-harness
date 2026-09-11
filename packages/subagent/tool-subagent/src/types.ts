/** Session-owned records for foreground delegation input and obsolete output. */
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'

/** Input identity recorded before one foreground provider invocation. */
export interface ForegroundInputBindingData {
  readonly callId: ToolCallId
  readonly provider: string
  readonly inputRevision: number
  readonly promptDigest: string
}

/** Obsolete output retained for inspection, outside model history. */
export interface ForegroundStaleResultData {
  readonly callId: ToolCallId
  readonly basisSeq: number
  readonly runId: string
  readonly output: JsonValue[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Log-only input identity captured before a foreground child starts. */
    'subagent/foreground-input': ForegroundInputBindingData
    /** Log-only obsolete output, retained without entering model history. */
    'subagent/foreground-stale': ForegroundStaleResultData
  }
}
