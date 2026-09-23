/// <reference lib="es2024.promise" />
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
    intakeTarget: vi.fn(),
    sessionSubmit: vi.fn(),
    sessionModels: vi.fn(),
    sessionSelectModel: vi.fn(),
    sessionState: { binding: binding, phase: 'idle', pending: null, pendingCreate: null, records: [] as unknown[] },
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
vi.mock('../src/browser-context.js', () => ({ createBrowserContext: () => ({ candidates: async () => [], current: async () => null,
  describe: mocks.intakeDescribe, target: mocks.intakeTarget }) }))
vi.mock('../src/assistant-approval.js', () => ({ createAssistantApproval: () => ({ read: () => ({ sessionId: null, requests: [] }), sync: vi.fn(), setView: vi.fn(), decide: vi.fn() }) }))
vi.mock('../src/assistant-monitors.js', () => ({ createAssistantMonitors: () => ({ read: () => ({ monitors: [] }), restore: vi.fn(async () => {}), connectionChanged: vi.fn(async () => {}), sync: vi.fn(), create: vi.fn(), retry: vi.fn(), control: vi.fn(), find: vi.fn() }) }))
vi.mock('../src/assistant-activity.js', () => ({ createAssistantActivity: () => ({ read: () => ({}), restore: vi.fn(async () => {}), connectionChanged: vi.fn(async () => {}), policy: vi.fn(), enqueue: vi.fn(), flush: vi.fn(), configure: vi.fn(), retry: vi.fn(), sync: vi.fn(), query: vi.fn() }) }))
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
    mocks.sessionState.records = []
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

const atlasPage = { tabId: 8, frameId: 0, documentId: 'document-a', url: 'https://example.test/a' }
const deliveredObservation = (time = Date.now(), seq = 1, turn = 1, page = atlasPage) => [
  { type: 'event', event: { type: 'tool/call', seq, time, data: { turn, step: 0, callId: `read-${seq}`, name: 'browser_snapshot', arguments: '{}' } } },
  { type: 'event', event: { type: 'tool/result', seq: seq + 1, time, surfaceOp: 'append', sourceEventSeqs: [seq], data: {
    message: { source: { kind: 'tool', callId: `read-${seq}` }, content: [{ type: 'tool-result', toolCallId: `read-${seq}`, isError: false,
      content: [{ type: 'text', text: JSON.stringify({ sessionId: 'current-session', installationId: mocks.installationId,
        requestId: `read-request-${seq}`, outcome: 'observed', delivery: 'sent', value: { page, snapshotId: `snapshot-${seq}`,
          title: 'Article', text: 'Delivered article', elements: [{ elementId: 'open', role: 'link', label: 'Open', context: '' }],
          source: { version: 1, extractorVersion: 'browser-source-v1', blocks: [{ blockId: 'block-0', ordinal: 0,
            kind: 'paragraph', text: 'Delivered paragraph', truncated: false }], omissions: [] } } }) }] }] },
  } } },
]
const targetResult = () => ({ revision: 4, binding: { installationId: mocks.installationId, page: atlasPage } })
const locationMessage = (pageId: string, actionId?: string) => ({
  type: actionId ? 'dsh-assistant-cognition-reveal-action' : 'dsh-assistant-cognition-locate',
  pageId, ...(actionId ? { actionId } : {}), expectedSessionId: 'current-session', expectedTargetRevision: 4,
})
interface ReadingPage {
  id: string
  unplacedActions: Array<{ id: string }>
  sourceSnapshot: { current: boolean; readingBlockId: string | null; blocks: Array<{ text: string }> }
  semanticMap: { nodes: Array<{ summary: string }> }
  semanticFeedback: { entries: unknown[] }
}
const readingPage = (value: unknown): ReadingPage => value as ReadingPage

