import { createExtensionController } from './controller.js'
import { createContentBrowserTransport } from './transport.js'

const hasPermission = baseUrl => chrome.permissions.contains({ origins: [`${new URL(baseUrl).origin}/*`] })
const broadcast = () => { void chrome.runtime.sendMessage({ type: 'dsh-state-changed' }).catch(() => {}) }
const transport = createContentBrowserTransport({ openApproval: url => chrome.tabs.create({ url }) })
const trusted = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
const controller = createExtensionController({ storage: chrome.storage.local, hasPermission, changed: broadcast,
  transport: { ...transport, begin: args => transport.begin({ ...args, extensionId: chrome.runtime.id }) },
})
let activeCapture = null
const activeTab = async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]
const isSidebar = sender => sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('sidebar.html')
const pageUrl = raw => {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('unsupported_page')
  return url
}
const siteOf = raw => {
  try { const host = pageUrl(raw).hostname; return host === 'chatgpt.com' ? 'chatgpt' : host === 'www.zhihu.com' || host === 'zhuanlan.zhihu.com' ? 'zhihu' : 'generic' } catch { return 'unsupported' }
}
const isPage = sender => sender.id === chrome.runtime.id && Number.isInteger(sender.tab?.id) && sender.frameId === 0 && siteOf(sender.url) !== 'unsupported'
const validatePayload = (payload, sender) => {
  if (!isPage(sender) || !payload || typeof payload.markdown !== 'string' || !payload.markdown.trim()) throw new Error('invalid_capture')
  const source = payload.source
  if (!source || !['selection', 'single-reply'].includes(source.kind) || typeof source.pageTitle !== 'string' || typeof source.site !== 'string' || typeof source.capturedAt !== 'string' || !Number.isFinite(Date.parse(source.capturedAt))) throw new Error('invalid_capture')
  const url = pageUrl(source.url)
  if (url.origin !== pageUrl(sender.url).origin) throw new Error('source_mismatch')
  return { title: typeof payload.title === 'string' ? payload.title : source.pageTitle, markdown: payload.markdown, source: {
    url: url.href, pageTitle: source.pageTitle, site: source.site, kind: source.kind, capturedAt: source.capturedAt,
    ...(typeof source.externalMessageId === 'string' ? { externalMessageId: source.externalMessageId } : {}),
  } }
}
const inject = tabId => chrome.scripting.executeScript({ target: { tabId }, files: ['src/content-script.js'] })
const badge = async text => {
  await chrome.action.setBadgeBackgroundColor({ color: text === '✓' ? '#28725a' : '#986925' })
  await chrome.action.setBadgeText({ text })
  await chrome.action.setTitle({ title: text === '✓' ? 'DSH：已保存' : text ? 'DSH：内容待处理，点击打开侧栏' : '打开 DSH 收藏' })
}
const uiState = async () => {
  const tab = await activeTab()
  const site = siteOf(tab?.url)
  const enabled = site !== 'unsupported' && await hasPermission(tab.url)
  return { ...await controller.read(), page: { tabId: tab?.id, url: tab?.url ?? '', title: tab?.title ?? '', site, quickEnabled: enabled } }
}
const scripts = [
  { id: 'dsh-chatgpt', matches: ['https://chatgpt.com/*'] },
  { id: 'dsh-zhihu', matches: ['https://www.zhihu.com/*'] },
  { id: 'dsh-zhihu-article', matches: ['https://zhuanlan.zhihu.com/*'] },
]
let scriptLane = Promise.resolve()
const syncScripts = () => {
  const work = scriptLane.then(async () => {
    const registered = await chrome.scripting.getRegisteredContentScripts()
    for (const site of scripts) {
      const allowed = await chrome.permissions.contains({ origins: site.matches })
      const exists = registered.some(s => s.id === site.id)
      if (allowed && !exists) await chrome.scripting.registerContentScripts([{ ...site, js: ['src/content-script.js'], persistAcrossSessions: true, runAt: 'document_idle' }])
      if (!allowed && exists) await chrome.scripting.unregisterContentScripts({ ids: [site.id] })
    }
  })
  scriptLane = work.catch(() => {})
  return work
}
chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await trusted
    await chrome.contextMenus.removeAll()
    chrome.contextMenus.create({ id: 'dsh-save-selection', title: '收藏选区到 DSH', contexts: ['selection'], documentUrlPatterns: ['http://*/*', 'https://*/*'] })
    await syncScripts()
  })().catch(() => badge('!'))
})
chrome.permissions.onAdded.addListener(() => { void syncScripts().catch(() => {}) })
chrome.permissions.onRemoved.addListener(() => { void syncScripts().catch(() => {}); broadcast() })
chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return
  // open must run in the original user gesture, before awaiting script injection.
  void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {})
  if (siteOf(tab.url) !== 'unsupported') void inject(tab.id).catch(() => {})
})
chrome.tabs.onActivated.addListener(broadcast)
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.status === 'complete') broadcast() })

