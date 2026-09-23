/// <reference types="node" />
/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import rawMarkup from '../sidebar.html?raw'
import { projectAssistantCognition } from '../src/assistant-cognition.js'
import { atlasPageFixtures } from './fixtures/assistant-atlas.js'

const markup: unknown = rawMarkup
const styles = readFileSync(resolve(import.meta.dirname, '../src/sidebar.css'), 'utf8')
if (typeof markup !== 'string' || typeof styles !== 'string') throw new Error('Expected sidebar source text')

const baseState = (overrides = {}) => ({
  assistantV2: {
    surface: { id: 'surface-1' },
    connection: { baseUrl: 'http://127.0.0.1:3080', phase: 'connected' },
    session: { binding: null, phase: 'idle', pending: null, pendingCreate: null, modelSelection: null, transcript: [] },
    target: { availability: 'ready', revision: 0, selected: null, candidates: [] },
    cognition: { status: 'unread', items: [], refreshPolicy: 'manual-or-agent-request' },
    functions: { availability: 'unavailable', items: [] },
  },
  ...overrides,
})
const modelCatalog = () => ({
  default: { provider: 'deepseek', model: 'chat', reasoningEffort: 'medium' },
  routableProviders: ['deepseek', 'openai'],
  groups: [
    { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'DeepSeek Chat',
      reasoning: { efforts: [{ id: 'low', name: '低' }, { id: 'medium', name: '中' }], defaultEffort: 'medium' } }] },
    { id: 'openai', name: 'OpenAI', models: [{ id: 'reasoner', name: 'Reasoner',
      reasoning: { efforts: [{ id: 'low', name: '轻量' }, { id: 'high', name: '深入' }], defaultEffort: 'high' } }] },
  ],
  failures: [],
})
const load = async (current: unknown = baseState(), reply?: (message: Record<string, unknown>) => unknown) => {
  document.body.innerHTML = markup
  const messages: Record<string, unknown>[] = []
  const wireMessages: Record<string, unknown>[] = []
  const listener = vi.fn<(callback: (message: { type: string }) => void) => void>()
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async (message: Record<string, unknown>) => {
    wireMessages.push(message)
    const { surfaceId: _surfaceId, ...semanticMessage } = message
    messages.push(semanticMessage); return reply?.(message) ?? { ok: true, state: current }
  }), onMessage: { addListener: listener } }, permissions: { request: vi.fn(async () => true) } })
  await import('../src/sidebar.js'); await Promise.resolve(); await Promise.resolve()
  return { messages, wireMessages, listener }
}
const element = (selector: string): HTMLElement => {
  const result = document.querySelector<HTMLElement>(selector)
  if (!result) throw new Error(`Missing fixture element: ${selector}`)
  return result
}
const projectedAtlasPage = (shape: object, addDefaults = true) => {
  const value = { page: { tabId: 9, frameId: 0, documentId: 'atlas-doc', url: 'https://example.test/atlas' }, snapshotId: 'atlas-snapshot', elements: [{ elementId: 'atlas-action', role: 'button', label: '定位', context: '主要区域' }], ...shape,
    ...(addDefaults ? { structure: { ...(shape as { structure?: object }).structure, regions: [{ role: 'main', label: '主要区域', text: '已送达内容', bounds: { x: 0, y: 0, width: 1, height: 1 }, importance: 'high' }] } } : {}) }
  const records = [
    { type: 'event', event: { type: 'tool/call', seq: 1, time: 10, data: { callId: 'atlas', name: 'browser_snapshot', arguments: '{}' } } },
    { type: 'event', event: { type: 'tool/result', seq: 2, time: 20, surfaceOp: 'append', sourceEventSeqs: [1], data: { message: { source: { callId: 'atlas' }, content: [{ type: 'tool-result', toolCallId: 'atlas', isError: false, content: [{ type: 'text', text: JSON.stringify({ sessionId: 'session-v2', requestId: 'request-atlas', installationId: 'install', outcome: 'observed', delivery: 'sent', value }) }] }] } } } },
  ]
  return projectAssistantCognition({ sessionId: 'session-v2', now: 30, records }).pages[0] as {
    id: string
    target: { page: { tabId: number; frameId: number; documentId: string; url: string } }
  }
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); document.body.replaceChildren() })

