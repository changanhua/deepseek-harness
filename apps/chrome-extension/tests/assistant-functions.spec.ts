import { describe, expect, test, vi } from 'vitest'
import { createAssistantFunctions } from '../src/assistant-functions.js'

const installationId = '123e4567-e89b-42d3-a456-426614174000'
const target = (overrides = {}) => ({ availability: 'ready', revision: 4, selected: {
  tabId: 9, frameId: 0, documentId: 'document-current', url: 'https://example.test/current',
}, ...overrides })
const pageScope = { kind: 'page', target: { tabId: 9, frameId: 0, documentId: 'document-current', url: 'https://example.test/current' }, targetRevision: 4 }
const functionRow = (overrides = {}) => ({
  pluginId: 'notes-1', name: '摘录整理', purpose: '把当前文章整理为可复用摘录', currentPackageId: 'pkg-2',
  activeRun: { pluginRunId: 'run-3', packageId: 'pkg-2' }, delivery: { scope: pageScope }, ...overrides,
})

const harness = (result = { functions: [functionRow()] }, storage?: unknown, options: Record<string, unknown> = {}) => {
  const call = vi.fn(async (method: string) => {
    if (method === 'function.list') return structuredClone(result)
    if (method === 'function.inspect') return { source: 'immutable inspection' }
    if (method === 'function.stop') return { stopped: true }
    if (method === 'function.run') return { accepted: true }
    if (method === 'function.edit') return { prepared: true }
    throw new Error(`Unexpected method ${method}`)
  })
  const changed = vi.fn()
  const connection = options.connection as { phase: string; baseUrl: string; grant: { installationId: string } } | undefined
    ?? { phase: 'connected', baseUrl: 'http://one.test', grant: { installationId } }
  const functions = createAssistantFunctions({ call, getConnection: () => connection, storage, changed, ...options })
  return { functions, call, changed, connection }
}

