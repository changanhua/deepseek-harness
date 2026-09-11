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
  connection: { baseUrl: 'http://127.0.0.1:3080', phase: 'connected' },
  session: {
    binding: { baseUrl: 'http://127.0.0.1:3080', installationId: '00000000-0000-4000-8000-000000000000', sessionId: 'session-1' },
    pending: null, pendingCreate: null, records: [] as Record<string, unknown>[], header: null, cursor: -1,
    phase: 'live', error: null, truncated: false, hasMore: false, streamId: 'stream-1',
  },
  contexts: [], page: { url: 'https://example.test/page', title: '当前网页' }, unresolved: [],
  ...overrides,
})

const load = async (current: unknown = baseState(), reply?: (message: Record<string, unknown>) => unknown) => {
  document.body.innerHTML = markup
  const messages: Record<string, unknown>[] = []
  const listener = vi.fn<(callback: (message: { type: string }) => void) => void>()
  const chromeApi = {
    runtime: {
      sendMessage: vi.fn(async (message: Record<string, unknown>) => {
        messages.push(message)
        return reply?.(message) ?? { ok: true, state: current }
      }),
      onMessage: { addListener: listener },
    },
    permissions: { request: vi.fn(async () => true) },
  }
  vi.stubGlobal('chrome', chromeApi)
  await import('../src/sidebar.js')
  await Promise.resolve()
  await Promise.resolve()
  return { messages, listener, chromeApi }
}

function element(selector: string): HTMLElement {
  const result = document.querySelector<HTMLElement>(selector)
  if (!result) throw new Error('Missing fixture element: ' + selector)
  return result
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); document.body.replaceChildren() })

