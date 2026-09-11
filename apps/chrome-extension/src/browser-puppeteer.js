import { performPuppeteerAction } from './browser-puppeteer-actions.js'

const error = code => Object.assign(new Error(code), { code })
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const measureTarget = node => {
  if (!node.isConnected) return { reason: 'stale_element' }
  const box = node.getBoundingClientRect(), style = getComputedStyle(node)
  if (!box.width || !box.height || style.visibility !== 'visible' || style.display === 'none') return { reason: 'target_unavailable' }
  const x = Math.max(0, Math.min(innerWidth, box.right) + Math.max(0, box.left)) / 2
  const y = Math.max(0, Math.min(innerHeight, box.bottom) + Math.max(0, box.top)) / 2
  let hit = document.elementFromPoint(x, y)
  while (hit?.shadowRoot) { const inner = hit.shadowRoot.elementFromPoint(x, y); if (!inner || inner === hit) break; hit = inner }
  if (hit !== node && !node.contains(hit)) return { reason: 'target_obscured' }
  return { bounds: [box.x, box.y, box.width, box.height] }
}

/** Puppeteer's pinned extension build is injected, so tests need no debugger. */
export const createPuppeteerDriver = ({ chromeApi, connect, ExtensionTransport, actionTimeoutMs = 5000 }) => {
  const busy = new Set()
  const execute = async ({ page, request, invoke, validate, authorizeUrl, signal }) => {
    let browser, transport, handle, reserved = false, issued = false, stage = 'attach'
    let attached = false, detached = false, closing = false, inputLane = Promise.resolve(), closePromise
    let keyboard, mouse, interruptedInput
    const pressedButtons = new Set(), pressedKeys = new Set()
    const releaseInputs = async () => {
      await inputLane
      for (const button of pressedButtons) { try { await mouse?.up({ button }) } catch { /* detached */ } }
      for (const code of pressedKeys) { try { await keyboard?.up(code) } catch { /* detached */ } }
    }
    const ancestors = []
    const detachEvent = source => {
      if (source.tabId !== page.tabId || !attached) return
      detached = true
      chromeApi.debugger.onDetach.removeListener(detachEvent)
    }
    const contexts = new Map()
    const event = (source, method, params) => {
      if (source.tabId !== page.tabId) return
      const session = source.sessionId ?? 'pageTargetSessionId'
      if (method === 'Runtime.executionContextCreated') contexts.set(`${session}:${params.context.id}`, { ...params.context, session })
      if (method === 'Runtime.executionContextDestroyed') contexts.delete(`${session}:${params.executionContextId}`)
      if (method === 'Runtime.executionContextsCleared') for (const [key, context] of contexts) if (context.session === session) contexts.delete(key)
    }
    const check = () => {
      if (signal?.aborted) throw error('cancelled')
      if (detached || closing) throw error('debugger_detached')
      if (Date.now() >= request.deadline) throw error('deadline')
      validate()
    }
    if (busy.has(page.tabId)) return { outcome: 'failed', reason: 'browser_busy', quiescent: true }
    busy.add(page.tabId)
    try {
      check()
      chromeApi.debugger?.onEvent.addListener(event)
      chromeApi.debugger?.onDetach.addListener(detachEvent)
      stage = 'connect'
      transport = await ExtensionTransport.connectTab(page.tabId)
      attached = true
      const close = transport.close.bind(transport)
      // The pinned build returns debugger.detach's promise from close().
      transport.close = () => (closePromise ??= Promise.resolve(close()))
      check()
      // Refuse any later input packet after stop/deadline/revocation. Never retry
      // an input packet whose reply was lost, including a partial fill.
      const send = transport.send.bind(transport)
      const deliver = (message, packet) => {
        if (packet.method === 'Input.dispatchMouseEvent') {
          if (packet.params?.type === 'mousePressed') pressedButtons.add(packet.params.button)
          if (packet.params?.type === 'mouseReleased') pressedButtons.delete(packet.params.button)
        }
        if (packet.method === 'Input.dispatchKeyEvent') {
          if (['keyDown', 'rawKeyDown'].includes(packet.params?.type)) pressedKeys.add(packet.params.code)
          if (packet.params?.type === 'keyUp') pressedKeys.delete(packet.params.code)
        }
        send(message)
      }
      transport.send = message => {
        const packet = JSON.parse(message)
        if (packet.method.startsWith('Input.')) {
          inputLane = inputLane.then(async () => {
            // Once a press has been sent, release completes that in-flight input
            // even after stop. Cancellation cannot undo it; return unknown.
            if (packet.method === 'Input.dispatchMouseEvent' && packet.params?.type === 'mouseReleased' && pressedButtons.has(packet.params.button)
              || packet.method === 'Input.dispatchKeyEvent' && packet.params?.type === 'keyUp' && pressedKeys.has(packet.params.code)) {
              if (packet.method === 'Input.dispatchMouseEvent') {
                try {
                  check()
                  const guard = await invoke(page, 'guardExternal', request)
                  if (!guard.ready) interruptedInput = guard.reason ?? 'in_flight_target_changed'
                } catch { interruptedInput = 'in_flight_interrupted' }
              }
              deliver(message, packet); return
            }
            check()
            const guard = await invoke(page, 'guardExternal', request)
            if (!guard.ready) throw error(guard.reason ?? 'stale_preparation')
            check()
            deliver(message, packet)
          }).catch(cause => {
            transport.onmessage?.(JSON.stringify({ id: packet.id, sessionId: packet.sessionId,
              error: { code: -32000, message: cause.code ?? 'stale_document' } }))
          })
          return
        }
        send(message)
      }
      stage = 'browser_connect'
      browser = await connect({ transport, defaultViewport: null, protocol: 'cdp', protocolTimeout: actionTimeoutMs })
      stage = 'document_token'
      check()
      const token = await invoke(page, 'documentToken')
      stage = 'pages'
      const pages = await browser.pages()
      if (pages.length !== 1) throw error('puppeteer_page_unavailable')
      const puppeteerPage = pages[0]
      keyboard = puppeteerPage.keyboard
      mouse = puppeteerPage.mouse
      let match
      // Chrome's documentId and CDP's frameId are different namespaces. Match
      // the random token in this extension's isolated context, never by URL.
      stage = 'context_match'
      for (const frame of puppeteerPage.frames()) {
        for (const context of contexts.values()) {
          if (context.origin.replace(/\/$/u, '') !== `chrome-extension://${chromeApi.runtime.id}`
            || context.auxData?.frameId !== frame._id || context.session !== frame.client.id()) continue
          const value = await frame.client.send('Runtime.evaluate', { contextId: context.id,
            expression: 'globalThis.__dshBrowserAssistant?.documentToken()', returnByValue: true })
          if (value.result?.value === token) match = { frame, context }
        }
      }
      if (!match) throw error('puppeteer_document_unavailable')
      stage = 'start_external'
      check()
      const reservation = await invoke(page, 'startExternal', request)
      if (!reservation.ready) return reservation
      reserved = true
      const { frame, context } = match
      stage = 'external_node'
      const remote = await frame.client.send('Runtime.evaluate', { contextId: context.id,
        expression: `globalThis.__dshBrowserAssistant.externalNode(${JSON.stringify(request)})` })
      if (!remote.result?.objectId || remote.result.subtype !== 'node') throw error('stale_element')
      try {
        stage = 'describe_node'
        const { node } = await frame.client.send('DOM.describeNode', { objectId: remote.result.objectId })
        stage = 'adopt_backend_node'
        handle = (await frame.isolatedRealm().adoptBackendNode(node.backendNodeId)).asElement()
      } finally { await frame.client.send('Runtime.releaseObject', { objectId: remote.result.objectId }) }
      if (!handle) throw error('stale_element')
      const until = Math.min(request.deadline, Date.now() + actionTimeoutMs)
      stage = 'ancestors'
      for (let current = frame; current.parentFrame(); current = current.parentFrame()) {
        const ancestor = await current.frameElement()
        if (!ancestor) throw error('stale_document')
        ancestors.push(ancestor)
      }
      const action = request.payload.action
      const requiresHit = Boolean(action.element) && action.kind !== 'upload'
      if (requiresHit) {
        for (const ancestor of [...ancestors].reverse()) await ancestor.scrollIntoView()
        await handle.scrollIntoView()
      }
      let previous, stable = false
      while (requiresHit && Date.now() < until) {
        check()
        const states = await Promise.all([handle, ...ancestors].map(target => target.evaluate(measureTarget)))
        if (states.some(state => state.reason === 'stale_element')) throw error('stale_element')
        const bounds = states.every(state => state.bounds) ? JSON.stringify(states.map(state => state.bounds)) : undefined
        if (bounds && bounds === previous) { stable = true; break }
        previous = bounds
        await delay(50)
      }
      if (requiresHit && !stable) throw error('target_not_actionable')
      check()
      if (['back', 'forward'].includes(action.kind)) {
        const history = await frame.client.send('Page.getNavigationHistory')
        const destination = history.entries[history.currentIndex + (action.kind === 'back' ? -1 : 1)]
        if (destination) await authorizeUrl(destination.url)
        check()
      }
      stage = 'issue_external'
      const permission = await invoke(page, 'issueExternal', request)
      if (!permission || !permission.ready) return permission ?? { outcome: 'failed', reason: 'executor_reply_lost', quiescent: true }
      issued = true
      check()
      stage = 'action'
      const result = await performPuppeteerAction({ action, handle, frame, page: puppeteerPage, chromeApi, targetPage: page, check, authorizeUrl,
        resolveDrop: async () => {
          const remote = await frame.client.send('Runtime.evaluate', { contextId: context.id,
            expression: `globalThis.__dshBrowserAssistant.externalNode(${JSON.stringify(request)}, true)` })
          if (!remote.result?.objectId || remote.result.subtype !== 'node') throw error('stale_drop_target')
          try {
            const { node } = await frame.client.send('DOM.describeNode', { objectId: remote.result.objectId })
            const drop = (await frame.isolatedRealm().adoptBackendNode(node.backendNodeId)).asElement()
            if (!drop) throw error('stale_drop_target')
            return drop
          } finally { await frame.client.send('Runtime.releaseObject', { objectId: remote.result.objectId }) }
        } })
      if (result?.documentReplaced) return { outcome: 'observed', quiescent: true, value: { engine: 'puppeteer', ...result, businessOutcome: 'unverified' } }
      if (interruptedInput) throw error(interruptedInput)
      check()
      const settleUntil = Math.min(request.deadline, Date.now() + 1000)
      while (Date.now() < settleUntil) {
        check()
        if (await invoke(page, 'externalChanged', request)) break
        await delay(50)
      }
      return await invoke(page, 'completeExternal', request, result ? { result } : {})
    } catch (cause) {
      await releaseInputs()
      const baseReason = stage === 'connect' ? 'debugger_unavailable' : 'puppeteer_action_failed'
      const rawDetail = [stage, cause?.name, cause?.message].filter(value => typeof value === 'string' && value).join(':')
      const reason = cause.code ?? (stage === 'connect' ? baseReason : `${baseReason}@${rawDetail}`.slice(0, 1024))
      const detail = { stage, name: cause?.name, message: cause?.message, stack: cause?.stack }
      if (reserved) {
        try { return { ...(await invoke(page, 'completeExternal', request, { reason })), detail } } catch { /* old document or lost driver result */ }
      }
      return { outcome: issued ? 'unknown' : reason === 'cancelled' ? 'cancelled' : 'failed', reason, detail, quiescent: !issued }
    } finally {
      await releaseInputs()
      closing = true
      await inputLane
      // Detaching releases the debugger session after every call, including
      // partially issued key sequences. No later input is allowed to resume.
      try { await handle?.dispose() } catch { /* document may be gone */ }
      await Promise.allSettled(ancestors.map(ancestor => ancestor.dispose()))
      try { if (browser) await browser.disconnect(); else transport?.close() } catch { /* detached externally */ }
      chromeApi.debugger?.onEvent.removeListener(event)
      try { await closePromise } catch { /* target closed or user detached */ }
      chromeApi.debugger?.onDetach.removeListener(detachEvent)
      busy.delete(page.tabId)
    }
  }
  return { execute }
}
