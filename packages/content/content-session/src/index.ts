/** Resolves one fully completed assistant message into a trusted Content capture source. */
import { Context, Service } from '@deepseek-ai/cordis'
import { CaptureCommandSchema, ContentError } from '@changanhua/dsh-content'
import type { CaptureCommand, ContentAccess, ResolvedCapture } from '@changanhua/dsh-content'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'

declare module '@deepseek-ai/cordis' {
  interface Context {
    contentSession: ContentSession
  }
}

/** Host-only bridge from Session observations to Content's verified source contract. */
export class ContentSession extends Service {
  static inject = ['sessionQuery']

  constructor(ctx: Context) {
    super(ctx, 'contentSession')
  }

  /**
   * Resolve a completed, text-only assistant message without activating its Agent.
   * @param request - Capture identity and the canonical source event sequence.
   * @param authorize - Trusted access check, repeated after the source read.
   * @param signal - Caller cancellation boundary.
   * @returns verified full-message text suitable for Content.capture().
   */
  async resolve(request: CaptureCommand, authorize: ContentAccess, signal: AbortSignal): Promise<ResolvedCapture> {
    assertOpen(signal)
    const parsed = parseRequest(request)
    const seq = parseMessageSequence(parsed.messageId)
    authorizeContent(authorize)
    assertOpen(signal)

    try {
      const snapshot = await readSession(this.ctx.sessionQuery.readSession(parsed.sessionId as SessionId), signal)
      assertOpen(signal)
      if (snapshot.session.cwd === undefined) throw new ContentError('not_found')
      if (snapshot.session.origin === 'subagent') throw new ContentError('forbidden')
      const event = snapshot.events.find(candidate => candidate.seq === seq)
      const body = completedText(event)
      assertOpen(signal)
      authorizeContent(authorize)
      assertOpen(signal)
      return {
        source: {
          type: 'session-message',
          sessionId: parsed.sessionId,
          messageId: parsed.messageId,
          captureId: `event:${parsed.messageId}`,
          scope: 'full-message',
          verification: 'host-verified',
          boundary: 'completed-text',
        },
        title: (snapshot.session as { readonly title?: string }).title ?? '',
        body,
      }
    } catch (error: unknown) {
      if (error instanceof ContentError) throw error
      if (signal.aborted) throw new ContentError('closed')
      if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw new ContentError('not_found')
      }
      throw new ContentError('unavailable')
    }
  }
}

function parseRequest(request: CaptureCommand): CaptureCommand {
  try {
    return CaptureCommandSchema.parse(request)
  } catch {
    throw new ContentError('invalid_request')
  }
}

function parseMessageSequence(messageId: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(messageId)) throw new ContentError('invalid_request')
  const seq = Number(messageId)
  if (!Number.isSafeInteger(seq)) throw new ContentError('invalid_request')
  return seq
}

function completedText(event: SessionEvent | undefined): string {
  if (event?.type !== 'assistant/message' || event.surfaceOp !== 'append' || event.data.interrupted === true) {
    throw new ContentError('invalid_transition')
  }
  const content = event.data.message.content
  if (content.length === 0) throw new ContentError('invalid_transition')
  let body = ''
  for (const block of content) {
    if (block.type !== 'text') throw new ContentError('invalid_transition')
    body += block.text
  }
  if (body === '') throw new ContentError('invalid_transition')
  return body
}

function authorizeContent(authorize: ContentAccess): void {
  try {
    authorize()
  } catch (error: unknown) {
    if (error instanceof ContentError && (error.code === 'forbidden' || error.code === 'closed')) throw error
    throw new ContentError('forbidden')
  }
}

function assertOpen(signal: AbortSignal): void {
  if (signal.aborted) throw new ContentError('closed')
}

async function readSession<T>(reading: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new ContentError('closed')
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => { reject(new ContentError('closed')) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([reading, aborted])
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  }
}

export default ContentSession
