import { afterEach, describe, expect, test, vi } from 'vitest'
import { createAssistantChannel } from '../src/assistant-channel.js'

type BrowserFrame = {
  type: string
  protocolVersion?: number
  installationId?: string
  requestId?: string
  token?: string
  receipt?: Record<string, unknown>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const parseFrame = (value: string): BrowserFrame => {
  const parsed: unknown = JSON.parse(value)
  if (!isRecord(parsed) || typeof parsed.type !== 'string') throw new Error('invalid browser frame')
  return {
    type: parsed.type,
    ...(typeof parsed.protocolVersion === 'number' ? { protocolVersion: parsed.protocolVersion } : {}),
    ...(typeof parsed.installationId === 'string' ? { installationId: parsed.installationId } : {}),
    ...(typeof parsed.requestId === 'string' ? { requestId: parsed.requestId } : {}),
    ...(typeof parsed.token === 'string' ? { token: parsed.token } : {}),
    ...(isRecord(parsed.receipt) ? { receipt: parsed.receipt } : {}),
  }
}

const credentials = {
  baseUrl: 'https://dsh.example.test/', installationId: 'installation-1', token: 'secret-token',
  grant: { installationId: 'installation-1', extensionId: 'extension-1', grantEpoch: 7, scopes: ['browser:read'], origins: ['https://example.test'], createdAt: '2026-09-08T00:00:00.000Z' },
}

class FakeSocket {
  static instances: FakeSocket[] = []
  static OPEN = 1
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) { FakeSocket.instances.push(this) }
  open() { this.readyState = FakeSocket.OPEN; this.onopen?.() }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent) }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code } as CloseEvent) }
  send(value: string) { this.sent.push(value) }
}

const ready = (socket: FakeSocket, grant = credentials.grant): void => {
  socket.message({ type: 'ready', protocolVersion: 1, grant, heartbeatIntervalMs: 10_000 })
}
const sent = (socket: FakeSocket): BrowserFrame[] => socket.sent.map(parseFrame)
const request = (requestId: string, grantEpoch = 7) => ({
  protocolVersion: 1, installationId: 'installation-1', grantEpoch, requestId, sessionId: 'session-1',
  deadline: 1_789_000_000_000, fingerprint: 'f'.repeat(64), mutates: true,
  payload: { action: 'click', elementId: 'element-1' }, target: { tabId: 1, frameId: 0, documentId: 'document-1' },
})
const receipt = (requestId: string, grantEpoch = 7) => ({
  protocolVersion: 1, installationId: 'installation-1', grantEpoch, requestId, sessionId: 'session-1',
  deadline: 1_789_000_000_000, fingerprint: 'f'.repeat(64), outcome: 'observed' as const,
})

afterEach(() => {
  FakeSocket.instances = []
  vi.useRealTimers()
})

