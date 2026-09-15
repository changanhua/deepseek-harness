/** @vitest-environment jsdom */
/** @vitest-environment-options {"url":"https://example.test/feed"} */
import { afterEach, describe, expect, test, vi } from 'vitest'
import source from '../src/browser-page.js?raw'

const browserPageSource: unknown = source

interface BrowserIdentity {
  protocolVersion: number
  installationId: string
  grantEpoch: number
  requestId: string
  sessionId: string
  deadline: number
  fingerprint: string
}

interface BrowserRequest extends BrowserIdentity {
  target?: { tabId: number; frameId: number; documentId: string }
  payload: {
    kind: string
    page?: { tabId: number; frameId: number; documentId: string; url: string }
    mountId?: string
    selector?: string
    label?: string
    titleSelector?: string
    linkSelector?: string
    collected?: string[]
  }
}

interface BrowserReceipt {
  outcome: string
  reason?: string
  quiescent?: boolean
  value?: unknown
}

type BrowserPageGlobal = typeof globalThis & { __dshBrowserAssistant?: {
  entryMount(request: BrowserRequest): BrowserReceipt
  entryUnmount(request: BrowserRequest): BrowserReceipt
} }

const identity = (requestId: string, extra: Partial<BrowserIdentity> = {}): BrowserIdentity => ({
  protocolVersion: 1, installationId: 'installation-1', grantEpoch: 7, requestId, sessionId: 'session-1',
  deadline: Date.now() + 10_000, fingerprint: `${requestId}-fingerprint`, ...extra,
})

const page = { tabId: 1, frameId: 0, documentId: 'doc-feed', url: 'https://example.test/feed' }
const target = { tabId: page.tabId, frameId: page.frameId, documentId: page.documentId }

const install = (): BrowserPageGlobal['__dshBrowserAssistant'] => {
  if (typeof browserPageSource !== 'string') throw new Error('browser page source is not text')
  globalThis.eval(browserPageSource)
  const assistant = (globalThis as BrowserPageGlobal).__dshBrowserAssistant
  if (assistant === undefined) throw new Error('browser assistant did not install')
  return assistant
}

const mountRequest = (mountId: string, extra: Partial<BrowserRequest['payload']> = {}): BrowserRequest => ({
  ...identity(`mount-${mountId}`, { requestId: `mount-${mountId}` }),
  target,
  payload: { kind: 'entry_mount', page, mountId, selector: '.item', label: '收集标题', ...extra },
})

const flushObservers = async () => {
  await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
}

afterEach(() => {
  const assistant = (globalThis as BrowserPageGlobal).__dshBrowserAssistant
  if (assistant?.entryUnmount) {
    const ids = [...document.querySelectorAll<HTMLElement>('[data-dsh-entry-mount-id]')]
      .map(button => button.getAttribute('data-dsh-entry-mount-id')).filter((value): value is string => Boolean(value))
    for (const mountId of new Set(ids)) assistant.entryUnmount({
      ...identity(`clean-${mountId}`), target,
      payload: { kind: 'entry_unmount', page, mountId },
    })
  }
  document.body.innerHTML = ''
  delete (globalThis as typeof globalThis & { __dshBrowserAssistant?: unknown }).__dshBrowserAssistant
  delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome
  vi.useRealTimers()
})

