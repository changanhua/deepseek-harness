/** @vitest-environment jsdom */
/** @vitest-environment-options {"url":"https://chatgpt.com/c/example"} */
import { afterEach, describe, expect, test, vi } from 'vitest'

type Message = { type: string; [key: string]: unknown }
type Reply = { ok: boolean; status?: string; entryId?: string; error?: string }
type ReplyCallback = (reply: Reply | undefined) => void
type SendMessage = (message: Message, callback?: ReplyCallback) => void

declare global {
  var chrome: { runtime: { lastError: Error | null; sendMessage: SendMessage; onMessage: { addListener: () => void } } }
  interface Window { __dshCaptureInstalled?: boolean }
}

const flushMutations = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
}

const install = async (sendMessage: SendMessage) => {
  delete window.__dshCaptureInstalled
  globalThis.chrome = { runtime: { lastError: null, sendMessage, onMessage: { addListener: () => {} } } }
  vi.resetModules()
  await import('../src/content-script.js')
}

const reply = (id: string) => `<article data-message-author-role="assistant" data-message-id="${id}"><p>${id} 的正文</p><div data-testid="message-actions"></div></article>`

afterEach(() => {
  document.body.innerHTML = ''
  delete window.__dshCaptureInstalled
})

describe('网页快捷收藏', () => {
  test('真实 MutationObserver 完成稳定后不重复安装按钮，并覆盖动态出现的 ChatGPT 回复', async () => {
    document.body.innerHTML = reply('msg-1')
    await install(() => {})
    await flushMutations()

    expect(document.querySelectorAll('[data-dsh-quick-capture]')).toHaveLength(1)
    document.body.append(document.createRange().createContextualFragment(reply('msg-2')))
    await flushMutations()
    await flushMutations()

    expect(document.querySelectorAll('[data-dsh-quick-capture]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-message-id="msg-1"] [data-dsh-quick-capture]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-message-id="msg-2"] [data-dsh-quick-capture]')).toHaveLength(1)
  })

  test('流式状态属性变化后更新按钮，无须重新注入脚本', async () => {
    document.body.innerHTML = '<article data-message-author-role="assistant" data-message-id="msg-stream" data-message-finished="false"><p>生成中</p><div data-testid="message-actions"></div></article>'
    await install(() => {})
    await flushMutations()

    const button = document.querySelector<HTMLButtonElement>('[data-dsh-quick-capture]')!
    expect(button.textContent).toBe('回复生成中…')
    expect(button.disabled).toBe(true)

    document.querySelector('[data-message-id="msg-stream"]')!.setAttribute('data-message-finished', 'true')
    await flushMutations()
    expect(button.textContent).toBe('收藏到 DSH')
    expect(button.disabled).toBe(false)
  })

  test('异步回执只更新用户点中的回复，且保留该回复的来源 ID', async () => {
    document.body.innerHTML = `${reply('msg-a')}${reply('msg-b')}`
    let respond: ReplyCallback | undefined
    let quickRequest: Message | undefined
    const sendMessage = vi.fn((message: Message, callback?: ReplyCallback) => {
      if (message.type === 'dsh-quick-capture') { quickRequest = message; respond = callback }
    })
    await install(sendMessage)
    await flushMutations()

    const first = document.querySelector<HTMLButtonElement>('[data-message-id="msg-a"] [data-dsh-quick-capture]')!
    const second = document.querySelector<HTMLButtonElement>('[data-message-id="msg-b"] [data-dsh-quick-capture]')!
    first.click()

    expect((quickRequest?.payload as { source: { externalMessageId: string } }).source.externalMessageId).toBe('msg-a')
    expect(first.textContent).toBe('保存中…')
    expect(second.textContent).toBe('收藏到 DSH')

    respond?.({ ok: true, status: 'saved', entryId: 'web:capture-a' })
    expect(first.textContent).toBe('✓ 已收藏 · 查看')
    expect(first.dataset.dshEntryId).toBe('web:capture-a')
    expect(second.textContent).toBe('收藏到 DSH')
  })

  test('已保存按钮所在节点被复用为新内容时，旧回执失效', async () => {
    document.body.innerHTML = reply('msg-reused')
    let respond: ReplyCallback | undefined
    await install((message, callback) => { if (message.type === 'dsh-quick-capture') respond = callback })
    await flushMutations()

    const target = document.querySelector<HTMLElement>('[data-message-id="msg-reused"]')!
    const button = target.querySelector<HTMLButtonElement>('[data-dsh-quick-capture]')!
    button.click()
    respond?.({ ok: true, status: 'saved', entryId: 'web:old-capture' })
    expect(button.dataset.dshEntryId).toBe('web:old-capture')

    target.querySelector('p')!.textContent = '同一节点已被页面复用为另一条回复'
    await flushMutations()
    expect(button.textContent).toBe('收藏到 DSH')
    expect(button.dataset.dshEntryId).toBeUndefined()
  })
})
