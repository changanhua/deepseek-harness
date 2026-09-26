/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from 'vitest'
import markup from '../reader.html?raw'
import { installReaderConnection } from '../src/reader-connection.js'

const readerMarkup: unknown = markup
if (typeof readerMarkup !== 'string') throw new Error('Expected reader HTML source')

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren() })

test('离线解读页用原授权重试，不索取全站操作权限', async () => {
  document.body.innerHTML = readerMarkup
  const send = vi.fn(async () => ({ ok: true }))
  const refresh = vi.fn(async () => {})
  const request = vi.fn(async () => true)
  vi.stubGlobal('chrome', { permissions: { request } })
  const ui = installReaderConnection({ send, refresh })
  ui.update({ connection: { phase: 'offline', baseUrl: 'http://127.0.0.1:3080' } })
  document.getElementById('reader-connect-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => { expect(send).toHaveBeenCalledWith({ type: 'dsh-assistant-retry' }) })
  expect(request).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'dsh-assistant-connect' }))
})

test('连接正在恢复时重复点击不申请权限或重新配对', async () => {
  document.body.innerHTML = readerMarkup
  const send = vi.fn(async () => ({ ok: true }))
  const request = vi.fn(async () => true)
  const refresh = vi.fn(async () => {})
  vi.stubGlobal('chrome', { permissions: { request } })
  const ui = installReaderConnection({ send, refresh })
  ui.update({ connection: { phase: 'connecting', baseUrl: 'http://127.0.0.1:3080' } })
  document.getElementById('reader-connect-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => { expect(refresh).toHaveBeenCalled() })
  expect(request).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
})
