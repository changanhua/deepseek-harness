const panels = new WeakMap()
const text = (tag, value = '') => { const node = document.createElement(tag); node.textContent = value; return node }
const field = (title, input, id) => {
  const label = document.createElement('label'); label.htmlFor = id; input.id = id
  label.append(text('span', title), input); return label
}
const number = (value, min, max) => {
  const input = document.createElement('input'); input.type = 'number'; input.value = String(value)
  input.min = String(min); input.max = String(max); input.step = '1'; input.required = true; return input
}
const button = (label, action) => {
  const node = text('button', label); node.type = 'button'
  node.addEventListener('click', async () => { node.disabled = true; try { await action() } finally { node.disabled = false } })
  return node
}
const errors = {
  activity_target_changed: '待确认数据属于另一台 DSH，请恢复原连接后确认。',
  activity_storage_unavailable: '本地缓冲保存失败，采集已停止。请保留扩展数据并重新打开助手。',
  activity_storage_invalid: '本地缓冲无法读取，采集已停止。',
  activity_configuration_pending: '请先确认上次配置请求。',
  activity_configuration_changed: '配置已在其他窗口改变，请刷新后再保存。',
  activity_sync_required: '正在核对 DSH 中的活动配置，请稍后再保存。',
  observation_not_authorized: '请先允许监控这些站点，并在 DSH 中批准。',
  page_permission_required: 'Chrome 站点权限已收回，采集和上传已停止。',
  activity_configuration_unconfirmed: '配置尚未确认，本地采集已停止。',
  activity_upload_unconfirmed: '上传尚未确认，缓冲已保留，连接恢复后会核对原批次。',
  result_unknown: '请求结果尚未确认，请确认原请求。',
}
function mount(panel) {
  const model = { state: null, send: null, close: null, busy: false, dirty: false, loadedRevision: undefined, resultKey: null }
  const header = document.createElement('div'); header.className = 'monitor-heading'
  header.append(button('← 返回会话', () => model.close()), text('h2', '浏览活动'),
    button('刷新', () => model.send({ type: 'dsh-assistant-activity-refresh' })))
  model.status = text('p'); model.status.setAttribute('role', 'status')
  model.error = text('p'); model.error.className = 'monitor-error'
  model.pause = button('暂停采集', () => model.send({ type: 'dsh-assistant-activity-pause' }))
  model.pause.id = 'activity-pause'
  model.retry = button('确认原配置请求', () => model.send({ type: 'dsh-assistant-activity-retry' }))
  const form = document.createElement('form'); form.className = 'monitor-form'
  const origins = document.createElement('textarea'); origins.rows = 2; origins.required = true; origins.maxLength = 8192
  const kinds = ['visit', 'dwell', 'dom-change'].map((kind, index) => {
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = true; input.value = kind
    const label = field(['标签与页面流转', '前台停留时段', '页面局部变化'][index], input, 'activity-kind-' + kind)
    label.className = 'monitor-toggle'; return { input, label }
  })
  const seconds = number(5, 1, 60), retention = number(7, 1, 30), count = number(500, 10, 2000), body = number(0, 0, 4000)
  model.submit = text('button', '保存并开始（当前会话）'); model.submit.type = 'submit'; model.submit.className = 'primary'
  form.append(field('允许采集的站点来源（每行一个）', origins, 'activity-origins'), ...kinds.map(item => item.label),
    field('采样间隔（秒）', seconds, 'activity-seconds'), field('保留天数', retention, 'activity-retention'),
    field('最多保留事件数', count, 'activity-count'), field('每条正文字符上限（0 表示不采集正文）', body, 'activity-body'),
    text('small', '仅观察已获持续站点权限的前台网页。原始记录保留在 DSH；本地缓冲最多 64 条。连续活动不采集图片，可在会话中主动截取当前页面。'), model.submit)
  form.addEventListener('input', () => { model.dirty = true })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (model.busy || !form.reportValidity()) return
    const selected = kinds.filter(item => item.input.checked).map(item => item.input.value)
    if (!selected.length) { model.error.textContent = '请至少选择一种事件。'; return }
    model.busy = true; model.submit.disabled = true
    try {
      const result = await model.send({ type: 'dsh-assistant-activity-configure', settings: { enabled: true,
        origins: origins.value.split(/\s+/u).filter(Boolean), kinds: selected, minIntervalMs: Number(seconds.value) * 1000,
        retentionDays: Number(retention.value), maxEvents: Number(count.value), maxTextChars: Number(body.value) } })
      if (result?.ok) model.dirty = false
    } finally { model.busy = false; update(model) }
  })
  const search = document.createElement('form'); search.className = 'activity-search'
  const query = document.createElement('input'); query.maxLength = 256
  const find = text('button', '检索 DSH 活动'); find.type = 'submit'
  search.append(field('按标题、网址或已采集正文检索', query, 'activity-query'), find)
  search.addEventListener('submit', async event => {
    event.preventDefault(); find.disabled = true
    try { await model.send({ type: 'dsh-assistant-activity-query', query: query.value }) } finally { find.disabled = false }
  })
  const purpose = document.createElement('select')
  for (const [value, label] of [['knowledge', '提炼知识'], ['reference', '整理资料']]) {
    const option = text('option', label); option.value = value; purpose.append(option)
  }
  const knowledge = document.createElement('div'); knowledge.className = 'monitor-form'
  model.knowledge = text('button', '整理并保存到思源'); model.knowledge.type = 'button'
  model.knowledge.addEventListener('click', async () => {
    if (model.knowledgeBusy || model.knowledge.disabled) return
    model.knowledgeBusy = true; update(model)
    try {
      const result = await model.send({ type: 'dsh-assistant-activity-knowledge', query: query.value, purpose: purpose.value })
      if (result?.ok) model.close()
    } finally { model.knowledgeBusy = false; update(model) }
  })
  knowledge.append(field('保存用途', purpose, 'activity-purpose'), model.knowledge,
    text('small', '由当前会话的 Agent 提炼相关活动，写入后回读并检索确认。需要 DSH 已连接思源原生 MCP。'))
  model.list = document.createElement('div'); model.list.className = 'monitor-list'
  Object.assign(model, { origins, kinds, seconds, retention, count, body })
  panel.replaceChildren(header, model.status, model.error, model.pause, model.retry, form, search, knowledge, model.list)
  return model
}
function update(model) {
  const activity = model.state?.activity, policy = activity?.policy
  const names = { unavailable: '等待已授权的 DSH 连接', unconfigured: '尚未开始采集', configuring: '正在保存配置，本地采集已暂停',
    'paused-local': '本地已暂停，请重新保存配置',
    collecting: '正在按配置采集', paused: '已暂停', unconfirmed: '配置等待确认，本地采集已停止',
    'authorization-changed': '授权已变化，请重新选择站点并保存', error: '采集状态需要检查' }
  model.status.textContent = `${names[activity?.phase] ?? '等待状态'} · 缓冲 ${activity?.buffered ?? 0} 条 · 丢弃 ${activity?.discarded ?? 0} 条`
  model.error.textContent = activity?.error ? errors[activity.error] ?? '操作尚未确认，请检查连接后刷新。'
    : activity?.collectionError ? '最近一次页面采集失败；请检查页面和站点权限。' : ''
  model.retry.hidden = !activity?.pendingConfiguration
  model.pause.hidden = !policy?.enabled
  model.pause.disabled = model.busy || activity?.pendingConfiguration === true
  model.submit.disabled = model.busy || !model.state?.session?.binding || model.state?.connection?.phase !== 'connected'
    || activity?.pendingConfiguration === true || activity?.synchronized !== true
  model.knowledge.disabled = model.knowledgeBusy === true || !model.state?.session?.binding || model.state?.connection?.phase !== 'connected'
  if (!model.dirty && model.loadedRevision !== activity?.revision) {
    let currentOrigin = ''
    try { currentOrigin = new URL(model.state.page?.url).origin } catch { /* No ordinary page selected. */ }
    model.origins.value = policy?.origins.join('\n') ?? (currentOrigin === 'null' ? '' : currentOrigin)
    if (policy) {
      model.seconds.value = String(policy.minIntervalMs / 1000); model.retention.value = String(policy.retentionDays)
      model.count.value = String(policy.maxEvents); model.body.value = String(policy.maxTextChars)
      model.kinds.forEach(item => { item.input.checked = policy.kinds.includes(item.input.value) })
    }
    model.loadedRevision = activity?.revision
  }
  const resultKey = JSON.stringify(activity?.results ?? [])
  if (resultKey !== model.resultKey) {
    model.resultKey = resultKey
    model.list.replaceChildren(...(activity?.results ?? []).map(event => {
      const article = document.createElement('article'); article.className = 'monitor-card'
      const kind = { visit: '页面访问', dwell: '前台停留', 'dom-change': '页面变化' }[event.kind] ?? '浏览活动'
      article.append(text('strong', event.title), text('small', `${new Date(event.at).toLocaleString('zh-CN')} · ${kind} · 会话 ${event.sessionId?.slice(-8) ?? ''}`),
        text('p', event.url), text('p', event.text ?? (event.durationMs === undefined ? '仅记录页面信息' : `前台时段 ${event.durationMs / 1000} 秒`)))
      return article
    }))
  }
}
export const renderActivity = (panel, state, send, close) => {
  let model = panels.get(panel)
  if (!model) { model = mount(panel); panels.set(panel, model) }
  Object.assign(model, { state, send, close }); update(model)
}