describe('DSH 浏览器助手 V2 侧栏', () => {
  test('语义缩放依次显示主题、重点和原文，返回保留焦点且展开不调用模型', async () => {
    const page = { ...projectedAtlasPage({ title: '缓存试验' }), sourceSnapshot: { snapshotId: 'snapshot-a', current: true, omissions: ['仅取得正文片段'], blocks: [
      { blockId: 'block-0', kind: 'paragraph', text: '在三种模板中，平均时间缩短约 14%；其他页面未验证。', truncated: false },
      { blockId: 'block-1', kind: 'paragraph', text: '独立保留的其他内容。', truncated: false },
    ] }, semanticMap: { mapId: 'map-a', nodes: [
      { nodeId: 'topic', parentId: null, label: '缓存的收益与适用范围', summary: '收益只在有限模板中观察到。', sourceRefs: ['block-0'], origin: 'ai-summary' },
      { nodeId: 'detail', parentId: 'topic', label: '实验范围与限制', summary: '三种模板的平均改善约为 14%，不能推及所有页面。', sourceRefs: ['block-0'], origin: 'ai-summary' },
    ], unorganizedBlockIds: ['block-1'] } }
    const fixture = await load(baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 4, selected: page.target.page }, cognition: { status: 'ready', pages: [page] } } }))
    element('[data-view="cognition"]').click()
    const sentBefore = fixture.messages.length
    expect(element('.semantic-overview').textContent).toContain('缓存的收益与适用范围')
    expect(element('.semantic-overview').textContent).not.toContain('在三种模板中，平均时间')
    element('[data-semantic-node="topic"]').click()
    expect(element('.semantic-focus').textContent).toContain('实验范围与限制')
    element('[data-source-ref="block-0"]').click()
    expect(element('.semantic-source').textContent).toContain('在三种模板中，平均时间缩短约 14%；其他页面未验证。')
    element('[data-semantic-back]').click()
    expect(element('.semantic-focus').textContent).toContain('实验范围与限制')
    expect(fixture.messages).toHaveLength(sentBefore)
    const update = fixture.listener.mock.calls[0][0]
    update({ type: 'dsh-state-changed' }); await Promise.resolve(); await Promise.resolve()
    expect(document.activeElement).toBe(element('[data-source-ref="block-0"]'))
    element('[data-source-ref="block-0"]').click()
    element('[data-source-locate="block-0"]').click(); await Promise.resolve()
    expect(fixture.messages).toContainEqual(expect.objectContaining({ type: 'dsh-assistant-cognition-reveal-source', blockId: 'block-0', pageId: page.id }))
  })

  test('同一标签刷新后，新文档来源仍可定位', async () => {
    const page = { ...projectedAtlasPage({ title: '刷新后的文章' }), sourceSnapshot: {
      snapshotId: 'snapshot-b', current: true, omissions: [], blocks: [
        { blockId: 'block-0', kind: 'paragraph', text: '刷新后的原文。', truncated: false },
      ] } }
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 4, selected: { ...page.target.page,
        documentId: 'bound-document', boundAt: 10, liveUrl: page.target.page.url, status: 'selected-document' } },
      cognition: { status: 'ready', pages: [page] },
    } })
    const fixture = await load(current)
    element('[data-view="cognition"]').click()
    element('.semantic-unorganized').click()
    element('[data-source-ref="block-0"]').click()
    const locate = element('[data-source-locate="block-0"]') as HTMLButtonElement
    expect(locate.disabled).toBe(false)
    locate.click(); await Promise.resolve()
    expect(fixture.messages).toContainEqual(expect.objectContaining({ type: 'dsh-assistant-cognition-reveal-source', pageId: page.id,
      blockId: 'block-0', snapshotId: 'snapshot-b' }))
  })
  test('缺少区域几何时仍直接展示已读正文和遗漏，不让标签空框占据地图', async () => {
    const page = projectedAtlasPage({ title: 'Popular players', text: 'Kylian Mbappé · 91 · ST\nAitana Bonmatí · 91 · CM', textTruncated: true,
      structure: { regions: [{ kind: 'header' }, { kind: 'nav' }, { kind: 'main' }, { kind: 'main' }, { kind: 'footer' }] } }, false)
    await load(baseState({ assistantV2: { ...baseState().assistantV2, cognition: { status: 'ready', pages: [page] } } }))
    element('[data-view="cognition"]').click()
    expect(element('.atlas-map').textContent).toContain('Kylian Mbappé')
    expect(element('.atlas-map').textContent).toContain('Aitana Bonmatí')
    expect(element('.atlas-gaps').textContent).toContain('正文超出本次读取范围')
    expect([...document.querySelectorAll('[data-atlas-region-id]')].some(node => node.textContent === 'main')).toBe(false)
  })

  test('未取得来源块时保留已读结构内容，并给出显式语义生成入口', async () => {
    const page = { ...projectedAtlasPage({ title: '旧快照', text: '已读取的内容仍然应当可以看到。' }, false),
      sourceSnapshot: { snapshotId: 'empty-source', blocks: [], current: true, omissions: ['未取得可回源的正文块'] } }
    const fixture = await load(baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 4, selected: page.target.page }, cognition: { status: 'ready', pages: [page] } } }))
    element('[data-view="cognition"]').click()
    expect(element('.atlas-map').textContent).toContain('已读取的内容仍然应当可以看到。')
    element('.semantic-generate').click(); await Promise.resolve()
    expect(fixture.messages).toContainEqual(expect.objectContaining({ type: 'dsh-assistant-cognition-generate' }))
  })

  test('集合直接显示成员，选中内容保留键盘焦点且不把全页控件冒充区域操作', async () => {
    const page = projectedAtlasPage({ title: 'Reading list', elements: [{ elementId: 'account', label: 'My account', role: 'button' }],
      structure: { collections: [{ kind: 'list', itemCount: 2, items: [{ index: 0, text: 'Designing Data-Intensive Applications' }, { index: 1, text: 'A Philosophy of Software Design' }] }] } }, false)
    await load(baseState({ assistantV2: { ...baseState().assistantV2, cognition: { status: 'ready', pages: [page] } } }))
    element('[data-view="cognition"]').click()
    expect(element('.atlas-map').textContent).toContain('Designing Data-Intensive Applications')
    const region = element('[data-atlas-region-id]'); region.focus(); region.click()
    expect(document.activeElement).toBe(region)
    expect(element('.atlas-inspector').textContent).toContain('A Philosophy of Software Design')
    expect(element('.atlas-inspector').textContent).not.toContain('My account')
    expect(element('.atlas-page-actions').textContent).toContain('My account')
  })

  test('worker 尚未返回时也先提供可操作的连接与设置入口', async () => {
    await load(baseState(), message => message.type === 'dsh-assistant-state'
      ? new Promise(() => {})
      : { ok: true, state: baseState() })
    expect(element('#connection-panel').textContent).toContain('连接本机 DSH')
    element('#show-settings').click()
    expect(element('#settings').hidden).toBe(false)
  })

  test('每条 worker 消息都携带当前侧栏自己的稳定身份', async () => {
    const fixture = await load()
    expect(fixture.wireMessages[0]?.type).toBe('dsh-assistant-state')
    expect(String(fixture.wireMessages[0]?.surfaceId)).toMatch(/^surface-[0-9a-f-]{36}$/u)
  })

  test('连接恢复并成功刷新状态后清除先前的瞬时错误', async () => {
    const fixture = await load()
    const notify = fixture.listener.mock.calls[0]?.[0] as ((message: { type: string; error?: string }) => void) | undefined
    if (!notify) throw new Error('Expected worker message listener')

    notify({ type: 'dsh-assistant-error', error: 'network_error' })
    expect(element('#notice').textContent).toBe('网络请求失败，请检查 DSH 服务后重试。')
    expect(element('#notice').hidden).toBe(false)

    notify({ type: 'dsh-state-changed' })
    await vi.waitFor(() => { expect(element('#notice').hidden).toBe(true) })
    expect(element('#notice').textContent).toBe('')
  })

  test('网络异常使用用户可理解的提示而不是内部错误码', async () => {
    const fixture = await load()
    const notify = fixture.listener.mock.calls[0]?.[0] as ((message: { type: string; error?: string }) => void) | undefined
    if (!notify) throw new Error('Expected worker message listener')

    notify({ type: 'dsh-assistant-error', error: 'network_error' })
    expect(element('#notice').textContent).toBe('网络请求失败，请检查 DSH 服务后重试。')
  })

  test('首页不创建会话，主导航只保留对话、页面认知和功能', async () => {
    const fixture = await load()
    expect(document.body.textContent).toContain('今天，想做点什么')
    expect(document.body.textContent).toContain('页面认知')
    expect(document.body.textContent).toContain('功能')
    expect(document.body.textContent).not.toContain('监控')
    expect(document.body.textContent).not.toContain('独立阅读')
    expect(fixture.messages).not.toContainEqual(expect.objectContaining({ type: 'dsh-assistant-session-create' }))
  })

  test('用户显式选择新对话或继续对话，继续项绑定选中的会话', async () => {
    const fixture = await load(baseState(), message => message.type === 'dsh-assistant-session-list'
      ? { ok: true, value: { items: [{ sessionId: 'session-old', projections: { values: { title: '之前的讨论' } } }] } }
      : { ok: true, state: baseState() })
    element('#new-session').click(); element('#session-picker').click(); await vi.waitFor(() => { expect(document.querySelector('#session-menu button')).not.toBeNull() })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-session-create' })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-session-list' })
    element('#session-menu button').click(); await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-session-bind', sessionId: 'session-old' })
  })

  test('进入会话后仍由用户显式选择新对话或切换对话', async () => {
    const current = baseState({ assistantV2: { ...baseState().assistantV2, session: {
      ...baseState().assistantV2.session,
      binding: { baseUrl: 'http://127.0.0.1:3080', installationId: 'install', sessionId: 'session-current' },
      transcript: [{ key: 'user:1', role: 'user', text: '当前讨论', images: [] }],
    } } })
    const fixture = await load(current, message => message.type === 'dsh-assistant-session-list'
      ? { ok: true, value: { items: [{ sessionId: 'session-other', projections: { values: { title: '另一个讨论' } } }] } }
      : { ok: true, state: current })

    expect(element('#session-controls').hidden).toBe(false)
    element('#session-new').click(); element('#session-switch').click()
    await vi.waitFor(() => { expect(document.querySelector('#session-switch-menu button')).not.toBeNull() })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-session-create' })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-session-list' })
    element('#session-switch-menu button').click(); await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-session-bind', sessionId: 'session-other' })
  })

  test('同一侧栏按会话隔离文字和图片草稿，切回原会话完整恢复', async () => {
    class ClipboardReader { result: string | null = null; onload: (() => void) | null = null; readAsDataURL(): void { this.result = 'data:image/png;base64,AQ=='; this.onload?.() } }
    vi.stubGlobal('FileReader', ClipboardReader)
    const stateFor = (sessionId: string) => baseState({ assistantV2: { ...baseState().assistantV2, session: {
      ...baseState().assistantV2.session, binding: { baseUrl: 'http://127.0.0.1:3080', installationId: 'install', sessionId }, transcript: [],
    } } })
    let current = stateFor('session-a')
    await load(current, (message) => {
      if (message.type === 'dsh-assistant-session-list') { const other = current.assistantV2.session.binding.sessionId === 'session-a' ? 'session-b' : 'session-a'; return { ok: true, value: { items: [{ sessionId: other, projections: { values: { title: other } } }] } } }
      if (message.type === 'dsh-assistant-session-bind') { current = stateFor(String(message.sessionId)); return { ok: true, state: current } }
      return { ok: true, state: current }
    })
    const composer = element('#composer') as HTMLTextAreaElement; composer.value = 'A 的草稿'
    const image = new File([Uint8Array.of(1)], 'a.png', { type: 'image/png' }); const paste = new Event('paste', { bubbles: true, cancelable: true }); Object.defineProperty(paste, 'clipboardData', { value: { items: [{ kind: 'file', getAsFile: () => image }] } }); composer.dispatchEvent(paste)
    await vi.waitFor(() =>{  expect(document.querySelector('#draft-images img')).not.toBeNull() })
    element('#session-switch').click(); await vi.waitFor(() =>{  expect(document.querySelector('#session-switch-menu button')).not.toBeNull() }); (element('#session-switch-menu button') as HTMLButtonElement).click(); await vi.waitFor(() =>{  expect(composer.value).toBe('') })
    composer.value = 'B 的草稿'
    element('#session-switch').click(); await vi.waitFor(() =>{  expect(element('#session-switch-menu button').textContent).toContain('session-a') }); (element('#session-switch-menu button') as HTMLButtonElement).click()
    await vi.waitFor(() =>{  expect(composer.value).toBe('A 的草稿') })
    expect(element('#draft-images img').getAttribute('alt')).toBe('a.png')
  })

  test('会话发送保留附件并携带当前绑定的 expectedSessionId', async () => {
    const current = baseState({ assistantV2: { ...baseState().assistantV2, session: {
      binding: { baseUrl: 'http://127.0.0.1:3080', installationId: 'install', sessionId: 'session-v2' }, phase: 'live', pending: null, pendingCreate: null, modelSelection: { next: { model: 'deepseek-v4.1-flash' } }, transcript: [],
    } } })
    const fixture = await load(current)
    ;(element('#composer') as HTMLTextAreaElement).value = '继续处理'
    element('#send-queue').click(); await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-session-submit', text: '继续处理', mode: 'queue', expectedSessionId: 'session-v2', expectedTargetRevision: 0 })
    expect(element('#model-selection').textContent).toContain('deepseek-v4.1-flash')
  })

  test('模型弹层按 provider 分组，只显示模型声明的强度并把默认强度用于下一条消息', async () => {
    const current = baseState({ assistantV2: { ...baseState().assistantV2, session: {
      ...baseState().assistantV2.session,
      binding: { baseUrl: 'http://127.0.0.1:3080', installationId: 'install', sessionId: 'session-v2' }, phase: 'live',
    } } })
    const selected = baseState({ assistantV2: { ...current.assistantV2, session: { ...current.assistantV2.session,
      modelSelection: { lastUsed: null, next: { provider: 'openai', model: 'reasoner', reasoningEffort: 'high' } },
    } } })
    const fixture = await load(current, message => message.type === 'dsh-assistant-session-models'
      ? { ok: true, value: modelCatalog() }
      : message.type === 'dsh-assistant-session-select-model' ? { ok: true, state: selected }
        : { ok: true, state: current })

    element('#composer-model').click()
    await vi.waitFor(() => { expect(element('#model-popover').textContent).toContain('OpenAI') })
    expect(element('#model-popover').textContent).toContain('DeepSeek')
    ;[...document.querySelectorAll<HTMLButtonElement>('#model-popover [data-model]')]
      .find(node => node.textContent === 'Reasoner')?.click()
    expect(element('#model-popover').textContent).toContain('轻量')
    expect(element('#model-popover').textContent).toContain('深入')
    expect(element('#model-popover').textContent).not.toContain('中')
    ;(element('#confirm-model') as HTMLButtonElement).click()
    await vi.waitFor(() => { expect(element('#composer-model').textContent).toBe('Reasoner · 深入') })
    expect(element('#model-status').textContent).toContain('下一条消息生效')
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-session-select-model',
      selection: { provider: 'openai', model: 'reasoner', reasoningEffort: 'high' }, expectedSessionId: 'session-v2' })
  })

  test('模型目录为空时保留 DSH 设置入口，Escape 关闭并把焦点还给模型按钮', async () => {
    await load(baseState(), message => message.type === 'dsh-assistant-session-models'
      ? { ok: true, value: { default: null, routableProviders: [], groups: [], failures: [] } }
      : { ok: true, state: baseState() })

    element('#composer-model').click()
    await vi.waitFor(() => { expect(element('#model-popover').textContent).toContain('没有可用模型') })
    expect(element('#model-popover').textContent).toContain('打开 DSH 模型设置')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(element('#model-popover').hidden).toBe(true)
    expect(document.activeElement).toBe(element('#composer-model'))
  })

  test('模型目录加载和断线错误留在弹层内，外部点击可关闭', async () => {
    let resolveCatalog!: (value: unknown) => void
    const catalog = new Promise((resolve) => { resolveCatalog = resolve })
    await load(baseState(), message => message.type === 'dsh-assistant-session-models'
      ? catalog : { ok: true, state: baseState() })

    element('#composer-model').click()
    expect(element('#model-picker-status').textContent).toContain('正在读取')
    resolveCatalog({ ok: false, error: 'offline' })
    await vi.waitFor(() => { expect(element('#model-picker-status').textContent).toContain('无法读取') })
    document.body.click()
    expect(element('#model-popover').hidden).toBe(true)
  })

  test('会话切换后丢弃旧弹层延迟返回的目录', async () => {
    let current = baseState({ assistantV2: { ...baseState().assistantV2, session: { ...baseState().assistantV2.session,
      binding: { sessionId: 'session-a' }, phase: 'live' } } })
    let resolveCatalog!: (value: unknown) => void
    const catalog = new Promise((resolve) => { resolveCatalog = resolve })
    const fixture = await load(current, (message) => {
      if (message.type === 'dsh-assistant-session-models') return catalog
      if (message.type === 'dsh-assistant-session-create') {
        current = baseState({ assistantV2: { ...baseState().assistantV2, session: { ...baseState().assistantV2.session,
          binding: { sessionId: 'session-b' }, phase: 'live' } } })
      }
      return { ok: true, state: current }
    })

    element('#composer-model').click()
    element('#top-new-session').click()
    await vi.waitFor(() => { expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-session-create' }) })
    resolveCatalog({ ok: true, value: modelCatalog() })
    await Promise.resolve(); await Promise.resolve()
    expect(element('#model-popover').hidden).toBe(true)
    expect(element('#model-popover').textContent).not.toContain('Reasoner')
  })

  test('斜杠命令完成后直接展示结果并清空草稿', async () => {
    const current = baseState({ assistantV2: { ...baseState().assistantV2, session: {
      ...baseState().assistantV2.session,
      binding: { baseUrl: 'http://127.0.0.1:3080', installationId: 'install', sessionId: 'session-v2' },
      phase: 'live',
    } } })
    await load(current, message => message.type === 'dsh-assistant-session-submit'
      ? { ok: true, value: { accepted: true, command: { commandId: 'command-1',
        result: { kind: 'success', text: '已压缩 8 条历史记录。' } } }, state: current }
      : { ok: true, state: current })
    const composer = element('#composer') as HTMLTextAreaElement
    composer.value = '/compact'
    element('#send-queue').click()

    await vi.waitFor(() => { expect(element('#notice').textContent).toContain('已压缩 8 条历史记录') })
    expect(composer.value).toBe('')
  })

  test('实时转录与最终消息各按适配器项渲染，不重新投递草稿', async () => {
    await load(baseState({ assistantV2: { ...baseState().assistantV2, session: {
      ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' }, transcript: [
        { key: 'user:1', role: 'user', text: '问题', images: [] },
        { key: 'assistant-live:1', role: 'assistant', text: '正在回答', images: [], live: true },
      ],
    } } }))
    expect(document.querySelectorAll('.message')).toHaveLength(2)
    expect(element('#conversation').textContent).toContain('正在回答')
    expect(element('#composer').value).toBe('')
  })

  test('目标和认知只展示投影，后端未接通时不伪造固定或读取', async () => {
    await load(baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { selected: { tabId: 9, title: '固定文章' }, candidates: [{ tabId: 9 }, { tabId: 10 }] },
      cognition: { status: 'unread', items: [], refreshPolicy: 'manual-or-agent-request' },
    } }))
    expect(element('#target-panel').textContent).toContain('固定文章')
    expect(element('#target-panel').textContent).toContain('目标服务暂不可用')
    element('[data-view="cognition"]').click()
    expect(element('#cognition-content').textContent).toContain('选择网页本身不会读取页面')
    expect((element('#refresh-cognition') as HTMLButtonElement).disabled).toBe(true)
    expect((element('#target-panel button') as HTMLButtonElement).disabled).toBe(true)
  })

  test('已连接但尚未绑定会话时，显式选择网页入口只提供新建或继续对话', async () => {
    const fixture = await load()
    expect(element('#target-panel').textContent).toContain('按需选择网页')
    const choose = [...document.querySelectorAll<HTMLButtonElement>('#target-panel button')].find(node => node.textContent === '选择')
    expect(choose?.disabled).toBe(false)
    choose?.click(); await Promise.resolve()
    expect(element('#target-dialog').hidden).toBe(false)
    expect(element('#target-candidates').textContent).toContain('新建对话后选择网页')
    expect(fixture.messages).not.toContainEqual(expect.objectContaining({ type: 'dsh-assistant-target-bind' }))
  })

  test('目标选择弹层点击内部保持打开，点击外部关闭', async () => {
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 3, selected: { tabId: 9, title: '固定文章' }, candidates: [] },
    } })
    await load(current, message => message.type === 'dsh-assistant-target-candidates'
      ? { ok: true, value: { items: [{ tabId: 10, title: '当前网页', url: 'https://example.test/', active: true }] } }
      : { ok: true, state: current })

    const choose = [...document.querySelectorAll<HTMLButtonElement>('#target-panel button')]
      .find(node => node.textContent === '选择其他标签')
    choose?.focus(); choose?.click()
    await vi.waitFor(() => { expect(element('#target-dialog').hidden).toBe(false) })
    expect(document.activeElement).toBe(element('[data-close-modal="target-dialog"]'))

    element('#target-dialog header').click()
    expect(element('#target-dialog').hidden).toBe(false)
    element('#conversation').click()
    expect(element('#target-dialog').hidden).toBe(true)

    choose?.focus(); choose?.click()
    await vi.waitFor(() => { expect(element('#target-dialog').hidden).toBe(false) })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(element('#target-dialog').hidden).toBe(true)
    expect(document.activeElement?.textContent).toBe('选择其他标签')
  })

  test('已绑定会话可直接切到当前页而不打开标签弹层', async () => {
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 3, selected: { tabId: 9, title: '固定文章' }, candidates: [] },
    } })
    const fixture = await load(current)

    const switchCurrent = [...document.querySelectorAll<HTMLButtonElement>('#target-panel button')]
      .find(node => node.textContent === '切到当前页')
    switchCurrent?.click()
    await Promise.resolve()

    expect(element('#target-dialog').hidden).toBe(true)
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-target-bind', expectedRevision: 3 })
  })

  test('首页显式固定当前标签时只绑定刚创建且仍为当前的对话', async () => {
    const created = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'created-session' } },
      target: { availability: 'ready', revision: 0, selected: null, candidates: [] },
    } })
    const fixture = await load(baseState(), message => message.type === 'dsh-assistant-session-create'
      ? { ok: true, state: created } : { ok: true, state: message.type === 'dsh-assistant-state' ? baseState() : created })
    const fix = [...document.querySelectorAll<HTMLButtonElement>('#target-panel button')].find(node => node.textContent === '固定当前标签')
    fix?.click(); await vi.waitFor(() =>{  expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-target-bind', expectedRevision: 0 }) })
    expect(fixture.messages.indexOf(fixture.messages.find(message => message.type === 'dsh-assistant-session-create')!))
      .toBeLessThan(fixture.messages.indexOf(fixture.messages.find(message => message.type === 'dsh-assistant-target-bind')!))
  })

  test('已绑定会话但目标服务不可用时提示重试或重连', async () => {
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'unavailable', revision: null, selected: null, candidates: [] },
    } })
    await load(current)
    expect(element('#target-panel').textContent).toContain('目标服务暂不可用，请稍后重试或重新连接')
    expect((element('#target-panel button') as HTMLButtonElement).disabled).toBe(true)
  })

  test('认知展示真实读取范围并只为当前文档提供刷新和定位命令', async () => {
    const pageId = 'install:9:0:doc-a:https://example.test/a'
    const cognition = { status: 'ready', refreshPolicy: 'manual-or-agent-request', refresh: { status: 'idle' }, pages: [{
      id: pageId, title: '已读取文章', pageType: 'article', documentState: 'current', locatorsValid: true,
      target: { installationId: 'install', page: { tabId: 9, frameId: 0, documentId: 'doc-a', url: 'https://example.test/a' } },
      coverage: { observationCount: 1, textChars: 120, elementCount: 3, treeNodeCount: 8, regionCount: 1, totalKnown: false }, omissions: ['正文超出本次读取范围'], collections: [], unplacedActions: [],
      content: { groups: [{ id: 'main', parentId: null, title: '正文', kind: 'section', excerpt: '已经送达 Agent 的正文片段', items: [], actionIds: [], evidenceIds: ['session-v2:12'] }], gaps: ['正文超出本次读取范围'], unplacedActionIds: [] },
      regions: [{ id: 'main', role: 'main', label: '正文', text: '已经送达 Agent 的正文片段', bounds: null, importance: 'high', coverage: 'partial', actions: [], collections: [], omissions: ['正文超出本次读取范围'], evidenceIds: ['session-v2:12'], anchorActionId: null }],
      observations: [{ id: 'session-v2:12', observedAt: 1000, readMode: 'tree', scope: { textChars: 120, elementCount: 3, treeNodeCount: 8, regionCount: 1 }, omissions: { textTruncated: true }, preview: { text: '已经送达 Agent 的正文片段' } }],
    }] }
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 4, selected: { tabId: 9, frameId: 0, documentId: 'doc-a', url: 'https://example.test/a' }, candidates: [] }, cognition } })
    const fixture = await load(current)
    element('[data-view="cognition"]').click()
    ;(element('[data-atlas-region-id="main"]') as HTMLButtonElement).click()
    expect(element('#cognition-content').textContent).toContain('已经送达 Agent 的正文片段')
    expect(element('#cognition-content').textContent).toContain('仅展示已读部分')
    expect(element('#cognition-content').textContent).toContain('1 个内容分组')
    expect(element('#cognition-content').textContent).toContain('正文超出本次读取范围')
    expect((element('#refresh-cognition') as HTMLButtonElement).disabled).toBe(false)
    element('#refresh-cognition').click()
    const locate = [...document.querySelectorAll<HTMLButtonElement>('#cognition-content button')].find(node => node.textContent === '定位标签')
    locate?.click(); await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-cognition-refresh', expectedSessionId: 'session-v2', expectedTargetRevision: 4 })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-cognition-locate', pageId, expectedSessionId: 'session-v2', expectedTargetRevision: 4 })
  })

  test('认知树节点只通过真实快照引用请求页面高亮', async () => {
    const page = {
      id: 'install:9:0:doc-a:https://example.test/a', title: '树页面', pageType: 'unknown', documentState: 'current', locatorsValid: true,
      target: { installationId: 'install', page: { tabId: 9, frameId: 0, documentId: 'doc-a', url: 'https://example.test/a' } },
      coverage: { observationCount: 1, textChars: 5, elementCount: 1, treeNodeCount: 1, regionCount: 0, totalKnown: false },
      omissions: [], regions: [], collections: [], unplacedActions: [],
      observations: [{ id: 'session-v2:22', observedAt: 1000, readMode: 'tree', scope: { textChars: 5, elementCount: 1, treeNodeCount: 1, regionCount: 0 }, omissions: {}, preview: { text: '保存' }, tree: { snapshotId: 'snapshot-a', complete: true, cursor: null, nodes: [{ index: 3, parentIndex: null, kind: 'element', tag: 'button', label: '保存', snapshotId: 'snapshot-a', elementId: 'element-3' }] } }],
    }
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 2, selected: { tabId: 9, frameId: 0, documentId: 'doc-a', url: 'https://example.test/a' }, candidates: [] },
      cognition: { status: 'ready', pages: [page], refreshPolicy: 'manual-or-agent-request', refresh: { status: 'idle' } },
    } })
    const fixture = await load(current); element('[data-view="cognition"]').click(); element('.atlas-tabs button:nth-child(2)').click()
    ;(element('.tree-node') as HTMLButtonElement).click()
    const reveal = [...document.querySelectorAll<HTMLButtonElement>('#cognition-content button')].find(node => node.textContent === '在页面中显示')
    expect(reveal).toBeDefined(); reveal?.click(); await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-cognition-reveal-node', pageId: page.id, observationId: 'session-v2:22', nodeIndex: 3, expectedSessionId: 'session-v2', expectedTargetRevision: 2 })
  })

  test('语义地图以页面为单位显示区域检查器，并只分发当前精确页面的定位引用', async () => {
    const page = {
      id: 'install:9:0:doc-a:https://example.test/a', title: '文章页面', pageType: 'article', documentState: 'current', locatorsValid: true,
      target: { installationId: 'install', page: { tabId: 9, frameId: 0, documentId: 'doc-a', url: 'https://example.test/a' } },
      coverage: { observationCount: 1, textChars: 120, elementCount: 2, treeNodeCount: 1, regionCount: 1, totalKnown: false },
      content: { groups: [{ id: 'main', parentId: null, title: '正文', kind: 'section', excerpt: '已经送达 Agent 的正文片段', items: [], actionIds: ['open', 'old'], evidenceIds: ['session-v2:12'] }], gaps: ['正文超出本次读取范围'], unplacedActionIds: ['share'] },
      omissions: ['正文超出本次读取范围'], collections: [{ kind: 'results', items: [{ index: 0, text: '第一项' }], observedCount: 1, totalCount: null, partial: true, evidenceIds: ['session-v2:12'] }],
      regions: [{ id: 'main', role: 'main', label: '正文', text: '已经送达 Agent 的正文片段', bounds: { x: 0.1, y: 0.1, width: 0.6, height: 0.7 }, importance: 'high', coverage: 'partial', omissions: ['正文超出本次读取范围'], evidenceIds: ['session-v2:12'], anchorActionId: 'open', collections: [], actions: [
        { id: 'open', observationId: 'session-v2:12', snapshotId: 'snapshot-a', elementId: 'open', role: 'button', label: '展开', state: {}, locatorsValid: true },
        { id: 'old', observationId: 'session-v2:11', snapshotId: 'snapshot-old', elementId: 'old', role: 'button', label: '旧引用', state: {}, locatorsValid: false },
      ] }],
      unplacedActions: [{ id: 'share', observationId: 'session-v2:12', snapshotId: 'snapshot-a', elementId: 'share', role: 'button', label: '分享', state: {}, locatorsValid: true }],
      observations: [{ id: 'session-v2:12', observedAt: 1000, readMode: 'page-map', title: '文章页面', scope: { textChars: 120, elementCount: 2, treeNodeCount: 1, regionCount: 1 }, omissions: { textTruncated: true }, preview: { text: '已经送达 Agent 的正文片段' }, tree: { snapshotId: 'snapshot-a', complete: true, cursor: null, nodes: [{ index: 3, parentIndex: null, kind: 'element', tag: 'button', label: '展开', snapshotId: 'snapshot-a', elementId: 'open' }] } }],
    }
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 4, selected: { tabId: 9, frameId: 0, documentId: 'doc-a', url: 'https://example.test/a' }, candidates: [] },
      cognition: { status: 'ready', pages: [page], refreshPolicy: 'manual-or-agent-request', refresh: { status: 'idle' } },
    } })
    const fixture = await load(current); element('[data-view="cognition"]').click()
    expect(element('#cognition-content').textContent).toContain('文章页面')
    expect(element('#cognition-content').textContent).toContain('选择一个内容分支')
    const region = element('[data-atlas-region-id="main"]') as HTMLButtonElement; region.click()
    expect(element('#cognition-content').textContent).toContain('掌握内容')
    expect(element('#cognition-content').textContent).toContain('分享')
    expect(element('#cognition-content').textContent).toContain('尚未覆盖')
    const locate = [...document.querySelectorAll<HTMLButtonElement>('#cognition-content button')].find(node => node.textContent === '定位到页面')
    locate?.click(); await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-cognition-reveal-action', pageId: page.id, actionId: 'open', expectedSessionId: 'session-v2', expectedTargetRevision: 4 })
    expect(fixture.messages).not.toContainEqual(expect.objectContaining({ type: 'dsh-assistant-cognition-reveal-action', actionId: 'old' }))
  })

  test.each(atlasPageFixtures)('语义地图用真实通用投影展示 %s 页面，而不依赖网站识别', async (_name, shape) => {
    const page = projectedAtlasPage(shape)
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 4, selected: page.target.page, candidates: [] },
      cognition: { status: 'ready', pages: [page], refreshPolicy: 'manual-or-agent-request', refresh: { status: 'idle' } },
    } })
    await load(current); element('[data-view="cognition"]').click()
    expect(element('#cognition-content').textContent).toContain(shape.title)
    expect(element('#cognition-content').textContent).toContain('主要区域')
    ;(element('[data-atlas-region-id]') as HTMLButtonElement).click()
    expect(element('#cognition-content').textContent).toContain('已送达内容')
    expect(element('#cognition-content').textContent).toContain('定位到页面')
  })

  test('固定目标不是该精确页面时保留历史证据但禁用全部定位', async () => {
    const page = projectedAtlasPage({ title: '旧页面' })
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 4, selected: { ...page.target.page, documentId: 'new-document', url: 'https://example.test/new' }, candidates: [] },
      cognition: { status: 'ready', pages: [page], refreshPolicy: 'manual-or-agent-request', refresh: { status: 'idle' } },
    } })
    await load(current); element('[data-view="cognition"]').click(); (element('[data-atlas-region-id]') as HTMLButtonElement).click()
    expect([...document.querySelectorAll<HTMLButtonElement>('#cognition-content button')].find(node => node.textContent === '定位标签')?.disabled).toBe(true)
    expect([...document.querySelectorAll<HTMLButtonElement>('#cognition-content button')].find(node => node.textContent === '定位到页面')?.disabled).toBe(true)
  })

  test('刷新等待新证据时不重复排队，证据视图保留观察身份与范围', async () => {
    const page = projectedAtlasPage({ title: '证据页面', text: '送达内容' })
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 4, selected: page.target.page, candidates: [] },
      cognition: { status: 'ready', pages: [page], refreshPolicy: 'manual-or-agent-request', refresh: { status: 'waiting' } },
    } })
    await load(current); element('[data-view="cognition"]').click()
    expect((element('#refresh-cognition') as HTMLButtonElement).disabled).toBe(true)
    expect(element('#refresh-cognition').textContent).toBe('等待新证据…')
    ;(element('.atlas-tabs button:nth-child(3)') as HTMLButtonElement).click()
    expect(element('#cognition-content').textContent).toContain('session-v2:2')
    expect(element('#cognition-content').textContent).toContain('正文 4 字')
    expect(styles).toContain('@container (min-width: 700px)')
  })

  test('目标后端可用时从候选标签精确选择并以修订号清除', async () => {
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 3, selected: { tabId: 9, title: '固定文章' }, candidates: [] } } })
    const fixture = await load(current, message => message.type === 'dsh-assistant-target-candidates'
      ? { ok: true, value: { items: [
        { tabId: 11, title: '其他网页', url: 'https://example.test/other', active: false },
        { tabId: 9, title: '固定文章', url: 'https://example.test/fixed', active: false },
        { tabId: 10, title: '候选网页', url: 'https://example.test/a', active: true },
      ] } }
      : { ok: true, state: current })
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('#target-panel button')]
    buttons.find(node => node.textContent === '选择其他标签')?.click()
    await vi.waitFor(() =>{  expect(element('#target-candidates').textContent).toContain('候选网页') })
    const candidates = [...document.querySelectorAll<HTMLButtonElement>('#target-candidates button')]
    expect(candidates[0]?.textContent).toContain('当前')
    expect(candidates[1]?.textContent).toContain('已固定')
    expect(candidates[1]?.getAttribute('aria-pressed')).toBe('true')
    candidates[0]?.click()
    buttons.find(node => node.textContent === '清除')?.click()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-target-bind', expectedRevision: 3, tabId: 10 })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-target-clear', expectedRevision: 3 })
  })

  test('功能未接通时绝不展示投影条目为成功功能，页面范围可切换', async () => {
    await load(baseState({ assistantV2: { ...baseState().assistantV2, functions: { availability: 'unavailable', items: [{ name: '演示功能' }] } } }))
    element('[data-view="functions"]').click()
    expect(element('#functions-panel').textContent).toContain('暂不可用')
    expect(element('#functions-panel').textContent).not.toContain('演示功能')
    element('[data-scope="page"]').click()
    expect(element('[data-scope="page"]').getAttribute('aria-pressed')).toBe('true')
  })

  test('我的功能按范围展示已交付项，运行态可查看、停止和用自然语言修改', async () => {
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 4, selected: { tabId: 9 }, candidates: [] }, functions: { availability: 'ready', items: [
        { pluginId: 'global-1', name: '每日整理', purpose: '整理近期材料', currentPackageId: 'pkg-1', activeRun: { pluginRunId: 'run-1' }, scope: 'global', status: 'running', inspection: null },
        { pluginId: 'page-2', name: '页面标注', purpose: '标注固定页面', currentPackageId: 'pkg-2', activeRun: { pluginRunId: 'run-2' }, scope: 'page', scopeStatus: 'stale-target', targetRevision: 3, status: 'running', inspection: null },
      ] } } })
    const fixture = await load(current)
    element('[data-view="functions"]').click()
    expect(element('#functions-content').textContent).toContain('每日整理')
    expect(element('#functions-content').textContent).toContain('版本 pkg-1')
    expect(element('#functions-content').textContent).toContain('运行中')
    expect([...document.querySelectorAll<HTMLButtonElement>('#functions-content button')].map(node => node.textContent)).not.toContain('运行')
    expect([...document.querySelectorAll<HTMLButtonElement>('#functions-content button')].map(node => node.textContent)).toContain('修改')
    const globalButtons = [...document.querySelectorAll<HTMLButtonElement>('#functions-content button')]
    globalButtons.find(node => node.textContent === '检查运行')?.click()
    globalButtons.find(node => node.textContent === '停止')?.click()
    const edit = element('#functions-content input') as HTMLInputElement; edit.value = '改成每周一整理'
    globalButtons.find(node => node.textContent === '修改')?.click()
    await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-function-inspect', pluginId: 'global-1' })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-function-stop', pluginId: 'global-1' })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-function-edit', pluginId: 'global-1', instruction: '改成每周一整理' })

    element('[data-scope="page"]').click()
    expect(element('#functions-content').textContent).not.toContain('页面标注')
    expect(element('#functions-content').textContent).toContain('当前操作网页没有可用功能')
  })

  test('停止的功能显示运行；其他页面的功能不会伪装成当前网页功能', async () => {
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } }, functions: { availability: 'ready', items: [
        { pluginId: 'global-1', name: '每日整理', purpose: '整理近期材料', currentPackageId: 'pkg-1', scope: 'global', status: 'stopped', inspection: null },
        { pluginId: 'page-2', name: '页面标注', purpose: '标注固定页面', currentPackageId: 'pkg-2', scope: 'page', scopeStatus: 'stale-target', targetRevision: 3, status: 'stopped', inspection: null },
      ] } } })
    const fixture = await load(current); element('[data-view="functions"]').click()
    const run = [...document.querySelectorAll<HTMLButtonElement>('#functions-content button')].find(node => node.textContent === '运行')
    expect(run?.disabled).toBe(false); run?.click(); await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-function-run', pluginId: 'global-1' })
    element('[data-scope="page"]').click()
    expect(element('#functions-content').textContent).not.toContain('页面标注')
    expect(element('#functions-content').textContent).toContain('当前操作网页没有可用功能')
  })

  test('功能只在目录给出真实打开目标时允许打开，创建通过对话草稿表达范围', async () => {
    const current = baseState({ assistantV2: { ...baseState().assistantV2, functions: { availability: 'ready', items: [
      { pluginId: 'with-view', name: '可视功能', purpose: '已有界面', currentPackageId: 'pkg-1', activeRun: { pluginRunId: 'run-1' }, scope: 'global', status: 'running', openTarget: { kind: 'web', sessionId: 'view-session' } },
      { pluginId: 'host-only', name: '后台功能', purpose: '没有界面', currentPackageId: 'pkg-2', activeRun: { pluginRunId: 'run-2' }, scope: 'global', status: 'running' },
    ] } } })
    const fixture = await load(current); element('[data-view="functions"]').click()
    const cards = [...document.querySelectorAll<HTMLElement>('#functions-content .function')]
    const open = [...cards[0].querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === '在 DSH 中打开')
    const disabled = [...cards[1].querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === '没有可打开的界面')
    expect(open?.disabled).toBe(false); expect(disabled?.disabled).toBe(true); open?.click(); await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-function-open', pluginId: 'with-view' })
    expect((cards[0].querySelector('input') as HTMLInputElement).disabled).toBe(true)
    expect(cards[0].textContent).toContain('开始或选择对话后可运行和修改')
    element('#create-function').click()
    expect((element('#composer') as HTMLTextAreaElement).value).toBe('帮我创建一个全局功能：')
    expect(element('#chat-panel').hidden).toBe(false)
  })

  test('离线错误状态保留可编辑草稿，不允许把它发送到未知会话', async () => {
    await load(baseState({ assistantV2: { ...baseState().assistantV2, connection: { phase: 'offline' } } }))
    expect((element('#composer') as HTMLTextAreaElement).disabled).toBe(false)
    expect((element('#send-queue') as HTMLButtonElement).disabled).toBe(true)
    expect(element('#send-status').textContent).toContain('连接 DSH')
    expect(element('#target-panel').textContent).toContain('请先连接 DSH')
  })

  test('保留粘贴图片、Enter 发送和 Shift+Enter 换行的编辑行为', async () => {
    class ClipboardReader { result: string | null = null; onload: (() => void) | null = null; readAsDataURL(): void { this.result = 'data:image/png;base64,AQ=='; this.onload?.() } }
    vi.stubGlobal('FileReader', ClipboardReader)
    const fixture = await load()
    const composer = element('#composer') as HTMLTextAreaElement; composer.value = '识别图片'
    const image = new File([Uint8Array.of(1)], 'clipboard.png', { type: 'image/png' })
    const paste = new Event('paste', { bubbles: true, cancelable: true }); Object.defineProperty(paste, 'clipboardData', { value: { items: [{ kind: 'file', getAsFile: () => image }] } })
    composer.dispatchEvent(paste); await vi.waitFor(() => { expect(element('#draft-images img').getAttribute('alt')).toBe('clipboard.png') })
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-session-submit', text: '识别图片', mode: 'queue', expectedSessionId: null, expectedTargetRevision: 0, images: [{ type: 'image', mediaType: 'image/png', data: 'AQ==', name: 'clipboard.png' }] })
    composer.value = '保留换行'; composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })); await Promise.resolve()
    expect(fixture.messages.filter(message => message.type === 'dsh-assistant-session-submit')).toHaveLength(1)
  })

  test('当前会话的动作审批保留在任务视图，其他会话不会串入', async () => {
    const current = baseState({
      assistantV2: { ...baseState().assistantV2, session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } } },
      approvals: { sessionId: 'session-v2', requests: [{ id: 'approval-1', reason: '需要点击目标页按钮' }] },
    })
    const fixture = await load(current)
    expect(element('#action-approvals').textContent).toContain('需要点击目标页按钮')
    const allow = [...document.querySelectorAll<HTMLButtonElement>('#action-approvals button')].find(node => node.textContent === '允许这一次')
    allow?.click(); await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-approval-decide', id: 'approval-1', decision: 'allowed-once' })

    await load(baseState({
      assistantV2: { ...baseState().assistantV2, session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } } },
      approvals: { sessionId: 'session-other', requests: [{ id: 'approval-2', reason: '不属于当前会话' }] },
    }))
    expect(element('#action-approvals').textContent).not.toContain('不属于当前会话')
  })

  test('未知动作保留查看目标与人工核对入口', async () => {
    const identity = { installationId: 'install', sessionId: 'session-v2', requestId: 'request-1' }
    const fixture = await load(baseState({ unresolved: [{ identity, target: { tabId: 9 }, acknowledgementPending: false }] }))
    expect(element('#unresolved-actions').textContent).toContain('结果未知')
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('#unresolved-actions button')]
    buttons.find(node => node.textContent === '查看目标标签')?.click()
    buttons.find(node => node.textContent?.includes('接受未知结果'))?.click()
    await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-reveal-target', requestId: 'request-1' })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-acknowledge', identity })
  })

  test('设置保留网页引擎和站点权限，steer 仍约束当前会话', async () => {
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      connection: { phase: 'connected', grant: { origins: [], scopes: ['session:interact', 'browser:read'] } },
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' }, phase: 'live' },
    }, browserEngine: 'puppeteer' })
    const fixture = await load(current)
    element('#show-settings').click()
    expect(element('#site-access').textContent).toContain('尚未授权所有网站')
    const engine = element('#browser-engine') as HTMLSelectElement; engine.value = 'dom'; engine.dispatchEvent(new Event('change'))
    ;(element('#composer') as HTMLTextAreaElement).value = '立即修正'
    element('#send-steer').click(); await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-browser-engine', engine: 'dom' })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-session-submit', text: '立即修正', mode: 'steer', expectedSessionId: 'session-v2', expectedTargetRevision: 0 })
  })
})
