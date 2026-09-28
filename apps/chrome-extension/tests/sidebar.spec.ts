/// <reference types="node" />
/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import rawMarkup from '../sidebar.html?raw'

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
const load = async (current: unknown = baseState(), reply?: (message: Record<string, unknown>) => unknown,
  connectImpl?: () => unknown) => {
  document.body.innerHTML = markup
  const messages: Record<string, unknown>[] = []
  const wireMessages: Record<string, unknown>[] = []
  const permissionRequest = vi.fn(async () => true)
  const listener = vi.fn<(callback: (message: { type: string }) => void) => void>()
  vi.stubGlobal('chrome', { runtime: { ...(connectImpl ? { connect: connectImpl } : {}), sendMessage: vi.fn(async (message: Record<string, unknown>) => {
    wireMessages.push(message)
    const { surfaceId: _surfaceId, ...semanticMessage } = message
    messages.push(semanticMessage); return reply?.(message) ?? { ok: true, state: current }
  }), onMessage: { addListener: listener } }, permissions: { request: permissionRequest } })
  await import('../src/sidebar.js'); await Promise.resolve(); await Promise.resolve()
  return { messages, wireMessages, listener, permissionRequest }
}
const element = (selector: string): HTMLElement => {
  const result = document.querySelector<HTMLElement>(selector)
  if (!result) throw new Error(`Missing fixture element: ${selector}`)
  return result
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.useRealTimers(); document.body.replaceChildren() })

