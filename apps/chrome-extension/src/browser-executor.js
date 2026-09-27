const failure = code => Object.assign(new Error(code), { code })
const clone = value => structuredClone(value)
const MAX_SCREENSHOT_BASE64 = 1_500_000
const SCREENSHOT_QUALITIES = [55, 45, 35, 25, 15]
const mutating = kind => !['tabs', 'snapshot', 'page_map', 'entry_inspect', 'wait', 'screenshot'].includes(kind)
const kinds = new Set(['tabs', 'snapshot', 'page_map', 'navigate', 'click', 'fill', 'submit', 'scroll', 'wait',
  'double_click', 'right_click', 'hover', 'press', 'select', 'check', 'drag', 'upload',
  'back', 'forward', 'reload', 'tab_open', 'tab_close', 'tab_focus', 'screenshot',
  'entry_inspect', 'entry_mount', 'entry_unmount', 'region_render', 'region_clear'])
const siteOf = raw => {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw failure('unsupported_page')
  return url.origin
}
const allowed = (grant, raw) => {
  try { const origin = siteOf(raw); return grant.origins.includes('*') || grant.origins.includes(origin) }
  catch { return false }
}
const targetOf = page => ({ tabId: page.tabId, documentIds: [page.documentId] })
const pageOf = action => action.element?.page ?? action.page
const staleTarget = (expected, current) => current?.documentId !== expected.documentId || current?.frameId !== expected.frameId
  ? 'document_replaced'
  : current?.url !== expected.url ? 'target_url_stale' : 'stale_document'
const actionOf = request => ['prepare', 'commit', 'observe'].includes(request.payload?.kind) ? request.payload.action : request.payload

