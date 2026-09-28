import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const installationId = '123e4567-e89b-42d3-a456-426614174000'
  const codexInstallationId = '223e4567-e89b-42d3-a456-426614174000'
  const binding = { baseUrl: 'http://127.0.0.1:3080', installationId, sessionId: 'current-session' }
  return {
    installationId,
    codexInstallationId,
    connectionChanged: null as null | ((state: unknown) => void),
    codexConnectionChanged: null as null | ((state: unknown) => void),
    dshCreateChannel: null as null | ((options: unknown) => unknown),
    codexCreateChannel: null as null | ((options: unknown) => unknown),
    createChannel: vi.fn(),
    connectionCall: vi.fn(),
    codexCall: vi.fn(),
    connectionRead: vi.fn(async () => ({ baseUrl: 'http://127.0.0.1:3080', phase: 'connected' })),
    connectionRetry: vi.fn(async () => false),
    connectionConnect: vi.fn(),
    functionScope: vi.fn(),
    functionRun: vi.fn(),
    functionEdit: vi.fn(),
    functionInspect: vi.fn(),
    intakeDescribe: vi.fn(),
    intakeTarget: vi.fn(),
    sessionSubmit: vi.fn(),
    sessionModels: vi.fn(),
    sessionSelectModel: vi.fn(),
    sessionState: { binding: binding, phase: 'idle', pending: null, pendingCreate: null, records: [] },
  }
})

vi.mock('../src/assistant-transport.js', () => ({ createAssistantTransport: () => ({}) }))
vi.mock('../src/assistant-channel.js', () => ({ createAssistantChannel: mocks.createChannel }))
vi.mock('../src/assistant-connection.js', () => ({ createAssistantConnection: (options: { changed: (state: unknown) => void; createChannel: (options: unknown) => unknown }) => {
  mocks.connectionChanged = options.changed
  mocks.dshCreateChannel = options.createChannel
  return {
    read: mocks.connectionRead,
    call: mocks.connectionCall, getGrant: () => ({ installationId: mocks.installationId, grantEpoch: 1, scopes: ['browser:write'], origins: ['*'] }),
    permit: vi.fn(), sendReceipt: vi.fn(), configure: vi.fn(),
    connect: mocks.connectionConnect, retrySaved: mocks.connectionRetry, disconnect: vi.fn(),
    cancel: vi.fn(), openApproval: vi.fn(), poll: vi.fn(),
  }
} }))
vi.mock('../src/codex-browser-connection.js', () => ({ createCodexBrowserConnection: (options: { changed: (state: unknown) => void; createChannel: (options: unknown) => unknown }) => {
  mocks.codexConnectionChanged = options.changed
  mocks.codexCreateChannel = options.createChannel
  return {
    read: vi.fn(async () => ({ baseUrl: 'http://127.0.0.1:3091', phase: 'connected' })),
    getGrant: () => ({ installationId: mocks.codexInstallationId, grantEpoch: 1, scopes: ['browser:write'], origins: ['*'] }),
    call: mocks.codexCall, sendReceipt: vi.fn(), restore: vi.fn(), configure: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
  }
} }))
vi.mock('../src/assistant-journal.js', () => ({ createAssistantJournal: () => ({ list: async () => [],
  interrupt: vi.fn(), lookup: vi.fn(), handle: vi.fn() }) }))
