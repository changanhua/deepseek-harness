/** Select exact routes from DSH, including user-configured compatible providers. */
export const installReadingModels = ({ send }) => {
  const el = id => document.getElementById(id)
  let state, catalog, loading = false, online = false, metadataRevision = 0, selectionKey
  const option = (label, value) => { const row = document.createElement('option'); row.textContent = label; row.value = value; return row }
  const selectedRoute = () => state?.readings?.selection ?? catalog?.defaultSelection
  const renderEfforts = async () => {
    const revision = ++metadataRevision
    const selection = selectedRoute()
    el('reading-effort').replaceChildren(option('推理强度：默认', ''))
    el('reading-effort').disabled = true
    if (!selection || !online) return
    try {
      const { value } = await send({ type: 'dsh-assistant-reading-model', selection })
      if (revision !== metadataRevision) return
      const efforts = value.reasoning?.efforts ?? []
      for (const effort of efforts) el('reading-effort').append(option(effort.name, effort.id))
      el('reading-effort').value = selection.reasoningEffort ?? ''
      el('reading-effort').disabled = !efforts.length
    } catch (error) { if (revision === metadataRevision) el('model-summary').textContent = `模型信息不可用：${error.message}` }
  }
  const render = () => {
    const saved = state?.readings?.selection
    const rows = [option('使用 DSH 默认模型', '')]
    for (const provider of catalog?.providers ?? []) for (const model of provider.models) {
      rows.push(option(`${provider.name ?? provider.id} / ${model.name ?? model.id}`, JSON.stringify([provider.id, model.id])))
    }
    const value = saved ? JSON.stringify([saved.provider, saved.model]) : ''
    if (value && !rows.some(row => row.value === value)) rows.push(option(`${saved.provider} / ${saved.model}（尚未在 DSH 加载）`, value))
    el('reading-model').replaceChildren(...rows); el('reading-model').value = value
    el('reading-model').disabled = !online
    const route = selectedRoute()
    const errors = catalog?.providers?.filter(provider => provider.error).map(provider => provider.name ?? provider.id)
    el('model-summary').textContent = route ? `下次解读：${route.provider} / ${route.model} · 推理：${route.reasoningEffort ?? '默认'}` : '在 DSH 完整设置中添加服务商和模型，然后刷新列表。'
    if (errors?.length) el('model-summary').textContent += ` · ${errors.join('、')} 列表读取失败`
    void renderEfforts()
  }
  const reload = async () => {
    if (!online || loading) return
    loading = true
    try { catalog = (await send({ type: 'dsh-assistant-reading-models' })).value; render() }
    catch (error) { el('model-summary').textContent = `无法读取模型列表：${error.message}。更新 DSH 后点击刷新。` }
    finally { loading = false }
  }
  const update = next => {
    const wasOnline = online
    state = next; online = state.connection?.phase === 'connected'
    el('model-settings').disabled = !state.connection?.baseUrl
    const key = JSON.stringify(state.readings?.selection)
    if (key !== selectionKey || wasOnline !== online) { selectionKey = key; render() }
    if (online && !wasOnline) void reload()
  }
  const configure = async selection => {
    try { update((await send({ type: 'dsh-assistant-reading-configure', selection })).state) }
    catch (error) { el('model-summary').textContent = `设置未保存：${error.message}` }
  }
  el('reading-model').addEventListener('change', () => {
    const value = el('reading-model').value
    const [provider, model] = value ? JSON.parse(value) : []
    void configure(value ? { provider, model } : null)
  })
  el('reading-effort').addEventListener('change', () => {
    const route = selectedRoute()
    if (!route) return
    const reasoningEffort = el('reading-effort').value
    void configure({ provider: route.provider, model: route.model, ...(reasoningEffort ? { reasoningEffort } : {}) })
  })
  el('refresh-models').addEventListener('click', () => { void reload() })
  return { update, reload }
}
