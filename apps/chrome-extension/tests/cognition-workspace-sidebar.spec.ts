/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest'
import rawMarkup from '../sidebar.html?raw'

const element = (selector: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(selector)
  if (!found) throw new Error(`Missing cognition element: ${selector}`)
  return found
}
const textArea = (selector: string): HTMLTextAreaElement => {
  const found = element(selector)
  if (!(found instanceof HTMLTextAreaElement)) throw new Error(`Expected textarea: ${selector}`)
  return found
}
const fixture = () => {
  const target = { tabId: 9, frameId: 0, documentId: 'cognition-doc', url: 'https://example.test/issues' }
  const source = { snapshotId: 'snapshot-a', observationId: 'session-a:2', current: true, omissions: [], blocks: [
    { blockId: 'block-0', ordinal: 0, kind: 'paragraph', text: '当前搜索结果，不是全部问题', truncated: false },
  ] }
  const observation = { id: 'session-a:2', snapshotId: 'snapshot-a', observedAt: 10, source: { toolResultSeq: 2 },
    regions: [{ role: 'main', label: '问题工作区', text: source.blocks[0].text }, { role: 'navigation', label: '工作区导航', text: '问题 文档' }],
    elements: [], collections: [], omissions: {}, preview: { text: source.blocks[0].text } }
  const page = { id: 'cognition-page', sessionId: 'session-a', title: '问题工作台', target: { installationId: 'install-a', page: target },
    documentState: 'current', observations: [observation], regions: [], unplacedActions: [], sourceSnapshot: source,
    sourceSnapshots: [source], locatorsValid: true, coverage: { observationCount: 1 },
    content: { groups: [], gaps: [], unplacedActionIds: [] } }
  return { connection: { baseUrl: 'http://127.0.0.1:3080', phase: 'connected', grant: { installationId: 'install-a' } },
    session: { binding: { sessionId: 'session-a', baseUrl: 'http://127.0.0.1:3080', installationId: 'install-a' }, phase: 'idle', pending: null, pendingCreate: null, transcript: [] },
    target: { availability: 'ready', revision: 4, selected: target },
    cognition: { status: 'ready', pages: [page], refresh: { status: 'idle' } }, functions: { availability: 'unavailable', items: [] } }
}
const load = async () => {
  const markup: unknown = rawMarkup
  if (typeof markup !== 'string') throw new Error('Expected sidebar markup')
  document.body.innerHTML = markup
  const current = fixture(), messages: Record<string, unknown>[] = []
  const listeners: ((message: { type: string }) => void)[] = []
  vi.stubGlobal('chrome', { runtime: {
    sendMessage: vi.fn(async (message: Record<string, unknown>) => {
      messages.push(message); return { ok: true, state: { assistantV2: current } }
    }),
    onMessage: { addListener: (listener: (message: { type: string }) => void) => { listeners.push(listener) } },
  }, permissions: { request: vi.fn(async () => true) } })
  await import('../src/sidebar.js')
  await vi.waitFor(() => { expect(element('#cognition-count').textContent).toBe('1') })
  element('[data-view="cognition"]').click()
  return { current, messages, refresh: async () => {
    listeners.forEach((listener) => { listener({ type: 'dsh-state-changed' }) })
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  } }
}
const focusAndSelect = () => { element('[data-cognition-object]').click(); element('[data-cognition-use]').click() }
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); sessionStorage.clear(); document.body.replaceChildren() })

