const validSurfaceId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value)
const validFallbackId = value => typeof value === 'string'
  && /^surface-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)

/** Resolve one trusted sidebar/popup document to its worker-owned surface identity. */
export const assistantSurfaceId = (sender, extensionId, sidebarUrl, fallbackId) => {
  if (sender?.id !== extensionId || sender.url !== sidebarUrl) return null
  if (validSurfaceId(sender.documentId)) return sender.documentId
  return validFallbackId(fallbackId) ? fallbackId : null
}

export const attachAssistantViewPort = ({ port, extensionId, sidebarUrl, onPresence, onClosed }) => {
  const sender = port.sender
  if (port.name !== 'dsh-assistant-view' || sender?.id !== extensionId || sender.url !== sidebarUrl) {
    port.disconnect()
    return
  }
  let surfaceId = assistantSurfaceId(sender, extensionId, sidebarUrl)
  let closed = false
  port.onMessage.addListener(message => {
    if (closed || message?.type !== 'presence' || typeof message.visible !== 'boolean') return
    const resolved = assistantSurfaceId(sender, extensionId, sidebarUrl, message.surfaceId)
    if (resolved === null || surfaceId !== null && resolved !== surfaceId) {
      port.disconnect()
      return
    }
    surfaceId = resolved
    try {
      void Promise.resolve(onPresence(surfaceId, message.visible)).then(() => {
        if (!closed) port.postMessage({ type: 'presence-ready' })
      }).catch(() => {})
    } catch { /* A failed view update cannot grant presence. */ }
  })
  port.onDisconnect.addListener(() => {
    closed = true
    if (surfaceId === null) return
    try { void Promise.resolve(onClosed(surfaceId)).catch(() => {}) } catch {}
  })
}

/** Reuse one dedicated assistant window; its document identity owns an independent Session selection. */
export const createAssistantSurfaces = ({ chromeApi }) => {
  let opening = null
  const openWindow = () => {
    if (opening) return opening
    const url = chromeApi.runtime.getURL('sidebar.html')
    const work = (async () => {
      const [contexts, windows] = await Promise.all([
        chromeApi.runtime.getContexts({ documentUrls: [url], contextTypes: ['TAB', 'POPUP'] }),
        chromeApi.windows.getAll({ windowTypes: ['popup'] }),
      ])
      const existing = windows.find(window => contexts.some(context => context.windowId === window.id))
      if (existing && Number.isInteger(existing.id)) {
        try {
          await chromeApi.windows.update(existing.id, { focused: true, ...(existing.state === 'minimized' ? { state: 'normal' } : {}) })
          return { windowId: existing.id }
        } catch { /* The user may have closed this window after enumeration. */ }
      }
      const created = await chromeApi.windows.create({ url, type: 'popup', width: 440, height: 820, focused: true })
      if (!Number.isInteger(created?.id)) throw new Error('assistant_window_unavailable')
      return { windowId: created.id }
    })().finally(() => { opening = null })
    opening = work
    return work
  }
  return { openWindow }
}
