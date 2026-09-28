import { describe, expect, test, vi } from 'vitest'
import { createCodexBrowserConnection } from '../src/codex-browser-connection.js'

const extensionId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const installationId = '123e4567-e89b-42d3-a456-426614174000'
const token = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const grant = { installationId, extensionId, grantEpoch: 1, origins: ['*'],
  scopes: ['browser:read', 'browser:write'], createdAt: '2026-09-26T00:00:00.000Z' }

const response = body => ({ status: 200, ok: true, json: async () => body })
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const harness = () => {
  const values = new Map()
  const storage = {
    get: vi.fn(async key => ({ [key]: structuredClone(values.get(key)) })),
    set: vi.fn(async (patch) => { for (const [key, value] of Object.entries(patch)) values.set(key, structuredClone(value)) }),
  }
  const channels = []
  const createChannel = vi.fn((options) => {
    const channel = { start: vi.fn(), stop: vi.fn(), call: vi.fn(), sendReceipt: vi.fn() }
    channels.push({ channel, options })
    return channel
  })
  const fetchImpl = vi.fn(async () => response({ token, grant }))
  const onCommand = vi.fn()
  const connection = createCodexBrowserConnection({ storage, extensionId, fetchImpl, createChannel,
    createInstallationId: () => installationId, onCommand })
  return { values, storage, channels, createChannel, fetchImpl, onCommand, connection }
}