describe('DSH 浏览器助手侧栏', () => {
  test('网页操作引擎默认 Puppeteer 并可在设置切到 DOM 兼容模式', async () => {
    const fixture = await load(baseState())
    const select = element('#browser-engine') as HTMLSelectElement
    expect(select.value).toBe('puppeteer')
    select.value = 'dom'
    select.dispatchEvent(new Event('change'))
    await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-browser-engine', engine: 'dom' })
  })
  test('正文按钮只采集草稿，并呈现截断与未展开内容提示', async () => {
    const fixture = await load(baseState({ contexts: [{ id: 'body-1', kind: 'page-body', text: '正文片段',
      textTruncated: true, incomplete: true, page: { title: '正文来源', url: 'https://example.test/article' } }] }))
    element('#capture-body').click()
    await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-context-capture', kind: 'page-body' })
    expect(fixture.messages).not.toContainEqual(expect.objectContaining({ type: 'dsh-assistant-session-submit' }))
    expect(element('#contexts').textContent).toContain('正文达到采集上限，已截断')
    expect(element('#contexts').textContent).toContain('未采集折叠或仍在更新的内容')
  })
  test('当前采集区展示内容状态，并能打开已导入内容', async () => {
    const fixture = await load(baseState({ capture: {
      captureId: '123e4567-e89b-42d3-a456-426614174000', title: '当前页面', markdown: '正文',
      source: { url: 'https://example.test/article', pageTitle: '来源页' }, status: 'saved', entryId: 'web:123e4567-e89b-42d3-a456-426614174000',
    } }))
    expect(element('#capture-panel').textContent).toContain('已导入内容库')
    element('#capture-open-entry').click(); await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-capture-open-entry', entryId: 'web:123e4567-e89b-42d3-a456-426614174000' })
  })
  test('当前采集区显示内容库连接状态，并提供单独连接动作', async () => {
    const fixture = await load(baseState({ captureConnection: { phase: 'configured' }, capture: {
      captureId: '123e4567-e89b-42d3-a456-426614174000', title: '当前页面', markdown: '正文',
      source: { url: 'https://example.test/article', pageTitle: '来源页' }, status: 'draft',
    } }))
    expect(element('#capture-panel').textContent).toContain('内容库尚未连接')
    element('#capture-connect').click(); await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-capture-connect' })
  })
  test('当前页面区显示页面身份，提醒用户采集动作作用于哪个标签页', async () => {
    await load(baseState({ page: { tabId: 7, windowId: 1, url: 'https://example.test/article', title: '当前文章' } }))
    expect(element('#page-panel').textContent).toContain('当前文章')
    expect(element('#page-panel').textContent).toContain('https://example.test/article')
  })
  test('未知动作显示原会话与目标，查看和人工核对都只针对原请求', async () => {
    const identity = { requestId: 'old-write', sessionId: 'session-1', installationId: 'install', grantEpoch: 1 }
    const fixture = await load(baseState({ unresolved: [{ identity, target: { tabId: 7 }, outcome: 'unknown' }] }))
    const panel = element('#unresolved-actions')
    expect(panel.textContent).toContain('标签 7')
    const original = panel.querySelectorAll('button')[1]
    fixture.listener.mock.calls[0][0]({ type: 'dsh-state-changed' })
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(panel.querySelectorAll('button')[1]).toBe(original)
    ;[...panel.querySelectorAll('button')].find(button => button.textContent === '查看目标标签')!.click()
    ;[...panel.querySelectorAll('button')].find(button => button.textContent === '我已核对页面，接受未知结果')!.click()
    await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-reveal-target', requestId: 'old-write' })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-acknowledge', identity })
    expect(fixture.messages).not.toContainEqual(expect.objectContaining({ type: 'dsh-assistant-session-submit' }))
  })
  test('动作确认显示当前会话的原始理由，按钮只发送该次审批身份', async () => {
    const fixture = await load(baseState({ approvals: { sessionId: 'session-1', requests: [{ id: 'approval-1', toolName: 'browser_action', reason: '<script>购买</script>\n填写金额 20' }] } }))
    const panel = element('#action-approvals')
    expect(panel.textContent).toContain('<script>购买</script>')
    expect(panel.querySelector('script')).toBeNull()
    ;[...panel.querySelectorAll('button')].find(button => button.textContent === '允许这一次')!.click()
    await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-approval-decide', id: 'approval-1', decision: 'allowed-once' })
  })
  test('其它会话的动作确认不在当前侧栏显示', async () => {
    await load(baseState({ approvals: { sessionId: 'foreign', requests: [{ id: 'approval-1', toolName: 'browser_action', reason: '不能批准' }] } }))
    expect(element('#action-approvals')?.hidden).toBe(true)
  })
  test('个人模式授权一次覆盖所有网站，并向 DSH 申请全站读写', async () => {
    const fixture = await load()
    expect(element('#site-access')?.textContent).toContain('尚未授权所有网站')
    element('#authorize-all-sites').click()
    await Promise.resolve(); await Promise.resolve()
    expect(fixture.chromeApi.permissions.request).toHaveBeenCalledExactlyOnceWith({ origins: ['http://*/*', 'https://*/*'] })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-connect',
      scopes: ['session:interact', 'browser:read', 'browser:write', 'browser:observe'], origins: ['*'] })
  })
  test('Chrome 拒绝全站权限后不向 DSH 申请授权', async () => {
    const fixture = await load()
    fixture.chromeApi.permissions.request.mockResolvedValue(false)
    element('#authorize-all-sites').click(); await Promise.resolve(); await Promise.resolve()
    expect(fixture.messages).not.toContainEqual(expect.objectContaining({ type: 'dsh-assistant-connect' }))
    expect(element('#notice')?.textContent).toContain('未授予')
  })
  test('流式文本先显示，最终回复替换它而不重复', async () => {
    const current = baseState({ session: { ...baseState().session, records: [{ type: 'event', event: {
      type: 'assistant/chunk', seq: 0, time: 1, data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: '正在回答' } },
    } }] } })
    const fixture = await load(current)
    expect(element('#conversation')?.textContent).toContain('正在回答')
    current.session.records.push({ type: 'event', event: { type: 'assistant/message', seq: 1, time: 2,
      data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '完整回答' }] } } } })
    fixture.listener.mock.calls[0][0]({ type: 'dsh-state-changed' })
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(document.querySelectorAll('.message.assistant')).toHaveLength(1)
    expect(element('#conversation')?.textContent).toContain('完整回答')
  })
  test('上下文可以单独发送，accepted 请求不提示未发送或重试', async () => {
    const fixture = await load(baseState({ contexts: [{ id: 'c', kind: 'selection', text: '页面资料', page: { title: '页面', url: 'https://example.test' } }],
      session: { ...baseState().session, pending: { requestId: 'r', content: [{ type: 'text', text: '上一条' }], status: 'accepted' } } }))
    expect(element('#pending-actions')?.textContent).not.toContain('尚未发送')
    element('#send-queue').click(); await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-session-submit', text: '', mode: 'queue' })
  })
  test('内部用户角色上下文不冒充人的输入显示', async () => {
    await load(baseState({ session: { ...baseState().session, records: [{ type: 'event', event: {
      type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'agent-instructions' }, content: [{ type: 'text', text: 'Internal harness instructions' }] },
    } }] } }))
    expect(element('#conversation')?.textContent).not.toContain('Internal harness instructions')
  })
  test('未绑定时主界面直接连接默认 3080，不需要进入设置', async () => {
    const fixture = await load(baseState({ connection: { baseUrl: 'http://127.0.0.1:3080', phase: 'configured' }, session: { ...baseState().session, binding: null, phase: 'idle' } }))
    expect(element('#settings')?.hidden).toBe(true)
    const connect = [...document.querySelectorAll('button')].find(node => node.textContent === '连接本机 DSH')
    expect(connect).toBeDefined()
    connect!.click()
    await Promise.resolve(); await Promise.resolve()
    expect(fixture.chromeApi.permissions.request).toHaveBeenCalledExactlyOnceWith({ origins: ['http://*/*', 'https://*/*'] })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-connect',
      scopes: ['session:interact', 'browser:read', 'browser:write', 'browser:observe'], origins: ['*'] })
    expect(fixture.messages).not.toContainEqual(expect.objectContaining({ type: 'dsh-assistant-configure' }))
  })

  test('等待批准时能从主界面重开批准页或取消', async () => {
    const fixture = await load(baseState({ connection: { baseUrl: 'http://127.0.0.1:3080', phase: 'pending' } }))
    const buttons = [...document.querySelectorAll('button')]
    const open = buttons.find(node => node.textContent === '打开批准页')
    const cancel = buttons.find(node => node.textContent === '取消连接')
    expect(open).toBeDefined()
    expect(cancel).toBeDefined()
    open!.click(); cancel!.click()
    await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-open-approval' })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-cancel' })
  })

  test('选择会话、新建会话并提交队列输入', async () => {
    const fixture = await load()
    element('#session-picker').click()
    await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-session-list' })
    element('#new-session').click()
    element('#composer').value = '继续检查这一页'
    element('#send-queue').click()
    await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-session-create' })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-session-submit', text: '继续检查这一页', mode: 'queue' })
  })

  test('连接后首次发送由后台创建会话，重复点击只提交一次', async () => {
    const initial = baseState({ session: { ...baseState().session, binding: null, phase: 'idle' } })
    let resolveCreate!: (value: unknown) => void
    const creation = new Promise((done) => { resolveCreate = done })
    const fixture = await load(initial, (message) => {
      if (message.type === 'dsh-assistant-session-submit') return creation
      return { ok: true, state: initial }
    })
    const input = element('#composer') as HTMLTextAreaElement
    const send = element('#send-queue') as HTMLButtonElement
    input.value = '看看当前页面'
    expect(send.disabled).toBe(false)
    send.click(); send.click()
    expect(fixture.messages.filter(message => message.type === 'dsh-assistant-session-create')).toHaveLength(0)
    expect(fixture.messages.filter(message => message.type === 'dsh-assistant-session-submit')).toHaveLength(1)
    resolveCreate({ ok: true, state: baseState() })
    await vi.waitFor(() => {
      expect(fixture.messages.filter(message => message.type === 'dsh-assistant-session-submit')).toEqual([
        { type: 'dsh-assistant-session-submit', text: '看看当前页面', mode: 'queue' },
      ])
      expect(input.value).toBe('')
      expect(send.disabled).toBe(false)
    })
  })

  test('首次创建未确认时保留输入，不向未知会话发送文字', async () => {
    const initial = baseState({ session: { ...baseState().session, binding: null, phase: 'idle' } })
    const fixture = await load(initial, message => message.type === 'dsh-assistant-session-submit'
      ? { ok: false, error: 'result_unknown' }
      : { ok: true, state: initial })
    const input = element('#composer') as HTMLTextAreaElement
    input.value = '保留这条草稿'
    element('#send-queue').click()
    await vi.waitFor(() => expect(element('#notice').textContent).toContain('提交结果尚未确认'))
    expect(input.value).toBe('保留这条草稿')
    expect(fixture.messages.filter(message => message.type === 'dsh-assistant-session-submit')).toHaveLength(1)
  })

  test('离线时解释为什么不能发送，并保留可编辑草稿', async () => {
    await load(baseState({ connection: { phase: 'offline' } }))
    expect((element('#send-queue') as HTMLButtonElement).disabled).toBe(true)
    expect((element('#composer') as HTMLTextAreaElement).disabled).toBe(false)
    expect(element('#send-status').textContent).toContain('连接')
  })

  test('unknown 请求只能重试原请求，不会再提交新的 prompt', async () => {
    const fixture = await load(baseState({ session: { ...baseState().session, pending: {
      requestId: 'request-1', content: [{ type: 'text', text: '旧问题' }], mode: 'queue', status: 'unknown',
    } } }))
    expect(element('#composer').disabled).toBe(true)
    element('#retry-prompt').click()
    await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-session-retry' })
    expect(fixture.messages).not.toContainEqual(expect.objectContaining({ type: 'dsh-assistant-session-submit' }))
  })

  test('停止会话、来源预览与清除都走既定消息', async () => {
    const fixture = await load(baseState({ contexts: [{ id: 'selection-1', kind: 'selection', page: { url: 'https://example.test/page', title: '来源标题' }, text: '选中的文字' }] }))
    element('#stop-session').click()
    element('#capture-screenshot').click()
    element('[data-context-id="selection-1"] .remove-context').click()
    await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-session-stop' })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-context-capture', kind: 'screenshot' })
    expect(fixture.messages).toContainEqual({ type: 'dsh-assistant-context-remove', id: 'selection-1' })
    expect(document.body.textContent).toContain('来源标题')
    expect(document.body.textContent).toContain('example.test')
  })

  test('文本消息按纯文本 Markdown 渲染，不把输入解释成 HTML', async () => {
    await load(baseState({ session: { ...baseState().session, records: [{ type: 'event', event: {
      type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: '你好 <img src=x>' }], source: { kind: 'user', rpcId: 'request-1' } },
    } }] } }))
    expect(document.querySelector('.message img')).toBeNull()
    expect(document.querySelector('.message').textContent).toContain('你好 <img src=x>')
  })

  test('附件回复只在仍绑定原会话时显示图片', async () => {
    await load(baseState({ session: { ...baseState().session, records: [{ type: 'event', event: {
      type: 'assistant/message', seq: 1, time: 1, data: { turn: 1, step: 1, message: { content: [{ type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png' } }] } },
    } }] } }), message => message.type === 'dsh-assistant-session-attachment'
      ? { ok: true, value: { attachment: { attachmentId: 'att-1', mediaType: 'image/png' }, data: 'AQ==' } }
      : undefined)
    await Promise.resolve()
    expect(element('.message img').getAttribute('src')).toContain('data:image/png;base64,AQ==')
  })

  test('状态刷新不覆盖正在输入的文本，窄屏没有横向溢出', async () => {
    const fixture = await load()
    const composer = element('#composer')
    if (!(composer instanceof HTMLTextAreaElement)) throw new Error('Missing composer textarea')
    composer.value = '尚未发送的草稿'
    fixture.listener.mock.calls[0][0]({ type: 'dsh-state-changed' })
    await Promise.resolve()
    expect(composer.value).toBe('尚未发送的草稿')
    expect(styles).toMatch(/overflow-x:\s*hidden/)
  })
})