describe('浏览器助手已交付功能适配器', () => {
  test('只投影目录中的已交付功能，并按当前目标标明页面范围匹配', async () => {
    const h = harness({ functions: [functionRow(), { ...functionRow({ pluginId: 'draft-2' }), delivery: undefined }] })

    await h.functions.refresh()

    expect(h.functions.read({ target: target(), installationId })).toEqual({ availability: 'ready', orphanCommands: [], items: [{
      pluginId: 'notes-1', name: '摘录整理', purpose: '把当前文章整理为可复用摘录', currentPackageId: 'pkg-2',
      activeRun: { pluginRunId: 'run-3', packageId: 'pkg-2' }, scope: 'page', scopeStatus: 'current-target',
      target: pageScope.target, targetRevision: 4, status: 'running', inspection: null,
    }] })
    expect(h.call).toHaveBeenCalledWith('function.list', {})
  })

  test('页面功能在目标文档或修订变化后明确标记为陈旧', async () => {
    const h = harness()
    await h.functions.refresh()

    expect(h.functions.read({ target: target({ revision: 5 }), installationId })).toMatchObject({ items: [{ scopeStatus: 'stale-target' }] })
    expect(h.functions.read({ target: target({ selected: { ...target().selected, documentId: 'document-new' } }), installationId })).toMatchObject({ items: [{ scopeStatus: 'stale-target' }] })
  })

  test('只保留有界且可验证的功能打开目标，并公开内部范围供运行时预检', async () => {
    const browserOpen = { kind: 'browser', resource: { kind: 'region_render', sessionId: 'cleanup-session', installationId,
      page: pageScope.target, mountId: 'mount-1' } }
    const h = harness({ functions: [functionRow({ openTarget: browserOpen }), functionRow({ pluginId: 'bad-open', openTarget: { kind: 'browser', resource: { mountId: 'missing-identity' } } })] })
    await h.functions.refresh()
    const items = h.functions.read({ target: target(), installationId }).items
    expect(items[0]).toMatchObject({ openTarget: browserOpen })
    expect(items[1]).not.toHaveProperty('openTarget')
    expect(h.functions.scope('notes-1')).toBe('page')
  })

  test('查看与停止只从已列目录取得精确版本，停止后重新拉取目录', async () => {
    const h = harness()
    await h.functions.refresh()

    await h.functions.inspect('notes-1')
    await h.functions.stop('notes-1')

    expect(h.call).toHaveBeenNthCalledWith(2, 'function.inspect', { pluginId: 'notes-1', expectedPackageId: 'pkg-2', expectedPluginRunId: 'run-3' })
    expect(h.call).toHaveBeenNthCalledWith(3, 'function.stop', { pluginId: 'notes-1', expectedPackageId: 'pkg-2', expectedPluginRunId: 'run-3' })
    expect(h.call).toHaveBeenLastCalledWith('function.list', {})
  })

  test('没有活动运行版本的功能不允许停止', async () => {
    const h = harness({ functions: [functionRow({ activeRun: undefined })] })
    await h.functions.refresh()

    await expect(h.functions.stop('notes-1')).rejects.toMatchObject({ code: 'function_not_running' })
    expect(h.call).not.toHaveBeenCalledWith('function.stop', expect.anything())
  })

  test('停止态提供运行命令；页面范围携带当前目标修订，全局明确传空修订', async () => {
    const h = harness({ functions: [functionRow({ activeRun: undefined }), functionRow({ pluginId: 'global-1', delivery: { scope: { kind: 'global' } }, activeRun: undefined })] })
    await h.functions.refresh()
    await h.functions.run('notes-1', { sessionId: 'session-1', target: target() })
    await h.functions.run('global-1', { sessionId: 'session-1', target: target() })
    expect(h.call).toHaveBeenCalledWith('function.run', expect.objectContaining({ functionId: 'notes-1', expectedVersion: 'pkg-2', expectedRunId: null, sessionId: 'session-1', expectedTargetRevision: 4 }))
    expect(h.call).toHaveBeenCalledWith('function.run', expect.objectContaining({ functionId: 'global-1', expectedTargetRevision: null }))
  })
  test('全局功能不需要页面目标，页面功能仍在缺少目标时拒绝', async () => {
    const h = harness({ functions: [functionRow({ activeRun: undefined }), functionRow({ pluginId: 'global-1', delivery: { scope: { kind: 'global' } }, activeRun: undefined })] })
    await h.functions.refresh()
    const unavailable = { availability: 'unavailable', revision: null, selected: null }
    await expect(h.functions.run('global-1', { sessionId: 'session-1', target: unavailable })).resolves.toMatchObject({ accepted: true })
    await expect(h.functions.run('notes-1', { sessionId: 'session-1', target: unavailable })).rejects.toMatchObject({ code: 'target_changed' })
  })
  test('目录读取失败保留有界错误，而不是永久伪装成空不可用', async () => {
    const h = harness()
    h.call.mockRejectedValueOnce(Object.assign(new Error('Host is upgrading'), { code: 'host_unavailable' }))
    await expect(h.functions.refresh()).rejects.toMatchObject({ code: 'host_unavailable' })
    expect(h.functions.read({ target: target(), installationId })).toMatchObject({
      availability: 'unavailable', readError: { code: 'host_unavailable', message: 'Host is upgrading' }, items: [],
    })
  })

  test('页面功能在陈旧目标上不运行，但可以用修改迁到当前固定目标', async () => {
    const h = harness({ functions: [functionRow({ activeRun: undefined })] }); await h.functions.refresh()
    await expect(h.functions.run('notes-1', { sessionId: 'session-1', target: target({ revision: 5 }) })).rejects.toMatchObject({ code: 'target_changed' })
    const migrated = target({ revision: 5, selected: { ...target().selected, documentId: 'document-new', url: 'https://example.test/new' } })
    await h.functions.edit('notes-1', { sessionId: 'session-1', target: migrated, instruction: '换个标题' })
    expect(h.call).not.toHaveBeenCalledWith('function.run', expect.anything())
    expect(h.call).toHaveBeenCalledWith('function.edit', expect.objectContaining({ expectedTargetRevision: 5 }))
  })

  test('修改只收取简短自然语言，并且调用含当前版本与页面修订', async () => {
    const h = harness(); await h.functions.refresh()
    await h.functions.edit('notes-1', { sessionId: 'session-1', target: target(), instruction: '把摘要压缩成三条要点' })
    expect(h.call).toHaveBeenCalledWith('function.edit', expect.objectContaining({ functionId: 'notes-1', expectedVersion: 'pkg-2', sessionId: 'session-1', expectedTargetRevision: 4, instruction: '把摘要压缩成三条要点' }))
    const edit = h.call.mock.calls.find(call => call[0] === 'function.edit')?.[1]
    expect(edit).not.toHaveProperty('owner'); expect(edit).not.toHaveProperty('capability')
  })

  test('结果未知时保留原请求而不生成新 ID 自动重发', async () => {
    const h = harness({ functions: [functionRow({ activeRun: undefined })] }); await h.functions.refresh()
    h.call.mockImplementationOnce(async method => method === 'function.run' ? Promise.reject(Object.assign(new Error('result_unknown'), { code: 'result_unknown' })) : { functions: [functionRow({ activeRun: undefined })] })
    await expect(h.functions.run('notes-1', { sessionId: 'session-1', target: target() })).rejects.toMatchObject({ code: 'result_unknown' })
    const first = h.call.mock.calls.find(call => call[0] === 'function.run')?.[1] as { readonly requestId?: unknown } | undefined
    const requestId = typeof first?.requestId === 'string' ? first.requestId : ''
    await expect(h.functions.run('notes-1', { sessionId: 'session-1', target: target() })).resolves.toMatchObject({ status: 'unknown' })
    expect(h.call.mock.calls.filter(call => call[0] === 'function.run')).toHaveLength(1)
    expect(requestId).not.toBe('')
    expect(h.functions.read({ target: target(), installationId }).items[0]).toMatchObject({ command: { status: 'unknown', requestId } })
  })

  test('模块重建会恢复命令账本；Host 找不到已受理命令时明确标成 host-lost', async () => {
    const data: Record<string, unknown> = {}
    const storage = {
      get: vi.fn(async (key: string) => ({ [key]: data[key] })),
      set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(data, value) }),
    }
    const first = harness({ functions: [functionRow({ activeRun: undefined })] }, storage)
    first.call.mockImplementationOnce(async (method: string) => method === 'function.run'
      ? { accepted: true } : { functions: [functionRow({ activeRun: undefined })] })
    await first.functions.refresh(); await first.functions.run('notes-1', { sessionId: 'session-1', target: target() })
    const second = harness({ functions: [] }, storage)
    second.call.mockImplementation(async (method: string) => method === 'function.command.status' ? { status: 'missing' } : { functions: [] })
    await second.functions.restore(); await second.functions.connectionChanged({ phase: 'connected', grant: { installationId } })
    expect(second.functions.read({ target: target(), installationId }).orphanCommands)
      .toMatchObject([{ status: 'host-lost' }])
  })

  test('accepted 命令只轮询控制面，Host 报 completed 后才结算', async () => {
    vi.useFakeTimers()
    const h = harness({ functions: [functionRow({ activeRun: undefined })] }, undefined, { pollMs: 1000 })
    await h.functions.refresh(); await h.functions.run('notes-1', { sessionId: 'session-1', target: target() })
    expect(h.functions.read({ target: target(), installationId }).items[0]).toMatchObject({ command: { status: 'accepted' } })
    h.call.mockImplementation(async method => method === 'function.command.status'
      ? { kind: 'run', status: 'settled', pluginId: 'notes-1', receipt: { ok: true } } : { functions: [functionRow({ activeRun: undefined })] })
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.call).toHaveBeenCalledWith('function.command.status', expect.any(Object))
    expect(h.functions.read({ target: target(), installationId }).items[0]).toMatchObject({ command: { status: 'completed' } })
    vi.useRealTimers()
  })

  test('同名功能在另一 Host 或安装实例不会被旧命令阻塞', async () => {
    const h = harness({ functions: [functionRow({ activeRun: undefined })] })
    await h.functions.refresh(); await h.functions.run('notes-1', { sessionId: 'session-1', target: target() })
    h.connection.baseUrl = 'http://two.test'; h.connection.grant.installationId = '123e4567-e89b-42d3-a456-426614174099'
    await h.functions.run('notes-1', { sessionId: 'session-2', target: target() })
    expect(h.call.mock.calls.filter(call => call[0] === 'function.run')).toHaveLength(2)
  })
})
