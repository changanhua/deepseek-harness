import { describe, expect, test, vi } from 'vitest'
import { createBrowserContext } from '../src/browser-context.js'

type DocumentResult = { documentId: string; frameId: number; result: unknown }

function harness() {
  const tab = { id: 7, windowId: 2, url: 'https://example.test/article', title: 'Article', active: true }
  type Listener = (...args: unknown[]) => void
  const listeners = new Set<Listener>()
  const chromeApi = {
    tabs: {
      query: vi.fn(async () => [tab]),
      get: vi.fn(async (tabId: number) => tabId === tab.id ? tab : undefined),
      captureVisibleTab: vi.fn(async () => 'data:image/jpeg;base64,AQ=='),
      onActivated: { addListener: (fn: Listener) => listeners.add(fn), removeListener: (fn: Listener) => listeners.delete(fn) },
      onUpdated: { addListener: (fn: Listener) => listeners.add(fn), removeListener: (fn: Listener) => listeners.delete(fn) },
    },
    scripting: { executeScript: vi.fn(async (): Promise<DocumentResult[]> => [{ documentId: 'doc-1', frameId: 0,
      result: { url: tab.url, title: tab.title, selection: 'Selected words' } }]) },
  }
  return { tab, chromeApi, listeners, capture: createBrowserContext({ chromeApi }) }
}
describe('explicit browser context capture', () => {
  test('resolves an exact current target without reading page body content', async () => {
    const h = harness()
    const target = await h.capture.target()
    expect(target).toEqual({ tabId: 7, windowId: 2, frameId: 0, documentId: 'doc-1', url: h.tab.url, title: h.tab.title })
    expect(h.chromeApi.scripting.executeScript).toHaveBeenCalledTimes(1)
    expect(h.chromeApi.tabs.captureVisibleTab).not.toHaveBeenCalled()
  })
  test('describes a previously selected stable tab while another tab may be active', async () => {
    const h = harness()
    expect(await h.capture.describe(7)).toEqual({ tabId: 7, windowId: 2, url: h.tab.url, title: h.tab.title })
    await expect(h.capture.describe(8)).resolves.toBeNull()
  })
  test('lists only bounded http tabs as metadata and resolves the selected document afresh', async () => {
    const h = harness()
    const other = { id: 8, windowId: 3, url: 'https://example.test/other', title: 'Other', active: false }
    h.chromeApi.tabs.query.mockResolvedValueOnce([h.tab, other, { id: 9, windowId: 3, url: 'chrome://settings', title: 'Private' }])
    h.chromeApi.tabs.get.mockImplementation(async (tabId: number) => tabId === 8 ? other : h.tab)
    h.chromeApi.scripting.executeScript.mockResolvedValueOnce([{ documentId: 'doc-8', frameId: 0,
      result: { url: other.url, title: other.title } }])
    expect(await h.capture.candidates()).toEqual([
      { tabId: 7, windowId: 2, url: h.tab.url, title: 'Article', active: true },
      { tabId: 8, windowId: 3, url: other.url, title: 'Other', active: false },
    ])
    await expect(h.capture.target(8)).resolves.toEqual({ tabId: 8, windowId: 3, frameId: 0,
      documentId: 'doc-8', url: other.url, title: other.title })
    expect(h.chromeApi.scripting.executeScript).toHaveBeenLastCalledWith(expect.objectContaining({ target: { tabId: 8, frameIds: [0] } }))
  })
  test('rejects a selected tab when it navigates while its document is being resolved', async () => {
    const h = harness()
    h.chromeApi.tabs.get.mockResolvedValueOnce(h.tab).mockResolvedValueOnce({ ...h.tab, url: 'https://example.test/replaced' })
    await expect(h.capture.target(7)).rejects.toMatchObject({ code: 'capture_target_changed' })
  })
  test('body capture reads and rechecks the exact document and preserves incomplete-source flags', async () => {
    const h = harness()
    h.chromeApi.scripting.executeScript.mockResolvedValueOnce([{ documentId: 'doc-1', frameId: 0,
      result: { url: h.tab.url, title: h.tab.title, selection: '' } }])
    h.chromeApi.scripting.executeScript.mockResolvedValueOnce([{ documentId: 'doc-1', frameId: 0,
      result: { url: h.tab.url, text: 'Page body.', textTruncated: true, incomplete: true } }])
    expect(await h.capture.capture('page-body')).toMatchObject({ kind: 'page-body', text: 'Page body.',
      textTruncated: true, incomplete: true, page: { tabId: 7, documentId: 'doc-1', url: h.tab.url } })
    expect(h.chromeApi.scripting.executeScript).toHaveBeenNthCalledWith(2, expect.objectContaining({
      target: { tabId: 7, documentIds: ['doc-1'] }, world: 'ISOLATED',
    }))
    expect(h.chromeApi.scripting.executeScript).toHaveBeenCalledTimes(3)
    expect(h.chromeApi.tabs.captureVisibleTab).not.toHaveBeenCalled()
  })
  test('body capture cannot attach a replacement document or another foreground tab', async () => {
    for (const replacement of ['document', 'tab']) {
      const h = harness()
      h.chromeApi.scripting.executeScript.mockResolvedValueOnce([{ documentId: 'doc-1', frameId: 0,
        result: { url: h.tab.url, title: h.tab.title, selection: '' } }])
      h.chromeApi.scripting.executeScript.mockResolvedValueOnce([{ documentId: replacement === 'document' ? 'doc-2' : 'doc-1',
        frameId: 0, result: { url: h.tab.url, text: 'Page body.', textTruncated: false, incomplete: false } }])
      if (replacement === 'tab') {
        h.chromeApi.tabs.query.mockResolvedValueOnce([h.tab]).mockResolvedValueOnce([{ ...h.tab, id: 8 }])
      }
      await expect(h.capture.capture('page-body')).rejects.toMatchObject({ code: 'capture_target_changed' })
    }
  })
  test('selection carries its actual document and source metadata without sending it to a Host', async () => {
    const h = harness(); const result = await h.capture.capture('selection')
    expect(result).toMatchObject({ kind: 'selection', text: 'Selected words', page: { tabId: 7, documentId: 'doc-1', url: h.tab.url } })
    expect(h.chromeApi.tabs.captureVisibleTab).not.toHaveBeenCalled()
  })
  test('screenshot uses the specified window and checks the target afterwards', async () => {
    const h = harness(); const result = await h.capture.capture('screenshot')
    expect(result).toMatchObject({ kind: 'screenshot', mediaType: 'image/jpeg', data: 'AQ==', page: { tabId: 7, documentId: 'doc-1' } })
    expect(h.chromeApi.tabs.captureVisibleTab).toHaveBeenCalledWith(2, { format: 'jpeg', quality: 85 })
    expect(h.listeners.size).toBe(0)
  })
  test('a tab transition during screenshot rejects even if the original tab is active again', async () => {
    const h = harness()
    h.chromeApi.tabs.captureVisibleTab.mockImplementationOnce(async () => {
      for (const listener of h.listeners) listener({ tabId: 8, windowId: 2 })
      return 'data:image/jpeg;base64,AQ=='
    })
    await expect(h.capture.capture('screenshot')).rejects.toMatchObject({ code: 'capture_target_changed' })
    expect(h.listeners.size).toBe(0)
  })
  test('rejects an empty selection and browser-internal pages', async () => {
    const h = harness()
    h.chromeApi.scripting.executeScript.mockResolvedValueOnce([{ documentId: 'doc-1', frameId: 0, result: { url: h.tab.url, title: '', selection: '' } }])
    await expect(h.capture.capture('selection')).rejects.toMatchObject({ code: 'empty_selection' })
    h.tab.url = 'chrome://settings'
    await expect(h.capture.capture('screenshot')).rejects.toMatchObject({ code: 'unsupported_page' })
    expect(h.chromeApi.tabs.captureVisibleTab).not.toHaveBeenCalled()
  })
})