/** All page work is pinned to Chrome's documentId, never foreground state. */
export const createBrowserExecutor = ({ chromeApi, getGrant, puppeteer = null, getEngine = () => 'puppeteer', now = Date.now, navigationTimeoutMs = 2000,
  transitionTimeoutMs = 250 }) => {
  const browserSessionId = createBrowserSessionId({ storageSession: chromeApi.storage?.session })
  const readExpectedTab = async (reference, tabId) => {
    const sessionId = await browserSessionId()
    if (reference.tabId !== tabId || sessionId !== reference.browserSessionId) throw failure('tab_reference_stale')
    let tab
    try { tab = await chromeApi.tabs.get(reference.tabId) } catch { throw failure('tab_reference_stale') }
    if (tab?.id !== reference.tabId || tab.windowId !== reference.windowId) throw failure('tab_reference_stale')
    return { tabId: tab.id, windowId: tab.windowId, browserSessionId: sessionId }
  }
  const releaseInstallation = async ({ installationId, grantEpoch }) => {
    if (typeof installationId !== 'string' || !Number.isSafeInteger(grantEpoch) || grantEpoch < 1) return
    const tabs = await chromeApi.tabs.query({})
    await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => chromeApi.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true }, world: 'ISOLATED',
      func: (owner) => globalThis.__dshBrowserAssistant?.releaseInstallation(owner.installationId, owner.grantEpoch),
      args: [{ installationId, grantEpoch }],
    })))
  }
  const grantFor = (request, signal) => {
    if (signal?.aborted) throw failure('cancelled')
    if (now() >= request.deadline) throw failure('deadline')
    const grant = getGrant(request)
    if (!grant || grant.installationId !== request.installationId || grant.grantEpoch !== request.grantEpoch
      || !grant.scopes.includes(mutating(actionOf(request).kind) ? 'browser:write' : 'browser:read')
      || request.payload.kind === 'observe' && !grant.scopes.includes('browser:observe')) throw failure('authorization_changed')
    return grant
  }
  const checkSite = async (request, signal, url) => {
    if (!allowed(grantFor(request, signal), url)) throw failure('site_not_authorized')
    if (!await chromeApi.permissions.contains({ origins: [`${siteOf(url)}/*`] })) throw failure('site_permission_required')
    if (!allowed(grantFor(request, signal), url)) throw failure('site_not_authorized')
  }
  const probe = async target => {
    const result = await chromeApi.scripting.executeScript({ target, world: 'ISOLATED',
      func: () => ({ url: location.href, title: document.title }) })
    if (result.length !== 1 || !result[0].documentId || !result[0].result?.url) throw failure('document_unavailable')
    return { tabId: target.tabId, frameId: result[0].frameId, documentId: result[0].documentId, url: result[0].result.url }
  }
  const transitions = createBrowserTransitions({ chromeApi, browserSessionId, probe, now, timeoutMs: transitionTimeoutMs })
  const tracksTransition = kind => ['navigate', 'click', 'submit', 'press', 'back', 'forward', 'reload', 'tab_close'].includes(kind)
  const attachTransition = async (result, watcher) => {
    if (!watcher || !result || typeof result !== 'object') return result
    const transition = await watcher.settle()
    return { ...result, value: { ...(result.value ?? {}), transition } }
  }
  const invoke = async (page, method, value, options = {}) => {
    const results = await chromeApi.scripting.executeScript({ target: targetOf(page), world: 'ISOLATED',
      func: (method, value, options) => globalThis.__dshBrowserAssistant[method](value, options),
      args: [method, value ?? null, options] })
    const result = results.find(row => row.documentId === page.documentId && row.frameId === page.frameId)
    if (!result || result.result == null) throw failure('executor_reply_lost')
    return result.result
  }
  const inspect = async (entry, { cancel = false } = {}) => {
    if (entry.operation === 'tab_open') return { outcome: 'unknown', quiescent: false, reason: 'tab_creation_unconfirmed' }
    if (!entry.target) return { outcome: 'unknown', quiescent: true, reason: 'read_interrupted' }
    try {
      // Do not inject a new page runtime while reconciling an old request.
      return await invoke(entry.target, 'inspect', entry.identity, { cancel })
    } catch {
      try {
        const current = await probe({ tabId: entry.target.tabId, frameIds: [entry.target.frameId] })
        if (current.documentId !== entry.target.documentId) return { outcome: 'unknown', quiescent: true, reason: 'document_replaced' }
      } catch { /* loss of permission alone does not prove document destruction */ }
      return { outcome: 'unknown', quiescent: false, reason: 'executor_unavailable' }
    }
  }
  const observeNavigation = async (request, prior, signal) => {
    const until = Math.min(request.deadline, now() + navigationTimeoutMs)
    while (!signal?.aborted && now() < until) {
      try {
        const grant = grantFor(request, signal)
        const current = await probe({ tabId: prior.tabId, frameIds: [prior.frameId] })
        if (current.documentId !== prior.documentId || current.url !== prior.url && current.url === actionOf(request).url) {
          // A redirect can leave the authorized origin. Report the completed
          // navigation without returning the unauthorized destination's URL.
          return { outcome: 'observed', quiescent: true, value: allowed(grant, current.url)
            ? { navigated: true, page: current } : { navigated: true, accessible: false } }
        }
      } catch { /* the replacement document may still be loading */ }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    return { outcome: 'unknown', quiescent: false, reason: 'navigation_unconfirmed' }
  }
  const execute = async (request, signal) => {
    let issued = false
    let cancel
    let preparedPage
    let watcher
    try {
      const action = actionOf(request)
      const preparing = request.payload?.kind === 'prepare'
      const committing = request.payload?.kind === 'commit'
      const observing = request.payload?.kind === 'observe'
      if (!action || !kinds.has(action.kind) || (preparing ? false : mutating(action.kind)) !== request.mutates
        || (preparing || committing) && ['tabs', 'snapshot', 'page_map'].includes(action.kind)
        || committing && typeof request.payload.preparationId !== 'string'
        || observing && !['tabs', 'snapshot', 'page_map'].includes(action.kind)) throw failure('invalid_action')
      const grant = grantFor(request, signal)
      if (action.kind === 'tabs') {
        const tabs = []
        const sessionId = await browserSessionId()
        for (const tab of await chromeApi.tabs.query({})) {
          if (!allowed(grant, tab.url) || !Number.isSafeInteger(tab.id) || tab.id < 0
            || !Number.isSafeInteger(tab.windowId) || tab.windowId < 0) continue
          if (!await chromeApi.permissions.contains({ origins: [`${siteOf(tab.url)}/*`] })) continue
          const live = grantFor(request, signal)
          if (!allowed(live, tab.url)) continue
          tabs.push({ tabId: tab.id, windowId: tab.windowId, browserSessionId: sessionId,
            url: tab.url, title: tab.title ?? '', active: tab.active === true })
          if (tabs.length >= 128) break
        }
        grantFor(request, signal)
        return { outcome: 'observed', quiescent: true, value: { tabs } }
      }
      const expected = pageOf(action)
      if (action.kind === 'tab_open' && !expected) {
        if (request.target || preparing || committing || observing) throw failure('invalid_action')
        const sessionId = await browserSessionId()
        await checkSite(request, signal, action.url)
        grantFor(request, signal)
        issued = true
        const tab = await chromeApi.tabs.create({ url: action.url, active: false })
        if (!Number.isSafeInteger(tab?.id) || tab.id < 0 || !Number.isSafeInteger(tab.windowId)) throw failure('tab_creation_unconfirmed')
        // Creation is already confirmed. Return only its handle, even if the
        // grant changed while Chrome answered; later reads recheck authority.
        return { outcome: 'observed', quiescent: true, value: { opened: true, tab: { tabId: tab.id, windowId: tab.windowId, browserSessionId: sessionId } } }
      }
      if (expected) {
        if (!request.target || request.target.tabId !== expected.tabId || request.target.frameId !== expected.frameId
          || request.target.documentId !== expected.documentId) throw failure('target_mismatch')
        await checkSite(request, signal, expected.url)
      }
      if (['navigate', 'tab_open'].includes(action.kind)) await checkSite(request, signal, action.url)
      if (action.kind === 'snapshot' && action.expectedTab) {
        await readExpectedTab(action.expectedTab, action.tabId)
      }
      const target = expected ? targetOf(expected) : action.documentId
        ? { tabId: action.tabId, documentIds: [action.documentId] } : { tabId: action.tabId, frameIds: [action.frameId] }
      let page
      try {
        page = await probe(target)
      } catch (cause) {
        if (expected) {
          let current
          try { current = await probe({ tabId: expected.tabId, frameIds: [expected.frameId] }) } catch { current = null }
          if (current && (current.documentId !== expected.documentId || current.url !== expected.url)) throw failure(staleTarget(expected, current))
          if (!current) {
            try {
              const frames = await chromeApi.webNavigation?.getAllFrames?.({ tabId: expected.tabId })
              const frame = frames?.find(candidate => candidate.frameId === expected.frameId)
              if (frame?.documentId && frame.documentId !== expected.documentId) throw failure('document_replaced')
            } catch (replacement) {
              if (['document_replaced', 'target_url_stale'].includes(replacement?.code)) throw replacement
            }
            try {
              const tab = await chromeApi.tabs.get(expected.tabId)
              if (typeof tab?.url === 'string' && tab.url !== expected.url) throw failure('target_url_stale')
            } catch (replacement) {
              if (['document_replaced', 'target_url_stale'].includes(replacement?.code)) throw replacement
            }
          }
        }
        throw cause
      }
      preparedPage = page
      const routeRelease = ['entry_unmount', 'region_clear'].includes(action.kind)
        && expected && page.documentId === expected.documentId && page.frameId === expected.frameId && page.url !== expected.url
      if (expected && !routeRelease && (page.documentId !== expected.documentId || page.frameId !== expected.frameId || page.url !== expected.url)
        || action.documentId && page.documentId !== action.documentId) throw failure(expected && staleTarget(expected, page) || 'document_replaced')
      await checkSite(request, signal, page.url)
      await chromeApi.scripting.executeScript({ target: targetOf(page), world: 'ISOLATED', files: ['src/browser-dom-tree.js', 'src/browser-page.js'] })
      grantFor(request, signal)
      if (preparing) {
        const result = await invoke(page, 'prepare', clone(request))
        grantFor(request, signal)
        return result
      }
      if (action.kind === 'snapshot') {
        const snapshot = await invoke(page, 'snapshot', observing ? { references: false } : {
          query: action.query ?? '', offset: action.offset ?? 0, limit: action.limit ?? 128, textLimit: action.textLimit ?? 50000,
          tree: action.tree ?? false, ...(action.treeCursor === undefined ? {} : { treeCursor: action.treeCursor }), treeLimit: action.treeLimit ?? 256,
          includeOptions: action.includeOptions ?? false, structure: action.structure ?? true,
          includeValues: action.includeValues ?? false,
          ...(action.presentationQueries === undefined ? {} : {
            presentationQueries: action.presentationQueries,
            presentationOwner: { sessionId: request.sessionId, installationId: request.installationId,
              grantEpoch: request.grantEpoch, page },
          }),
        })
        if (snapshot?.error?.code) return { outcome: 'failed', quiescent: true, reason: snapshot.error.code, detail: snapshot.error.message }
        const frames = []
        if (chromeApi.webNavigation && !observing) {
          for (const frame of await chromeApi.webNavigation.getAllFrames({ tabId: page.tabId }) ?? []) {
            if (!frame.documentId || !allowed(grantFor(request, signal), frame.url)) continue
            if (!await chromeApi.permissions.contains({ origins: [`${siteOf(frame.url)}/*`] })) continue
            frames.push({ tabId: page.tabId, frameId: frame.frameId, documentId: frame.documentId, url: frame.url })
            if (frames.length >= 128) break
          }
        }
        grantFor(request, signal)
        if (snapshot.url !== page.url) throw failure('target_url_stale')
        const tab = action.expectedTab ? await readExpectedTab(action.expectedTab, page.tabId) : undefined
        grantFor(request, signal)
        return { outcome: 'observed', quiescent: true,
          value: { ...snapshot, page, ...(tab ? { tab } : {}), ...(frames.length ? { frames } : {}) } }
      }
      if (action.kind === 'page_map') {
        const result = await invoke(page, 'pageMap', clone(request))
        grantFor(request, signal)
        return result
      }
      if (action.kind === 'entry_inspect') {
        const result = await invoke(page, 'entryInspect', clone(request))
        grantFor(request, signal)
        return result
      }
      if (action.kind === 'entry_mount' || action.kind === 'entry_unmount') {
        const result = await invoke(page, action.kind === 'entry_mount' ? 'entryMount' : 'entryUnmount', clone(request))
        grantFor(request, signal)
        return result
      }
      if (action.kind === 'region_render' || action.kind === 'region_clear') {
        const result = await invoke(page, action.kind === 'region_render' ? 'regionRender' : 'regionClear', clone(request))
        grantFor(request, signal)
        return result
      }
      // Waiting does not need a CDP session. Keep it on the page runtime so a
      // transient debugger attach failure cannot turn a read into an error.
      if (action.kind === 'wait') {
        issued = true
        return await invoke(page, 'execute', clone(request))
      }
      // Focusing a tab is a browser-level operation; it must not depend on
      // adopting a DOM node through Puppeteer.
      if (action.kind === 'tab_focus') {
        await chromeApi.tabs.update(page.tabId, { active: true })
        grantFor(request, signal)
        return { outcome: 'observed', quiescent: true, value: { focused: true } }
      }
      // The extension already owns a permission-safe screenshot path. It only
      // captures the visible tab, so reject a stale/non-foreground target
      // rather than returning pixels from a different page.
      if (action.kind === 'screenshot') {
        let active
        try { active = await chromeApi.tabs.get?.(page.tabId) } catch { active = undefined }
        if (!active) active = (await chromeApi.tabs.query({ active: true, lastFocusedWindow: true }))[0]
        // captureVisibleTab is safe only when Chrome already reports this exact
        // target as foreground. Never change user focus merely to obtain a read;
        // a background target falls through to Puppeteer's focus-free CDP path.
        if (active?.id === page.tabId && active.active !== false && Number.isInteger(active.windowId)) {
          let dataUrl
          for (const quality of SCREENSHOT_QUALITIES) {
            try {
              dataUrl = await chromeApi.tabs.captureVisibleTab(active.windowId, { format: 'jpeg', quality })
              if (typeof dataUrl === 'string' && dataUrl.match(/^data:image\/jpeg;base64,/u)?.[0] && dataUrl.length <= MAX_SCREENSHOT_BASE64) break
            } catch { dataUrl = undefined }
          }
          if (dataUrl !== undefined) {
            const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(dataUrl)
            if (!match || match[1].length > MAX_SCREENSHOT_BASE64) throw failure('screenshot_too_large')
            grantFor(request, signal)
            return { outcome: 'observed', quiescent: true, value: { screenshot: { data: match[1], mimeType: 'image/jpeg' } } }
          }
        } else if (!puppeteer || getEngine() !== 'puppeteer') throw failure('screenshot_requires_active_tab')
      }
      watcher = tracksTransition(action.kind) ? await transitions.start({ source: page, deadline: request.deadline, signal,
        authorized: async url => {
          try { await checkSite(request, signal, url); return true } catch { return false }
        } }) : null
      cancel = () => { void inspect({ target: page, identity: request }, { cancel: true }) }
      signal?.addEventListener('abort', cancel, { once: true })
      grantFor(request, signal)
      if (puppeteer && getEngine() === 'puppeteer') {
          return await attachTransition(await puppeteer.execute({ page, request: clone(request), invoke, signal,
            validate: () => grantFor(request, signal), authorizeUrl: url => checkSite(request, signal, url) }), watcher)
      }
      issued = true
      const result = await invoke(page, 'execute', clone(request))
      const settled = action.kind === 'navigate' && result.outcome === 'unknown' ? await observeNavigation(request, page, signal) : result
      return await attachTransition(settled, watcher)
    } catch (cause) {
      const result = issued && actionOf(request).kind === 'navigate'
        ? await observeNavigation(request, preparedPage, signal)
        : { outcome: issued ? 'unknown' : cause.code === 'cancelled' ? 'cancelled' : 'failed',
        quiescent: !issued, reason: issued ? 'executor_reply_lost' : cause.code ?? 'page_unavailable' }
      return await attachTransition(result, watcher)
    } finally { if (cancel) signal?.removeEventListener('abort', cancel) }
  }
  return { execute, inspect, releaseInstallation }
}
import { createBrowserSessionId } from './browser-session-id.js'
import { createBrowserTransitions } from './browser-transitions.js'