describe('持久化页面条目挂载', () => {
  test('entryMount 为每个匹配项插入按钮并报告挂载数', () => {
    document.body.innerHTML = '<div class="item"><a href="https://example.test/a">标题 A</a></div>'
      + '<div class="item"><a href="https://example.test/b">标题 B</a></div>'
    const assistant = install()
    const receipt = assistant.entryMount(mountRequest('collect'))
    expect(receipt).toMatchObject({ outcome: 'observed', quiescent: true, value: { mounted: 2 } })
    const buttons = document.querySelectorAll('[data-dsh-entry-mount]')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].textContent).toBe('收集标题')
  })

  test('点击按钮把标题与链接回传给 assistant', async () => {
    const sendMessage = vi.fn(async () => {})
    ;(globalThis as typeof globalThis & { chrome: unknown }).chrome = { runtime: { sendMessage } }
    document.body.innerHTML = '<div class="item"><a href="https://example.test/a">标题 A</a></div>'
    const assistant = install()
    assistant.entryMount(mountRequest('collect'))
    ;(document.querySelector('[data-dsh-entry-mount]') as HTMLButtonElement).click()
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dsh-entry-click', mountId: 'collect', documentId: 'doc-feed', url: 'https://example.test/feed',
      entry: { title: '标题 A', link: 'https://example.test/a' },
    }))
  })

  test('同 mountId 重复挂载先移除旧按钮再重建，不产生重复项', () => {
    document.body.innerHTML = '<div class="item"><a href="https://example.test/a">标题 A</a></div>'
    const assistant = install()
    assistant.entryMount(mountRequest('collect'))
    const first = document.querySelectorAll('[data-dsh-entry-mount]')
    expect(first).toHaveLength(1)
    const rebuilt = assistant.entryMount(mountRequest('collect'))
    expect(rebuilt).toMatchObject({ outcome: 'observed', value: { mounted: 1 } })
    expect(document.querySelectorAll('[data-dsh-entry-mount]')).toHaveLength(1)
    expect(document.querySelector('[data-dsh-entry-mount]')).not.toBe(first[0])
  })

  test('collected 中的链接渲染为已加入且禁用', () => {
    document.body.innerHTML = '<div class="item"><a href="https://example.test/a">标题 A</a></div>'
      + '<div class="item"><a href="https://example.test/b">标题 B</a></div>'
    const assistant = install()
    assistant.entryMount(mountRequest('collect', { collected: ['https://example.test/a'] }))
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-dsh-entry-mount]')]
    expect(buttons[0].textContent).toContain('已加入')
    expect(buttons[0].disabled).toBe(true)
    expect(buttons[1].textContent).toBe('收集标题')
    expect(buttons[1].disabled).toBe(false)
  })

  test('新插入的匹配项会被 MutationObserver 补挂', async () => {
    document.body.innerHTML = '<div class="item"><a href="https://example.test/a">标题 A</a></div>'
    const assistant = install()
    assistant.entryMount(mountRequest('collect'))
    expect(document.querySelectorAll('[data-dsh-entry-mount]')).toHaveLength(1)
    const item = document.createElement('div')
    item.className = 'item'
    item.innerHTML = '<a href="https://example.test/c">标题 C</a>'
    document.body.appendChild(item)
    await flushObservers()
    expect(document.querySelectorAll('[data-dsh-entry-mount]')).toHaveLength(2)
  })

  test('entryUnmount 移除按钮与观察者', async () => {
    document.body.innerHTML = '<div class="item"><a href="https://example.test/a">标题 A</a></div>'
    const assistant = install()
    assistant.entryMount(mountRequest('collect'))
    expect(document.querySelectorAll('[data-dsh-entry-mount]')).toHaveLength(1)
    const receipt = assistant.entryUnmount({ ...identity('unmount', { requestId: 'unmount' }), target,
      payload: { kind: 'entry_unmount', page, mountId: 'collect' } })
    expect(receipt).toMatchObject({ outcome: 'observed', quiescent: true, value: { unmounted: true } })
    expect(document.querySelectorAll('[data-dsh-entry-mount]')).toHaveLength(0)
    const item = document.createElement('div')
    item.className = 'item'
    item.innerHTML = '<a href="https://example.test/d">标题 D</a>'
    document.body.appendChild(item)
    await flushObservers()
    expect(document.querySelectorAll('[data-dsh-entry-mount]')).toHaveLength(0)
  })

  test('非法载荷被拒绝且不改变页面', () => {
    const assistant = install()
    const receipt = assistant.entryMount({ ...identity('bad', { requestId: 'bad' }), target,
      payload: { kind: 'entry_mount', page, mountId: '', selector: '.item', label: 'x' } })
    expect(receipt).toMatchObject({ outcome: 'failed', reason: 'invalid_action', quiescent: true })
    expect(document.querySelectorAll('[data-dsh-entry-mount]')).toHaveLength(0)
  })

  test('目标 URL 与当前文档不一致时拒绝挂载', () => {
    document.body.innerHTML = '<div class="item">x</div>'
    const assistant = install()
    const receipt = assistant.entryMount({ ...identity('stale', { requestId: 'stale' }), target,
      payload: { kind: 'entry_mount', page: { ...page, url: 'https://example.test/other' }, mountId: 'collect', selector: '.item', label: 'x' } })
    expect(receipt).toMatchObject({ outcome: 'failed', reason: 'stale_document', quiescent: true })
    expect(document.querySelectorAll('[data-dsh-entry-mount]')).toHaveLength(0)
  })
})
