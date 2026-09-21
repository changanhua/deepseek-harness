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
  modelCatalog: vi.fn(async () => ({
    default: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'medium' },
    routableProviders: ['deepseek'],
    groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat',
      reasoning: { efforts: [{ id: 'low', name: '低' }, { id: 'medium', name: '中' }], defaultEffort: 'medium' } }] }],
    failures: [],
  })),
  selectModel: vi.fn(async (request: { provider: string; model: string; reasoningEffort?: string }) => ({
    selected: { provider: request.provider, model: request.model,
      ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }) },
  })),
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
  test('returns a detached Host model catalog and accepts only an empty request', async () => {
    const c = controller()
    const sessions = new BrowserSessions(c as unknown as Controller, { permit: () => true, send: () => {} })

    const result = await sessions.handle('session.modelCatalog', {})
    expect(result).toEqual(await c.modelCatalog.mock.results[0]?.value)
    expect(c.modelCatalog).toHaveBeenCalledOnce()
    expect(result).not.toBe(await c.modelCatalog.mock.results[0]?.value)
    await expect(sessions.handle('session.modelCatalog', { sessionId })).rejects.toMatchObject({ code: 'bad_request' })
  })

  test('forwards one strict Session model selection to the Host controller', async () => {
    const c = controller()
    const sessions = new BrowserSessions(c as unknown as Controller, { permit: () => true, send: () => {} })
    const request = { sessionId, provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'low' }

    await expect(sessions.handle('session.selectModel', request)).resolves.toEqual({
      selected: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'low' },
    })
    expect(c.selectModel).toHaveBeenCalledWith(request, expect.any(AbortSignal))
    await expect(sessions.handle('session.selectModel', { ...request, defaultEffort: 'medium' }))
      .rejects.toMatchObject({ code: 'bad_request' })
  })

  test('executes a slash command through the authenticated Session command bridge', async () => {
    const c = controller()
    const execute = vi.fn(async () => ({
      commandId: 'command-1', result: { kind: 'success' as const, text: 'Compacted 8 history items.' },
    }))
    const sessions = new BrowserSessions(c as unknown as Controller, {
      permit: () => true, send: () => {}, commands: { execute },
    })

    await expect(sessions.handle('commands.execute', { sessionId, line: '/compact' })).resolves.toEqual({
      commandId: 'command-1', result: { kind: 'success', text: 'Compacted 8 history items.' },
    })
    expect(execute).toHaveBeenCalledWith(sessionId, '/compact', expect.any(AbortSignal))
    await expect(sessions.handle('commands.execute', { sessionId, line: '/compact', ownerAgentId: 'unsafe' }))
      .rejects.toMatchObject({ code: 'bad_request' })
  })

  test('在每次调用前后检查 grant permit，并严格拒绝额外 create 字段', async () => {
    const c = controller(); let allowed = true
    const sessions = new BrowserSessions(c as unknown as Controller, { permit: () => allowed, send: () => {} })
    await expect(sessions.handle('session.create', { sessionId, cwd: 'C:/work' })).resolves.toEqual({ sessionId })
    expect(c.create).toHaveBeenCalledWith({ sessionId, cwd: 'C:/work' }, expect.any(AbortSignal))
    await expect(sessions.handle('session.create', { sessionId, ownerAgentId: 'unsafe' })).rejects.toMatchObject({ code: 'bad_request' })
    allowed = false
    await expect(sessions.handle('session.list', {})).rejects.toMatchObject({ code: 'forbidden' })
    expect(c.list).not.toHaveBeenCalled()
  })

  test('不同 streamId 的 follow 并存，unfollow 只中止指定流', async () => {
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
    expect(firstSignal.aborted).toBe(false)
    await sessions.handle('session.unfollow', { streamId })
    expect(firstSignal.aborted).toBe(true)
    expect((c.follow.mock.calls[1]?.[1] as AbortSignal).aborted).toBe(false)
    await sessions.handle('session.unfollow', { streamId: nextStreamId })
    expect((c.follow.mock.calls[1]?.[1] as AbortSignal).aborted).toBe(true)
  })

  test('follow 显式把 Assistant 实时流请求转发给 SessionController', async () => {
    const c = controller()
    const sessions = new BrowserSessions(c as unknown as Controller, { permit: () => true, send: () => {} })

    await sessions.handle('session.follow', {
      streamId,
      request: { address: { kind: 'session', sessionId }, maxMessages: 10, assistantStream: true },
    })

    await vi.waitFor(() => {
      expect(c.follow).toHaveBeenCalledWith({
        address: { kind: 'session', sessionId }, maxMessages: 10, assistantStream: true,
      }, expect.any(AbortSignal))
    })
    await sessions.dispose()
  })

  test('并行 follow 数量受连接级上限约束', async () => {
    const c = controller()
    const sessions = new BrowserSessions(c as unknown as Controller, {
      permit: () => true, send: () => {}, maxFollows: 1,
    })
    await sessions.handle('session.follow', { streamId, request: { address: { kind: 'session', sessionId } } })

    await expect(sessions.handle('session.follow', {
      streamId: nextStreamId, request: { address: { kind: 'session', sessionId } },
    })).rejects.toMatchObject({ code: 'too_many_follows' })

    await sessions.dispose()
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

  test('拒绝任意 JSON prompt part，并安全建立并发 follow', async () => {
    const c = controller(); const sessions = new BrowserSessions(c as unknown as Controller, { permit: () => true, send: () => {} })
    await expect(sessions.handle('session.prompt', { requestId: 'r', sessionId, mode: 'queue', content: [{ arbitrary: true }] })).rejects.toMatchObject({ code: 'bad_request' })
    await expect(sessions.handle('session.prompt', { requestId: 'r', sessionId, mode: 'queue', content: Array.from({ length: 9 }, () => ({ type: 'text', text: 'x' })) })).rejects.toMatchObject({ code: 'bad_request' })
    await Promise.all([
      sessions.handle('session.follow', { streamId, request: { address: { kind: 'session', sessionId } } }),
      sessions.handle('session.follow', { streamId: nextStreamId, request: { address: { kind: 'session', sessionId } } }),
    ])
    expect(c.follow).toHaveBeenCalledTimes(2)
    expect((c.follow.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(false)
    expect((c.follow.mock.calls[1]?.[1] as AbortSignal).aborted).toBe(false)
    await sessions.dispose()
    expect((c.follow.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(true)
    expect((c.follow.mock.calls[1]?.[1] as AbortSignal).aborted).toBe(true)
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
