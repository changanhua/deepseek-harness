/** @vitest-environment jsdom */
/** @vitest-environment-options {"url":"https://example.test/article"} */
import { afterEach, describe, expect, it, vi } from 'vitest'
import source from '../src/browser-page.js?raw'

type Result = { ok: boolean; reason?: string }
interface PageHelper {
  snapshot(): { snapshotId: string; elements: Array<{ elementId: string }> }
  reveal(reference: { snapshotId: string; elementId: string; url: string }): Result
  revealFunction(reference: { mountId: string; url: string }): Result
  regionRender(request: unknown): unknown
  regionClear(request: unknown): unknown
}
const url = 'https://example.test/article'
const install = () => {
  globalThis.eval(source)
  return (globalThis as typeof globalThis & { __dshBrowserAssistant: PageHelper }).__dshBrowserAssistant
}
const request = (kind: string) => ({ protocolVersion: 1, installationId: 'personal', grantEpoch: 1,
  sessionId: 'session-a', requestId: `request-${kind}`, fingerprint: kind, deadline: Date.now() + 10000,
  payload: { kind, mountId: 'plugin:result', page: { tabId: 7, frameId: 0, documentId: 'doc', url },
    selector: 'main', blocks: [{ type: 'text', text: 'Result' }] } })

afterEach(() => {
  delete (globalThis as typeof globalThis & { __dshBrowserAssistant?: PageHelper }).__dshBrowserAssistant
  document.body.replaceChildren()
  history.replaceState({}, '', '/article')
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('human navigation to previously observed content', () => {
  it('reveals only an existing element reference without activating the control', () => {
    document.body.innerHTML = '<button>Read more</button><input value="private">'
    const button = document.querySelector('button')!
    const scroll = vi.fn(), animate = vi.fn(), click = vi.fn()
    button.scrollIntoView = scroll
    button.animate = animate
    button.addEventListener('click', click)
    const helper = install(), snapshot = helper.snapshot()
    const reference = { snapshotId: snapshot.snapshotId, elementId: snapshot.elements[0]!.elementId, url }
    expect(helper.reveal(reference)).toEqual({ ok: true })
    expect(scroll).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'instant' })
    expect(animate).toHaveBeenCalledOnce()
    expect(click).not.toHaveBeenCalled()
    expect(document.querySelector('input')!.value).toBe('private')
    button.textContent = 'Delete'
    expect(helper.reveal(reference)).toMatchObject({ ok: false, reason: 'stale_element' })
    expect(scroll).toHaveBeenCalledOnce()
  })

  it('refuses expired references and same-document URL drift', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<button>Original</button>'
    const helper = install(), snapshot = helper.snapshot()
    const reference = { snapshotId: snapshot.snapshotId, elementId: snapshot.elements[0]!.elementId, url }
    history.replaceState({}, '', '/other')
    expect(helper.reveal(reference)).toMatchObject({ ok: false, reason: 'target_changed' })
    history.replaceState({}, '', '/article')
    vi.advanceTimersByTime(60_001)
    expect(helper.reveal(reference)).toMatchObject({ ok: false, reason: 'stale_element' })
  })

  it('opens only a mounted function and refuses it after cleanup', () => {
    document.body.innerHTML = '<main></main>'
    const helper = install()
    expect(helper.regionRender(request('region_render'))).toMatchObject({ outcome: 'observed' })
    const panel = document.querySelector<HTMLElement>('[data-dsh-region-mount-id]')!
    panel.scrollIntoView = vi.fn()
    expect(helper.revealFunction({ mountId: 'plugin:result', url })).toEqual({ ok: true })
    expect(panel.scrollIntoView).toHaveBeenCalledOnce()
    expect(helper.regionClear(request('region_clear'))).toMatchObject({ outcome: 'observed' })
    expect(helper.revealFunction({ mountId: 'plugin:result', url })).toMatchObject({ ok: false, reason: 'function_view_unavailable' })
  })
})
