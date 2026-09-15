/** Input binding for one foreground delegation owned by its calling Session. */
import { createHash } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'

import type {} from './types.ts'

/** Operation-local binding to the Session and its recorded assignment. */
export interface ForegroundInput {
  readonly session: Session
  readonly callId: ToolCallId
  readonly basisSeq: number
  readonly inputRevision: number
}

/** Latest accepted input insertion; unrelated log activity does not revise input. */
function inputRevision(session: Session): number {
  for (let index = session.events.length - 1; index >= 0; index--) {
    const event = session.events[index]
    if (event?.type === 'user/message'
      || (event?.type === 'agent/inbox/spliced' && event.data.inserted.length > 0)) return event.seq
  }
  return -1
}

/**
 * Record the exact prompt digest and parent input before dispatch.
 * @param parent - live calling Agent whose input owns this assignment.
 * @param callId - native tool call identity, never selected by the child.
 * @param provider - configured delegation provider.
 * @param prompt - exact text passed to the provider.
 * @returns an operation-local binding; pending new input rejects before dispatch.
 */
export function captureForegroundInput(
  parent: Agent,
  callId: ToolCallId,
  provider: string,
  prompt: string,
): ForegroundInput {
  if (parent.inbox.hasPending) throw new Error('subagent delegation has pending input; consume it before assigning another task')
  const session = parent.session
  const revision = inputRevision(session)
  const basis = session.append('subagent/foreground-input', {
    callId,
    provider,
    inputRevision: revision,
    promptDigest: createHash('sha256').update(prompt, 'utf8').digest('hex'),
  })
  if (inputRevision(session) !== revision) {
    throw new Error('subagent delegation input changed before dispatch; consume the new input first')
  }
  return { session, callId, basisSeq: basis.seq, inputRevision: revision }
}

/**
 * Withhold obsolete terminal output, retaining its text in the Session log.
 * @param parent - original calling Agent.
 * @param basis - input captured before the child started.
 * @param result - terminal output after provider resource disposal.
 * @throws when parent input changed; the error contains no obsolete child text.
 */
export function assertForegroundInputCurrent(
  parent: Agent,
  basis: ForegroundInput,
  result: { readonly runId: string; readonly output: JsonValue[] },
): void {
  if (parent.session === basis.session
    && !parent.inbox.hasPending
    && inputRevision(basis.session) === basis.inputRevision) return
  const archived = basis.session.append('subagent/foreground-stale', {
    callId: basis.callId,
    basisSeq: basis.basisSeq,
    runId: result.runId,
    output: result.output,
  })
  throw new Error(`subagent result withheld because parent input changed; obsolete output is retained in Session event ${archived.seq}. Re-evaluate the current request before delegating again.`)
}
