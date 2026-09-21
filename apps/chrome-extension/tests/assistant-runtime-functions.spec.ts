import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const installationId = '123e4567-e89b-42d3-a456-426614174000'
  const binding = { baseUrl: 'http://127.0.0.1:3080', installationId, sessionId: 'current-session' }
  return {
    installationId,
    connectionChanged: null as null | ((state: unknown) => void),
    connectionCall: vi.fn(),
    functionScope: vi.fn(),
    functionRun: vi.fn(),
    functionEdit: vi.fn(),
    functionInspect: vi.fn(),
    intakeDescribe: vi.fn(),
    sessionSubmit: vi.fn(),
    sessionModels: vi.fn(),
    sessionSelectModel: vi.fn(),
    sessionState: { binding: binding, phase: 'idle', pending: null, pendingCreate: null, records: [] },
  }
})

vi.mock('../src/assistant-transport.js', () => ({ createAssistantTransport: () => ({}) }))
vi.mock('../src/assistant-channel.js', () => ({ createAssistantChannel: () => ({}) }))
vi.mock('../src/assistant-connection.js', () => ({ createAssistantConnection: (options: { changed: (state: unknown) => void }) => {
  mocks.connectionChanged = options.changed
  return {
    read: async () => ({ baseUrl: 'http://127.0.0.1:3080', phase: 'connected', grant: { installationId: mocks.installationId, grantEpoch: 1, scopes: ['browser:write'], origins: ['*'] } }),
    call: mocks.connectionCall, getGrant: () => ({ installationId: mocks.installationId, grantEpoch: 1, scopes: ['browser:write'], origins: ['*'] }),
    permit: vi.fn(), sendReceipt: vi.fn(), configure: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
    cancel: vi.fn(), openApproval: vi.fn(), poll: vi.fn(),
  }
} }))
vi.mock('../src/assistant-journal.js', () => ({ createAssistantJournal: () => ({ list: async () => [], acknowledgements: async () => [], interrupt: vi.fn(), lookup: vi.fn(), handle: vi.fn(), acknowledge: vi.fn(), confirmAcknowledgement: vi.fn() }) }))
vi.mock('../src/browser-executor.js', () => ({ createBrowserExecutor: () => ({ releaseInstallation: vi.fn() }) }))
vi.mock('../src/browser-puppeteer.js', () => ({ createPuppeteerDriver: () => ({}) }))
vi.mock('../vendor/puppeteer.js', () => ({ connect: vi.fn(), ExtensionTransport: class { readonly mocked = true } }))
vi.mock('../src/assistant-session.js', () => ({ createAssistantSession: () => ({ read: () => structuredClone(mocks.sessionState), restore: vi.fn(), connectionChanged: vi.fn(async () => {}), onEvent: vi.fn(), bind: vi.fn(), create: vi.fn(), models: mocks.sessionModels, selectModel: mocks.sessionSelectModel, submit: mocks.sessionSubmit, retry: vi.fn(), discardDraft: vi.fn(), stop: vi.fn() }) }))
vi.mock('../src/assistant-session-surfaces.js', () => ({ createAssistantSessionSurfaces: () => ({ ready: async () => ({ read: () => structuredClone(mocks.sessionState), restore: vi.fn(), connectionChanged: vi.fn(async () => {}), onEvent: vi.fn(), bind: vi.fn(), create: vi.fn(), models: mocks.sessionModels, selectModel: mocks.sessionSelectModel, submit: mocks.sessionSubmit, retry: vi.fn(), discardDraft: vi.fn(), stop: vi.fn() }), peek: () => null, release: vi.fn(), restore: vi.fn(), connectionChanged: vi.fn(async () => {}), onEvent: vi.fn() }) }))
vi.mock('../src/assistant-view.js', () => ({ projectAssistantView: ({ state }: { state: unknown }) => state }))
vi.mock('../src/assistant-cognition.js', () => ({ projectAssistantCognition: () => ({ status: 'unread', items: [], refreshPolicy: 'manual-or-agent-request' }) }))
vi.mock('../src/browser-context.js', () => ({ createBrowserContext: () => ({ candidates: async () => [], current: async () => null, describe: mocks.intakeDescribe }) }))
vi.mock('../src/assistant-approval.js', () => ({ createAssistantApproval: () => ({ read: () => ({ sessionId: null, requests: [] }), sync: vi.fn(), setView: vi.fn(), decide: vi.fn() }) }))
vi.mock('../src/assistant-monitors.js', () => ({ createAssistantMonitors: () => ({ read: () => ({ monitors: [] }), restore: vi.fn(), connectionChanged: vi.fn(async () => {}), sync: vi.fn(), create: vi.fn(), retry: vi.fn(), control: vi.fn(), find: vi.fn() }) }))
vi.mock('../src/assistant-activity.js', () => ({ createAssistantActivity: () => ({ read: () => ({}), restore: vi.fn(), connectionChanged: vi.fn(async () => {}), policy: vi.fn(), enqueue: vi.fn(), flush: vi.fn(), configure: vi.fn(), retry: vi.fn(), sync: vi.fn(), query: vi.fn() }) }))
vi.mock('../src/browser-activity.js', () => ({ createBrowserActivity: () => ({ start: vi.fn(), tick: vi.fn(), policyChanged: vi.fn() }) }))
vi.mock('../src/assistant-readings.js', () => ({ createAssistantReadings: () => ({ read: () => ({}), restore: vi.fn(), onEvent: vi.fn(), configure: vi.fn(), select: vi.fn(), stop: vi.fn(), generate: vi.fn() }) }))
vi.mock('../src/assistant-functions.js', () => ({ createAssistantFunctions: () => ({ read: () => ({ availability: 'ready', items: [] }), restore: vi.fn(), connectionChanged: vi.fn(async () => {}), refresh: vi.fn(), stop: vi.fn(), scope: mocks.functionScope, run: mocks.functionRun, edit: mocks.functionEdit, inspect: mocks.functionInspect }) }))

