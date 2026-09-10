/** Reuse one dedicated assistant window. It shares the worker's Session binding and has no second history. */
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
