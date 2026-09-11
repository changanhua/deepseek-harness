/** Runs only in the extension's isolated world. The page retains a dirty bit, never a text history. */
export function observeActivityPage(options) {
  const key = '__dshActivityObservationV1'
  let state = globalThis[key]
  if (options.stop) {
    if (state?.revision === options.revision) { state.observer.disconnect(); clearTimeout(state.timer); delete globalThis[key] }
    return null
  }
  if (!state || state.revision !== options.revision) {
    if (state) { state.observer.disconnect(); clearTimeout(state.timer) }
    state = { revision: options.revision, documentId: crypto.randomUUID(), dirty: false, timer: null, observer: null }
    state.observer = new MutationObserver(() => { state.dirty = true })
    state.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
    globalThis[key] = state
  }
  clearTimeout(state.timer)
  const current = state
  state.timer = setTimeout(() => {
    current.observer.disconnect()
    if (globalThis[key] === current) delete globalThis[key]
  }, Math.min(65000, options.leaseMs))
  const changed = state.dirty; state.dirty = false
  let text = ''
  if (options.maxTextChars > 0) {
    const root = document.querySelector('main,article') ?? document.body
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node, visited = 0
    while (text.length < options.maxTextChars && visited < 10000 && (node = walker.nextNode())) {
      visited += 1
      const parent = node.parentElement
      if (!parent || parent.closest('script,style,noscript,textarea,input,select,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"]')) continue
      const style = getComputedStyle(parent)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const value = node.textContent?.replace(/\s+/gu, ' ').trim()
      if (value) text = (text ? text + ' ' + value : value).slice(0, options.maxTextChars)
    }
  }
  return { url: location.href, title: document.title.slice(0, 256), documentId: state.documentId, changed, text }
}

/** Samples focused normal windows under durable site permission; temporary activeTab is insufficient. */
export const createBrowserActivity = ({ chromeApi, getPolicy, enqueue, flush, changed = () => {}, now = Date.now, pollMs = 1000 }) => {
  let running = null, timer = null, stopped = false, generation = 0, revision = null, last = null, lastScan = 0
  const documents = new Map()
  const still = fixed => !stopped && generation === fixed.generation && getPolicy()?.revision === fixed.revision
  const cleanup = async () => {
    const active = [...documents]; documents.clear()
    await Promise.allSettled(active.map(([tabId, policyRevision]) => chromeApi.scripting.executeScript({
      target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: observeActivityPage,
      args: [{ stop: true, revision: policyRevision }],
    })))
  }
  const reset = () => { generation += 1; last = null; lastScan = 0; void cleanup() }
  const event = (page, kind, at, extra = {}) => ({ id: crypto.randomUUID(), kind, at, tabId: page.tabId,
    documentId: page.documentId, url: page.url, title: page.title, ...extra })
  const sample = async () => {
    const policy = getPolicy()
    if (!policy) { if (last || documents.size) reset(); revision = null; return }
    if (revision !== policy.revision) { reset(); revision = policy.revision }
    const fixed = { revision, generation }
    const window = await chromeApi.windows.getLastFocused({ windowTypes: ['normal'] })
    if (!still(fixed)) return
    const tabs = window?.focused ? await chromeApi.tabs.query({ windowId: window.id, active: true }) : []
    if (!still(fixed)) return
    const tab = tabs[0]
    const timestamp = now()
    let origin = null
    try {
      const url = new URL(tab?.url)
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && policy.origins.includes(url.origin)) origin = url.origin
    } catch { /* Restricted and extension pages do not participate. */ }
    if (!origin || !Number.isInteger(tab?.id) || !await chromeApi.permissions.contains({ origins: [origin + '/*'] })) {
      if (still(fixed) && last && policy.kinds.includes('dwell')) {
        const previous = last
        const previousOrigin = new URL(previous.url).origin
        const permitted = previousOrigin !== origin && await chromeApi.permissions.contains({ origins: [previousOrigin + '/*'] })
        if (still(fixed) && permitted) {
          enqueue([event(previous, 'dwell', timestamp, { durationMs: Math.min(60000, Math.max(0, timestamp - previous.at)) })])
          await flush()
        }
      }
      last = null; await cleanup(); return
    }
    if (!still(fixed)) return
    if (last?.tabId === tab.id && last.url === tab.url && timestamp - lastScan < policy.minIntervalMs) return
    if (!documents.has(tab.id) && documents.size >= 16) {
      const [oldTab, oldRevision] = documents.entries().next().value
      documents.delete(oldTab)
      await chromeApi.scripting.executeScript({ target: { tabId: oldTab, frameIds: [0] }, world: 'ISOLATED', func: observeActivityPage,
        args: [{ stop: true, revision: oldRevision }] }).catch(() => {})
      if (!still(fixed)) return
    }
    documents.set(tab.id, revision)
    const responses = await chromeApi.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, world: 'ISOLATED',
      func: observeActivityPage, args: [{ revision, maxTextChars: policy.maxTextChars, leaseMs: policy.minIntervalMs + 5000 }] })
    if (!still(fixed)) return
    const response = responses.find(item => item.frameId === 0)
    const result = response?.result
    const current = await chromeApi.tabs.get(tab.id)
    if (!still(fixed) || !result || result.url !== tab.url || current.url !== tab.url
      || typeof response?.documentId !== 'string' || typeof result.title !== 'string' || typeof result.text !== 'string'
      || !await chromeApi.permissions.contains({ origins: [origin + '/*'] })) return
    if (!still(fixed)) return
    const page = { tabId: tab.id, frameId: response.frameId, documentId: response.documentId, url: result.url, title: result.title }
    const events = []
    const samePage = last?.tabId === page.tabId && last.documentId === page.documentId && last.url === page.url
    if (last && policy.kinds.includes('dwell')) events.push(event(last, 'dwell', timestamp,
      { durationMs: Math.min(60000, Math.max(0, timestamp - last.at)) }))
    const body = policy.maxTextChars > 0 ? { text: result.text.slice(0, policy.maxTextChars) } : {}
    if (!samePage && policy.kinds.includes('visit')) events.push(event(page, 'visit', timestamp, body))
    if (samePage && result.changed && policy.kinds.includes('dom-change')) events.push(event(page, 'dom-change', timestamp, body))
    if (events.length) enqueue(events)
    last = { ...page, at: timestamp }; lastScan = timestamp
    await flush()
  }
  const tick = () => {
    if (running || stopped) return running ?? Promise.resolve()
    running = sample().catch(error => { changed(error.code ?? error.message ?? 'activity_collection_failed') })
      .finally(() => { running = null })
    return running
  }
  const start = () => { if (!timer && !stopped) timer = setInterval(() => { void tick() }, pollMs); return tick() }
  const policyChanged = () => { if (!getPolicy()) reset(); return tick() }
  const stop = async () => { stopped = true; clearInterval(timer); reset(); await running; await cleanup() }
  return { start, tick, policyChanged, stop }
}
