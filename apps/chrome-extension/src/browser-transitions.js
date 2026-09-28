const candidateLimit = 8
const httpUrl = value => {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined
  } catch { return undefined }
}

/** Collects bounded browser transition facts for one already-targeted action. */
export const createBrowserTransitions = ({ chromeApi, browserSessionId, probe, now = Date.now, timeoutMs = 250 }) => {
  const start = async ({ source, deadline, signal, authorized }) => {
    const sessionId = await browserSessionId()
    const sourceTab = await chromeApi.tabs.get(source.tabId)
    if (!sourceTab || !Number.isInteger(sourceTab.windowId)) throw Object.assign(new Error('source_tab_unavailable'), { code: 'source_tab_unavailable' })
    const startedAt = now(), sourceTabRef = { tabId: source.tabId, windowId: sourceTab.windowId, browserSessionId: sessionId }
    const events = [], children = []
    let truncated = false, sameTab = { kind: 'unchanged' }, sourceReplaced = false, disposed = false, deadlineTimer
    const record = (event, child = false) => {
      const items = child ? children : events
      if (items.length >= candidateLimit) { truncated = true; return }
      items.push(event)
    }
    const committed = event => {
      if (event.tabId !== source.tabId || event.frameId !== source.frameId) return
      record(event)
      if (event.documentId === source.documentId) sameTab = { kind: 'same-document', event }
      else {
        sourceReplaced = true
        children.length = 0
        truncated = true
        sameTab = { kind: 'document-replaced', event }
      }
    }
    const history = event => {
      if (event.tabId !== source.tabId || event.frameId !== source.frameId || event.documentId !== source.documentId) return
      record(event)
      sameTab = { kind: 'same-document', event }
    }
    const referenceFragment = history
    const failed = event => {
      if (event.tabId !== source.tabId || event.frameId !== source.frameId) return
      record(event)
      sameTab = { kind: 'unavailable' }
    }
    const removed = (tabId, removeInfo) => {
      if (tabId !== source.tabId) return
      record({ tabId, windowId: removeInfo.windowId })
      sameTab = { kind: 'closed' }
    }
    const replaced = (addedTabId, removedTabId) => {
      if (removedTabId !== source.tabId) return
      record({ addedTabId, removedTabId })
      sameTab = { kind: 'unavailable' }
    }
    const createdNavigationTarget = event => {
      if (event.sourceTabId !== source.tabId || event.sourceFrameId !== source.frameId) return
      if (sourceReplaced) { truncated = true; return }
      record({ tabId: event.tabId, url: event.url, evidence: 'created-navigation-target' }, true)
    }
    const created = tab => {
      if (source.frameId !== 0 || tab.openerTabId !== source.tabId) return
      if (sourceReplaced) { truncated = true; return }
      record({ tabId: tab.id, url: tab.url, evidence: 'opener-tab' }, true)
    }
    chromeApi.webNavigation?.onCommitted?.addListener(committed)
    chromeApi.webNavigation?.onHistoryStateUpdated?.addListener(history)
    chromeApi.webNavigation?.onReferenceFragmentUpdated?.addListener(referenceFragment)
    chromeApi.webNavigation?.onCreatedNavigationTarget?.addListener(createdNavigationTarget)
    chromeApi.webNavigation?.onErrorOccurred?.addListener(failed)
    chromeApi.tabs?.onCreated?.addListener(created)
    chromeApi.tabs?.onRemoved?.addListener(removed)
    chromeApi.tabs?.onReplaced?.addListener(replaced)
    const dispose = () => {
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer)
      chromeApi.webNavigation?.onCommitted?.removeListener(committed)
      chromeApi.webNavigation?.onHistoryStateUpdated?.removeListener(history)
      chromeApi.webNavigation?.onReferenceFragmentUpdated?.removeListener(referenceFragment)
      chromeApi.webNavigation?.onCreatedNavigationTarget?.removeListener(createdNavigationTarget)
      chromeApi.webNavigation?.onErrorOccurred?.removeListener(failed)
      chromeApi.tabs?.onCreated?.removeListener(created)
      chromeApi.tabs?.onRemoved?.removeListener(removed)
      chromeApi.tabs?.onReplaced?.removeListener(replaced)
      signal?.removeEventListener('abort', abort)
    }
    let resolveStopped
    const stopped = new Promise(resolve => { resolveStopped = resolve })
    const stop = () => {
      if (disposed) return
      disposed = true
      dispose()
      resolveStopped()
    }
    const abort = () => stop()
    signal?.addEventListener('abort', abort, { once: true })
    deadlineTimer = setTimeout(stop, Math.max(0, deadline - now()))
    if (signal?.aborted) stop()
    const page = async state => {
      if (!state.event || !await authorized(state.event.url)) return undefined
      try {
        const current = await probe({ tabId: source.tabId, frameIds: [source.frameId] })
        if (current.documentId !== state.event.documentId || current.url !== state.event.url || !await authorized(current.url)) return undefined
        return current
      } catch { return undefined }
    }
    const candidates = async () => {
      const result = []
      for (const child of children) {
        if (!Number.isInteger(child.tabId) || result.some(item => item.tab.tabId === child.tabId)) continue
        try {
          const tab = await chromeApi.tabs.get(child.tabId)
          const url = httpUrl(tab?.url)
          if (!tab || !Number.isInteger(tab.windowId) || !url || !await authorized(url)) continue
          result.push({ tab: { tabId: child.tabId, windowId: tab.windowId, browserSessionId: sessionId }, url,
            relation: 'opener', attribution: 'candidate', evidence: child.evidence })
        } catch { /* absent children are not candidates */ }
      }
      if (!(await Promise.all(result.map(candidate => authorized(candidate.url)))).every(Boolean)) return []
      return result
    }
    return {
      async settle() {
        let observationTimer
        try {
          if (!disposed) {
            const observed = new Promise(resolve => { observationTimer = setTimeout(resolve, timeoutMs) })
            await Promise.race([observed, stopped])
          }
          const resolvedPage = await page(sameTab)
          const resolvedSameTab = resolvedPage ? { kind: sameTab.kind, page: resolvedPage } : { kind: sameTab.kind }
          return { version: 1, source: { tab: sourceTabRef, page: source }, startedAt, observedAt: now(), sameTab: resolvedSameTab,
            candidates: await candidates(), truncated }
        } finally {
          if (observationTimer !== undefined) clearTimeout(observationTimer)
          stop()
        }
      },
    }
  }
  return { start }
}
