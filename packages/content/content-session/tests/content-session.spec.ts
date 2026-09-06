import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import { SessionObservationReader } from '@deepseek-ai/dsh-session-query/src/observation.ts'
import { describe, expect, it, vi } from 'vitest'
import { ContentError } from '../../content/src/index.ts'
import ContentSession from '../src/index.ts'

function allow(): void {}

interface ColdSession {
  readonly header: object
  readonly events: object[]
  readonly dispose: ReturnType<typeof vi.fn>
}

async function fixture(cold?: ColdSession, queryFailure?: SessionQueryError) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  if (cold !== undefined) {
    ctx.provide('sessionPersistence', {
      borrowSession: async () => ({
        source: 'prepared',
        inspection: { meta: cold.header, events: cold.events },
        revision: 'test',
        preparedSession: {},
        [Symbol.dispose]: cold.dispose,
      }),
    } as never)
  }
  const reader = new SessionObservationReader(ctx)
  ctx.provide('sessionQuery', {
    readSession: async (id: SessionId) => {
      if (queryFailure !== undefined) throw queryFailure
      using observation = await reader.read(id, { projectionMode: 'none' })
      return { session: observation.header, events: [...observation.events] }
    },
  } as never)
  await ctx.plugin(ContentSession)
  return { ctx, resolver: ctx.contentSession }
}

function assistant(content: { type: string; text?: string }[]) {
  return createAssistantMessage({
    content: content as never,
    source: { provider: 'test', model: 'test' },
  })
}

function appendCompletedText(ctx: Context, sessionId: SessionId, text: string): number {
  const session = ctx.sessions.get(sessionId)
  if (session === undefined) throw new Error('test session missing')
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  return session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: assistant([{ type: 'text', text }]),
  }, { surfaceOp: 'append' }).seq
}

