const panels = new WeakMap()
const text = (tag, value = '') => { const node = document.createElement(tag); node.textContent = value; return node }
const button = (value, action) => {
  const node = text('button', value); node.type = 'button'
  node.addEventListener('click', async () => {
    if (node.disabled) return
    node.disabled = true
    try { await action() } finally { if (node.isConnected) node.disabled = false }
  })
  return node
}
const date = value => Number.isFinite(value) ? new Date(value).toLocaleString('zh-CN') : '尚未检查'
const field = (label, node, id) => {
  node.id = id
  const wrapper = document.createElement('label'); wrapper.htmlFor = id
  wrapper.append(text('span', label), node)
  return wrapper
}
const select = choices => {
  const node = document.createElement('select')
  for (const [value, label] of choices) node.append(new Option(label, value))
  return node
}
const errorLabel = value => ({
  monitor_storage_failed: '创建记录保存失败，请保留当前数据并重新打开助手。',
  monitor_storage_invalid: '原创建请求无法读取，请检查扩展存储。',
  monitor_sync_failed: '尚未同步监控结果，请检查 DSH 连接后刷新。',
  monitor_create_unconfirmed: '创建结果尚未确认，请重试原请求。',
  result_unknown: '创建结果尚未确认，请重试原请求。',
  observation_not_authorized: '请先允许监控此站点，并在 DSH 中批准。',
  target_changed: '原请求属于另一连接或页面，请恢复原目标后重试。',
})[value] ?? '监控状态尚未确认，请刷新或重试原请求。'

function mount(panel) {
  const model = { panel, state: null, send: null, close: null, busy: false, titleEdited: false, listKey: null, pendingKey: null }
  const heading = document.createElement('div'); heading.className = 'monitor-heading'
  heading.append(button('← 返回会话', () => model.close()), text('h2', '监控'),
    button('刷新', () => model.send({ type: 'dsh-assistant-monitor-refresh' })))
  model.target = text('p'); model.target.className = 'monitor-target'
  model.error = text('p'); model.error.className = 'monitor-error'; model.error.setAttribute('role', 'status')
  model.pending = document.createElement('div'); model.pending.className = 'monitor-pending'
  const form = document.createElement('form'); form.className = 'monitor-form'
  const title = document.createElement('input'); title.maxLength = 200; title.required = true
  title.addEventListener('input', () => { model.titleEdited = true })
  const once = document.createElement('input'); once.type = 'checkbox'
  const minutes = document.createElement('input'); minutes.type = 'number'; minutes.min = String(1 / 60)
  minutes.max = '1440'; minutes.step = 'any'; minutes.value = '1'; minutes.required = true
  const policy = select([['latest', '恢复后补查最近一次'], ['skip', '跳过已错过的周期']])
  const match = select([['changed', '正文发生变化'], ['appears', '出现指定文字'], ['disappears', '指定文字消失']])
  const query = document.createElement('input'); query.maxLength = 1024
  const queryField = field('匹配文字', query, 'monitor-query')
  const minutesField = field('检查周期（分钟）', minutes, 'monitor-minutes')
  const policyField = field('错过检查时', policy, 'monitor-policy')
  const onceField = field('仅检查一次', once, 'monitor-once'); onceField.className = 'monitor-toggle'
  const updateOptions = () => {
    minutes.disabled = once.checked; minutesField.hidden = once.checked; policyField.hidden = once.checked
    queryField.hidden = match.value === 'changed'; query.required = !queryField.hidden
  }
  once.addEventListener('change', updateOptions); match.addEventListener('change', updateOptions); updateOptions()
  model.hint = text('small')
  model.create = text('button', '创建监控'); model.create.type = 'submit'; model.create.className = 'primary'
  form.append(field('监控名称', title, 'monitor-title'), onceField, minutesField, policyField,
    field('提醒条件', match, 'monitor-match'), queryField, model.hint, model.create)
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (model.busy || model.create.disabled || !form.reportValidity()) return
    const intervalMs = once.checked ? null : Number(minutes.value) * 60000
    if (intervalMs !== null && (!Number.isSafeInteger(intervalMs) || intervalMs < 1000 || intervalMs > 86400000)) {
      model.error.textContent = '检查周期须在 1 秒到 24 小时之间。'; return
    }
    const state = model.state
    const condition = match.value === 'changed' ? { kind: 'changed' } : { kind: match.value, text: query.value }
    model.busy = true; model.create.disabled = true
    try {
      await model.send({ type: 'dsh-assistant-monitor-create', page: structuredClone(state.page),
        input: { title: title.value, intervalMs, missedPolicy: policy.value, match: condition } })
    } finally { model.busy = false; updateForm(model) }
  })
  model.title = title; model.form = form
  model.list = document.createElement('div'); model.list.className = 'monitor-list'
  panel.replaceChildren(heading, model.target, model.error, model.pending, form, model.list)
  return model
}

function updateForm(model) {
  const state = model.state
  const monitoring = state?.monitoring
  let canObserve = false
  try {
    const origin = new URL(state.page.url).origin, grant = state.connection.grant
    canObserve = state.connection.phase === 'connected' && ['session:interact', 'browser:read', 'browser:observe'].every(scope => grant.scopes.includes(scope))
      && grant.origins.some(site => site === '*' || site === origin)
  } catch { /* No ordinary authorized page is selected. */ }
  const binding = state?.session?.binding
  const canCreate = canObserve && binding && binding.baseUrl === state.connection.baseUrl
    && binding.installationId === state.connection.grant.installationId && !monitoring?.pendingCreate
  model.create.disabled = model.busy || !canCreate
  model.hint.textContent = monitoring?.pendingCreate ? '请先确认原创建请求，再创建新计划。'
    : !binding ? '请先选择所属会话。' : !canObserve ? '请先允许监控当前站点。' : '关闭侧栏后，DSH 仍会按计划检查。'
}

