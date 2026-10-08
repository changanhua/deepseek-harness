/**
 * Read-only diagnostics for a closed step/turn with missing tool outcomes.
 * Open tails remain the responsibility of interruptedTurnClosers; this scan
 * never manufactures events, rewrites history, or executes/retries a tool.
 * @module dsh-session/tool-protocol
 */

import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionSeq } from './types.ts'

/** One unresolved tool request at the boundary that prematurely closed it. */
export interface ClosedToolCallGap {
  readonly turn: number
  readonly step: number
  readonly callId: ToolCallId
  readonly requestSeq: SessionSeq
  readonly callSeq?: SessionSeq
  readonly closedAt: SessionSeq
}

type PendingCall = Omit<ClosedToolCallGap, 'closedAt'>

/**
 * Diagnose protocol gaps even when ordinary tail repair considers the log
 * closed. Identity includes turn and step, so reused provider call ids cannot
 * balance another turn. Surface rewrites are presentations, not executions.
 * @param events - accepted logical events in their recorded order.
 * @returns gaps in closure/model-request order, without changing the input.
 */
export function closedToolCallGaps(events: readonly SessionEvent[]): ClosedToolCallGap[] {
  const pending = new Map<string, PendingCall>()
  const gaps: ClosedToolCallGap[] = []
  const key = (turn: number, step: number, callId: ToolCallId): string =>
    JSON.stringify([turn, step, callId])

  for (const event of events) {
    switch (event.type) {
      case 'assistant/message': {
        if (event.surfaceOp === 'replace') break
        for (const block of event.data.message.content) {
          if (block.type !== 'tool-call') continue
          const { turn, step } = event.data
          const identity = key(turn, step, block.id)
          if (!pending.has(identity)) {
            pending.set(identity, { turn, step, callId: block.id, requestSeq: event.seq })
          }
        }
        break
      }
      case 'tool/call': {
        const { turn, step, callId } = event.data
        const identity = key(turn, step, callId)
        const previous = pending.get(identity)
        pending.set(identity, {
          turn, step, callId,
          requestSeq: previous?.requestSeq ?? event.seq,
          callSeq: event.seq,
        })
        break
      }
      case 'tool/result': {
        if (event.surfaceOp === 'replace') break
        pending.delete(key(event.data.turn, event.data.step, event.data.message.source.callId))
        break
      }
      case 'step/end':
      case 'turn/end': {
        for (const [identity, call] of pending) {
          if (call.turn !== event.data.turn) continue
          if (event.type === 'step/end' && call.step !== event.data.step) continue
          gaps.push({ ...call, closedAt: event.seq })
          pending.delete(identity)
        }
        break
      }
      default:
        break
    }
  }
  return gaps
}