describe('浏览器助手 WebSocket 通道', () => {
  test('新写授权只恢复旧代次的最小状态，不重放旧动作或发送旧页面内容', async () => {
    const writable = { ...credentials, grant: { ...credentials.grant, scopes: ['browser:read', 'browser:write'] } }
    const onCommand = vi.fn<(frame: { type: string }) => void>()
    const channel = createAssistantChannel({ credentials: writable, WebSocketImpl: FakeSocket, onCommand })
    channel.start(); const socket = FakeSocket.instances.at(-1)!; socket.open(); ready(socket, writable.grant)
    socket.message({ type: 'execute', request: request('old', 6) })
    socket.message({ type: 'status', request: request('old', 6) })
    socket.message({ type: 'cancel', request: request('future', 8) })
    await Promise.resolve()
    expect(onCommand).toHaveBeenCalledTimes(1)
    expect(onCommand.mock.calls[0]?.[0].type).toBe('status')
    expect(channel.sendReceipt({ ...receipt('old', 6), value: { privatePage: 'secret' }, reason: 'private-url', quiescent: true })).toBe(true)
    expect(sent(socket).at(-1).receipt).toMatchObject({ grantEpoch: 6, outcome: 'observed', quiescent: true })
    expect(sent(socket).at(-1).receipt).not.toHaveProperty('reason')
    expect(JSON.stringify(sent(socket).at(-1))).not.toContain('secret')
    expect(JSON.stringify(sent(socket).at(-1))).not.toContain('private-url')
    channel.stop()
  })
  test('只转发当前已认证连接的会话事件', async () => {
    const onEvent = vi.fn()
    const channel = createAssistantChannel({ credentials, WebSocketImpl: FakeSocket, onEvent })
    channel.start(); const socket = FakeSocket.instances.at(-1)!; socket.open()
    const event = { type: 'event', streamId: 'stream-1', event: { type: 'snapshot', cursor: -1 } }
    socket.message(event); expect(onEvent).not.toHaveBeenCalled()
    ready(socket); socket.message(event); await Promise.resolve()
    expect(onEvent).toHaveBeenCalledWith(event)
    channel.stop(); socket.message(event)
    expect(onEvent).toHaveBeenCalledTimes(1)
  })
  test('只在 hello 发送 token，ready 后派发匹配 epoch 的真实执行帧并发送回执', async () => {
    const onCommand = vi.fn()
    const channel = createAssistantChannel({ credentials, WebSocketImpl: FakeSocket, onCommand })
    channel.start()
    const socket = FakeSocket.instances[0]
    expect(socket.url).toBe('wss://dsh.example.test/api/browser-extension/v1/ws')
    socket.open()
    expect(sent(socket)).toEqual([{ type: 'hello', protocolVersion: 1, installationId: 'installation-1', token: 'secret-token' }])
    ready(socket)
    const invocation = request('job-1')
    socket.message({ type: 'execute', request: invocation })
    await Promise.resolve()
    expect(onCommand).toHaveBeenCalledWith({ type: 'execute', request: invocation })
    const result = receipt('job-1')
    expect(channel.sendReceipt(result)).toBe(true)
    expect(sent(socket).at(-1)).toEqual({ type: 'result', receipt: result })
  })

  test('RPC 成功和远端失败结算当前 call，发送后的取消与超时均为结果未知', async () => {
    vi.useFakeTimers()
    const channel = createAssistantChannel({ credentials, WebSocketImpl: FakeSocket, requestTimeoutMs: 50 })
    channel.start(); const socket = FakeSocket.instances.at(-1)!; socket.open(); ready(socket)
    const resolved = channel.call('instances', { active: true })
    const request = sent(socket).at(-1)
    socket.message({ type: 'response', requestId: request.requestId, result: { ok: true, value: ['a'] } })
    await expect(resolved).resolves.toEqual(['a'])
    const remoteFailure = channel.call('future-method', {})
    socket.message({ type: 'response', requestId: sent(socket).at(-1).requestId, result: { ok: false, error: { code: 'bad' } } })
    await expect(remoteFailure).rejects.toEqual({ code: 'bad' })
    const preAborted = new AbortController(); preAborted.abort()
    await expect(channel.call('instances', {}, { signal: preAborted.signal })).rejects.toMatchObject({ code: 'cancelled' })
    const controller = new AbortController(); const cancelled = channel.call('instances', {}, { signal: controller.signal }); controller.abort()
    await expect(cancelled).rejects.toMatchObject({ code: 'result_unknown', reason: 'cancelled' })
    const timedOut = channel.call('instances', {})
    const timeoutExpectation = expect(timedOut).rejects.toMatchObject({ code: 'result_unknown', reason: 'request_timeout' })
    await vi.advanceTimersByTimeAsync(51)
    await timeoutExpectation
    vi.useRealTimers()
  })

  test('断线后不重放调用，旧 socket 不能覆盖新连接，4401 停止重连', async () => {
    vi.useFakeTimers()
    const states: unknown[] = []
    const channel = createAssistantChannel({
      credentials, WebSocketImpl: FakeSocket, reconnectDelayMs: 20, onState: state => states.push(state),
    })
    channel.start(); const first = FakeSocket.instances.at(-1)!; first.open(); ready(first)
    const pending = channel.call('instances', {})
    first.close(1006)
    await expect(pending).rejects.toMatchObject({ code: 'result_unknown', reason: 'connection_lost' })
    await vi.advanceTimersByTimeAsync(21)
    const second = FakeSocket.instances.at(-1)!; second.open(); ready(second)
    first.message({ type: 'ready', protocolVersion: 1, grant: credentials.grant, heartbeatIntervalMs: 1 })
    expect(states.at(-1)).toEqual({ phase: 'connected', grant: credentials.grant })
    second.close(4401)
    await vi.advanceTimersByTimeAsync(100)
    expect(FakeSocket.instances).toHaveLength(2)
    expect(states.at(-1)).toEqual({ phase: 'unauthorized' })
    vi.useRealTimers()
  })

  test('拒绝错误 ready、超大消息和不匹配 epoch，且隔离 callback 异常', async () => {
    const onCommand = vi.fn(() => Promise.reject(new Error('handler failure')))
    const channel = createAssistantChannel({ credentials, WebSocketImpl: FakeSocket, onCommand })
    channel.start(); const socket = FakeSocket.instances.at(-1)!; socket.open()
    socket.message({ type: 'ready', protocolVersion: 2, grant: credentials.grant })
    expect(channel.sendReceipt({ grantEpoch: 7 })).toBe(false)
    const commandChannel = createAssistantChannel({ credentials, WebSocketImpl: FakeSocket, onCommand })
    commandChannel.start(); const commandSocket = FakeSocket.instances.at(-1)!; commandSocket.open(); ready(commandSocket)
    commandSocket.message({ type: 'execute', request: request('handled') })
    await Promise.resolve(); await Promise.resolve()
    expect(onCommand).toHaveBeenCalledTimes(1)
    commandSocket.message({ type: 'status', request: request('ignored', 8) })
    commandSocket.onmessage?.({ data: 'x'.repeat(16 * 1024 * 1024 + 1) } as MessageEvent)
    await Promise.resolve()
    expect(onCommand).toHaveBeenCalledTimes(1)
    expect(commandSocket.readyState).toBe(3)
  })

  test('限制未结算 RPC，并且 stop 清理定时器和 abort listener且不会再重连', async () => {
    vi.useFakeTimers()
    const states: unknown[] = []
    const channel = createAssistantChannel({ credentials, WebSocketImpl: FakeSocket, maxPending: 1, onState: state => states.push(state) })
    channel.start(); const socket = FakeSocket.instances[0]; socket.open(); ready(socket)
    const controller = new AbortController()
    const pending = channel.call('instances', {}, { signal: controller.signal })
    await expect(channel.call('instances', {})).rejects.toMatchObject({ code: 'max_pending' })
    const stopped = expect(pending).rejects.toMatchObject({ code: 'result_unknown', reason: 'connection_lost' })
    channel.stop()
    await stopped
    expect(vi.getTimerCount()).toBe(0)
    controller.abort()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(FakeSocket.instances).toHaveLength(1)
    expect(states.at(-1)).toEqual({ phase: 'stopped' })
  })

  test('不发送未打开、超大或外部突变后的 RPC 与回执，异步观察者失败不会泄漏', async () => {
    const stateFailure = vi.fn(() => Promise.reject(new Error('state failure')))
    const mutableCredentials = structuredClone(credentials)
    const channel = createAssistantChannel({ credentials: mutableCredentials, WebSocketImpl: FakeSocket, onState: stateFailure })
    mutableCredentials.token = 'replaced-token'; mutableCredentials.baseUrl = 'https://changed.example.test'
    channel.start(); const socket = FakeSocket.instances[0]
    await Promise.resolve()
    expect(socket.url).toBe('wss://dsh.example.test/api/browser-extension/v1/ws')
    await expect(channel.call('instances', {})).rejects.toMatchObject({ code: 'offline' })
    socket.open(); ready(socket); await Promise.resolve()
    expect(sent(socket)[0].token).toBe('secret-token')
    expect(channel.sendReceipt({ ...receipt('too-large'), value: 'x'.repeat(16 * 1024 * 1024) })).toBe(false)
    await expect(channel.call('instances', { value: 'x'.repeat(16 * 1024 * 1024) })).rejects.toMatchObject({ code: 'request_too_large' })
  })
})