vi.mock('../src/browser-executor.js', () => ({ createBrowserExecutor: () => ({ releaseInstallation: vi.fn() }) }))
vi.mock('../src/browser-puppeteer.js', () => ({ createPuppeteerDriver: () => ({}) }))
vi.mock('../vendor/puppeteer.js', () => ({ connect: vi.fn(), ExtensionTransport: class { readonly mocked = true } }))
vi.mock('../src/assistant-session.js', () => ({ createAssistantSession: () => ({ read: () => structuredClone(mocks.sessionState), restore: vi.fn(), connectionChanged: vi.fn(async () => {}), onEvent: vi.fn(), bind: vi.fn(), create: vi.fn(), models: mocks.sessionModels, selectModel: mocks.sessionSelectModel, submit: mocks.sessionSubmit, retry: vi.fn(), discardDraft: vi.fn(), stop: vi.fn() }) }))
vi.mock('../src/assistant-session-surfaces.js', () => ({ createAssistantSessionSurfaces: () => ({ ready: async () => ({ read: () => structuredClone(mocks.sessionState), restore: vi.fn(), connectionChanged: vi.fn(async () => {}), onEvent: vi.fn(), bind: vi.fn(), create: vi.fn(), models: mocks.sessionModels, selectModel: mocks.sessionSelectModel, submit: mocks.sessionSubmit, retry: vi.fn(), discardDraft: vi.fn(), stop: vi.fn() }), peek: () => null, release: vi.fn(), restore: vi.fn(), connectionChanged: vi.fn(async () => {}), onEvent: vi.fn() }) }))
vi.mock('../src/assistant-view.js', () => ({ projectAssistantView: ({ state }: { state: unknown }) => state }))
vi.mock('../src/assistant-cognition.js', () => ({ projectAssistantCognition: () => ({ status: 'unread', items: [], refreshPolicy: 'manual-or-agent-request' }) }))
vi.mock('../src/browser-context.js', () => ({ createBrowserContext: () => ({ candidates: async () => [], current: async () => null,
  describe: mocks.intakeDescribe, target: mocks.intakeTarget }) }))
vi.mock('../src/assistant-approval.js', () => ({ createAssistantApproval: () => ({ read: () => ({ sessionId: null, requests: [] }), sync: vi.fn(), setView: vi.fn(), decide: vi.fn() }) }))
vi.mock('../src/assistant-monitors.js', () => ({ createAssistantMonitors: () => ({ read: () => ({ monitors: [] }), restore: vi.fn(), connectionChanged: vi.fn(async () => {}), sync: vi.fn(), create: vi.fn(), retry: vi.fn(), control: vi.fn(), find: vi.fn() }) }))
vi.mock('../src/assistant-activity.js', () => ({ createAssistantActivity: () => ({ read: () => ({}), restore: vi.fn(), connectionChanged: vi.fn(async () => {}), policy: vi.fn(), enqueue: vi.fn(), flush: vi.fn(), configure: vi.fn(), retry: vi.fn(), sync: vi.fn(), query: vi.fn() }) }))
vi.mock('../src/browser-activity.js', () => ({ createBrowserActivity: () => ({ start: vi.fn(), tick: vi.fn(), policyChanged: vi.fn() }) }))
vi.mock('../src/assistant-readings.js', () => ({ createAssistantReadings: () => ({ read: () => ({}), restore: vi.fn(), onEvent: vi.fn(), configure: vi.fn(), select: vi.fn(), stop: vi.fn(), generate: vi.fn() }) }))
vi.mock('../src/assistant-functions.js', () => ({ createAssistantFunctions: () => ({ read: () => ({ availability: 'ready', items: [] }), restore: vi.fn(), connectionChanged: vi.fn(async () => {}), refresh: vi.fn(), stop: vi.fn(), scope: mocks.functionScope, run: mocks.functionRun, edit: mocks.functionEdit, inspect: mocks.functionInspect }) }))

import { createAssistantRuntime } from '../src/assistant-runtime.js'

const chromeApi = () => ({
  runtime: { id: 'extension-id', getManifest: vi.fn(() => ({ version: '0.4.0' })) }, storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } },
  permissions: { contains: vi.fn(async () => true) },
  tabs: { create: vi.fn(async (value: unknown): Promise<unknown> => value), update: vi.fn(async () => ({ windowId: 3 })) },
  windows: { update: vi.fn() }, scripting: { executeScript: vi.fn() }, action: { setBadgeText: vi.fn() },
})
const connected = () => ({ baseUrl: 'http://127.0.0.1:3080', phase: 'connected', grant: { installationId: mocks.installationId, grantEpoch: 1, scopes: ['browser:write'], origins: ['*'] } })
afterEach(() => { vi.useRealTimers() })

