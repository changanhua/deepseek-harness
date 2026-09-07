/** @vitest-environment jsdom */
import { afterEach, describe, expect, test, vi } from 'vitest'

const capture = {
  captureId: 'capture-1', title: '一条可回看的内容', markdown: '## 标题\n\n正文 <img src=x>', baseUrl: 'http://127.0.0.1:3080',
  source: { site: 'chatgpt', scope: 'single-reply', url: 'https://chatgpt.com/c/example' }, status: 'draft', attempted: false,
}

const state = (captureState: typeof capture | null) => ({
  connection: { baseUrl: 'http://127.0.0.1:3080', phase: 'connected' }, capture: captureState,
  page: { tabId: 12, url: 'https://chatgpt.com/c/example', title: '一段对话', site: 'chatgpt', quickEnabled: true },
})

const markup = `
  <section id="notice"></section><button id="connection-status"></button><button id="show-settings"></button>
  <section id="empty"><strong id="page-title"></strong><p id="empty-hint"></p><button id="capture-selection"></button><button id="choose-reply"></button><button id="enable-site"></button></section>
  <section id="capture"><span id="source-label"></span><button id="open-source"></button><input id="title"><button id="edit-title"></button><p id="capture-destination"></p><article id="markdown"></article></section>
  <section id="settings"><button id="hide-settings"></button><strong id="settings-phase"></strong><span id="settings-current-url"></span><input id="base-url"></section><footer id="footer"></footer>`

const load = async (current: ReturnType<typeof state>) => {
  document.body.innerHTML = markup
  const messages: Array<{ type?: string; captureId?: string }> = []
  const listener = vi.fn()
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn(async (message: unknown) => {
        if (typeof message === 'object' && message !== null) messages.push(message)
        return { ok: true, state: current }
      }),
      onMessage: { addListener: listener },
    },
    permissions: { request: vi.fn(async () => true) },
  })
  await import('../src/sidebar.js')
  await Promise.resolve()
  return { messages, listener }
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('收藏侧栏', () => {
  test('把草稿渲染为阅读预览，并以 captureId 保存', async () => {
    const fixture = await load(state(capture))
    expect(document.querySelector('#title')?.hasAttribute('readonly')).toBe(true)
    expect(document.querySelector('#markdown h2')?.textContent).toBe('标题')
    expect(document.querySelector('#markdown img')).toBeNull()
    const save = document.querySelector('.primary') as HTMLButtonElement
    save.click()
    await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-save', captureId: 'capture-1' })
  })

  test('已经尝试的材料不能编辑或丢弃', async () => {
    await load(state({ ...capture, status: 'unknown', attempted: true }))
    expect(document.querySelector('#title')?.hasAttribute('readonly')).toBe(true)
    expect(document.querySelector('#edit-title')?.hidden).toBe(true)
    expect([...document.querySelectorAll('button')].map(node => node.textContent)).not.toContain('丢弃这份草稿')
  })

  test('已保存材料继续采集时只清除侧栏预览', async () => {
    const fixture = await load(state({ ...capture, status: 'saved', attempted: true, entryId: 'entry-1' }))
    const next = [...document.querySelectorAll('button')].find(node => node.textContent === '继续采集') as HTMLButtonElement
    next.click()
    await Promise.resolve()
    expect(fixture.messages).toContainEqual({ type: 'dsh-discard', captureId: 'capture-1' })
  })
})
