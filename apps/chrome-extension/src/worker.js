import { createAssistantRuntime } from './assistant-runtime.js'
import { createAssistantSurfaces } from './assistant-surfaces.js'
import { createExtensionController } from './controller.js'
import { createContentBrowserTransport } from './transport.js'
import { createCaptureBridge } from './capture-bridge.js'

let broadcastTimer
const broadcast = () => {
  if (broadcastTimer !== undefined) return
  broadcastTimer = setTimeout(() => {
    broadcastTimer = undefined
    void chrome.runtime.sendMessage({ type: 'dsh-state-changed' }).catch(() => {})
  }, 50)
}
const assistant = createAssistantRuntime({ chromeApi: chrome, changed: broadcast })
const surfaces = createAssistantSurfaces({ chromeApi: chrome })
const hasPermission = baseUrl => chrome.permissions.contains({ origins: [`${new URL(baseUrl).origin}/*`] })
const contentTransport = createContentBrowserTransport({ openApproval: url => chrome.tabs.create({ url }) })
const captureController = createExtensionController({ storage: chrome.storage.local, hasPermission, changed: broadcast,
  transport: { ...contentTransport, begin: args => contentTransport.begin({ ...args, extensionId: chrome.runtime.id }) },
})
const captureBridge = createCaptureBridge({ controller: captureController, extensionId: chrome.runtime.id, openTab: url => chrome.tabs.create({ url }) })
let readerRevision = 0
const isSidebar = sender => sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('sidebar.html')
const scripts = [
  { id: 'dsh-chatgpt', matches: ['https://chatgpt.com/*'] },
  { id: 'dsh-zhihu', matches: ['https://www.zhihu.com/*'] },
  { id: 'dsh-zhihu-article', matches: ['https://zhuanlan.zhihu.com/*'] },
]
let setupLane = Promise.resolve()
const setup = () => {
  const task = setupLane.then(async () => {
    await chrome.contextMenus.removeAll()
    chrome.contextMenus.create({ id: 'dsh-assistant-selection', title: '用 DSH 讨论选中文字', contexts: ['selection'], documentUrlPatterns: ['http://*/*', 'https://*/*'] })
    await chrome.action.setTitle({ title: '打开 DSH 浏览器助手' })
  })
  setupLane = task.catch(() => {})
  return task
}
let scriptLane = Promise.resolve()
const syncScripts = () => {
  const work = scriptLane.then(async () => {
    const registered = await chrome.scripting.getRegisteredContentScripts()
    for (const site of scripts) {
      const allowed = await chrome.permissions.contains({ origins: site.matches })
      const exists = registered.some(item => item.id === site.id)
      if (allowed && !exists) await chrome.scripting.registerContentScripts([{ ...site, js: ['src/content-script.js'], persistAcrossSessions: true, runAt: 'document_idle' }])
      if (!allowed && exists) await chrome.scripting.unregisterContentScripts({ ids: [site.id] })
    }
  })
  scriptLane = work.catch(() => {})
  return work
}
const ready = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  await setup()
  await syncScripts().catch(() => {})
  await assistant.start()
})()
void ready.catch(() => broadcast())