describe('Codex 浏览器直连', () => {
  test('并发首次连接共享配对，凭据失效续授权后只复用一个通道', async () => {
    const h = harness()
    await Promise.all(Array.from({ length: 8 }, () => h.connection.connect()))
    expect(h.fetchImpl).toHaveBeenCalledTimes(1)
    expect(h.channels).toHaveLength(1)
    h.channels[0].options.onState({ phase: 'credentials-expired' })
    h.channels[0].options.onState({ phase: 'offline', retryPending: true, pauseOnRestart: true })
    const renewed = await Promise.all(Array.from({ length: 8 }, () => h.channels[0].options.renewCredentials()))
    expect(h.fetchImpl).toHaveBeenCalledTimes(2)
    expect(renewed[0]).toMatchObject({ installationId, token, grant })
    expect(h.values.get('dsh.codex.browser.connection.v1')).not.toHaveProperty('reauthorize')
    h.channels[0].options.onState({ phase: 'connected', grant })
    expect((await h.connection.read()).phase).toBe('connected')
    expect(h.channels).toHaveLength(1)
  })

  test('失效后的 worker 唤醒保留重新配对意图，撤销后所有入口保持停止', async () => {
    const h = harness()
    h.values.set('dsh.codex.browser.connection.v1', { baseUrl: 'http://127.0.0.1:3091', installationId, reauthorize: true, retryPaused: true })
    expect((await h.connection.restore()).phase).toBe('offline')
    await Promise.all(Array.from({ length: 8 }, () => h.connection.retrySaved({ once: true })))
    expect(h.channels).toHaveLength(1)
    await h.channels[0].options.renewCredentials()
    expect(h.fetchImpl).toHaveBeenCalledTimes(1)
    h.channels[0].options.onState({ phase: 'unauthorized' })
    await vi.waitFor(() => expect(h.values.get('dsh.codex.browser.connection.v1')).toMatchObject({ blocked: true }))
    await h.connection.connect()
    await h.connection.retrySaved()
    const restored = createCodexBrowserConnection({ storage: h.storage, extensionId,
      fetchImpl: h.fetchImpl, createChannel: h.createChannel })
    expect((await restored.restore()).phase).toBe('unauthorized')
    await restored.connect()
    expect(h.fetchImpl).toHaveBeenCalledTimes(1)
    expect(h.channels).toHaveLength(1)
  })

  test('主动断开使飞行中续授权失效，唤醒不能重新连接', async () => {
    const h = harness()
    await h.connection.connect()
    h.channels[0].options.onState({ phase: 'credentials-expired' })
    const pending = deferred()
    h.fetchImpl.mockImplementationOnce(() => pending.promise)
    const renewal = h.channels[0].options.renewCredentials()
    const rejected = expect(renewal).rejects.toThrow('connection_cancelled')
    await vi.waitFor(() => expect(h.fetchImpl).toHaveBeenCalledTimes(2))
    await h.connection.disconnect()
    pending.resolve(response({ token, grant }))
    await rejected
    expect(await h.connection.retrySaved()).toBe(false)
    expect(h.values.get('dsh.codex.browser.connection.v1')).toEqual({ baseUrl: 'http://127.0.0.1:3091', installationId })
  })

  test('断线的暂停跨 worker 保留，事件恢复沿用 token 且不重新配对', async () => {
    const h = harness()
    await h.connection.connect()
    h.channels[0].options.onState({ phase: 'offline', retryPaused: false, retryPending: true, pauseOnRestart: true })
    await vi.waitFor(() => { expect(h.values.get('dsh.codex.browser.connection.v1')).toMatchObject({ retryPaused: true }) })
    expect(await h.connection.read()).toMatchObject({ retryPending: true, retryPaused: false })
    const restored = createCodexBrowserConnection({ storage: h.storage, extensionId, fetchImpl: h.fetchImpl,
      createChannel: h.createChannel, createInstallationId: () => installationId })
    expect(await restored.restore()).toMatchObject({ phase: 'offline', retryPaused: true })
    expect(h.channels).toHaveLength(1)
    await restored.retrySaved({ once: true })
    expect(h.values.get('dsh.codex.browser.connection.v1')).toMatchObject({ retryPaused: true })
    expect(h.channels).toHaveLength(2)
    expect(h.channels[1].channel.start).toHaveBeenCalledExactlyOnceWith({ once: true })
    expect(h.channels[1].options.credentials).toMatchObject({ installationId, token, grant })
    expect(h.fetchImpl).toHaveBeenCalledTimes(1)
  })

  test('首次连接只向本地桥申请一次凭据，并持久化独立安装身份', async () => {
    const h = harness()

    await expect(h.connection.connect()).resolves.toMatchObject({ phase: 'connecting', baseUrl: 'http://127.0.0.1:3091' })
    expect(h.fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:3091/browser-connector/connect', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ extensionId, installationId }), credentials: 'omit',
    }))
    expect(h.values.get('dsh.codex.browser.connection.v1')).toMatchObject({ installationId, token, grant })
    expect(h.createChannel).toHaveBeenCalledWith(expect.objectContaining({ credentials: { baseUrl: 'http://127.0.0.1:3091', installationId, token, grant } }))
    expect(h.channels[0].channel.start).toHaveBeenCalledTimes(1)
  })

  test('拒绝非 loopback 的桥地址，且不发起请求', async () => {
    const h = harness()
    await expect(h.connection.configure('https://example.test')).rejects.toThrow('invalid_codex_bridge_url')
    expect(h.fetchImpl).not.toHaveBeenCalled()
  })

  test('DSH 不存在时仍能恢复 Codex 已保存的连接', async () => {
    const h = harness()
    h.values.set('dsh.codex.browser.connection.v1', { baseUrl: 'http://127.0.0.1:3091', installationId, token, grant })

    await expect(h.connection.restore()).resolves.toMatchObject({ phase: 'connecting', baseUrl: 'http://127.0.0.1:3091' })
    expect(h.fetchImpl).not.toHaveBeenCalled()
    expect(h.channels[0].channel.start).toHaveBeenCalledTimes(1)
  })

  test('断开后只保留安装身份，worker 重启后仍可再次连接', async () => {
    const h = harness()
    await h.connection.configure('http://127.0.0.1:3091')
    const restarted = createCodexBrowserConnection({ storage: h.storage, extensionId, fetchImpl: h.fetchImpl,
      createChannel: h.createChannel, createInstallationId: () => installationId })

    await expect(restarted.restore()).resolves.toMatchObject({ phase: 'configured', installationId })
    expect(h.channels).toHaveLength(0)
  })

  test('配置变更会废弃飞行中的旧桥连接结果', async () => {
    const h = harness()
    const pending = deferred()
    h.fetchImpl.mockImplementationOnce(() => pending.promise)
    const connecting = h.connection.connect()
    await vi.waitFor(() => { expect(h.fetchImpl).toHaveBeenCalledTimes(1) })
    await h.connection.configure('http://localhost:3091')
    pending.resolve(response({ token, grant }))

    await expect(connecting).resolves.toMatchObject({ phase: 'configured', baseUrl: 'http://localhost:3091' })
    await expect(h.connection.read()).resolves.toMatchObject({ phase: 'configured', baseUrl: 'http://localhost:3091' })
    expect(h.channels).toHaveLength(0)
  })

  test('断开会废弃飞行中的旧桥连接结果', async () => {
    const h = harness()
    const pending = deferred()
    h.fetchImpl.mockImplementationOnce(() => pending.promise)
    const connecting = h.connection.connect()
    await vi.waitFor(() => { expect(h.fetchImpl).toHaveBeenCalledTimes(1) })
    await h.connection.disconnect()
    pending.resolve(response({ token, grant }))

    await expect(connecting).resolves.toMatchObject({ phase: 'configured' })
    expect(h.values.get('dsh.codex.browser.connection.v1')).not.toHaveProperty('token')
    expect(h.channels).toHaveLength(0)
  })

  test('旧 WebSocket 回调不能改变新连接或投递命令', async () => {
    const h = harness()
    await h.connection.connect()
    const old = h.channels[0]
    await h.connection.configure('http://localhost:3091')
    await h.connection.connect()

    old.options.onState({ phase: 'offline' })
    old.options.onCommand({ type: 'execute' })
    await expect(h.connection.read()).resolves.toMatchObject({ phase: 'connecting', baseUrl: 'http://localhost:3091' })
    expect(h.onCommand).not.toHaveBeenCalled()
  })
})