function makeCard(model, monitor, signature) {
  const node = document.createElement('article'); node.className = 'monitor-card'; node.dataset.monitorId = monitor.id
  const title = text('strong'), url = text('p'), session = text('small'), status = text('p'), capacity = text('p'), sample = text('p'), failure = text('p')
  const notices = document.createElement('div')
  const resume = !monitor.enabled || monitor.authorizationChanged
  node.append(title, url, session, status, capacity, sample, failure,
    button(resume ? '恢复' : '暂停', () => model.send({ type: resume ? 'dsh-assistant-monitor-resume' : 'dsh-assistant-monitor-pause',
      id: monitor.id, revision: monitor.revision })),
    button('打开所属会话', () => model.send({ type: 'dsh-assistant-open-monitor-session', id: monitor.id })), notices)
  return { node, title, url, session, status, capacity, sample, failure, notices, noticeNodes: new Map(), signature }
}
function updateNotices(model, card, monitor) {
  const wanted = new Set((monitor.outbox ?? []).map(notice => notice.id))
  for (const [id, item] of card.noticeNodes) if (!wanted.has(id)) { item.remove(); card.noticeNodes.delete(id) }
  for (const [index, notice] of (monitor.outbox ?? []).entries()) {
    let item = card.noticeNodes.get(notice.id)
    if (!item) {
      item = document.createElement('div'); item.className = 'monitor-notice'; item.dataset.noticeId = notice.id
      item.append(text('strong', ({ changed: '有变化', completed: '已完成', failed: '检查未完成', recovered: '已恢复' })[notice.kind] ?? '监控通知'),
        text('p', notice.message), text('small', date(notice.createdAt)),
        button('已读', () => model.send({ type: 'dsh-assistant-monitor-acknowledge', id: monitor.id, noticeId: notice.id })))
      card.noticeNodes.set(notice.id, item)
    }
    if (card.notices.children[index] !== item) card.notices.insertBefore(item, card.notices.children[index] ?? null)
  }
}
function updateList(model, monitors) {
  const key = JSON.stringify(monitors)
  if (key === model.listKey) return
  model.listKey = key; model.cards ??= new Map()
  const wanted = new Set(monitors.map(monitor => monitor.id))
  for (const [id, card] of model.cards) if (!wanted.has(id)) { card.node.remove(); model.cards.delete(id) }
  model.empty ??= text('p', '还没有可显示的监控计划。')
  if (monitors.length) model.empty.remove()
  for (const [index, monitor] of monitors.entries()) {
    const signature = JSON.stringify([monitor.id, monitor.revision, monitor.enabled, monitor.authorizationChanged])
    let card = model.cards.get(monitor.id)
    if (!card || card.signature !== signature) {
      const replacement = makeCard(model, monitor, signature)
      card?.node.replaceWith(replacement.node)
      card = replacement; model.cards.set(monitor.id, card)
    }
    card.title.textContent = monitor.title; card.url.textContent = monitor.url; card.session.textContent = `所属会话：${monitor.sessionId}`
    card.status.textContent = monitor.authorizationChanged ? '授权已变化，请明确恢复监控。'
      : monitor.enabled ? monitor.checking ? '正在检查' : `下次检查：${date(monitor.nextDue)}`
        : monitor.intervalMs === null && monitor.lastSample ? '本次检查已完成' : '已暂停'
    card.capacity.hidden = !monitor.notificationCapacity
    card.capacity.textContent = '待确认通知已占满可用空间，确认后继续检查。'
    card.sample.hidden = !monitor.lastSample
    if (monitor.lastSample) card.sample.textContent = `最近有效检查：${date(monitor.lastSample.sampledAt)}${monitor.match?.kind === 'changed' ? ''
      : monitor.lastSample.matched ? ' · 当前包含匹配文字' : ' · 当前不包含匹配文字'}`
    card.failure.hidden = !monitor.lastFailure
    card.failure.textContent = monitor.lastFailure?.message ?? ''
    updateNotices(model, card, monitor)
    if (model.list.children[index] !== card.node) model.list.insertBefore(card.node, model.list.children[index] ?? null)
  }
  if (!monitors.length && !model.empty.isConnected) model.list.append(model.empty)
}
/** Keep the form stable while Host plan and notification projections refresh independently. */
export function renderMonitors(panel, state, send, close) {
  const model = panels.get(panel) ?? mount(panel)
  panels.set(panel, model); model.state = state; model.send = send; model.close = close
  const monitoring = state?.monitoring ?? { phase: 'unavailable', monitors: [], pendingCreate: null, error: null }
  model.target.textContent = `当前页面：${state?.page?.url ?? '未读取'}\n当前会话：${state?.session?.binding?.sessionId ?? '未选择'}`
  if (!model.titleEdited) model.title.value = (state?.page?.title || '当前页面').slice(0, 200)
  model.error.textContent = monitoring.error ? errorLabel(monitoring.error) : monitoring.phase === 'syncing' ? '正在同步监控状态…' : ''
  const pendingKey = JSON.stringify(monitoring.pendingCreate)
  if (pendingKey !== model.pendingKey) {
    model.pendingKey = pendingKey; model.pending.replaceChildren()
    const pending = monitoring.pendingCreate
    if (pending) model.pending.append(text('p', `正在确认原请求：${pending.input.url}\n所属会话：${pending.input.sessionId}`),
      button('重试原请求', () => model.send({ type: 'dsh-assistant-monitor-retry' })))
  }
  updateForm(model); updateList(model, monitoring.monitors)
}