describe('page atlas runtime commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sessionState.binding = { baseUrl: 'http://127.0.0.1:3080', installationId: mocks.installationId, sessionId: 'current-session' }
    mocks.sessionState.records = deliveredObservation()
    mocks.intakeDescribe.mockResolvedValue({ tabId: 8, windowId: 3, url: atlasPage.url })
    mocks.connectionCall.mockImplementation(async method => method === 'session.target.read' ? targetResult() : {})
    mocks.sessionSubmit.mockResolvedValue({ accepted: true, requestId: 'refresh-1' })
    mocks.intakeTarget.mockResolvedValue({ tabId: 9, frameId: 0, documentId: 'document-b', url: 'https://example.test/b' })
  })

  test('human corrections are bound to a delivered map without mutating source evidence or asking the model', async () => {
    mocks.sessionState.records.push(
      { event: { type: 'tool/call', seq: 3, data: { callId: 'map-call', name: 'browser_publish_semantic_map' } } },
      { event: { type: 'tool/result', seq: 4, surfaceOp: 'append', sourceEventSeqs: [3], data: {
        message: { source: { kind: 'tool', callId: 'map-call' }, content: [{ type: 'tool-result', toolCallId: 'map-call', isError: false }] },
        meta: { semanticMap: { version: 1, mapId: 'map-a', installationId: mocks.installationId, page: atlasPage,
          snapshotId: 'snapshot-1', sourceResultSeq: 2, nodes: [{ nodeId: 'topic-a', parentId: null, label: 'AI 标题',
            summary: 'AI 概括', sourceRefs: ['block-0'], origin: 'ai-summary' }], unorganizedBlockIds: [] } },
      } } },
    )
    const api = chromeApi(), runtime = createAssistantRuntime({ chromeApi: api })
    await runtime.start(); mocks.connectionChanged?.(connected())
    const page = readingPage((await runtime.read('surface-a')).cognition.pages[0])
    const request = { type: 'dsh-assistant-semantic-feedback', expectedSessionId: 'current-session', pageId: page.id,
      mapId: 'map-a', nodeId: 'topic-a', action: 'edit', expectedRevision: 0, label: '修正后的标题', summary: '保留适用范围。' }
    await runtime.handle(request, 'surface-a')
    const updated = readingPage((await runtime.read('surface-a')).cognition.pages[0])
    expect(updated.semanticFeedback.entries).toMatchObject([{ mapId: 'map-a', nodeId: 'topic-a', label: '修正后的标题', sourceRefs: ['block-0'] }])
    expect(updated.semanticMap.nodes[0].summary).toBe('AI 概括')
    expect(updated.sourceSnapshot.blocks[0].text).toBe('Delivered paragraph')
    await expect(runtime.handle({ ...request, expectedRevision: 1, nodeId: 'invented' }, 'surface-a')).rejects.toThrow('semantic_feedback_unavailable')
    await expect(runtime.handle({ ...request, expectedSessionId: 'other-session' }, 'surface-a')).rejects.toThrow('session_changed')
    expect(mocks.sessionSubmit).not.toHaveBeenCalled()
    expect(api.scripting.executeScript).not.toHaveBeenCalled()
  })

  test('source navigation requires exact document and an independently matched source text', async () => {
    mocks.sessionState.records = deliveredObservation(Date.now() - 90_000)
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api }); mocks.connectionChanged?.(connected())
    const page = readingPage((await runtime.read('surface-a')).cognition.pages[0])
    const message = { ...locationMessage(page.id), type: 'dsh-assistant-cognition-reveal-source', blockId: 'block-0' }
    api.scripting.executeScript.mockResolvedValue([{ documentId: atlasPage.documentId, frameId: 0,
      result: { ok: true, blockId: 'block-0', text: 'Delivered paragraph' } }])
    await runtime.handle(message, 'surface-a')
    expect(api.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
      args: [{ snapshotId: 'snapshot-1', blockId: 'block-0', url: atlasPage.url }],
    }))
    api.scripting.executeScript.mockResolvedValue([{ documentId: atlasPage.documentId, frameId: 0,
      result: { ok: true, blockId: 'block-0', text: 'Another paragraph' } }])
    await expect(runtime.handle(message, 'surface-a')).rejects.toThrow('source_changed')
    await expect(runtime.handle({ ...message, blockId: 'invented' }, 'surface-a')).rejects.toThrow('cognition_location_unavailable')
    expect(mocks.sessionSubmit).not.toHaveBeenCalled()
  })

  test('locates a source captured after same-tab navigation without rebinding the old document', async () => {
    const observedAt = Date.now()
    const navigatedPage = { ...atlasPage, documentId: 'document-b', url: 'https://example.test/b' }
    mocks.sessionState.records = deliveredObservation(observedAt, 1, 1, navigatedPage)
    mocks.connectionCall.mockImplementation(async method => method === 'session.target.read'
      ? { revision: 4, binding: { installationId: mocks.installationId, page: atlasPage, boundAt: observedAt - 1000 } } : {})
    mocks.intakeDescribe.mockResolvedValue({ tabId: 8, windowId: 3, url: navigatedPage.url })
    const api = chromeApi(), runtime = createAssistantRuntime({ chromeApi: api }); mocks.connectionChanged?.(connected())
    const page = readingPage((await runtime.read('surface-a')).cognition.pages[0])
    api.scripting.executeScript.mockResolvedValue([{ documentId: navigatedPage.documentId, frameId: 0,
      result: { ok: true, blockId: 'block-0', text: 'Delivered paragraph' } }])
    await runtime.handle({ ...locationMessage(page.id), type: 'dsh-assistant-cognition-reveal-source', blockId: 'block-0' }, 'surface-a')
    expect(api.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 8, documentIds: ['document-b'] },
      args: [{ snapshotId: 'snapshot-1', blockId: 'block-0', url: navigatedPage.url }],
    }))
  })

  test('rejects an older document observation after a later target binding', async () => {
    const observedAt = Date.now() - 1000
    const oldPage = { ...atlasPage, documentId: 'document-b', url: 'https://example.test/b' }
    mocks.sessionState.records = deliveredObservation(observedAt, 1, 1, oldPage)
    mocks.connectionCall.mockImplementation(async method => method === 'session.target.read'
      ? { revision: 4, binding: { installationId: mocks.installationId, page: atlasPage, boundAt: observedAt + 500 } } : {})
    const api = chromeApi(), runtime = createAssistantRuntime({ chromeApi: api }); mocks.connectionChanged?.(connected())
    const page = readingPage((await runtime.read('surface-a')).cognition.pages[0])
    await expect(runtime.handle({ ...locationMessage(page.id), type: 'dsh-assistant-cognition-reveal-source', blockId: 'block-0' }, 'surface-a'))
      .rejects.toThrow('cognition_location_unavailable')
    expect(api.scripting.executeScript).not.toHaveBeenCalled()
  })

  test('semantic generation queues one bounded source-read and publish request on the pinned target', async () => {
    const runtime = createAssistantRuntime({ chromeApi: chromeApi() }); mocks.connectionChanged?.(connected())
    const message = { type: 'dsh-assistant-cognition-generate', expectedSessionId: 'current-session', expectedTargetRevision: 4 }
    await runtime.handle(message, 'surface-a'); await runtime.handle(message, 'surface-a')
    expect(mocks.sessionSubmit).toHaveBeenCalledOnce()
    expect(mocks.sessionSubmit).toHaveBeenCalledWith(expect.objectContaining({ content: [expect.objectContaining({
      // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher.
      text: expect.stringContaining('browser_publish_semantic_map'),
    })] }))
    expect(mocks.sessionSubmit).toHaveBeenCalledWith(expect.objectContaining({ content: [expect.objectContaining({
      // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher.
      text: expect.stringMatching(/^\[DSH_SEMANTIC_MAP_READ_ONLY_V1\]\n请为当前固定目标网页/u),
    })] }))
    expect(mocks.sessionSubmit).toHaveBeenCalledWith(expect.objectContaining({ content: [expect.objectContaining({
      // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher.
      text: expect.stringContaining('并列列表项和表格行应保持独立及原有顺序'),
    })] }))
    mocks.sessionState.records.push(
      { type: 'event', event: { type: 'turn/start', seq: 10, time: Date.now(), data: { turn: 2 } } },
      { type: 'event', event: { type: 'user/message', seq: 11, time: Date.now(), data: { source: { kind: 'user', rpcId: 'refresh-1' } } } },
      ...deliveredObservation(Date.now(), 12, 2),
    )
    expect((await runtime.read('surface-a')).cognition.refresh.status).toBe('waiting')
  })

  test('reading position is scoped to the source document and relevant mutation invalidates location without inference', async () => {
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api }); mocks.connectionChanged?.(connected())
    runtime.sourcePosition({ page: { ...atlasPage, documentId: 'other-document' }, snapshotId: 'snapshot-1', blockId: 'block-0', invalidated: true })
    expect(readingPage((await runtime.read('surface-a')).cognition.pages[0]).sourceSnapshot.current).toBe(true)
    runtime.sourcePosition({ page: atlasPage, snapshotId: 'snapshot-1', blockId: 'block-0' })
    expect(readingPage((await runtime.read('surface-a')).cognition.pages[0]).sourceSnapshot.readingBlockId).toBe('block-0')
    runtime.sourcePosition({ page: atlasPage, snapshotId: 'snapshot-1', blockId: 'block-0', invalidated: true })
    const page = readingPage((await runtime.read('surface-a')).cognition.pages[0])
    expect(page.sourceSnapshot.current).toBe(false)
    await expect(runtime.handle({ ...locationMessage(page.id), type: 'dsh-assistant-cognition-reveal-source', blockId: 'block-0' }, 'surface-a'))
      .rejects.toThrow('cognition_location_unavailable')
    expect(mocks.sessionSubmit).not.toHaveBeenCalled()
    expect(api.scripting.executeScript).not.toHaveBeenCalled()
  })

  test('locates an action from delivered evidence on the pinned document, without executing its website action', async () => {
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api }); mocks.connectionChanged?.(connected())
    const state = await runtime.read('surface-a')
    const page = readingPage(state.cognition.pages[0])
    const action = page.unplacedActions[0]
    api.scripting.executeScript.mockResolvedValue([{ documentId: atlasPage.documentId, frameId: 0, result: { ok: true } }])
    await runtime.handle(locationMessage(page.id, action.id), 'surface-a')
    expect(api.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 8, documentIds: ['document-a'] },
      args: [{ snapshotId: 'snapshot-1', elementId: 'open', url: atlasPage.url }],
    }))
    expect(api.tabs.update).toHaveBeenCalledWith(8, { active: true })
    expect(mocks.sessionSubmit).not.toHaveBeenCalled()
  })

  test('rejects stale Session, target revision and invented action identifiers before page access', async () => {
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api }); mocks.connectionChanged?.(connected())
    const page = readingPage((await runtime.read('surface-a')).cognition.pages[0])
    const message = locationMessage(page.id, page.unplacedActions[0].id)
    await expect(runtime.handle({ ...message, expectedSessionId: 'other-session' }, 'surface-a')).rejects.toThrow('session_changed')
    await expect(runtime.handle({ ...message, expectedTargetRevision: 3 }, 'surface-a')).rejects.toThrow('target_changed')
    await expect(runtime.handle({ ...message, actionId: 'invented' }, 'surface-a')).rejects.toThrow('cognition_location_unavailable')
    expect(api.scripting.executeScript).not.toHaveBeenCalled()
    expect(api.tabs.update).not.toHaveBeenCalled()
  })

  test('rechecks Session binding after asynchronous target inspection', async () => {
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api }); mocks.connectionChanged?.(connected())
    const page = readingPage((await runtime.read('surface-a')).cognition.pages[0])
    mocks.connectionCall.mockImplementation(async () => {
      mocks.sessionState.binding = { ...mocks.sessionState.binding, sessionId: 'new-session' }
      return targetResult()
    })
    await expect(runtime.handle(locationMessage(page.id), 'surface-a')).rejects.toThrow('session_changed')
    expect(api.tabs.update).not.toHaveBeenCalled()
  })

  test('keeps cached facts but rejects expired element references and provider eviction without rereading', async () => {
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api }); mocks.connectionChanged?.(connected())
    const page = readingPage((await runtime.read('surface-a')).cognition.pages[0])
    const message = locationMessage(page.id, page.unplacedActions[0].id)
    mocks.sessionState.records = deliveredObservation(Date.now() - 61_000)
    await expect(runtime.handle(message, 'surface-a')).rejects.toThrow('cognition_location_unavailable')
    api.scripting.executeScript.mockResolvedValue([])
    await expect(runtime.handle(locationMessage(page.id), 'surface-a')).rejects.toThrow('cognition_location_unavailable')
    expect(api.scripting.executeScript).not.toHaveBeenCalled()
    mocks.sessionState.records = deliveredObservation()
    api.scripting.executeScript.mockResolvedValue([{ documentId: 'document-a', frameId: 0, result: { ok: false, reason: 'stale_element' } }])
    await expect(runtime.handle(message, 'surface-a')).rejects.toThrow('stale_element')
    expect(api.tabs.update).not.toHaveBeenCalled()
    expect(mocks.sessionSubmit).not.toHaveBeenCalled()
  })

  test('coalesces repeated refresh clicks and exposes waiting state without changing delivered facts', async () => {
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api }); mocks.connectionChanged?.(connected())
    const submitted = Promise.withResolvers<undefined>()
    const accepted = Promise.withResolvers<{ accepted: boolean; requestId: string }>()
    mocks.sessionSubmit.mockImplementation(() => { submitted.resolve(undefined); return accepted.promise })
    const message = { type: 'dsh-assistant-cognition-refresh', expectedSessionId: 'current-session', expectedTargetRevision: 4 }
    const first = runtime.handle(message, 'surface-a')
    await submitted.promise
    const second = runtime.handle(message, 'surface-a')
    const during = await runtime.read('surface-a')
    expect(during.cognition.refresh.status).toBe('submitting')
    expect(during.cognition.pages).toHaveLength(1)
    accepted.resolve({ accepted: true, requestId: 'refresh-1' })
    await Promise.all([first, second])
    const waiting = await runtime.read('surface-a')
    expect(waiting.cognition.refresh.status).toBe('waiting')
    await runtime.handle(message, 'surface-a')
    expect(mocks.sessionSubmit).toHaveBeenCalledTimes(1)
    expect(api.scripting.executeScript).not.toHaveBeenCalled()
    mocks.sessionState.records = [...deliveredObservation(),
      { type: 'event', event: { seq: 3, type: 'turn/start', data: { turn: 2 } } },
      { type: 'event', event: { seq: 4, type: 'user/message', data: { role: 'user', source: { kind: 'user', rpcId: 'refresh-1' }, content: [] } } },
      ...deliveredObservation(Date.now(), 5, 2)]
    expect((await runtime.read('surface-a')).cognition.refresh.status).toBe('complete')
  })

  test('refresh completion without an observation reports no new evidence', async () => {
    const runtime = createAssistantRuntime({ chromeApi: chromeApi() }); mocks.connectionChanged?.(connected())
    await runtime.handle({ type: 'dsh-assistant-cognition-refresh', expectedSessionId: 'current-session', expectedTargetRevision: 4 }, 'surface-a')
    mocks.sessionState.records.push(
      { type: 'event', event: { type: 'turn/start', seq: 3, data: { turn: 2 } } },
      { type: 'event', event: { type: 'user/message', seq: 4, data: { role: 'user', source: { kind: 'user', rpcId: 'refresh-1' }, content: [] } } },
      { type: 'event', event: { type: 'turn/end', seq: 5, data: { turn: 2 } } },
    )
    expect((await runtime.read('surface-a')).cognition.refresh.status).toBe('no-new-evidence')
  })

  test('a different target or later turn cannot complete the requested refresh', async () => {
    const runtime = createAssistantRuntime({ chromeApi: chromeApi() }); mocks.connectionChanged?.(connected())
    await runtime.handle({ type: 'dsh-assistant-cognition-refresh', expectedSessionId: 'current-session', expectedTargetRevision: 4 }, 'surface-a')
    mocks.sessionState.records.push(
      { type: 'event', event: { type: 'turn/start', seq: 3, data: { turn: 2 } } },
      { type: 'event', event: { type: 'user/message', seq: 4, data: { role: 'user', source: { kind: 'user', rpcId: 'refresh-1' }, content: [] } } },
      ...deliveredObservation(Date.now(), 5, 2, { ...atlasPage, tabId: 9, documentId: 'other-document' }),
    )
    expect((await runtime.read('surface-a')).cognition.refresh.status).toBe('waiting')
    mocks.sessionState.records.push(
      { type: 'event', event: { type: 'turn/end', seq: 7, data: { turn: 2 } } },
      { type: 'event', event: { type: 'turn/start', seq: 8, data: { turn: 3 } } },
      ...deliveredObservation(Date.now(), 9, 3),
    )
    expect((await runtime.read('surface-a')).cognition.refresh.status).toBe('no-new-evidence')
  })

  test('associates a queued inbox splice with the turn that starts immediately after it', async () => {
    const runtime = createAssistantRuntime({ chromeApi: chromeApi() }); mocks.connectionChanged?.(connected())
    await runtime.handle({ type: 'dsh-assistant-cognition-refresh', expectedSessionId: 'current-session', expectedTargetRevision: 4 }, 'surface-a')
    mocks.sessionState.records.push(
      { type: 'event', event: { type: 'agent/inbox/spliced', seq: 3, data: { target: 'next-turn', inserted: [{ source: { kind: 'user', rpcId: 'refresh-1' } }] } } },
      { type: 'event', event: { type: 'turn/start', seq: 4, data: { turn: 2 } } },
      ...deliveredObservation(Date.now(), 5, 2),
      { type: 'event', event: { type: 'turn/end', seq: 7, data: { turn: 2 } } },
    )
    expect((await runtime.read('surface-a')).cognition.refresh.status).toBe('complete')
  })

  test('does not attribute a next-turn refresh to the turn that was already running', async () => {
    const runtime = createAssistantRuntime({ chromeApi: chromeApi() }); mocks.connectionChanged?.(connected())
    mocks.sessionState.records = [
      { type: 'event', event: { type: 'turn/start', seq: 1, data: { turn: 1 } } },
      ...deliveredObservation(Date.now(), 2, 1),
    ]
    await runtime.handle({ type: 'dsh-assistant-cognition-refresh', expectedSessionId: 'current-session', expectedTargetRevision: 4 }, 'surface-a')
    mocks.sessionState.records.push(
      { type: 'event', event: { type: 'agent/inbox/spliced', seq: 4, data: { target: 'next-turn', inserted: [{ source: { kind: 'user', rpcId: 'refresh-1' } }] } } },
      ...deliveredObservation(Date.now(), 5, 1),
      { type: 'event', event: { type: 'turn/end', seq: 7, data: { turn: 1 } } },
    )
    expect((await runtime.read('surface-a')).cognition.refresh.status).toBe('waiting')
    mocks.sessionState.records.push(
      { type: 'event', event: { type: 'turn/start', seq: 8, data: { turn: 2 } } },
      ...deliveredObservation(Date.now(), 9, 2),
    )
    expect((await runtime.read('surface-a')).cognition.refresh.status).toBe('complete')
  })

  test('does not focus the old tab when the pinned target changes while reveal is pending', async () => {
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api }); mocks.connectionChanged?.(connected())
    let target = targetResult()
    mocks.connectionCall.mockImplementation(async method => method === 'session.target.read' ? target : {})
    const page = readingPage((await runtime.read('surface-a')).cognition.pages[0])
    const script = Promise.withResolvers<Array<{ documentId: string; frameId: number; result: { ok: boolean } }>>()
    api.scripting.executeScript.mockReturnValue(script.promise)
    const locating = runtime.handle(locationMessage(page.id, page.unplacedActions[0].id), 'surface-a')
    await vi.waitFor(() => { expect(api.scripting.executeScript).toHaveBeenCalledOnce() })
    target = { revision: 5, binding: { installationId: mocks.installationId,
      page: { ...atlasPage, tabId: 9, documentId: 'document-b', url: 'https://example.test/b' } } }
    script.resolve([{ documentId: atlasPage.documentId, frameId: 0, result: { ok: true } }])
    await expect(locating).rejects.toThrow('target_changed')
    expect(api.tabs.update).not.toHaveBeenCalled()
  })

  test('serializes target rebinding behind an in-flight reveal across assistant surfaces', async () => {
    const api = chromeApi(); const runtime = createAssistantRuntime({ chromeApi: api }); mocks.connectionChanged?.(connected())
    const page = readingPage((await runtime.read('surface-a')).cognition.pages[0])
    const script = Promise.withResolvers<Array<{ documentId: string; frameId: number; result: { ok: boolean } }>>()
    api.scripting.executeScript.mockReturnValue(script.promise)
    const locating = runtime.handle(locationMessage(page.id, page.unplacedActions[0].id), 'surface-a')
    await vi.waitFor(() => { expect(api.scripting.executeScript).toHaveBeenCalledOnce() })
    const binding = runtime.handle({ type: 'dsh-assistant-target-bind', expectedRevision: 4, tabId: 9 }, 'surface-b')
    await Promise.resolve()
    expect(mocks.connectionCall.mock.calls.some(call => call[0] === 'session.target.bind')).toBe(false)
    script.resolve([{ documentId: atlasPage.documentId, frameId: 0, result: { ok: true } }])
    await Promise.all([locating, binding])
    expect(mocks.connectionCall).toHaveBeenCalledWith('session.target.bind', { sessionId: 'current-session', expectedRevision: 4,
      page: { tabId: 9, frameId: 0, documentId: 'document-b', url: 'https://example.test/b' } })
  })
})
