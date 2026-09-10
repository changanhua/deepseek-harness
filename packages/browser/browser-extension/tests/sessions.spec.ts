import { describe, expect, test, vi } from 'vitest'
import { BrowserSessions } from '../src/sessions.ts'

type Controller = ConstructorParameters<typeof BrowserSessions>[0]

function followSignal(calls: unknown, index: number): AbortSignal {
  if (!Array.isArray(calls) || !Array.isArray(calls[index]) || !(calls[index][1] instanceof AbortSignal)) {
    throw new Error('follow call did not receive an AbortSignal')
  }
  return calls[index][1]
}

const sessionId = 'session-1'
const streamId = '123e4567-e89b-42d3-a456-426614174000'
const nextStreamId = '223e4567-e89b-42d3-a456-426614174000'

const controller = () => ({
  list: vi.fn(async (_request: unknown, _signal: AbortSignal) => ({ items: [] as never[] })),
  create: vi.fn(async (request: { sessionId?: string }) => ({ sessionId: request.sessionId ?? sessionId })),
  prompt: vi.fn(async () => ({ accepted: true })), cancel: vi.fn(() => ({ accepted: true })),
  page: vi.fn(async () => ({ records: [], hasMore: false })), attachment: vi.fn(async () => ({ attachment: {}, data: '' })),
  follow: vi.fn((_request: unknown, signal: AbortSignal) => ({
    async *[Symbol.asyncIterator]() {
      yield { type: 'event', event: { type: 'user/message', seq: 1, time: 1, data: null } }
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    },
  })),
})

describe('browser assistant session peer', () => {
  test('在每次调用前后检查 grant permit，并严格拒绝额外 create 字段', async () => {
    const c = controller(); let allowed = true
    const sessions = new BrowserSessions(c as unknown as Controller, { permit: () => allowed, send: () => {} })
    await expect(sessions.handle('session.create', { sessionId, cwd: 'C:/work' })).resolves.toEqual({ sessionId })
    expect(c.create).toHaveBeenCalledWith({ sessionId, cwd: 'C:/work' }, expect.any(AbortSignal))
    await expect(sessions.handle('session.create', { sessionId, agentPreset: 'unsafe' })).rejects.toMatchObject({ code: 'bad_request' })
    allowed = false
    await expect(sessions.handle('session.list', {})).rejects.toMatchObject({ code: 'forbidden' })
    expect(c.list).not.toHaveBeenCalled()
  })

  test('follow 立即返回 caller 指定 streamId，替换与 unfollow 只中止自己的流', async () => {
    const c = controller(); const frames: unknown[] = []
    const sessions = new BrowserSessions(c as unknown as Controller, {
      permit: () => true,
      send: (frame: unknown) => { frames.push(frame) },
    })
    await expect(sessions.handle('session.follow', { streamId, request: { address: { kind: 'session', sessionId }, maxMessages: 10 } })).resolves.toEqual({ streamId })
    await vi.waitFor(() => {
      expect(frames.some(frame => frame !== null && typeof frame === 'object'
        && 'type' in frame && frame.type === 'event' && 'streamId' in frame && frame.streamId === streamId
        && 'event' in frame)).toBe(true)
    })
    const firstSignal = followSignal(c.follow.mock.calls, 0)
    await sessions.handle('session.follow', { streamId: nextStreamId, request: { address: { kind: 'session', sessionId } } })
    expect(firstSignal.aborted).toBe(true)
    await sessions.handle('session.unfollow', { streamId })
    expect((c.follow.mock.calls[1]?.[1] as AbortSignal).aborted).toBe(false)
    await sessions.handle('session.unfollow', { streamId: nextStreamId })
    expect((c.follow.mock.calls[1]?.[1] as AbortSignal).aborted).toBe(true)
  })

  test('拒绝 subagent follow，send 出错会终止流并发出可恢复错误，dispose 中止在途调用', async () => {
    const c = controller(); const frames: unknown[] = []; let sends = 0
    const sessions = new BrowserSessions(c as unknown as Controller, { permit: () => true, send: (frame) => { sends += 1; if (sends === 1) throw new Error('backpressure'); frames.push(frame) } })
    await expect(sessions.handle('session.follow', { streamId, request: { address: { kind: 'subagent', parentSessionId: sessionId, childSessionId: 'child', mode: 'one-shot' } } })).rejects.toMatchObject({ code: 'bad_request' })
    await sessions.handle('session.follow', { streamId, request: { address: { kind: 'session', sessionId } } })
    await vi.waitFor(() =>{  expect(frames).toContainEqual({ type: 'event', streamId, error: { code: 'stream_error', message: 'backpressure' } }) })
    c.list.mockImplementationOnce((_request: unknown, signal: AbortSignal) => new Promise<{ items: never[] }>((_resolve, reject) =>{  signal.addEventListener('abort', () =>{  reject(new Error('aborted')) }, { once: true }) }))
    const call = sessions.handle('session.list', {})
    const cancelled = expect(call).rejects.toMatchObject({ code: 'cancelled' })
    await sessions.dispose()
    await cancelled
  })

  test('拒绝任意 JSON prompt part，并把并发 follow 串行化为最后一个流', async () => {
    const c = controller(); const sessions = new BrowserSessions(c as unknown as Controller, { permit: () => true, send: () => {} })
    await expect(sessions.handle('session.prompt', { requestId: 'r', sessionId, mode: 'queue', content: [{ arbitrary: true }] })).rejects.toMatchObject({ code: 'bad_request' })
    await expect(sessions.handle('session.prompt', { requestId: 'r', sessionId, mode: 'queue', content: Array.from({ length: 9 }, () => ({ type: 'text', text: 'x' })) })).rejects.toMatchObject({ code: 'bad_request' })
    await Promise.all([
      sessions.handle('session.follow', { streamId, request: { address: { kind: 'session', sessionId } } }),
      sessions.handle('session.follow', { streamId: nextStreamId, request: { address: { kind: 'session', sessionId } } }),
    ])
    expect(c.follow).toHaveBeenCalledTimes(2)
    expect((c.follow.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(true)
    expect((c.follow.mock.calls[1]?.[1] as AbortSignal).aborted).toBe(false)
  })

  test('dispose 等待已经开始的 controller 调用真正结束', async () => {
    const c = controller(); let finish!: () => void
    c.list.mockImplementationOnce(() => new Promise((resolve) => { finish = () =>{  resolve({ items: [] }) } }))
    const sessions = new BrowserSessions(c as unknown as Controller, { permit: () => true, send: () => {} })
    const call = sessions.handle('session.list', {})
    await vi.waitFor(() =>{  expect(c.list).toHaveBeenCalledTimes(1) })
    let disposed = false
    const disposing = sessions.dispose().then(() => { disposed = true })
    let secondDisposed = false
    const secondDisposal = sessions.dispose().then(() => { secondDisposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    expect(secondDisposed).toBe(false)
    finish()
    await disposing
    await secondDisposal
    await expect(call).rejects.toMatchObject({ code: 'cancelled' })
  })
})