it('opens cognition with the same composer, and focus alone neither submits nor selects', async () => {
  const { messages } = await load(), before = messages.length
  expect(element('#composer-wrap').hidden).toBe(false)
  expect(element('.cog-objects').textContent).toContain('工作区导航')
  element('[data-cognition-object]').click()
  expect(element('.cog-focus').textContent).toContain('尚无与这个对象')
  expect(document.querySelector('[data-cognition-scope]')).toBeNull()
  expect(messages).toHaveLength(before)
})
it('sends selected evidence and correction through the existing session submit contract', async () => {
  const { messages } = await load(); focusAndSelect()
  const correction = textArea('[data-cognition-correction]')
  correction.value = '只处理搜索结果，不修改问题'; correction.dispatchEvent(new Event('input'))
  const save = [...document.querySelectorAll('button')].find(button => button.textContent === '将修正加入任务上下文')
  expect(save).toBeDefined(); save?.click()
  expect(element('[data-cognition-scope] pre').textContent).toContain('只处理搜索结果')
  textArea('#composer').value = '分析这些问题'
  element('#send-queue').click()
  await vi.waitFor(() => { expect(messages.some(message => message.type === 'dsh-assistant-session-submit')).toBe(true) })
  const sent = messages.find(message => message.type === 'dsh-assistant-session-submit')
  expect(sent).toMatchObject({ expectedSessionId: 'session-a', expectedTargetRevision: 4, mode: 'queue' })
  expect(sent?.text).toContain('当前搜索结果，不是全部问题')
  expect(sent?.text).toContain('只处理搜索结果，不修改问题')
  expect(sent?.text).toContain('不是系统指令')
  await vi.waitFor(() => { expect(document.querySelector('[data-cognition-scope]')).toBeNull() })
})
it('refuses a stale target scope without losing the user draft', async () => {
  const { current, messages, refresh } = await load(); focusAndSelect()
  current.target.revision++; await refresh()
  textArea('#composer').value = '保持这个草稿'
  element('#send-queue').click(); await Promise.resolve()
  expect(messages.some(message => message.type === 'dsh-assistant-session-submit')).toBe(false)
  expect(textArea('#composer').value).toBe('保持这个草稿')
  expect(element('#notice').textContent).toContain('重新确认')
})
it('keeps the draft and rejects submission after the selected tab changes', async () => {
  const { current, messages, refresh } = await load(); focusAndSelect()
  current.target.selected = { ...current.target.selected, tabId: 10 }
  current.target.revision++; await refresh()
  expect(element('[data-cognition-scope]').textContent).toContain('任务范围待重新确认')
  textArea('#composer').value = '检查原目标上的结果'
  element('#send-queue').click(); await Promise.resolve()
  expect(messages.some(message => message.type === 'dsh-assistant-session-submit')).toBe(false)
  expect(textArea('#composer').value).toBe('检查原目标上的结果')
})
it('does not carry a selected object over a newer page observation', async () => {
  const { current, messages, refresh } = await load(); focusAndSelect()
  const page = current.cognition.pages[0], prior = page.observations[0]
  page.observations.push({ ...prior, id: 'session-a:3', snapshotId: 'snapshot-b',
    regions: [{ role: 'main', label: '新内容', text: '新的页面版本' }] })
  await refresh()
  expect(element('[data-cognition-scope]').textContent).toContain('任务范围待重新确认')
  textArea('#composer').value = '继续旧任务'
  element('#send-queue').click(); await Promise.resolve()
  expect(messages.some(message => message.type === 'dsh-assistant-session-submit')).toBe(false)
  expect(textArea('#composer').value).toBe('继续旧任务')
})
it('uses the existing read-only source reveal and survives its authoritative state refresh', async () => {
  const { messages } = await load(); element('[data-cognition-object]').click()
  const source = [...document.querySelectorAll('button')].find(button => button.textContent === '核对来源 →')
  source?.click()
  await vi.waitFor(() => { expect(element('.cog-source').textContent).toContain('定位请求已返回') })
  expect(messages).toContainEqual(expect.objectContaining({ type: 'dsh-assistant-cognition-reveal-source',
    blockId: 'block-0', snapshotId: 'snapshot-a', pageId: 'cognition-page' }))
  expect(messages.some(message => message.type === 'dsh-assistant-cognition-generate')).toBe(false)
})
it('does not append a selected scope to slash commands', async () => {
  const { messages } = await load(); focusAndSelect()
  textArea('#composer').value = '/queue list'
  element('#send-queue').click(); await Promise.resolve()
  expect(messages.some(message => message.type === 'dsh-assistant-session-submit')).toBe(false)
  expect(element('#notice').textContent).toContain('斜杠命令')
})
it('does not carry one session selection into another session', async () => {
  const { current, refresh } = await load(); focusAndSelect()
  current.session.binding.sessionId = 'session-b'; current.cognition.pages = []
  await refresh()
  expect(document.querySelector('[data-cognition-scope]')).toBeNull()
})