describe('assistant runtime function handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.sessionState.binding = { baseUrl: 'http://127.0.0.1:3080', installationId: mocks.installationId, sessionId: 'current-session' }
    mocks.codexCall.mockReset()
    mocks.createChannel.mockReset().mockReturnValue({})
    mocks.connectionRead.mockResolvedValue({ baseUrl: 'http://127.0.0.1:3080', phase: 'connected' })
    mocks.connectionRetry.mockResolvedValue(false)
    mocks.intakeTarget.mockResolvedValue({ tabId: 7, windowId: 2, frameId: 0, documentId: 'doc-7',
      url: 'https://example.test/a', title: 'A' })
    mocks.connectionCall.mockImplementation(async (method) => { if (method === 'session.target.read') throw Object.assign(new Error('target backend down'), { code: 'target_unavailable' }); return {} })
    mocks.sessionSubmit.mockResolvedValue({ accepted: true, requestId: 'prompt-1' })
    mocks.sessionModels.mockResolvedValue({ groups: [] })
    mocks.sessionSelectModel.mockResolvedValue({ provider: 'deepseek', model: 'deepseek-chat' })
    mocks.functionRun.mockResolvedValue({ accepted: true }); mocks.functionEdit.mockResolvedValue({ prepared: true })
  })

  test('向 DSH 与 Codex 统一报告实际 manifest 版本', () => {
    const api = chromeApi(); createAssistantRuntime({ chromeApi: api })
    mocks.dshCreateChannel!({ credentials: {} })
    mocks.codexCreateChannel!({ credentials: {} })

    expect(mocks.createChannel).toHaveBeenNthCalledWith(1, { credentials: {}, runtime: { version: '0.4.0' } })
    expect(mocks.createChannel).toHaveBeenNthCalledWith(2, { credentials: {}, runtime: { version: '0.4.0' } })
    expect(api.runtime.getManifest).toHaveBeenCalledTimes(1)
  })

  test('manifest 信息不可用时不虚构 hello 运行时版本', () => {
    const api = chromeApi(); delete (api.runtime as { getManifest?: unknown }).getManifest
    createAssistantRuntime({ chromeApi: api })
    mocks.dshCreateChannel!({ credentials: {} })
    mocks.codexCreateChannel!({ credentials: {} })

    expect(mocks.createChannel).toHaveBeenNthCalledWith(1, { credentials: {} })
    expect(mocks.createChannel).toHaveBeenNthCalledWith(2, { credentials: {} })
  })

  test('显式重试只恢复已保存授权，不发起新配对', async () => {
    mocks.connectionRead.mockResolvedValue({ baseUrl: 'http://127.0.0.1:3080', phase: 'offline' })
    mocks.connectionRetry.mockResolvedValue(true)
    const runtime = createAssistantRuntime({ chromeApi: chromeApi() })
    await expect(runtime.handle({ type: 'dsh-assistant-retry' })).resolves.toMatchObject({ ok: true })
    expect(mocks.connectionRetry).toHaveBeenCalledWith()
    expect(mocks.connectionConnect).not.toHaveBeenCalled()
  })

  test('持久通道正在握手时重复连接不切断它', async () => {
    mocks.connectionRead.mockResolvedValue({ baseUrl: 'http://127.0.0.1:3080', phase: 'connecting' })
    const runtime = createAssistantRuntime({ chromeApi: chromeApi() })
    await expect(runtime.handle({ type: 'dsh-assistant-connect' })).resolves.toMatchObject({ ok: true })
    expect(mocks.connectionConnect).not.toHaveBeenCalled()
    expect(mocks.connectionRetry).not.toHaveBeenCalled()
  })

  test('当前页身份先返回给侧栏，绑定时再核对同一文档', async () => {
    const runtime = createAssistantRuntime({ chromeApi: chromeApi() }); mocks.connectionChanged?.(connected())
    const selected = { tabId: 7, windowId: 2, frameId: 0, documentId: 'doc-7', url: 'https://example.test/a', title: 'A' }
    await expect(runtime.handle({ type: 'dsh-assistant-target-current' })).resolves.toMatchObject({ ok: true, value: selected })
    await expect(runtime.handle({ type: 'dsh-assistant-target-bind', expectedRevision: 0,
      tabId: 7, expectedPage: selected })).resolves.toMatchObject({ ok: true })
    expect(mocks.intakeTarget).toHaveBeenLastCalledWith(7, selected)
    expect(mocks.connectionCall).toHaveBeenCalledWith('session.target.bind', expect.objectContaining({
      expectedRevision: 0, page: { tabId: 7, frameId: 0, documentId: 'doc-7', url: 'https://example.test/a' },
    }))
  })

  test('FC SBC 规划入口只计算候选方案，不触发会话或浏览器写动作', async () => {
    const runtime = createAssistantRuntime({ chromeApi: chromeApi() })
    const result = await runtime.handle({ type: 'dsh-assistant-fc-sbc-plan', input: {
      now: 1790316000000, fcYear: 'FC27', platform: 'pc', groupId: 'marquee',
      inventory: [{ instanceId: 'owned-a', cardVersionId: 'gold-a' }],
      quotes: [{ platform: 'pc', cardVersionId: 'buy-a', price: 700, source: 'fixture',
        observedAt: 1790316000000, validUntil: 1790316600000 }],
      challenges: [{ challengeId: 'one', slotCount: 2, candidates: [
        { cards: [{ instanceId: 'owned-a' }, { cardVersionId: 'buy-a', planPurchaseId: 'p-a' }] },
      ] }],
    } })

    expect(result).toMatchObject({ ok: true, value: { variants: [{ purchaseCount: 1, maxSpend: 700 }] } })
    expect(mocks.sessionSubmit).not.toHaveBeenCalled()
    expect(mocks.connectionCall).not.toHaveBeenCalledWith('session.target.bind', expect.anything())
  })

  test('FC SBC 就绪度入口只梳理阻塞项，不触发会话或浏览器写动作', async () => {
    const runtime = createAssistantRuntime({ chromeApi: chromeApi() })
    const result = await runtime.handle({ type: 'dsh-assistant-fc-sbc-readiness', input: {
      probe: {
        url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/',
        title: 'FC',
        capturedAt: '2026-09-25T06:20:00.000Z',
        supported: true,
        taskType: 'puzzle',
        marketAccess: { status: 'visible', evidence: ['transfer-market-visible'] },
        challengeSet: { title: 'Marquee Matchups', visibleChallengeCount: 1, challenges: [] },
        inventory: { coverage: 'visible-only', sbcStorageVisible: false, visibleCards: [] },
        warnings: [],
      },
      planInput: {
        now: 1790317200000, fcYear: 'FC27', platform: 'pc', groupId: 'marquee',
        inventory: [{ instanceId: 'owned-a', cardVersionId: 'gold-a' }],
        quotes: [{ platform: 'pc', cardVersionId: 'buy-a', price: 700, source: 'fixture',
          observedAt: 1790317200000, validUntil: 1790317800000 }],
        challenges: [{ challengeId: 'one', slotCount: 2, candidates: [
          { cards: [{ instanceId: 'owned-a' }, { cardVersionId: 'buy-a', planPurchaseId: 'p-a' }] },
        ] }],
      },
    } })

    expect(result).toMatchObject({ ok: true, value: { report: { status: 'draft-only',
      canApproveExecution: false, summary: { variantCount: 1 } } } })
    const report = (result as {
      readonly value: { readonly report: { readonly blockers: readonly { readonly code: string }[] } }
    }).value.report
    expect(report.blockers.map(issue => issue.code)).toContain('inventory-visible-only')
    expect(mocks.sessionSubmit).not.toHaveBeenCalled()
    expect(mocks.connectionCall).not.toHaveBeenCalledWith('session.target.bind', expect.anything())
  })

  test('FC SBC 页面探针在同一 documentId 上只读执行，并返回页面身份', async () => {
    const api = chromeApi()
    const runtime = createAssistantRuntime({ chromeApi: api }); mocks.connectionChanged?.(connected())
    const selected = { tabId: 7, windowId: 2, frameId: 0, documentId: 'doc-7', url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/', title: 'FC' }
    mocks.intakeTarget.mockResolvedValueOnce(selected)
    api.scripting.executeScript.mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-7', result: {
      url: selected.url, title: 'FC', supported: true, taskType: 'puzzle',
      marketAccess: { status: 'visible', evidence: ['transfer-market-visible'] },
      challengeSet: { title: 'Marquee Matchups', visibleChallengeCount: 1, challenges: [] },
      inventory: { coverage: 'visible-only', sbcStorageVisible: false, visibleCards: [] },
      warnings: [],
    } }])

    await expect(runtime.handle({ type: 'dsh-assistant-fc-sbc-probe', tabId: 7,
      expectedPage: selected })).resolves.toMatchObject({ ok: true, value: { page: selected,
      probe: { supported: true, taskType: 'puzzle' } } })
    expect(mocks.intakeTarget).toHaveBeenLastCalledWith(7, selected)
    expect(api.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 7, documentIds: ['doc-7'] }, world: 'ISOLATED',
    }))
    expect(mocks.sessionSubmit).not.toHaveBeenCalled()
  })

  test('FC SBC 只读扫描可直接读取当前标签，不依赖 DSH 对话绑定', async () => {
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api })
    mocks.sessionState.binding = null
    const page = { tabId: 7, windowId: 2, frameId: 0, documentId: 'doc-7',
      url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/', title: 'FC' }
    mocks.intakeTarget.mockResolvedValue(page)
    const probe = { url: page.url, supported: true, challengeSet: { title: '重大比赛', challenges: [] } }
    api.scripting.executeScript.mockResolvedValue([{ frameId: 0, documentId: 'doc-7', result: probe }])
    await expect(runtime.handle({ type: 'dsh-assistant-fc-sbc-slice' })).resolves.toMatchObject({
      ok: true, value: { page, probe, main: null, readMode: 'page-only' },
    })
    expect(mocks.intakeTarget).toHaveBeenCalledWith(undefined)
    expect(mocks.connectionCall).not.toHaveBeenCalled()
    expect(api.scripting.executeScript).toHaveBeenCalledTimes(1)
    expect(api.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
      world: 'ISOLATED', target: { tabId: 7, documentIds: ['doc-7'] },
    }))
  })

  test('FC SBC 纵切读取把 DOM 和应用数据固定在同一文档，且不触发写操作', async () => {
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api })
    const selected = { tabId: 7, windowId: 2, frameId: 0, documentId: 'doc-7',
      url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/', title: 'FC' }
    mocks.intakeTarget.mockResolvedValue(selected)
    const probe = { url: selected.url, supported: true, taskType: 'puzzle', challengeSet: { title: 'Marquee Matchups' } }
    const main = { url: selected.url, status: 'partial', group: { status: 'partial', sets: [] },
      inventory: { coverage: 'unread', cards: [] }, issues: [{ code: 'service-unavailable' }] }
    api.scripting.executeScript.mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-7', result: probe }])
      .mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-7', result: main }])
      .mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-7', result: probe }])

    await expect(runtime.handle({ type: 'dsh-assistant-fc-sbc-slice', mode: 'full-read', tabId: 7,
      expectedPage: selected })).resolves.toMatchObject({ ok: true, value: { page: selected, probe, main } })
    expect(api.scripting.executeScript).toHaveBeenCalledTimes(3)
    expect(api.scripting.executeScript).toHaveBeenNthCalledWith(1, expect.objectContaining({
      target: { tabId: 7, documentIds: ['doc-7'] }, world: 'ISOLATED',
    }))
    expect(api.scripting.executeScript).toHaveBeenNthCalledWith(2, expect.objectContaining({
      target: { tabId: 7, documentIds: ['doc-7'] }, world: 'MAIN',
    }))
    expect(api.scripting.executeScript).toHaveBeenNthCalledWith(3, expect.objectContaining({
      target: { tabId: 7, documentIds: ['doc-7'] }, world: 'ISOLATED',
    }))
    expect(mocks.sessionSubmit).not.toHaveBeenCalled()
    expect(mocks.connectionCall).not.toHaveBeenCalledWith('browser.execute', expect.anything())
  })

  test('固定标签重载后只读扫描采用同标签同 URL 的新文档，不修改 DSH 绑定', async () => {
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api })
    const oldPage = { tabId: 7, windowId: 2, frameId: 0, documentId: 'old-doc',
      url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/' }
    const currentPage = { ...oldPage, documentId: 'new-doc' }
    mocks.intakeTarget.mockResolvedValue(currentPage)
    const probe = { url: currentPage.url, supported: true, view: { kind: 'sbc-group' },
      challengeSet: { title: '重大比赛', challenges: [{ title: '首关', completed: false }] } }
    const main = { url: currentPage.url, status: 'partial', group: { status: 'partial', sets: [] },
      inventory: { coverage: 'unread', cards: [] }, issues: [] }
    api.scripting.executeScript.mockResolvedValueOnce([{ frameId: 0, documentId: 'new-doc', result: probe }])
      .mockResolvedValueOnce([{ frameId: 0, documentId: 'new-doc', result: main }])
      .mockResolvedValueOnce([{ frameId: 0, documentId: 'new-doc', result: probe }])

    await expect(runtime.handle({ type: 'dsh-assistant-fc-sbc-slice', mode: 'full-read', tabId: 7,
      expectedPage: oldPage })).resolves.toMatchObject({ ok: true, value: { page: currentPage, probe, main } })
    expect(mocks.intakeTarget).toHaveBeenCalledWith(7)
    expect(mocks.connectionCall).not.toHaveBeenCalledWith('session.target.bind', expect.anything())
  })

  test('FC SBC 纵切读取拒绝应用数据来自另一文档', async () => {
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api })
    const selected = { tabId: 7, frameId: 0, documentId: 'doc-7',
      url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/' }
    mocks.intakeTarget.mockResolvedValue(selected)
    api.scripting.executeScript.mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-7', result: {
      url: selected.url, supported: true, challengeSet: { title: 'Marquee Matchups' },
    } }]).mockResolvedValueOnce([{ frameId: 0, documentId: 'other-doc', result: { url: selected.url } }])

    await expect(runtime.handle({ type: 'dsh-assistant-fc-sbc-slice', mode: 'full-read', tabId: 7,
      expectedPage: selected })).rejects.toThrow('capture_target_changed')
  })

  test('FC SBC 同一文档内切换了任务组也拒绝过期读取', async () => {
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api })
    const selected = { tabId: 7, frameId: 0, documentId: 'doc-7',
      url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/' }
    mocks.intakeTarget.mockResolvedValue(selected)
    const before = { url: selected.url, supported: true, view: { kind: 'sbc-group' },
      challengeSet: { title: '重大比赛', challenges: [{ title: '首关' }] } }
    api.scripting.executeScript.mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-7', result: before }])
      .mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-7', result: { url: selected.url } }])
      .mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-7', result: {
        ...before, challengeSet: { title: '其他任务组', challenges: [{ title: '另一关' }] },
      } }])
    await expect(runtime.handle({ type: 'dsh-assistant-fc-sbc-slice', mode: 'full-read', tabId: 7,
      expectedPage: selected })).rejects.toThrow('sbc_view_changed')
  })

  test('FC SBC 原生化学复核仅对固定文档注入只读函数', async () => {
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api })
    const selected = { tabId: 7, frameId: 0, documentId: 'doc-7',
      url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/' }
    mocks.intakeTarget.mockResolvedValue(selected)
    const result = { url: selected.url, status: 'complete', issues: [], results: [] }
    const probe = { url: selected.url, view: { kind: 'sbc-group' },
      challengeSet: { title: '重大比赛', challenges: [{ title: '首关', completed: false }] } }
    const expectedView = { kind: 'sbc-group', title: '重大比赛', challenges: [{ title: '首关', completed: false }] }
    api.scripting.executeScript.mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-7', result: probe }])
      .mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-7', result }])
      .mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-7', result: probe }])
    const groups = [{ challengeId: 'one', formationName: 'f442', candidates: [] }]

    await expect(runtime.handle({ type: 'dsh-assistant-fc-sbc-evaluate-chemistry', tabId: 7,
      expectedPage: selected, expectedView, groups })).resolves.toMatchObject({ ok: true, value: { page: selected, verification: result } })
    expect(api.scripting.executeScript).toHaveBeenCalledTimes(3)
    expect(api.scripting.executeScript).toHaveBeenNthCalledWith(2, expect.objectContaining({
      target: { tabId: 7, documentIds: ['doc-7'] }, world: 'MAIN', args: [{ groups }],
    }))
    expect(mocks.sessionSubmit).not.toHaveBeenCalled()
  })

  test('FC SBC 原生化学复核时 SPA 切组会拒绝过期结果', async () => {
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api })
    const selected = { tabId: 7, frameId: 0, documentId: 'doc-7',
      url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/' }
    mocks.intakeTarget.mockResolvedValue(selected)
    const before = { url: selected.url, view: { kind: 'sbc-group' },
      challengeSet: { title: '重大比赛', challenges: [{ title: '首关', completed: false }] } }
    api.scripting.executeScript.mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-7', result: before }])
      .mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-7', result: { url: selected.url } }])
      .mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-7', result: { ...before,
        challengeSet: { title: '另一任务组', challenges: [{ title: '另一关', completed: false }] },
      } }])
    await expect(runtime.handle({ type: 'dsh-assistant-fc-sbc-evaluate-chemistry', tabId: 7,
      expectedPage: selected, expectedView: { kind: 'sbc-group', title: '重大比赛',
        challenges: [{ title: '首关', completed: false }] }, groups: [] })).rejects.toThrow('sbc_view_changed')
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
