import { describe, expect, test, vi } from 'vitest'
import { createExtensionController, DEFAULT_BASE_URL } from '../src/controller.js'

interface Capture { captureId: string; title: string; markdown: string; source: ReturnType<typeof payload>['source']; baseUrl: string; attempted: boolean; status: string }
interface Controller {
  read: () => Promise<{ connection: { baseUrl: string; phase: string }; capture: Capture | null }>
  connect: () => Promise<unknown>
  receive: (input: ReturnType<typeof payload>, tabId: number) => Promise<Capture>
  save: (id: string, allowConnect?: boolean) => Promise<Capture>
  title: (id: string, value: string) => Promise<void>
  discard: (id: string) => Promise<void>
  check: () => Promise<unknown>
  configure: (url: string) => Promise<unknown>
  receipt: (id: string) => Promise<{ entryId: string; baseUrl: string; sourceTabId: number }>
}

function harness(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(structuredClone(initial)))
  const storage = {
    get: async (key: string) => ({ [key]: structuredClone(values.get(key)) }),
    set: async (patch: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(patch)) values.set(key, structuredClone(value))
    },
    remove: async (key: string) => { values.delete(key) },
  }
  const transport = {
    info: vi.fn(async () => ({})),
    begin: vi.fn(async () => ({ phase: 'connected', token: 'test-installation-capability' })),
    poll: vi.fn(async () => ({ phase: 'connected', token: 'test-installation-capability' })),
    import: vi.fn(async ({ request }: { request: { captureId: string } }) => ({ entryId: `web:${request.captureId}` })),
  }
  const hasPermission = vi.fn(async () => true)
  const controller = createExtensionController({ storage, transport, hasPermission }) as unknown as Controller
  return { values, storage, transport, hasPermission, controller }
}
const payload = (text = '选中的正文') => ({
  title: '收藏标题', markdown: text,
  source: { url: 'https://chatgpt.com/c/example', pageTitle: '对话标题', site: 'chatgpt.com', kind: 'selection', capturedAt: new Date().toISOString() },
})
const connected = { 'dsh.connection.v1': { baseUrl: DEFAULT_BASE_URL, installationId: 'installation', token: 'private-capability' } }

