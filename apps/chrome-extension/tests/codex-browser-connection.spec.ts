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