describe('DSH 浏览器助手 V2 侧栏', () => {
  test('未固定页面仍可看到、检查和停止旧页面已交付功能', async () => {
    const fixture = await load(baseState({ assistantV2: { ...baseState().assistantV2,
      functions: { availability: 'ready', items: [{ pluginId: 'pstfn-1', name: 'Personal result',
        purpose: '挂载持续入口', scope: 'page', scopeStatus: 'stale-target', status: 'running',
        target: { url: 'http://127.0.0.1:37922/handoff-child.html' },
        openTarget: { kind: 'browser' } }] } } }))
    element('[data-view="functions"]').click()
    expect(element('#function-count').textContent).toBe('1')
    expect(element('#functions-content').textContent).toContain('已交付 1 项 · 当前网页可用 0 项')
    expect(element('#functions-content').textContent).toContain('http://127.0.0.1:37922/handoff-child.html')
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('#functions-content button')]
    expect(buttons.find(node => node.textContent === '在页面中打开')?.disabled).toBe(true)
    buttons.find(node => node.textContent === '停止')?.click()
    await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-function-stop', pluginId: 'pstfn-1' })
  })

  test.each([true, false])('连接恢复状态区分有限退避与等待事件：retryPending=%s', async (retryPending) => {
    await load(baseState({ assistantV2: { ...baseState().assistantV2,
      connection: { phase: 'offline', baseUrl: 'http://127.0.0.1:3080', retryPending, retryPaused: !retryPending } } }))
    expect(element('#connection-panel').textContent).toContain(retryPending ? '正在有限退避重试' : '已暂停自动重试')
    expect(element('#connection-panel').textContent).not.toContain(retryPending ? '已暂停自动重试' : '正在有限退避重试')
  })

  test('设置页显示独立的 Codex 浏览器连接，并可发起连接', async () => {
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      codexConnection: { baseUrl: 'http://127.0.0.1:3091', phase: 'configured' } } })
    const fixture = await load(current)
    element('#show-settings').click()
    expect(element('#codex-browser-connection').textContent).toContain('Codex 网页连接')
    const action = [...element('#codex-browser-connection').querySelectorAll('button')].find(node => node.textContent === '连接 Codex')
    expect(action).toBeTruthy()
    action!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await vi.waitFor(() => { expect(fixture.messages).toContainEqual({ type: 'dsh-codex-browser-connect' }) })
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

  test('首页不创建会话，主导航展示对话、页面认知、功能和 SBC', async () => {
    const fixture = await load()
    expect(document.body.textContent).toContain('今天，想做点什么')
    expect(document.body.textContent).toContain('页面认知')
    expect(document.body.textContent).toContain('功能')
    expect(document.body.textContent).toContain('SBC')
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

  test('固定目标明确限定在当前对话，会话列表显示身份以免误选同名对话', async () => {
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-12345678' } },
      target: { availability: 'ready', revision: 3, selected: { tabId: 9, title: 'FC Ultimate Team Web App' }, candidates: [] },
    } })
    await load(current, message => message.type === 'dsh-assistant-session-list'
      ? { ok: true, value: { items: [
        { sessionId: 'session-12345678', projections: { values: { title: 'FC 研究' } } },
        { sessionId: 'session-87654321', projections: { values: { title: 'FC 研究' } } },
      ] } }
      : { ok: true, state: current })

    expect(element('#target-panel').textContent).toContain('已固定到此对话')
    expect(element('#target-panel').textContent).toContain('仅此对话')
    expect(element('#target-panel').textContent).toContain('12345678')
    element('#session-switch').click()
    await vi.waitFor(() => { expect(document.querySelectorAll('#session-switch-menu button')).toHaveLength(2) })
    const rows = [...document.querySelectorAll<HTMLButtonElement>('#session-switch-menu button')]
    expect(rows[0]?.textContent).toContain('12345678')
    expect(rows[1]?.textContent).toContain('87654321')
    expect(rows[1]?.title).toContain('session-87654321')
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
    const selected = { tabId: 7, windowId: 2, frameId: 0, documentId: 'doc-7', url: 'https://example.test/a', title: 'A' }
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 3, selected: { tabId: 9, title: '固定文章' }, candidates: [] },
    } })
    const fixture = await load(current, message => message.type === 'dsh-assistant-target-current'
      ? { ok: true, value: selected } : { ok: true, state: current })

    const switchCurrent = [...document.querySelectorAll<HTMLButtonElement>('#target-panel button')]
      .find(node => node.textContent === '切到当前页')
    switchCurrent?.click()

    expect(element('#target-dialog').hidden).toBe(true)
    await vi.waitFor(() => { expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-target-bind',
      expectedRevision: 3, tabId: 7, expectedPage: selected }) })
  })

  test('首页显式固定当前标签时只绑定刚创建且仍为当前的对话', async () => {
    const selected = { tabId: 7, windowId: 2, frameId: 0, documentId: 'doc-7', url: 'https://example.test/a', title: 'A' }
    const created = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'created-session' } },
      target: { availability: 'ready', revision: 0, selected: null, candidates: [] },
    } })
    const fixture = await load(baseState(), message => message.type === 'dsh-assistant-target-current'
      ? { ok: true, value: selected } : message.type === 'dsh-assistant-session-create'
        ? { ok: true, state: created } : { ok: true, state: message.type === 'dsh-assistant-state' ? baseState() : created })
    const fix = [...document.querySelectorAll<HTMLButtonElement>('#target-panel button')].find(node => node.textContent === '固定当前标签')
    fix?.click(); await vi.waitFor(() =>{  expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-target-bind',
      expectedRevision: 0, tabId: 7, expectedPage: selected }) })
    expect(fixture.messages.indexOf(fixture.messages.find(message => message.type === 'dsh-assistant-session-create')!))
      .toBeLessThan(fixture.messages.indexOf(fixture.messages.find(message => message.type === 'dsh-assistant-target-bind')!))
  })

  test('创建会话期间切换标签也只绑定点击时的文档', async () => {
    const selected = { tabId: 7, windowId: 2, frameId: 0, documentId: 'doc-a', url: 'https://example.test/a', title: 'A' }
    let active = selected
    const created = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'created-session' } },
      target: { availability: 'ready', revision: 0, selected: null, candidates: [] },
    } })
    let finishCreate!: (value: unknown) => void
    const creating = new Promise((resolve) => { finishCreate = resolve })
    const fixture = await load(baseState(), message => message.type === 'dsh-assistant-target-current'
      ? { ok: true, value: active }
      : message.type === 'dsh-assistant-session-create' ? creating
        : { ok: true, state: message.type === 'dsh-assistant-state' ? baseState() : created })
    const fix = [...document.querySelectorAll<HTMLButtonElement>('#target-panel button')].find(node => node.textContent === '固定当前标签')
    fix?.click()
    await vi.waitFor(() => { expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-session-create' }) })
    active = { tabId: 8, windowId: 2, frameId: 0, documentId: 'doc-b', url: 'https://example.test/b', title: 'B' }
    finishCreate({ ok: true, state: created })
    await vi.waitFor(() => { expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-target-bind',
      expectedRevision: 0, tabId: 7, expectedPage: selected }) })
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
    const cognition = { status: 'ready', refreshPolicy: 'manual-or-agent-request', items: [{
      id: 'session-v2:12', observedAt: 1000, readMode: 'tree', documentState: 'current', locatorsValid: true,
      target: { installationId: 'install', page: { tabId: 9, frameId: 0, documentId: 'doc-a', url: 'https://example.test/a' } },
      source: { toolResultSeq: 12, requestId: 'request-12' },
      scope: { textChars: 120, elementCount: 3, treeNodeCount: 8, regionCount: 1 },
      omissions: { textTruncated: true, scanTruncated: false, treeTruncated: true, nextOffset: null, treeCursor: 'next' },
      preview: { text: '已经送达 Agent 的正文片段', labels: ['展开'], regions: [{ label: '侧栏' }] },
    }] }
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 4, selected: { tabId: 9 }, candidates: [] }, cognition } })
    const fixture = await load(current)
    element('[data-view="cognition"]').click()
    expect(element('#cognition-content').textContent).toContain('已经送达 Agent 的正文片段')
    expect(element('#cognition-content').textContent).toContain('正文 120 字')
    expect(element('#cognition-content').textContent).toContain('DOM 8 节点')
    expect(element('#cognition-content').textContent).toContain('有截断或后续页')
    expect((element('#refresh-cognition') as HTMLButtonElement).disabled).toBe(false)
    element('#refresh-cognition').click()
    const locate = [...document.querySelectorAll<HTMLButtonElement>('#cognition-content button')]
      .find(node => node.textContent === '定位标签')
    locate?.click(); await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-cognition-refresh', expectedSessionId: 'session-v2', expectedTargetRevision: 4 })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-cognition-locate', itemId: 'session-v2:12' })
  })

  test('认知树节点只通过真实快照引用请求页面高亮', async () => {
    const item = {
      id: 'session-v2:22', readMode: 'tree', documentState: 'current', locatorsValid: true,
      target: { installationId: 'install', page: { tabId: 9, frameId: 0, documentId: 'doc-a', url: 'https://example.test/a' } },
      scope: { textChars: 5, elementCount: 1, treeNodeCount: 1, regionCount: 0 }, omissions: {}, preview: { text: '保存', labels: [], regions: [] },
      tree: { snapshotId: 'snapshot-a', complete: true, cursor: null, nodes: [{ index: 3, parentIndex: null, kind: 'element', tag: 'button', label: '保存', snapshotId: 'snapshot-a', elementId: 'element-3' }] },
    }
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 2, selected: { tabId: 9 }, candidates: [] },
      cognition: { status: 'ready', items: [item], refreshPolicy: 'manual-or-agent-request' },
    } })
    const fixture = await load(current); element('[data-view="cognition"]').click()
    ;(element('.tree-node') as HTMLButtonElement).click()
    const reveal = [...document.querySelectorAll<HTMLButtonElement>('#cognition-content button')].find(node => node.textContent === '在页面中显示')
    expect(reveal).toBeDefined(); reveal?.click(); await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-cognition-reveal-node', itemId: 'session-v2:22', nodeIndex: 3 })
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

  test('多窗口候选不把两个活动标签都标成当前，并精确绑定 FC 标签', async () => {
    const items = [
      { tabId: 70, windowId: 1, title: 'B 站视频', url: 'https://www.bilibili.com/video/a', active: true },
      { tabId: 80, windowId: 2, title: 'FC Ultimate Team Web App', url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/', active: true },
      { tabId: 81, windowId: 2, title: 'FUTBIN', url: 'https://www.futbin.com/popular', active: false },
    ]
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 0, selected: null, candidates: items },
    } })
    const fixture = await load(current, message => message.type === 'dsh-assistant-target-candidates'
      ? { ok: true, value: { items } } : { ok: true, state: current })

    expect(element('#target-panel').textContent).not.toContain('切到当前页')
    const choose = [...document.querySelectorAll<HTMLButtonElement>('#target-panel button')]
      .find(node => node.textContent === '选择其他标签')
    choose?.click()
    await vi.waitFor(() => { expect(element('#target-candidates').textContent).toContain('FC Ultimate Team Web App') })
    const candidates = [...document.querySelectorAll<HTMLButtonElement>('#target-candidates button')]
    expect(candidates[0]?.textContent).toContain('窗口 1 · 该窗口已选中 · B 站视频')
    expect(candidates[1]?.textContent).toContain('窗口 2 · 该窗口已选中 · FC Ultimate Team Web App')
    expect(candidates.filter(node => node.hasAttribute('aria-current'))).toHaveLength(0)
    candidates[1]?.click()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-target-bind', expectedRevision: 0, tabId: 80 })
  })

  test('功能未接通时绝不展示投影条目为成功功能，页面范围可切换', async () => {
    await load(baseState({ assistantV2: { ...baseState().assistantV2, functions: { availability: 'unavailable', items: [{ name: '演示功能' }] } } }))
    element('[data-view="functions"]').click()
    expect(element('#functions-panel').textContent).toContain('暂不可用')
    expect(element('#functions-panel').textContent).not.toContain('演示功能')
    element('[data-scope="page"]').click()
    expect(element('[data-scope="page"]').getAttribute('aria-pressed')).toBe('true')
  })

  test('SBC 只读梳理无需先连接 DSH 或创建对话', async () => {
    const selectedPage = { tabId: 9, windowId: 2, frameId: 0, documentId: 'doc-fc',
      url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/', title: 'FC Web App' }
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      connection: { phase: 'offline' }, target: { availability: 'unavailable', revision: null, selected: null, candidates: [] },
    } })
    const probe = { url: selectedPage.url, title: 'FC', capturedAt: '2026-09-26T02:00:00.000Z',
      supported: true, loginRequired: false, taskType: 'puzzle', warnings: [],
      marketAccess: { status: 'unknown', evidence: [] }, view: { kind: 'sbc-group', selectedChallenge: null },
      challengeSet: { title: '重大比赛', visibleChallengeCount: 0, challenges: [] },
      inventory: { coverage: 'unread', sbcStorageVisible: false, visibleCards: [] } }
    const fixture = await load(current, message => message.type === 'dsh-assistant-fc-sbc-slice'
      ? { ok: true, value: { page: selectedPage, probe, main: null } } : { ok: true, state: current })
    element('[data-view="fc-sbc"]').click()
    expect((element('#scan-fc-sbc') as HTMLButtonElement).disabled).toBe(false)
    ;(element('#scan-fc-sbc') as HTMLButtonElement).click()
    await vi.waitFor(() => { expect(element('#fc-sbc-content').textContent).toContain('重大比赛') })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-fc-sbc-slice', mode: 'page-only' })
    expect(fixture.messages).not.toContainEqual(expect.objectContaining({ type: 'dsh-assistant-session-create' }))
  })

  test('固定页重载后仍可只读梳理新文档，但旧 DSH 绑定不能发送报告', async () => {
    const selected = { tabId: 9, windowId: 2, frameId: 0, documentId: 'old-doc',
      url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/', title: 'FC Web App' }
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 4, selected, candidates: [] },
    } })
    const probe = { url: selected.url, title: 'FC', capturedAt: '2026-09-26T02:00:00.000Z',
      supported: true, loginRequired: false, taskType: 'puzzle', warnings: [],
      marketAccess: { status: 'unknown', evidence: [] }, view: { kind: 'sbc-group', selectedChallenge: null },
      challengeSet: { title: '重大比赛', visibleChallengeCount: 0, challenges: [] },
      inventory: { coverage: 'unread', sbcStorageVisible: false, visibleCards: [] } }
    const page = { ...selected, documentId: 'new-doc' }
    const fixture = await load(current, message => message.type === 'dsh-assistant-fc-sbc-slice'
      ? { ok: true, value: { page, probe, main: null } } : { ok: true, state: current })
    element('[data-view="fc-sbc"]').click()
    ;(element('#scan-fc-sbc') as HTMLButtonElement).click()
    await vi.waitFor(() => { expect(element('#fc-sbc-content').textContent).toContain('旧文档已失效') })
    const sendReport = [...document.querySelectorAll<HTMLButtonElement>('#fc-sbc-content button')]
      .find(button => button.textContent === '发送给对话')
    expect(sendReport?.disabled).toBe(true)
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-fc-sbc-slice', mode: 'page-only', tabId: 9, expectedPage: selected })
  })

  test('SBC 面板只读梳理当前固定页面，并展示阻塞项', async () => {
    const selected = { tabId: 9, frameId: 0, documentId: 'doc-fc',
      url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/', title: 'FC Web App' }
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 4, selected, candidates: [] },
    } })
    const probe = { url: selected.url, title: selected.title, capturedAt: '2026-09-25T06:20:00.000Z',
      supported: true, taskType: 'puzzle', marketAccess: { status: 'visible', evidence: ['transfer-market-visible'] },
      view: { kind: 'sbc-group', selectedChallenge: { title: 'Marquee Matchups', visibleIndex: 0 } },
      challengeSet: { title: 'Marquee Matchups', visibleChallengeCount: 2, challenges: [{
        challengeId: 'match-a',
        title: 'Marquee Matchups',
        completed: false,
        requirementLines: ['Min. 2 Clubs'],
        rewardLines: ['Gold Pack'],
        textSample: 'raw DOM challenge text',
      }, { challengeId: 'match-b', title: 'Second Match', completed: false,
        requirementLines: [], rewardLines: [], textSample: 'other raw DOM text' }] },
      inventory: { coverage: 'visible-only', sbcStorageVisible: false, visibleCards: [{
        visibleId: 'visible-card-1',
        instanceId: 'private-card-instance',
        rating: 91,
        locked: false,
        textSample: 'Mbappe private card text',
      }] }, warnings: [] }
    const report = { status: 'draft-only', canApproveExecution: false, nextAction: 'read-complete-inventory',
      blockers: [{ code: 'inventory-visible-only', source: 'inventory' }, { code: 'plan-input-missing', source: 'solver' }],
      deferred: [{ code: 'complete-inventory-adapter', source: 'inventory' }], warnings: [], variants: [],
      fieldAudit: { schemaVersion: 1, kind: 'fc-sbc-field-audit', status: 'needs-samples',
        summary: { covered: 10, partial: 4, missing: 5 },
        fields: [],
        gaps: [
          { area: 'inventory', code: 'inventory-coverage', status: 'partial', detail: 'club inventory coverage', evidence: [] },
          { area: 'readback', code: 'purchase-result-readback', status: 'missing', detail: 'purchase readback', evidence: [] },
        ] },
      executionDryRun: {
        schemaVersion: 1,
        kind: 'fc-sbc-execution-dry-run',
        status: 'ready',
        issues: [],
        summary: { planId: 'plan-a', groupId: 'marquee', platform: 'pc', purchaseCount: 1, submitCount: 0,
          maxSpend: 700, reservedIfStarted: 700, maxMarketSearches: 20, maxSearchesPerPurchase: 2 },
        purchaseQueue: [{ order: 1, challengeId: 'match-a', planPurchaseId: 'p-a', cardVersionId: 'buy-a',
          maxPrice: 700, maxSearches: 2 }],
        submitQueue: [],
        sideEffects: { browserWrites: false, purchases: false, squadFill: false, submits: false },
      },
      riskPreflight: {
        schemaVersion: 1,
        kind: 'fc-sbc-risk-preflight',
        status: 'caution',
        disclaimer: '该预检只量化自动化暴露量，不能证明不会封禁。',
        issues: [{ code: 'automation-exposure-nonzero', detail: '1 purchases, 0 submits' }],
        summary: { purchaseCount: 1, submitCount: 0, plannedSearches: 2, maxSearchesPerPurchase: 2,
          maxPurchases: 12, maxSubmits: 4, maxTotalSearches: 20, marketAccess: 'visible', unknownTransactionCount: 0 },
        sideEffects: { browserWrites: false, purchases: false, submits: false },
      },
      approvalPreview: {
        schemaVersion: 1,
        kind: 'fc-sbc-approval-preview',
        status: 'ready',
        reviewDigest: 'abc123ef',
        identity: { sessionId: 'session-1', installationId: 'install-1', grantEpoch: 4, tabId: 9,
          frameId: 0, documentId: 'doc-a', clubId: 'club-a', pageCapturedAt: '2026-09-25T06:20:00.000Z',
          inventoryCapturedAt: '2026-09-25T06:25:00.000Z' },
        notice: '只生成批准预览；不会购买、填阵或提交。',
        issues: [],
        approvalWindow: { approvedAt: 1, startBy: 601, expiresAt: 3601, startWithinMs: 600, expiresInMs: 3600 },
        requiredBindings: { session: true, installation: true, tab: true, club: true },
        scope: { planId: 'plan-a', groupId: 'marquee', platform: 'pc',
          purchaseScope: [{ challengeId: 'match-a', planPurchaseId: 'p-a', cardVersionId: 'buy-a', maxPrice: 700 }],
          submitChallengeIds: ['match-a'] },
        summary: { planId: 'plan-a', groupId: 'marquee', platform: 'pc', purchaseCount: 1, submitCount: 1,
          maxSpend: 700, reservedIfStarted: 700, plannedSearches: 2, riskStatus: 'caution',
          readinessStatus: 'ready-for-approval', executionStatus: 'ready' },
        sideEffects: { browserWrites: false, purchases: false, squadFill: false, submits: false },
      },
      summary: { taskType: 'puzzle', marketAccess: 'visible', inventoryCoverage: 'visible-only',
        visibleChallengeCount: 2, variantCount: 0, purchaseRange: null, maxSpendRange: null, planError: null,
        fieldCoverage: { covered: 10, partial: 4, missing: 5 } } }
    const fixture = await load(current, message => message.type === 'dsh-assistant-fc-sbc-slice'
      ? { ok: true, value: { page: selected, probe, main: null, report } }
      : { ok: true, state: current })

    element('[data-view="fc-sbc"]').click()
    ;(element('#scan-fc-sbc') as HTMLButtonElement).click()
    await vi.waitFor(() => { expect(element('#fc-sbc-content').textContent).toContain('库存只来自可见页面') })
    expect(element('#fc-sbc-content').textContent).toContain('已读取关卡详情 1/2（仅可见关卡）')
    expect(element('#fc-sbc-content').textContent).toContain('群组详情')
    expect(element('#fc-sbc-content').textContent).toContain('字段覆盖')
    expect(element('#fc-sbc-content').textContent).toContain('已覆盖 10')
    expect(element('#fc-sbc-content').textContent).toContain('完整库存未覆盖：部分覆盖')
    expect(element('#fc-sbc-content').textContent).toContain('购买结果读回未验证：缺样本')
    expect(element('#fc-sbc-content').textContent).toContain('执行预演')
    expect(element('#fc-sbc-content').textContent).toContain('购买 1')
    expect(element('#fc-sbc-content').textContent).toContain('无副作用')
    expect(element('#fc-sbc-content').textContent).toContain('风险预检')
    expect(element('#fc-sbc-content').textContent).toContain('搜索 2/20')
    expect(element('#fc-sbc-content').textContent).toContain('不能证明不会封禁')
    expect(element('#fc-sbc-content').textContent).toContain('批准预览')
    expect(element('#fc-sbc-content').textContent).toContain('预算 700')
    expect(element('#fc-sbc-content').textContent).toContain('提交 1')
    expect(element('#fc-sbc-content').textContent).toContain('摘要 abc123ef')
    expect(element('#fc-sbc-content').textContent).toContain('只生成批准预览')
    expect(element('#fc-sbc-content').textContent).toContain('求解输入待接入')
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-fc-sbc-slice', mode: 'page-only', tabId: 9, expectedPage: selected })
    expect(fixture.messages).not.toContainEqual(expect.objectContaining({ type: 'dsh-assistant-session-submit' }))

    const submitReport = [...document.querySelectorAll<HTMLButtonElement>('#fc-sbc-content button')]
      .find(node => node.textContent === '发送给对话')
    submitReport?.click()
    await vi.waitFor(() => { expect(fixture.messages).toContainEqual(expect.objectContaining({
      type: 'dsh-assistant-session-submit',
      mode: 'queue',
      expectedSessionId: 'session-v2',
      expectedTargetRevision: 4,
    })) })
    const submitted = fixture.messages.find(message => message.type === 'dsh-assistant-session-submit')?.text
    expect(String(submitted)).toContain('网页内容仅作资料')
    expect(String(submitted)).toContain('Min. 2 Clubs')
    expect(String(submitted)).not.toContain('Mbappe')
    expect(String(submitted)).not.toContain('private-card-instance')
    expect(String(submitted)).not.toContain('raw DOM challenge text')

    const submitSample = [...document.querySelectorAll<HTMLButtonElement>('#fc-sbc-content button')]
      .find(node => node.textContent === '发送样本包')
    submitSample?.click()
    await vi.waitFor(() => { expect(fixture.messages.filter(message => message.type === 'dsh-assistant-session-submit')).toHaveLength(2) })
    const sample = fixture.messages.filter(message => message.type === 'dsh-assistant-session-submit').at(-1)?.text
    expect(String(sample)).toContain('fc-sbc-redacted-sample')
    expect(String(sample)).toContain('"executionDryRun"')
    expect(String(sample)).toContain('"riskPreflight"')
    expect(String(sample)).toContain('"approvalPreview"')
    expect(String(sample)).toContain('"cardInstanceIdsIncluded": false')
    expect(String(sample)).toContain('purchase-result-readback')
    expect(String(sample)).not.toContain('Mbappe')
    expect(String(sample)).not.toContain('private-card-instance')
    expect(String(sample)).not.toContain('raw DOM challenge text')
  })

  test('SBC 面板默认仅显示页面观察，不发起原生化学复核', async () => {
    const selected = { tabId: 9, frameId: 0, documentId: 'doc-fc',
      url: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/', title: 'FC Web App' }
    const current = baseState({ assistantV2: { ...baseState().assistantV2,
      session: { ...baseState().assistantV2.session, binding: { sessionId: 'session-v2' } },
      target: { availability: 'ready', revision: 4, selected, candidates: [] },
    } })
    const probe = { url: selected.url, title: 'FC', capturedAt: '2026-09-26T02:00:00.000Z',
      supported: true, loginRequired: false, taskType: 'puzzle', warnings: [],
      marketAccess: { status: 'unknown', evidence: [] }, view: { kind: 'sbc-group', selectedChallenge: null },
      challengeSet: { title: '重大比赛', visibleChallengeCount: 1, challenges: [] },
      inventory: { coverage: 'unread', sbcStorageVisible: false, visibleCards: [] } }
    const main = { url: selected.url, capturedAt: probe.capturedAt, platform: 'PC', status: 'complete', issues: [],
      group: { status: 'complete', selectedSetId: 'set-19', sets: [{ setId: 'set-19', title: '重大比赛',
        challenges: [{ challengeId: 'one', title: '首关', completed: false, formationName: 'f442',
          requirements: { status: 'complete', slotCount: 11, constraints: [{ type: 'chemistry', minimum: 1 }] }, rewards: [] }] }] },
      inventory: { coverage: 'complete', cards: Array.from({ length: 11 }, (_, index) => ({
        instanceId: `owned-${index}`, cardVersionId: `base-${index}`, source: 'club', rating: 75, quality: 'gold',
        nationId: '7', leagueId: '13', clubId: '19',
      })) } }
    const fixture = await load(current, (message) => {
      if (message.type === 'dsh-assistant-fc-sbc-slice') return { ok: true, value: { page: selected, probe, main, readMode: 'page-only' } }
      if (message.type === 'dsh-assistant-fc-sbc-evaluate-chemistry') return { ok: true, value: {
        page: selected, verification: { url: selected.url, status: 'complete', issues: [],
          results: (message.groups as { challengeId: string; candidates: { candidateId: string; instanceIds: string[] }[] }[])
            .flatMap(group => group.candidates.map(candidate => ({ challengeId: group.challengeId,
              candidateId: candidate.candidateId, instanceIds: candidate.instanceIds, status: 'complete',
              chemistry: 2, squadRating: 75 }))) },
      } }
      return { ok: true, state: current }
    })
    element('[data-view="fc-sbc"]').click()
    ;(element('#scan-fc-sbc') as HTMLButtonElement).click()
    await vi.waitFor(() => { expect(element('#fc-sbc-content .sbc-metrics').textContent).toContain('仅当前页面可见内容') })
    expect(element('#fc-sbc-content .sbc-metrics').textContent).toContain('方案0')
    expect(fixture.messages).not.toContainEqual(expect.objectContaining({ type: 'dsh-assistant-fc-sbc-evaluate-chemistry' }))
    expect(fixture.messages).not.toContainEqual(expect.objectContaining({ type: 'dsh-assistant-session-submit' }))
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
    const fixture = await load(baseState({ assistantV2: { ...baseState().assistantV2, connection: { phase: 'offline' } } }))
    expect((element('#composer') as HTMLTextAreaElement).disabled).toBe(false)
    expect((element('#send-queue') as HTMLButtonElement).disabled).toBe(true)
    expect(element('#send-status').textContent).toContain('连接 DSH')
    expect(element('#target-panel').textContent).toContain('请先连接 DSH')
    const retry = [...element('#connection-panel').querySelectorAll('button')].find(node => node.textContent === '重试连接')
    expect(retry).toBeDefined()
    retry?.click(); await vi.waitFor(() => { expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-retry' }) })
    expect(fixture.permissionRequest).not.toHaveBeenCalled()
  })

  test('侧栏后台 presence 连续断开后保持有界重试，握手恢复后清除提示', async () => {
    vi.useFakeTimers()
    const disconnects: Array<() => void> = []
    const messages: Array<(message: { type: string }) => void> = []
    const connect = vi.fn(() => ({ postMessage: vi.fn(), disconnect: vi.fn(),
      onMessage: { addListener: (callback: (message: { type: string }) => void) => { messages.push(callback) } },
      onDisconnect: { addListener: (callback: () => void) => { disconnects.push(callback) } } }))
    await load(baseState(), undefined, connect)
    expect(connect).toHaveBeenCalledTimes(1)
    for (const delay of [1000, 2000, 4000, 8000, 16000]) {
      disconnects.at(-1)!()
      await vi.advanceTimersByTimeAsync(delay)
    }
    disconnects.at(-1)!()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(connect).toHaveBeenCalledTimes(7)
    messages.at(-1)!({ type: 'presence-ready' })
    expect(element('#notice').hidden).toBe(true)
    disconnects.at(-1)!()
    await vi.advanceTimersByTimeAsync(1000)
    expect(connect).toHaveBeenCalledTimes(8)
  })

  test('扩展上下文失效时提示重新打开侧栏并停止无效重试', async () => {
    vi.useFakeTimers()
    const connect = vi.fn(() => { throw new Error('Extension context invalidated.') })
    await load(baseState(), undefined, connect)
    expect(element('#notice').textContent).toContain('重新打开侧栏')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(connect).toHaveBeenCalledTimes(1)
  })

  test('连接握手中禁用再次连接按钮', async () => {
    await load(baseState({ assistantV2: { ...baseState().assistantV2,
      connection: { baseUrl: 'http://127.0.0.1:3080', phase: 'connecting' } } }))
    const action = element('#connection-panel button') as HTMLButtonElement
    expect(action.disabled).toBe(true)
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