describe('content-session capture source resolver', () => {
  it('resolves a completed all-text assistant surface message from a live Session', async () => {
    const { ctx, resolver } = await fixture()
    const session = ctx.sessions.create(SessionId('live'), { meta: { cwd: '/project' } })
    const seq = appendCompletedText(ctx, session.id, 'alpha')

    await expect(resolver.resolve({ operationId: 'capture', sessionId: session.id, messageId: String(seq) }, allow, new AbortController().signal))
      .resolves.toEqual({
        source: {
          type: 'session-message', sessionId: session.id, messageId: String(seq), captureId: `event:${String(seq)}`,
          scope: 'full-message', verification: 'host-verified', boundary: 'completed-text',
        },
        title: '', body: 'alpha',
      })
    await ctx.fiber.dispose()
  })

  it('resolves a cold Session through the real observation reader and releases its persistence lease', async () => {
    const dispose = vi.fn()
    const message = assistant([{ type: 'text', text: 'cold body' }])
    const { ctx, resolver } = await fixture({
      header: { version: 0, id: SessionId('cold'), createdAt: 0, cwd: '/project', title: 'Stored title' },
      events: [{
        type: 'assistant/message', seq: 7, time: 0, surfaceOp: 'append',
        data: { turn: 1, step: 1, message },
      }],
      dispose,
    })

    await expect(resolver.resolve({ operationId: 'capture', sessionId: 'cold', messageId: '7' }, allow, new AbortController().signal))
      .resolves.toMatchObject({ title: 'Stored title', body: 'cold body' })
    expect(dispose).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('rejects malformed requests and unavailable or missing sessions without source payloads', async () => {
    const { ctx, resolver } = await fixture()
    const signal = new AbortController().signal
    await expect(resolver.resolve({ operationId: 'x', sessionId: 'missing', messageId: '0' }, allow, signal))
      .rejects.toEqual(new ContentError('not_found'))
    await expect(resolver.resolve({ operationId: 'x', sessionId: 'missing', messageId: '-1' }, allow, signal))
      .rejects.toEqual(new ContentError('invalid_request'))
    await expect(resolver.resolve({ operationId: 'x', sessionId: 'missing', messageId: '01' }, allow, signal))
      .rejects.toEqual(new ContentError('invalid_request'))
    await expect(resolver.resolve({ operationId: 'x', sessionId: 'missing', messageId: '0', extra: true } as never, allow, signal))
      .rejects.toEqual(new ContentError('invalid_request'))
    await ctx.fiber.dispose()
  })

  it.each([
    ['a missing workspace', { meta: {} }, 'not_found'],
    ['a subagent session', { meta: { cwd: '/project', origin: 'subagent' as const } }, 'forbidden'],
  ])('hides %s', async (_name, input, code) => {
    const { ctx, resolver } = await fixture()
    const session = ctx.sessions.create(SessionId(code), input)
    const seq = appendCompletedText(ctx, session.id, 'visible')
    await expect(resolver.resolve({ operationId: 'capture', sessionId: session.id, messageId: String(seq) }, allow, new AbortController().signal))
      .rejects.toEqual(new ContentError(code as 'not_found' | 'forbidden'))
    await ctx.fiber.dispose()
  })

  it.each([
    ['interrupted', { interrupted: true }],
    ['reasoning output', { content: [{ type: 'reasoning', text: 'hidden' }] }],
    ['a tool call', { content: [{ type: 'tool-call', id: 'call', name: 'tool', arguments: '{}' }] }],
    ['an image', { content: [{ type: 'image', attachment: { id: 'att', sha256: 'a'.repeat(64) } }] }],
    ['mixed text and reasoning', { content: [{ type: 'text', text: 'visible' }, { type: 'reasoning', text: 'hidden' }] }],
    ['mixed text and a tool call', {
      content: [{ type: 'text', text: 'visible' }, { type: 'tool-call', id: 'call', name: 'tool', arguments: '{}' }],
    }],
    ['empty', { content: [] }],
  ])('rejects %s output as an incomplete capture', async (_name, replacement) => {
    const { ctx, resolver } = await fixture()
    const session = ctx.sessions.create(SessionId('partial'), { meta: { cwd: '/project' } })
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const content = 'content' in replacement ? replacement.content : [{ type: 'text', text: 'visible' }]
    const event = session.append('assistant/message', {
      turn: 1, step: 1, message: assistant(content),
      ...('interrupted' in replacement && replacement.interrupted) ? { interrupted: true as const } : {},
    }, { surfaceOp: 'append' })

    await expect(resolver.resolve({ operationId: 'capture', sessionId: session.id, messageId: String(event.seq) }, allow, new AbortController().signal))
      .rejects.toEqual(new ContentError('invalid_transition'))
    await ctx.fiber.dispose()
  })

  it('rejects a message sequence that no stored event occupies', async () => {
    const { ctx, resolver } = await fixture()
    const session = ctx.sessions.create(SessionId('gap'), { meta: { cwd: '/project' } })
    appendCompletedText(ctx, session.id, 'visible')

    await expect(resolver.resolve({ operationId: 'capture', sessionId: session.id, messageId: '999' }, allow, new AbortController().signal))
      .rejects.toEqual(new ContentError('invalid_transition'))
    await ctx.fiber.dispose()
  })

  it('maps read-service failures to a stable unavailable code without source payloads', async () => {
    const { ctx, resolver } = await fixture(undefined, new SessionQueryError('index offline', 'SESSION_QUERY_INDEX_FAILED'))
    const session = ctx.sessions.create(SessionId('broken'), { meta: { cwd: '/project' } })
    const seq = appendCompletedText(ctx, session.id, 'visible')

    await expect(resolver.resolve({ operationId: 'capture', sessionId: session.id, messageId: String(seq) }, allow, new AbortController().signal))
      .rejects.toEqual(new ContentError('unavailable'))
    await ctx.fiber.dispose()
  })

  it('checks authority before and after the read, closes cancellation, and disposes the observation', async () => {
    const { ctx, resolver } = await fixture()
    const session = ctx.sessions.create(SessionId('authority'), { meta: { cwd: '/project' } })
    const seq = appendCompletedText(ctx, session.id, 'visible')
    const authorize = vi.fn()
    authorize.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('private') })
    const resolved = resolver.resolve(
      { operationId: 'capture', sessionId: session.id, messageId: String(seq) },
      authorize,
      new AbortController().signal,
    )
    await expect(resolved).rejects.toEqual(new ContentError('forbidden'))
    expect(authorize).toHaveBeenCalledTimes(2)
    const abort = new AbortController()
    abort.abort()
    await expect(resolver.resolve({ operationId: 'capture', sessionId: session.id, messageId: String(seq) }, allow, abort.signal))
      .rejects.toEqual(new ContentError('closed'))
    await ctx.fiber.dispose()
  })
})