import { createAssistantRuntime } from '../src/assistant-runtime.js'

const chromeApi = () => ({
  runtime: { id: 'extension-id' }, storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } },
  permissions: { contains: vi.fn(async () => true) },
  tabs: { create: vi.fn(async (value: unknown): Promise<unknown> => value), update: vi.fn(async () => ({ windowId: 3 })) },
  windows: { update: vi.fn() }, scripting: { executeScript: vi.fn() }, action: { setBadgeText: vi.fn() },
})
const connected = () => ({ baseUrl: 'http://127.0.0.1:3080', phase: 'connected', grant: { installationId: mocks.installationId, grantEpoch: 1, scopes: ['browser:write'], origins: ['*'] } })

describe('assistant runtime function handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.sessionState.binding = { baseUrl: 'http://127.0.0.1:3080', installationId: mocks.installationId, sessionId: 'current-session' }
    mocks.connectionCall.mockImplementation(async (method) => { if (method === 'session.target.read') throw Object.assign(new Error('target backend down'), { code: 'target_unavailable' }); return {} })
    mocks.sessionSubmit.mockResolvedValue({ accepted: true, requestId: 'prompt-1' })
    mocks.sessionModels.mockResolvedValue({ groups: [] })
    mocks.sessionSelectModel.mockResolvedValue({ provider: 'deepseek', model: 'deepseek-chat' })
    mocks.functionRun.mockResolvedValue({ accepted: true }); mocks.functionEdit.mockResolvedValue({ prepared: true })
  })

  test('global run and edit do not consult a failing page-target service', async () => {
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api }); mocks.connectionChanged?.(connected())
    mocks.functionScope.mockReturnValue('global')
    await expect(runtime.handle({ type: 'dsh-assistant-function-run', pluginId: 'global-1' })).resolves.toMatchObject({ ok: true })
    await expect(runtime.handle({ type: 'dsh-assistant-function-edit', pluginId: 'global-1', instruction: '改成每周运行' })).resolves.toMatchObject({ ok: true })
    expect(mocks.functionRun).toHaveBeenCalledWith('global-1', expect.objectContaining({ target: { availability: 'ready', revision: null, selected: null } }))
    expect(mocks.functionEdit).toHaveBeenCalledWith('global-1', expect.objectContaining({ target: { availability: 'ready', revision: null, selected: null } }))
    expect(mocks.connectionCall.mock.calls.filter(call => call[0] === 'session.target.read')).toHaveLength(2)
  })

  test('web open works without a current conversation and browser open accepts an older cleanup session only with exact document result', async () => {
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api }); mocks.connectionChanged?.(connected())
    mocks.sessionState.binding = null
    mocks.functionInspect.mockResolvedValueOnce({ function: { openTarget: { kind: 'web', sessionId: 'view-session' } } })
    await expect(runtime.handle({ type: 'dsh-assistant-function-open', pluginId: 'global-web' })).resolves.toMatchObject({ ok: true })
    expect(api.tabs.create).toHaveBeenCalledWith({ url: 'http://127.0.0.1:3080/#session=view-session' })

    mocks.sessionState.binding = { baseUrl: 'http://127.0.0.1:3080', installationId: mocks.installationId, sessionId: 'current-session' }
    const page = { tabId: 8, frameId: 2, documentId: 'document-a', url: 'https://example.test/a' }
    mocks.functionInspect.mockResolvedValueOnce({ function: { openTarget: { kind: 'browser', resource: { kind: 'entry_mount', sessionId: 'older-cleanup-session', installationId: mocks.installationId, page, mountId: 'mount-a' } } } })
    api.scripting.executeScript.mockResolvedValue([{ frameId: 2, documentId: 'document-a', result: { ok: true } }])
    await expect(runtime.handle({ type: 'dsh-assistant-function-open', pluginId: 'browser-view' })).resolves.toMatchObject({ ok: true })
    expect(api.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 8, documentIds: ['document-a'] }, world: 'ISOLATED' }))
    expect(api.tabs.update).toHaveBeenCalledWith(8, { active: true })
  })

  test('历史目标属于另一安装实例时保留修订并允许重绑，不触碰可能碰撞的旧标签', async () => {
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api }); mocks.connectionChanged?.(connected())
    mocks.connectionCall.mockImplementation(async method => method === 'session.target.read' ? {
      revision: 7, binding: { installationId: 'other-installation', revision: 7, boundAt: 1,
        page: { tabId: 8, frameId: 0, documentId: 'old-document', url: 'https://old.example.test/' } },
    } : {})
    const result = await runtime.handle({ type: 'dsh-assistant-state' })
    expect(result.state.target).toMatchObject({ availability: 'ready', revision: 7, selected: null, bindingState: 'other-installation' })
    expect(mocks.intakeDescribe).not.toHaveBeenCalled()
  })

  test('未知斜杠命令只回落为一次普通提交', async () => {
    const runtime = createAssistantRuntime({ chromeApi: chromeApi() }); mocks.connectionChanged?.(connected())

    await expect(runtime.handle({ type: 'dsh-assistant-session-submit', text: '/unknown', mode: 'queue',
      expectedSessionId: 'current-session' })).resolves.toMatchObject({ ok: true })

    expect(mocks.sessionSubmit).toHaveBeenCalledTimes(1)
    expect(mocks.sessionSubmit).toHaveBeenCalledWith({
      content: [{ type: 'text', text: '/unknown' }], mode: 'queue', expectedSessionId: 'current-session',
    })
  })

  test('模型目录和选择消息只映射到当前 surface 的 Session adapter', async () => {
    const runtime = createAssistantRuntime({ chromeApi: chromeApi() }); mocks.connectionChanged?.(connected())
    const selection = { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'low' }

    await expect(runtime.handle({ type: 'dsh-assistant-session-models' }, 'surface-1'))
      .resolves.toMatchObject({ ok: true, value: { groups: [] } })
    await expect(runtime.handle({ type: 'dsh-assistant-session-select-model', selection,
      expectedSessionId: 'current-session' }, 'surface-1')).resolves.toMatchObject({ ok: true })

    expect(mocks.sessionModels).toHaveBeenCalledOnce()
    expect(mocks.sessionSelectModel).toHaveBeenCalledWith(selection, 'current-session')
  })
})
