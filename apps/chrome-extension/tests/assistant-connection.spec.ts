import { describe, expect, test, vi } from 'vitest'
import { createAssistantConnection } from '../src/assistant-connection.js'

const installationId = '123e4567-e89b-42d3-a456-426614174000'
const requestId = '223e4567-e89b-42d3-a456-426614174000'
const extensionId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const verifier = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const pending = { baseUrl: 'https://dsh.example.test', installationId, extensionId, verifier, requestId, scopes: ['session:interact', 'browser:read'], origins: ['https://example.test'], expiresAt: '2099-09-08T00:00:00.000Z', status: 'pending' }
const grant = { installationId, extensionId, grantEpoch: 1, scopes: ['session:interact'], origins: ['https://example.test'], createdAt: '2026-09-08T00:00:00.000Z' }

const harness = (initial: Record<string, unknown> = {}) => {
  const values = new Map(Object.entries(structuredClone(initial)))
  const storage = {
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(values.get(key)) })),
    set: vi.fn(async (patch: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(patch)) values.set(key, structuredClone(value))
    }),
  }
  const transport = { begin: vi.fn(async () => pending), exchange: vi.fn(async () => ({ phase: 'connected', token: verifier, grant })) }
  const channels: Array<{
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    call: ReturnType<typeof vi.fn>
    sendReceipt: ReturnType<typeof vi.fn>
    onState: (state: { phase: string }) => void
  }> = []
  const createChannel = vi.fn((options: { onState: (state: { phase: string }) => void }) => {
    const channel = { start: vi.fn(), stop: vi.fn(), call: vi.fn(), sendReceipt: vi.fn(), onState: options.onState }
    channels.push(channel)
    return channel
  })
  const hasPermission = vi.fn(async () => true)
  const hasOrigins = vi.fn(async () => true)
  const openApprovalPage = vi.fn(async () => {})
  const connection = createAssistantConnection({ storage, transport, createChannel, hasPermission, hasOrigins, extensionId,
    createInstallationId: () => installationId, openApprovalPage })
  return { values, storage, transport, channels, createChannel, hasPermission, hasOrigins, openApprovalPage, connection }
}

