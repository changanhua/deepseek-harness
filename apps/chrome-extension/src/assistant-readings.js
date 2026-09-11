const KEY = 'dsh.assistant.readings.v1'

/** Reading history is display-only; only the supplied material enters a model request. */
export const createAssistantReadings = ({ storage, call, changed }) => {
  let items = [], selection, selectedId = null
  const read = () => structuredClone({ items, selection, selectedId })
  const save = () => storage.set({ [KEY]: { items: items.filter(item => item.status !== 'running'), selection } })
  const restore = async () => {
    const saved = (await storage.get(KEY))[KEY]
    items = (saved?.items ?? []).slice(-30)
    selection = saved?.selection
    selectedId = items.at(-1)?.id ?? null
  }
  const configure = async value => {
    if (value !== null && (!value || typeof value.provider !== 'string' || typeof value.model !== 'string'
      || value.provider.length > 256 || value.model.length > 256
      || value.reasoningEffort !== undefined && (typeof value.reasoningEffort !== 'string' || value.reasoningEffort.length > 128))) throw new Error('invalid_input')
    selection = value ?? undefined
    await save(); changed()
  }
  const onEvent = frame => {
    const item = items.find(row => row.id === frame.id && row.status === 'running')
    if (!item || typeof frame.text !== 'string' || item.text.length + frame.text.length > 64000) return
    item.text += frame.text; changed()
  }
  const select = url => { const item = items.findLast(row => row.url === url); if (item) { selectedId = item.id; changed() } }
  const generate = async (payload, text) => {
    if (items.some(item => item.status === 'running')) throw new Error('reading_busy')
    const item = { id: crypto.randomUUID(), title: payload.title, url: payload.url, text: '', status: 'running', selection }
    items.push(item); items = items.slice(-30); selectedId = item.id; changed()
    // No automatic retry: a lost acknowledgement must not cause another paid request.
    void call('reading.generate', { id: item.id, text, ...(selection ? { selection } : {}) }, { timeoutMs: 250000 })
      .then(result => { item.text = result.text; item.selection = result.selection; item.status = 'complete' }, error => {
        item.status = error.code === 'result_unknown' ? 'unknown' : 'error'
        item.error = error.message ?? error.code ?? String(error)
      }).finally(() => { changed(); void save().catch(() => {}) })
    return { ok: true }
  }
  const stop = async () => {
    const item = items.find(row => row.status === 'running')
    if (item) await call('reading.stop', { id: item.id })
  }
  return { read, restore, configure, generate, onEvent, select, stop }
}