const quickSave = async (payload, tabId) => {
  const capture = await controller.receive(payload, tabId)
  try { await badge('…'); const saved = await controller.save(capture.captureId, true); await badge('✓'); return { ok: true, status: 'saved', entryId: saved.entryId } }
  catch (error) { await badge('!'); return { ok: false, error: error.code ?? error.message, status: 'pending' } }
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'dsh-save-selection' || !info.selectionText || !tab?.id) return
  void (async () => {
    await trusted
    const url = pageUrl(info.frameUrl || info.pageUrl || tab.url)
    url.hash = ''; url.search = ''
    const markdown = info.selectionText.replace(/([\\`*_{}\[\]()#+.!>|~-])/gu, '\\$1').trim()
    await quickSave({ title: tab.title || '网页片段', markdown, source: {
      url: url.href, pageTitle: tab.title || url.hostname, site: url.hostname, kind: 'selection', capturedAt: new Date().toISOString(),
    } }, tab.id)
  })().catch(() => badge('!'))
})

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const page = isPage(sender)
  if (message?.type === 'dsh-capture-result' && page && sender.tab.id === activeCapture?.tabId && sender.documentId === activeCapture.documentId && message.requestId === activeCapture.id) {
    activeCapture = null
    void (async () => {
      if (message.payload?.error) throw new Error(message.payload.error)
      await controller.receive(validatePayload(message.payload, sender), sender.tab.id)
      broadcast()
    })().catch(error => { void chrome.runtime.sendMessage({ type: 'dsh-capture-error', error: error.message }).catch(() => {}); void badge('!') })
    return
  }
  if (message?.type === 'dsh-quick-capture' && page) {
    void trusted.then(() => quickSave(validatePayload(message.payload, sender), sender.tab.id)).then(respond, error => respond({ ok: false, error: error.code ?? error.message }))
    return true
  }
  if (message?.type === 'dsh-open-captured' && page) {
    void (async () => {
      const r = await controller.receipt(message.entryId)
      const source = pageUrl(r.sourceUrl)
      const current = pageUrl(sender.url)
      if (source.origin !== current.origin || r.sourceTabId !== sender.tab.id) throw new Error('receipt_mismatch')
      await chrome.tabs.create({ url: `${r.baseUrl}/#content-entry=${encodeURIComponent(r.entryId)}` })
      respond({ ok: true })
    })().catch(error => respond({ ok: false, error: error.message }))
    return true
  }
  if (!isSidebar(sender)) return
  void (async () => {
    await trusted
    switch (message?.type) {
      case 'dsh-ui-state': break
      case 'dsh-capture-request': {
        if (!['selection', 'single-reply'].includes(message.action)) throw new Error('invalid_capture')
        const tab = await activeTab()
        if (siteOf(tab?.url) === 'unsupported') throw new Error('unsupported_page')
        const results = await inject(tab.id)
        activeCapture = { id: crypto.randomUUID(), tabId: tab.id, documentId: results[0]?.documentId }
        await chrome.tabs.sendMessage(tab.id, { type: 'dsh-capture-command', action: message.action, requestId: activeCapture.id }, { documentId: activeCapture.documentId })
        break
      }
      case 'dsh-save': await controller.save(message.captureId, true); await badge('✓'); break
      case 'dsh-title': await controller.title(message.captureId, message.title); break
      case 'dsh-discard': await controller.discard(message.captureId); await badge(''); break
      case 'dsh-connection-check': await controller.check(); break
      case 'dsh-connection-save': await controller.configure(message.baseUrl); break
      case 'dsh-connection-connect':
      case 'dsh-connection-resume': await controller.connect(); break
      case 'dsh-connection-cancel': await controller.cancel(); break
      case 'dsh-enable-site': {
        const tab = await activeTab()
        if (!['chatgpt', 'zhihu'].includes(siteOf(tab?.url)) || !await hasPermission(tab.url)) throw new Error('permission_required')
        await syncScripts(); await inject(tab.id); break
      }
      case 'dsh-open-source': {
        const capture = (await controller.read()).capture
        if (!capture) throw new Error('capture_changed')
        await chrome.tabs.create({ url: pageUrl(capture.source.url).href }); break
      }
      case 'dsh-open-entry': {
        const r = await controller.receipt(message.entryId)
        await chrome.tabs.create({ url: `${r.baseUrl}/#content-entry=${encodeURIComponent(r.entryId)}` }); break
      }
      default: throw new Error('unknown_message')
    }
    return { ok: true, state: await uiState() }
  })().then(respond, async error => {
    respond({ ok: false, error: error.code ?? error.message, state: await uiState().catch(() => undefined) })
  })
  return true
})
