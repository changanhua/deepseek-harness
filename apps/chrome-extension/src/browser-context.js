import { capturePageBody } from './capture.js'

const failure = code => Object.assign(new Error(code), { code })
const MAX_CONTEXT_SCREENSHOT_BASE64 = 4 * 1024 * 1024
const CONTEXT_SCREENSHOT_QUALITIES = [85, 70, 55, 40, 25]
const pageUrl = value => {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw failure('unsupported_page')
  return url.href
}

/** Explicit intake only: capture stays in the worker until a user submits it. */
export const createBrowserContext = ({ chromeApi }) => {
  const activeTab = async () => {
    const tab = (await chromeApi.tabs.query({ active: true, lastFocusedWindow: true }))[0]
    if (!Number.isInteger(tab?.id) || !Number.isInteger(tab.windowId)) throw failure('no_active_tab')
    pageUrl(tab.url)
    return tab
  }
  const current = async () => {
    try { const tab = await activeTab(); return { tabId: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title ?? '' } }
    catch { return null }
  }
  const readDocument = async (tab, documentId) => {
    let results
    try {
      results = await chromeApi.scripting.executeScript({
        target: { tabId: tab.id, ...(documentId ? { documentIds: [documentId] } : { frameIds: [0] }) }, world: 'ISOLATED',
        func: () => ({ url: location.href, title: document.title.slice(0, 512), selection: String(getSelection() ?? '').slice(0, 48000) }),
      })
    } catch { throw failure('page_permission_required') }
    const result = results[0]
    if (results.length !== 1 || !result.documentId || result.frameId !== 0
      || documentId && result.documentId !== documentId) throw failure('capture_target_changed')
    return { page: { tabId: tab.id, windowId: tab.windowId, frameId: 0, documentId: result.documentId,
      url: pageUrl(result.result.url), title: String(result.result.title ?? '').slice(0, 512) },
    text: String(result.result.selection ?? '').trim() }
  }
  const capture = async kind => {
    if (!['selection', 'page-body', 'screenshot'].includes(kind)) throw failure('invalid_capture')
    const tab = await activeTab()
    const captured = await readDocument(tab)
    if (captured.page.url !== tab.url) throw failure('capture_target_changed')
    const metadata = { id: crypto.randomUUID(), kind, page: captured.page, capturedAt: new Date().toISOString() }
    if (kind === 'selection') {
      if (!captured.text) throw failure('empty_selection')
      return { ...metadata, text: captured.text }
    }
    if (kind === 'page-body') {
      let results
      try {
        results = await chromeApi.scripting.executeScript({ target: { tabId: tab.id, documentIds: [captured.page.documentId] },
          world: 'ISOLATED', func: capturePageBody })
      } catch { throw failure('capture_target_changed') }
      const value = results[0]?.result
      if (results.length !== 1 || results[0].documentId !== captured.page.documentId || results[0].frameId !== 0
        || value?.url !== captured.page.url || typeof value.text !== 'string' || value.text.length > 48000
        || typeof value.textTruncated !== 'boolean' || typeof value.incomplete !== 'boolean') throw failure('capture_target_changed')
      const after = await activeTab()
      const verified = await readDocument(tab, captured.page.documentId)
      if (after.id !== tab.id || after.windowId !== tab.windowId || after.url !== captured.page.url
        || verified.page.url !== captured.page.url) throw failure('capture_target_changed')
      if (!value.text.trim()) throw failure('empty_body')
      return { ...metadata, text: value.text, textTruncated: value.textTruncated, incomplete: value.incomplete }
    }
    let changed = false
    const activated = info => { if (info.windowId === tab.windowId && info.tabId !== tab.id) changed = true }
    const updated = (tabId, change) => { if (tabId === tab.id && (change.url || change.status === 'loading')) changed = true }
    chromeApi.tabs.onActivated.addListener(activated)
    chromeApi.tabs.onUpdated.addListener(updated)
    try {
      const before = await activeTab()
      if (before.id !== tab.id || before.windowId !== tab.windowId) throw failure('capture_target_changed')
      let dataUrl
      try {
        for (const quality of CONTEXT_SCREENSHOT_QUALITIES) {
          dataUrl = await chromeApi.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality })
          if (typeof dataUrl === 'string' && dataUrl.length <= `data:image/jpeg;base64,`.length + MAX_CONTEXT_SCREENSHOT_BASE64) break
        }
      } catch { throw failure('screenshot_permission_required') }
      const after = await activeTab()
      const verified = await readDocument(tab, captured.page.documentId)
      if (changed || after.id !== tab.id || after.windowId !== tab.windowId || verified.page.url !== captured.page.url) throw failure('capture_target_changed')
      const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(dataUrl)
      if (!match || match[1].length > MAX_CONTEXT_SCREENSHOT_BASE64) throw failure('screenshot_too_large')
      return { ...metadata, mediaType: 'image/jpeg', data: match[1] }
    } finally {
      chromeApi.tabs.onActivated.removeListener(activated)
      chromeApi.tabs.onUpdated.removeListener(updated)
    }
  }
  return { current, capture }
}
