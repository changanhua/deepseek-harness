// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { renderActivity } from '../src/sidebar-activity.js'

const state = () => ({ connection: { phase: 'connected' }, session: { binding: { sessionId: 'session' } },
  page: { url: 'https://page.test/article' }, activity: { phase: 'unconfigured', revision: null, policy: null,
    pendingConfiguration: false, synchronized: true, buffered: 0, discarded: 0, results: [] } })
describe('activity panel', () => {
  it('keeps a knowledge handoff single-flight through status refreshes', async () => {
    const panel = document.createElement('section')
    let release!: (value: { ok: boolean }) => void
    const send = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => { release = resolve }))
    const close = vi.fn()
    renderActivity(panel, state(), send, close)
    const button = [...panel.querySelectorAll('button')].find(item => item.textContent === '整理并保存到思源')!
    button.click(); renderActivity(panel, state(), send, close); button.click()
    expect(send).toHaveBeenCalledOnce(); expect(button.disabled).toBe(true)
    release({ ok: true }); await vi.waitFor(() => { expect(close).toHaveBeenCalledOnce() })
    expect(button.disabled).toBe(false)
  })
  it('preserves edited limits and focus across status refreshes', () => {
    const panel = document.createElement('section'); document.body.append(panel)
    const send = vi.fn(async () => ({ ok: true })), close = vi.fn()
    renderActivity(panel, state(), send, close)
    const body = panel.querySelector<HTMLInputElement>('#activity-body')!
    body.value = '200'; body.focus(); body.dispatchEvent(new Event('input', { bubbles: true }))
    renderActivity(panel, { ...state(), activity: { ...state().activity, buffered: 1 } }, send, close)
    expect(panel.querySelector('#activity-body')).toBe(body); expect(body.value).toBe('200'); expect(document.activeElement).toBe(body)
    panel.remove()
  })
  it('submits explicit limits and renders captured text as plain content', async () => {
    const panel = document.createElement('section'); const send = vi.fn(async () => ({ ok: true }))
    renderActivity(panel, state(), send, vi.fn())
    panel.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => { expect(send).toHaveBeenCalledOnce() })
    expect(send.mock.calls[0]).toMatchObject([{ type: 'dsh-assistant-activity-configure', settings: {
      enabled: true, origins: ['https://page.test'], minIntervalMs: 5000, maxTextChars: 0,
    } }])
    renderActivity(panel, { ...state(), activity: { ...state().activity, results: [{ at: 1000, title: '<img src=x>',
      text: '<script>run()</script>', url: 'https://page.test', kind: 'visit' }] } }, send, vi.fn())
    expect(panel.querySelector('img,script')).toBeNull(); expect(panel.textContent).toContain('<script>run()</script>')
  })
})