describe('浏览器助手持久连接', () => {
  test('取消会中止旧配对并拒绝迟到结果写回新的 generation', async () => {
    const h = harness()
    let resolveBegin!: (value: typeof pending) => void
    h.transport.begin.mockImplementationOnce(() => new Promise((resolve) => { resolveBegin = resolve }))
    await h.connection.configure('https://dsh.example.test')
    const running = h.connection.connect({ scopes: pending.scopes, origins: pending.origins })
    await vi.waitFor(() =>{  expect(h.transport.begin).toHaveBeenCalledTimes(1) })
    await h.connection.cancel()
    resolveBegin(pending)
    await expect(running).rejects.toMatchObject({ code: 'cancelled' })
    expect(await h.connection.read()).toMatchObject({ phase: 'configured' })
    expect(JSON.stringify([...h.values.values()])).not.toContain(requestId)
  })

  test('凭证未持久化时绝不启动通道', async () => {
    const h = harness()
    await h.connection.configure('https://dsh.example.test')
    await h.connection.connect({ scopes: pending.scopes, origins: pending.origins })
    h.storage.set.mockImplementationOnce(async () => { throw new Error('storage_failed') })
    await expect(h.connection.poll()).rejects.toThrow('storage_failed')
    expect(h.createChannel).not.toHaveBeenCalled()
  })

  test('重启后用持久 pending 单次 exchange，持久凭证成功后才启动通道', async () => {
    const h = harness({ 'dsh.assistant.connection.v1': { baseUrl: pending.baseUrl, installationId, pending } })
    await expect(h.connection.poll()).resolves.toMatchObject({ phase: 'connecting' })
    expect(h.transport.exchange).toHaveBeenCalledWith(pending, expect.any(Object))
    expect(h.channels).toHaveLength(1)
    expect(h.channels[0].start).toHaveBeenCalledTimes(1)
    h.channels[0].onState({ phase: 'connected', grant })
    await vi.waitFor(async () =>{  expect(await h.connection.read()).toMatchObject({ phase: 'connected', grant }) })
  })

  test('检查 DSH 与页面 origin 权限，允许纯会话空 origins 和显式通配', async () => {
    const h = harness()
    await h.connection.configure('https://dsh.example.test')
    await h.connection.connect({ scopes: ['session:interact'], origins: [] })
    expect(h.hasOrigins).not.toHaveBeenCalled()
    await h.connection.disconnect()
    await h.connection.connect({ scopes: ['session:interact'], origins: ['*'] })
    expect(h.hasOrigins).toHaveBeenLastCalledWith(['*'])
  })

  test('通道 4401 清除凭证但保留安装身份和目标，审批页可从 pending 重新打开', async () => {
    const approval = harness({ 'dsh.assistant.connection.v1': { baseUrl: pending.baseUrl, installationId, pending } })
    await approval.connection.openApproval()
    expect(approval.openApprovalPage).toHaveBeenCalledWith(`https://dsh.example.test/browser-assistant?requestId=${requestId}`)

    const h = harness({ 'dsh.assistant.connection.v1': { baseUrl: pending.baseUrl, installationId, token: verifier, grant } })
    await h.connection.read()
    expect(h.channels).toHaveLength(1)
    h.channels[0].onState({ phase: 'unauthorized' })
    await vi.waitFor(async () =>{  expect(await h.connection.read()).toMatchObject({ phase: 'unauthorized' }) })
    const stored = h.values.get('dsh.assistant.connection.v1') as Record<string, unknown>
    expect(stored).toMatchObject({ baseUrl: pending.baseUrl, installationId })
    expect(stored.token).toBeUndefined()
  })

  test('并发首次 read 只铸造一个安装身份，坏的持久状态 fail-closed 且不访问 transport', async () => {
    let identities = 0
    const h = harness()
    const connection = createAssistantConnection({ storage: h.storage, transport: h.transport, createChannel: h.createChannel,
      hasPermission: h.hasPermission, hasOrigins: h.hasOrigins, extensionId,
      createInstallationId: () => { identities += 1; return installationId } })
    await Promise.all([connection.read(), connection.read()])
    expect(identities).toBe(1)

    const broken = harness({ 'dsh.assistant.connection.v1': { baseUrl: 'https://dsh.example.test', installationId: 'not-a-uuid', token: verifier, grant } })
    await expect(broken.connection.read()).resolves.toMatchObject({ phase: 'invalid' })
    expect(broken.transport.begin).not.toHaveBeenCalled()
    expect(broken.transport.exchange).not.toHaveBeenCalled()
    expect(broken.createChannel).not.toHaveBeenCalled()
  })

  test('只有 current ready grant 可 permit；重配后旧通道回调不能恢复权限', async () => {
    const changes: unknown[] = []
    const h = harness({ 'dsh.assistant.connection.v1': { baseUrl: pending.baseUrl, installationId, token: verifier, grant } })
    const connection = createAssistantConnection({ storage: h.storage, transport: h.transport, createChannel: h.createChannel,
      hasPermission: h.hasPermission, hasOrigins: h.hasOrigins, extensionId,
      createInstallationId: () => installationId, changed: view => changes.push(view) })
    await connection.read()
    const old = h.channels[0]
    expect(connection.permit({ installationId, grantEpoch: 1, scopes: ['session:interact'] })).toBe(false)
    old.onState({ phase: 'connected', grant })
    await vi.waitFor(() =>{  expect(connection.permit({ installationId, grantEpoch: 1, scopes: ['session:interact'] })).toBe(true) })
    expect(connection.getGrant()).toEqual(grant)
    await connection.configure('https://other.example')
    old.onState({ phase: 'connected', grant })
    old.onState({ phase: 'unauthorized' })
    await Promise.resolve()
    expect(connection.permit({ installationId, grantEpoch: 1, scopes: ['session:interact'] })).toBe(false)
    expect((await connection.read())).toMatchObject({ baseUrl: 'https://other.example', phase: 'configured' })
    expect(changes.length).toBeGreaterThan(0)
  })

  test('重启恢复先验证 DSH 与已授权站点权限，权限缺失时不启动旧凭证通道', async () => {
    const h = harness({ 'dsh.assistant.connection.v1': { baseUrl: pending.baseUrl, installationId, token: verifier, grant } })
    h.hasPermission.mockResolvedValue(false)
    await expect(h.connection.read()).resolves.toMatchObject({ phase: 'offline' })
    expect(h.createChannel).not.toHaveBeenCalled()
    expect(h.hasOrigins).not.toHaveBeenCalled()
  })

  test('通道撤销的持久化失败会本地禁用，之后 read 不会重新启动旧 token', async () => {
    const h = harness({ 'dsh.assistant.connection.v1': { baseUrl: pending.baseUrl, installationId, token: verifier, grant } })
    await h.connection.read()
    h.storage.set.mockImplementationOnce(async () => { throw new Error('storage_failed') })
    h.channels[0].onState({ phase: 'unauthorized' })
    await vi.waitFor(async () =>{  expect(await h.connection.read()).toMatchObject({ phase: 'invalid' }) })
    expect(h.channels).toHaveLength(1)
  })

  test('disconnect 未等待持久化时同步撤销 permit，configure 等待权限时旧 ready 不能复活', async () => {
    const h = harness({ 'dsh.assistant.connection.v1': { baseUrl: pending.baseUrl, installationId, token: verifier, grant } })
    await h.connection.read()
    const old = h.channels[0]
    old.onState({ phase: 'connected', grant })
    await vi.waitFor(() =>{  expect(h.connection.permit({ installationId, grantEpoch: 1, scopes: ['session:interact'] })).toBe(true) })
    const disconnecting = h.connection.disconnect()
    expect(h.connection.permit({ installationId, grantEpoch: 1, scopes: ['session:interact'] })).toBe(false)
    await disconnecting

    const second = harness({ 'dsh.assistant.connection.v1': { baseUrl: pending.baseUrl, installationId, token: verifier, grant } })
    await second.connection.read()
    const stale = second.channels[0]
    let allow!: () => void
    second.hasPermission.mockImplementationOnce(() => new Promise<void>((resolve) => { allow = resolve }).then(() => true))
    const configuring = second.connection.configure('https://other.example')
    stale.onState({ phase: 'connected', grant })
    expect(second.connection.getGrant()).toBeNull()
    allow()
    await configuring
    expect((await second.connection.read())).toMatchObject({ baseUrl: 'https://other.example', phase: 'configured' })
  })
})