describe('收藏状态与恢复', () => {
  test('首次读取直接提供 3080，公开状态不含安装凭据', async () => {
    const h = harness()
    expect((await h.controller.read()).connection).toEqual({ baseUrl: DEFAULT_BASE_URL, phase: 'configured' })
    await h.controller.connect()
    expect(JSON.stringify(await h.controller.read())).not.toContain('test-installation-capability')
    expect(h.transport.begin).toHaveBeenCalledTimes(1)
  })
  test('未连接时先保存草稿，批准后完成原采集', async () => {
    const h = harness()
    const capture = await h.controller.receive(payload(), 7)
    expect((await h.controller.read()).capture?.attempted).toBe(false)
    await h.controller.save(capture.captureId, true)
    expect(h.transport.begin).toHaveBeenCalledTimes(1)
    expect(h.transport.import.mock.calls[0]?.[0].request.captureId).toBe(capture.captureId)
    expect((await h.controller.read()).capture?.status).toBe('saved')
  })
  test('网络结果未知时禁止改标题和丢弃，重启后原请求可重试', async () => {
    const h = harness(connected)
    h.transport.import.mockRejectedValueOnce(Object.assign(new Error('network_error'), { code: 'network_error' }))
    const capture = await h.controller.receive(payload(), 7)
    await expect(h.controller.save(capture.captureId)).rejects.toThrow('network_error')
    await expect(h.controller.title(capture.captureId, '变更标题')).rejects.toThrow('capture_frozen')
    await expect(h.controller.discard(capture.captureId)).rejects.toThrow('pending_unconfirmed')
    const recovered = createExtensionController(h) as unknown as Controller
    expect((await recovered.read()).capture?.status).toBe('unknown')
    await recovered.save(capture.captureId)
    expect(h.transport.import.mock.calls[1]?.[0].request).toEqual(h.transport.import.mock.calls[0]?.[0].request)
  })
  test('探测服务恢复不会自动补传', async () => {
    const h = harness(connected)
    await h.controller.receive(payload(), 7)
    await h.controller.check()
    expect(h.transport.import).not.toHaveBeenCalled()
    expect((await h.controller.read()).capture?.status).toBe('draft')
  })
  test('切换目标后不能将旧草稿发往新服务', async () => {
    const h = harness(connected)
    const capture = await h.controller.receive(payload(), 7)
    await h.controller.configure('https://other.example')
    await expect(h.controller.save(capture.captureId, true)).rejects.toThrow('target_changed')
    expect(h.transport.import).not.toHaveBeenCalled()
    expect((await h.controller.read()).capture?.baseUrl).toBe(DEFAULT_BASE_URL)
  })
  test('替换草稿必须显式清除，并拒绝旧页面的修改消息', async () => {
    const h = harness()
    const first = await h.controller.receive(payload('第一份'), 7)
    await expect(h.controller.receive(payload('第二份'), 8)).rejects.toThrow('pending_exists')
    await h.controller.discard(first.captureId)
    const second = await h.controller.receive(payload('第二份'), 8)
    await expect(h.controller.title(first.captureId, '旧标题')).rejects.toThrow('capture_changed')
    expect((await h.controller.read()).capture?.captureId).toBe(second.captureId)
  })
  test('并发保存只有一个 HTTP 导入，后到点击不会释放先到的锁', async () => {
    const h = harness(connected)
    let finish!: (value: { entryId: string }) => void
    h.transport.import.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const capture = await h.controller.receive(payload(), 7)
    const running = h.controller.save(capture.captureId)
    await vi.waitFor(() => { expect(h.transport.import).toHaveBeenCalledTimes(1) })
    await expect(h.controller.save(capture.captureId)).rejects.toThrow('busy')
    await expect(h.controller.receive(payload('别的材料'), 8)).rejects.toThrow('busy')
    finish({ entryId: `web:${capture.captureId}` })
    await running
    expect((await h.controller.read()).capture?.status).toBe('saved')
  })
  test('worker 保存中退出后显示结果未知，不重新铸造请求', async () => {
    const h = harness(connected)
    const capture = await h.controller.receive(payload(), 7)
    await h.storage.set({ 'dsh.capture.v2': { ...capture, status: 'saving', attempted: true } })
    const recovered = createExtensionController(h) as unknown as Controller
    const state = await recovered.read()
    expect(state.capture).toMatchObject({ captureId: capture.captureId, status: 'unknown', attempted: true })
    expect(h.transport.import).not.toHaveBeenCalled()
  })
  test('权限撤销的导入失败会清除失效令牌，再次保存重新授权', async () => {
    const h = harness(connected)
    const capture = await h.controller.receive(payload(), 7)
    h.transport.import.mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { code: 'unauthorized', status: 401 }))
    await expect(h.controller.save(capture.captureId)).rejects.toThrow('unauthorized')
    expect((await h.controller.read()).connection.phase).toBe('unauthorized')
    await h.controller.save(capture.captureId, true)
    expect(h.transport.begin).toHaveBeenCalledTimes(1)
    expect(h.transport.import).toHaveBeenCalledTimes(2)
  })
  test('先前版本的待确认请求按原身份恢复', async () => {
    const old = { baseUrl: DEFAULT_BASE_URL, request: { ...payload(), captureId: '123e4567-e89b-42d3-a456-426614174000' } }
    const h = harness({ ...connected, 'dsh.pendingCapture.v1': old })
    const restored = (await h.controller.read()).capture
    expect(restored).toMatchObject({ ...old.request, baseUrl: old.baseUrl, attempted: true, status: 'unknown' })
    await h.controller.save(old.request.captureId)
    expect(h.values.get('dsh.pendingCapture.v1')).toBeUndefined()
  })
  test('第二次收藏之后仍能打开先前的持久回执', async () => {
    const h = harness(connected)
    const first = await h.controller.receive(payload('第一份正文'), 7)
    await h.controller.save(first.captureId)
    const second = await h.controller.receive(payload('第二份正文'), 8)
    await h.controller.save(second.captureId)
    expect(await h.controller.receipt(`web:${first.captureId}`)).toMatchObject({
      entryId: `web:${first.captureId}`, baseUrl: DEFAULT_BASE_URL, sourceTabId: 7,
    })
    await expect(h.controller.receipt('web:unknown')).rejects.toThrow('receipt_missing')
  })
  test('切换地址会阻止旧授权结果回写', async () => {
    const h = harness()
    let finish!: (value: { phase: string; token: string }) => void
    h.transport.begin.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const running = h.controller.connect()
    const rejected = expect(running).rejects.toThrow('cancelled')
    await vi.waitFor(() => { expect(h.transport.begin).toHaveBeenCalledTimes(1) })
    await h.controller.configure('https://other.example')
    finish({ phase: 'connected', token: 'old-service-token' })
    await rejected
    expect((await h.controller.read()).connection).toEqual({ baseUrl: 'https://other.example', phase: 'configured' })
  })
})