chrome.runtime.onInstalled.addListener(() => { void ready.then(() => Promise.all([setup(), syncScripts()])).catch(() => broadcast()) })
chrome.permissions.onAdded.addListener(() => { void syncScripts().catch(() => broadcast()) })
chrome.action.onClicked.addListener(tab => {
  if (tab.windowId === undefined) return
  // Opening remains in the original Chrome user gesture.
  void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {})
  if (Number.isInteger(tab.id) && typeof tab.url === 'string' && /^https?:/u.test(tab.url)) {
    void chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content-script.js'] }).catch(() => {})
  }
})
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-assistant-window') { void surfaces.openWindow().catch(() => broadcast()); return }
  if (command === 'open-assistant' && tab?.windowId !== undefined) void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {})
})
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'dsh-assistant-selection' || !tab?.windowId) return
  void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {})
  void ready.then(() => assistant.capture('selection')).catch(error => {
    void chrome.runtime.sendMessage({ type: 'dsh-assistant-error', error: error.code ?? error.message }).catch(() => {})
  })
})
chrome.tabs.onActivated.addListener(broadcast)
const activityTick = () => { void ready.then(() => assistant.activityTick()).catch(() => {}) }
chrome.tabs.onActivated.addListener(activityTick)
chrome.windows.onFocusChanged.addListener(activityTick)
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.status === 'complete') activityTick() })
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.status === 'complete') broadcast() })
chrome.permissions.onRemoved.addListener(() => { void ready.then(() => assistant.permissionsChanged()).catch(() => {}); broadcast() })
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'dsh-assistant-view' || !isSidebar(port.sender)) { port.disconnect(); return }
  const id = crypto.randomUUID()
  let closed = false
  port.onMessage.addListener(message => {
    if (message?.type !== 'presence' || typeof message.visible !== 'boolean') return
    void ready.then(() => { if (!closed) return assistant.viewChanged(id, message.visible) }).catch(() => {})
  })
  port.onDisconnect.addListener(() => { closed = true; void ready.then(() => assistant.viewChanged(id, false)).catch(() => {}) })
})
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'dsh-quick-capture') {
    void ready.then(() => captureBridge.quickCapture(message.payload, sender)).then(respond,
      error => {
        const code = error.code ?? error.message
        const uncertain = ['network_error', 'request_timeout', 'invalid_receipt', 'result_unknown'].includes(code)
        respond({ ok: false, status: uncertain ? 'unknown' : 'failed', uncertain, error: code })
      })
    return true
  }
  if (message?.type === 'dsh-open-captured') {
    void ready.then(() => captureBridge.openCaptured(message.entryId, sender)).then(respond,
      error => respond({ ok: false, error: error.code ?? error.message }))
    return true
  }
  if (message?.type === 'dsh-capture-save') {
    void ready.then(async () => {
      const capture = await captureController.save(message.captureId, true)
      return { ok: true, capture }
    }).then(respond, error => respond({ ok: false, error: error.code ?? error.message }))
    return true
  }
  if (message?.type === 'dsh-capture-connect') {
    void ready.then(async () => { await captureController.connect(); return { ok: true, captureConnection: (await captureController.read()).connection } })
      .then(respond, error => respond({ ok: false, error: error.code ?? error.message }))
    return true
  }
  if (message?.type === 'dsh-capture-open-entry') {
    void ready.then(async () => {
      const receipt = await captureController.receipt(message.entryId)
      if (!receipt?.baseUrl || receipt.entryId !== message.entryId) throw new Error('receipt_missing')
      await chrome.tabs.create({ url: `${new URL(receipt.baseUrl).origin}/#content-entry=${encodeURIComponent(receipt.entryId)}` })
      return { ok: true }
    }).then(respond, error => respond({ ok: false, error: error.code ?? error.message }))
    return true
  }
  if (message?.type === 'dsh-capture-open-source') {
    void ready.then(async () => {
      const url = new URL(message.url)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('unsupported_page')
      await chrome.tabs.create({ url: url.href })
      return { ok: true }
    }).then(respond, error => respond({ ok: false, error: error.code ?? error.message }))
    return true
  }
  if (sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('reader.html')
    && ['dsh-assistant-state', 'dsh-assistant-open-model-settings', 'dsh-assistant-reading-models',
      'dsh-assistant-configure', 'dsh-assistant-connect', 'dsh-assistant-poll', 'dsh-assistant-open-approval', 'dsh-assistant-cancel',
      'dsh-assistant-reading-model', 'dsh-assistant-reading-configure', 'dsh-assistant-reading-stop'].includes(message?.type)) {
    void ready.then(() => assistant.handle(message)).then(respond,
      error => respond({ ok: false, error: error.code ?? error.message }))
    return true
  }
  if (message?.type === 'dsh-zhihu-open-assistant' || message?.type === 'dsh-zhihu-summarize') {
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)
      || !sender.url?.startsWith('https://www.zhihu.com/')) return
    if (message.type === 'dsh-zhihu-open-assistant') {
      // Opening must stay in the original content-script click message's user gesture.
      const opened = chrome.sidePanel.open({ tabId: sender.tab.id })
      readerRevision += 1
      broadcast()
      void opened.then(async () => {
        await ready
        const result = await assistant.handle({ type: 'dsh-assistant-reading-select', url: message.url })
        void chrome.runtime.sendMessage({ type: 'dsh-reader-follow-latest' }).catch(() => {})
        respond({ ok: true, readingStatus: result.state.readings.items.findLast(item => item.url === message.url)?.status })
      }).catch(() => respond({ ok: false, error: '无法打开解读侧栏，请点击工具栏里的 DSH 图标' }))
    } else {
      void ready.then(() => assistant.summarizeZhihu(message.payload)).then(respond, error => {
        const messages = { offline: '请先在侧栏连接 DSH', reading_busy: '正在解读，请完成或停止后再试', pending_exists: '正在解读，请稍后再试',
          pending_locked: '上一条消息待确认，请在侧栏处理', 'model-unavailable': '请先在 DSH 中选择模型' }
        const code = error.code ?? error.message
        respond({ ok: false, uncertain: code === 'result_unknown', error: messages[code] ?? code })
      })
    }
    return true
  }
  if (message?.type === 'dsh-entry-click') {
    // Page-world buttons (isolated world of any site) hand a collected item back.
    if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id)
      || typeof message.mountId !== 'string' || !message.mountId
      || typeof message.documentId !== 'string' || typeof message.url !== 'string'
      || typeof message.entry?.title !== 'string' || typeof message.entry?.link !== 'string') return
    void ready.then(() => assistant.handle({
      type: 'dsh-entry-click',
      payload: { mountId: message.mountId, tabId: sender.tab.id, frameId: sender.frameId ?? 0,
        documentId: message.documentId, url: message.url, entry: { title: message.entry.title, link: message.entry.link } },
    })).then(respond, error => respond({ ok: false, error: error.code ?? error.message }))
    return true
  }
  if (!isSidebar(sender) || typeof message?.type !== 'string' || !message.type.startsWith('dsh-assistant-')) return
  if (message.type === 'dsh-assistant-open-window') {
    void surfaces.openWindow().then(value => respond({ ok: true, value }), () => respond({ ok: false, error: 'assistant_window_unavailable' }))
    return true
  }
  void ready.then(() => assistant.handle(message)).then(async result => {
    if (!result.state) return respond(result)
    const captureState = await captureController.read()
    return respond({ ...result, state: { ...result.state, readerRevision, capture: captureState.capture, captureConnection: captureState.connection } })
  }, error => respond({ ok: false, error: error.code ?? error.message }))
  return true
})
