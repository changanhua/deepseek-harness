import { renderMarkdown } from './preview.js'
import { renderMonitors } from './sidebar-monitors.js'
import { renderActivity } from './sidebar-activity.js'
import { modelSummary } from './model-summary.js'

const DEFAULT_BASE_URL = 'http://127.0.0.1:3080'
const byId = id => document.getElementById(id)
const view = Object.fromEntries(['notice', 'connection-panel', 'connection-label', 'session-menu', 'settings', 'base-url', 'conversation', 'contexts', 'composer', 'pending-actions'].map(id => [id.replaceAll('-', '_'), byId(id)]))
let state = null
let renderGeneration = 0
let editingUrl = false
let pendingPoll = null
let nextRequest = 0
let appliedRequest = 0
let submittedText = null
const imageRequests = new Map()
let approvalRenderKey = null
let unresolvedRenderKey = null
let seenReaderRevision = 0
const showReader = enabled => {
  document.body.classList.toggle('reading-mode', enabled)
  byId('reader-panel').hidden = !enabled
  byId('open-reader').setAttribute('aria-pressed', String(enabled))
  byId('show-conversation').setAttribute('aria-pressed', String(!enabled))
  if (enabled && !byId('reader-frame').getAttribute('src')) byId('reader-frame').src = 'reader.html'
}

const label = phase => ({ unconfigured: '尚未配置', configured: '尚未连接', pending: '等待批准', connecting: '正在连接', connected: '已连接', offline: '离线', unauthorized: '需要授权', invalid: '配置无效' })[phase] ?? '未知状态'
const errorLabels = {
  offline: '连接已中断，恢复连接后可继续。', target_changed: '这条请求属于另一台 DSH，请恢复原连接后确认结果。',
  result_unknown: '提交结果尚未确认，请重试原请求，不要重新发送。', pending_locked: '上次请求尚未确认，请先恢复原连接并确认结果。',
  pending_exists: '请先处理当前待确认的输入。', empty_selection: '请先在网页中选中文字。', empty_body: '当前页面没有可采集的已展开正文。', unsupported_page: '请选择普通网页，再采集上下文。',
  page_permission_required: '请先点击工具栏中的助手图标，允许读取当前网页。', screenshot_permission_required: '请先点击工具栏中的助手图标，允许读取当前标签后再截图。',
  capture_target_changed: '采集期间页面发生变化，请重新采集。', screenshot_too_large: '截图过大，请缩小浏览器窗口后重试。', context_limit: '上下文已达到上限，请移除部分内容再继续。',
  'model-unavailable': '请先在 DSH Web 中选择可用模型。', 'session-not-found': '找不到这个会话，请重新选择。',
  storage_invalid: '本地会话记录无法读取，请保留数据并检查连接设置。', storage_failed: '本地记录保存失败，本次操作未能确认。',
  approval_unavailable: '此动作已不再等待当前侧栏确认，请查看最新状态。',
  executor_not_quiescent: '尚不能确认旧操作已停止，请先停止任务并检查目标页面。',
  acknowledgement_unconfirmed: '核对结果已保留在扩展中，等待与 DSH 同步。',
  target_unavailable: '该目标标签已不可用，请根据会话记录核对操作结果。',
}
const messageError = error => {
  const code = error?.code ?? error?.message ?? error
  return errorLabels[code] ?? (typeof error?.message === 'string' ? error.message : String(code ?? '操作未完成'))
}
const button = (text, handler, className = '') => {
  const node = document.createElement('button')
  node.type = 'button'; node.className = className; node.textContent = text
  node.addEventListener('click', () => { void handler() })
  return node
}
const notice = text => { view.notice.hidden = !text; view.notice.textContent = text ?? '' }
const send = async message => {
  const request = ++nextRequest
  try {
    const result = await chrome.runtime.sendMessage(message)
    if (!result?.ok) throw new Error(result?.error ?? '操作未完成')
    if (result.state && request >= appliedRequest) { appliedRequest = request; applyState(result.state) }
    return result
  } catch (error) { notice(messageError(error)); return null }
}
const readState = () => send({ type: 'dsh-assistant-state' })
const bindingKey = binding => binding ? `${binding.baseUrl}\u0000${binding.installationId}\u0000${binding.sessionId}` : null
const locked = pending => ['sending', 'unknown'].includes(pending?.status)
const connectAllSites = async () => {
  try {
    if (!await chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] })) { notice('未授予所有网站访问权限'); return }
    await send({ type: 'dsh-assistant-connect', scopes: ['session:interact', 'browser:read', 'browser:write', 'browser:observe'], origins: ['*'] })
  } catch (error) { notice(messageError(error)) }
}

const renderConnection = () => {
  const connection = state?.connection ?? { phase: 'unconfigured' }
  view.connection_label.textContent = label(connection.phase)
  view.connection_panel.replaceChildren()
  view.connection_panel.hidden = connection.phase === 'connected'
  if (connection.phase === 'pending') {
    view.connection_panel.append('等待 DSH 批准此扩展。', button('打开批准页', () => send({ type: 'dsh-assistant-open-approval' }), 'primary'), button('已批准，继续', () => send({ type: 'dsh-assistant-poll' })), button('取消连接', () => send({ type: 'dsh-assistant-cancel' }), ''))
  } else if (connection.phase !== 'connected') {
    view.connection_panel.append(`${label(connection.phase)}${connection.baseUrl ? `：${connection.baseUrl}` : ''}`, button('连接本机 DSH', connectAllSites, 'primary'))
  }
  if (connection.phase === 'pending') {
    clearTimeout(pendingPoll)
    pendingPoll = setTimeout(() => { if (state?.connection?.phase === 'pending') void send({ type: 'dsh-assistant-poll' }) }, 2000)
  } else clearTimeout(pendingPoll)
}

const renderSettings = () => {
  byId('browser-engine').value = state?.browserEngine ?? 'puppeteer'
  if (!editingUrl) view.base_url.value = state?.connection?.baseUrl ?? DEFAULT_BASE_URL
  byId('model-summary').textContent = modelSummary(state?.session)
  byId('configure-model').disabled = state?.connection?.phase !== 'connected'
}

const renderSiteAccess = () => {
  const panel = byId('site-access')
  panel.replaceChildren(); panel.hidden = true
  if (state?.connection?.phase !== 'connected') return
  const grant = state.connection.grant
  const covered = grant?.origins?.includes('*') && ['browser:read', 'browser:write', 'browser:observe'].every(scope => grant.scopes.includes(scope))
  const summary = document.createElement('span')
  summary.textContent = covered ? '所有网站已永久授权，直到撤销' : '尚未授权所有网站'
  panel.append(summary); panel.hidden = false
  if (!covered) {
    const authorize = button('永久授权所有网站', connectAllSites, 'primary'); authorize.id = 'authorize-all-sites'; panel.append(authorize)
  }
}

const renderPending = () => {
  const pending = state?.session?.pending
  view.pending_actions.replaceChildren()
  if (state?.session?.pendingCreate) {
    view.pending_actions.append('正在确认会话创建结果。', button('继续确认创建', () => send({ type: 'dsh-assistant-session-create' })))
    return
  }
  if (pending?.status === 'accepted') { view.pending_actions.textContent = '已送达 DSH'; return }
  if (!pending) return
  if (locked(pending)) {
    const retry = button('重试原请求', () => send({ type: 'dsh-assistant-session-retry' }), 'primary')
    retry.id = 'retry-prompt'
    view.pending_actions.append('正在等待确认，请勿重复发送。', retry)
    return
  }
  view.pending_actions.append(`上次请求${pending.status === 'failed' ? '失败' : '尚未发送'}。`, button('重试', () => send({ type: 'dsh-assistant-session-retry' }), 'primary'), button('丢弃草稿', () => send({ type: 'dsh-assistant-session-discard' })))
}

const textFrom = content => (Array.isArray(content) ? content : []).filter(part => part?.type === 'text').map(part => part.text).join('\n')
const projection = records => {
  const chunks = new Map()
  const output = []
  for (const record of records ?? []) {
    const event = record?.event
    if (!event) continue
    if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'text-delta') {
      const key = `${event.data.turn}:${event.data.step}`
      const prior = chunks.get(key) ?? { role: 'assistant', key, text: '', images: [] }
      prior.text += event.data.chunk.text ?? ''; chunks.set(key, prior)
      const index = output.findIndex(item => item.key === key)
      if (index < 0) output.push(prior); else output[index] = prior
      continue
    }
    let role, content, key
    if (event.type === 'user/message' && event.data?.source?.kind === 'user') { role = 'user'; content = event.data?.content; key = `user:${event.seq}` }
    if (event.type === 'assistant/message') { role = 'assistant'; content = event.data?.message?.content; key = `${event.data?.turn}:${event.data?.step}` }
    if (!role) continue
    const item = { role, key, text: textFrom(content), images: (Array.isArray(content) ? content : []).filter(part => part?.type === 'image').map(part => part.attachment) }
    const prior = output.findIndex(entry => entry.key === key)
    if (prior >= 0) output[prior] = item; else output.push(item)
  }
  return output
}

const showImage = async (image, attachment, generation, binding) => {
  if (!attachment?.attachmentId) return
  const key = binding + ':' + attachment.attachmentId
  if (!imageRequests.has(key)) {
    if (imageRequests.size >= 8) imageRequests.delete(imageRequests.keys().next().value)
    imageRequests.set(key, chrome.runtime.sendMessage({ type: 'dsh-assistant-session-attachment', attachmentId: attachment.attachmentId }).catch(() => null))
  }
  const result = await imageRequests.get(key)
  if (!result?.ok || renderGeneration !== generation || bindingKey(state?.session?.binding) !== binding) return
  const mediaType = result.value?.attachment?.mediaType ?? attachment.mediaType
  if (typeof result.value?.data !== 'string' || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) return
  image.src = `data:${mediaType};base64,${result.value.data}`
}

const renderConversation = () => {
  const generation = ++renderGeneration
  const binding = bindingKey(state?.session?.binding)
  const entries = projection(state?.session?.records)
  const pending = state?.session?.pending
  const echoed = pending && (state.session.records ?? []).some(record => record.event?.type === 'user/message' && record.event.data?.source?.rpcId === pending.requestId)
  if (pending && !echoed) entries.push({ role: 'user', key: 'pending:' + pending.requestId, text: textFrom(pending.content), images: [] })
  const previousScroll = view.conversation.scrollTop
  const followTail = view.conversation.scrollHeight - view.conversation.clientHeight - previousScroll < 40
  view.conversation.replaceChildren()
  if (!entries.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = state?.session?.binding ? '从这里继续当前会话。' : '连接后选择或新建一个会话。'; view.conversation.append(empty)
  }
  for (const entry of entries) {
    const node = document.createElement('article'); node.className = `message ${entry.role}`
    const meta = document.createElement('div'); meta.className = 'message-meta'; meta.textContent = entry.role === 'user' ? '你' : 'DSH'; node.append(meta)
    const reading = document.createElement('div'); reading.className = 'reading'; renderMarkdown(reading, entry.text); node.append(reading)
    for (const attachment of entry.images) { const image = document.createElement('img'); image.alt = '会话图片'; node.append(image); void showImage(image, attachment, generation, binding) }
    view.conversation.append(node)
  }
  view.conversation.scrollTop = followTail ? view.conversation.scrollHeight : previousScroll
}

const renderContexts = () => {
  view.contexts.replaceChildren()
  for (const context of state?.contexts ?? []) {
    const row = document.createElement('article'); row.className = 'context'; row.dataset.contextId = context.id
    const main = document.createElement('div'); main.className = 'context-main'
    const title = document.createElement('strong'); title.textContent = context.page?.title || (context.kind === 'screenshot' ? '页面截图' : context.kind === 'page-body' ? '网页正文' : '网页选区')
    const url = document.createElement('span'); url.textContent = context.page?.url ?? ''
    main.append(title, url)
    if (context.text) { const text = document.createElement('p'); text.textContent = context.text.slice(0, 240); main.append(text) }
    if (context.textTruncated || context.incomplete) {
      const note = document.createElement('small')
      note.textContent = [context.textTruncated ? '正文达到采集上限，已截断' : '', context.incomplete ? '未采集折叠或仍在更新的内容' : ''].filter(Boolean).join('；')
      main.append(note)
    }
    if (context.kind === 'screenshot' && typeof context.data === 'string' && String(context.mediaType).startsWith('image/')) {
      const preview = document.createElement('img'); preview.className = 'context-preview'; preview.alt = '截图预览'; preview.src = `data:${context.mediaType};base64,${context.data}`; main.append(preview)
    }
    row.append(main, button('移除', () => send({ type: 'dsh-assistant-context-remove', id: context.id }), 'remove-context'))
    view.contexts.append(row)
  }
}

const renderApprovals = () => {
  const panel = byId('action-approvals')
  const items = state?.connection?.phase === 'connected' && state?.approvals?.sessionId === state?.session?.binding?.sessionId ? state.approvals?.requests ?? [] : []
  const key = JSON.stringify([state?.session?.binding?.sessionId, items])
  if (key === approvalRenderKey) return
  approvalRenderKey = key
  panel.replaceChildren(); panel.hidden = true
  for (const item of items) {
    const card = document.createElement('article')
    const title = document.createElement('strong'); title.textContent = '确认浏览器操作'
    const reason = document.createElement('pre'); reason.textContent = item.reason ?? '请确认是否允许本次浏览器操作。'
    const decision = async value => {
      for (const action of card.querySelectorAll('button')) action.disabled = true
      const result = await send({ type: 'dsh-assistant-approval-decide', id: item.id, decision: value })
      if (!result?.ok && card.isConnected) for (const action of card.querySelectorAll('button')) action.disabled = false
    }
    const controls = document.createElement('div'); controls.className = 'approval-controls'
    controls.append(button('允许这一次', () => decision('allowed-once'), 'primary'), button('拒绝', () => decision('rejected')))
    card.append(title, reason, controls)
    panel.append(card); panel.hidden = false
  }
}
const renderUnresolved = () => {
  const key = JSON.stringify(state?.unresolved ?? [])
  if (key === unresolvedRenderKey) return
  unresolvedRenderKey = key
  const panel = byId('unresolved-actions'); panel.replaceChildren(); panel.hidden = true
  for (const item of state?.unresolved ?? []) {
    const row = document.createElement('article')
    const text = document.createElement('p')
    text.textContent = `标签 ${item.target?.tabId} · 会话 ${item.identity.sessionId.slice(-12)}：${item.acknowledgementPending ? '已人工核对，等待同步到 DSH。' : '旧操作结果未知，同一标签的后续操作已暂停。请先查看目标页面，确认是否已生效。'}`
    const acknowledge = button(item.acknowledgementPending ? '同步核对结果' : '我已核对页面，接受未知结果', async () => {
      acknowledge.disabled = true
      const result = await send({ type: 'dsh-assistant-acknowledge', identity: item.identity })
      if (!result?.ok && acknowledge.isConnected) acknowledge.disabled = false
    })
    row.append(text, button('查看目标标签', () => send({ type: 'dsh-assistant-reveal-target', requestId: item.identity.requestId })), acknowledge)
    panel.append(row); panel.hidden = false
  }
}

const render = () => {
  const session = state?.session
  renderConnection(); renderSettings(); renderSiteAccess(); renderPending(); renderConversation(); renderContexts(); renderApprovals(); renderUnresolved()
  const offline = state?.connection?.phase !== 'connected' || session?.phase === 'foreign'
  const block = locked(session?.pending) || Boolean(session?.pendingCreate)
  view.composer.disabled = block
  byId('send-queue').disabled = block || offline || !session?.binding
  byId('send-steer').disabled = block || offline || !session?.binding
  byId('stop-session').disabled = offline || !session?.binding
  byId('session-picker').disabled = block || offline
  byId('session-picker').title = session?.binding?.sessionId ?? '选择会话'
  byId('session-picker').textContent = session?.binding ? '会话 · ' + session.binding.sessionId.slice(-8) : '会话'
  if (session?.error) notice(messageError(session.error))
  if (!byId('monitors').hidden) openMonitors()
  if (!byId('activity').hidden) openActivity()
}
const applyState = next => {
  if (Number.isSafeInteger(next.readerRevision) && next.readerRevision > seenReaderRevision) {
    seenReaderRevision = next.readerRevision
    showReader(true)
  }
  if (submittedText !== null && state?.session?.pending && (!next.session?.pending || next.session.pending.status === 'accepted')) {
    if (view.composer.value.trim() === submittedText) view.composer.value = ''
    submittedText = null
  }
  state = next; render()
}
const openMonitors = () => {
  byId('activity').hidden = true
  const panel = byId('monitors')
  panel.hidden = false
  byId('conversation').hidden = true; byId('contexts').hidden = true; document.querySelector('.composer-wrap').hidden = true
  renderMonitors(panel, state, send, () => { panel.hidden = true; byId('conversation').hidden = false; byId('contexts').hidden = false; document.querySelector('.composer-wrap').hidden = false })
}
const openActivity = () => {
  const panel = byId('activity'); panel.hidden = false; byId('monitors').hidden = true
  byId('conversation').hidden = true; byId('contexts').hidden = true; document.querySelector('.composer-wrap').hidden = true
  renderActivity(panel, state, send, () => {
    panel.hidden = true; byId('conversation').hidden = false; byId('contexts').hidden = false; document.querySelector('.composer-wrap').hidden = false
  })
}

const openSessionMenu = async () => {
  view.session_menu.replaceChildren(); view.session_menu.hidden = false
  const create = button('新建会话', async () => {
    const result = await send({ type: 'dsh-assistant-session-create' })
    if (result?.ok) view.session_menu.hidden = true
  }, 'primary')
  create.id = 'new-session'
  view.session_menu.append(create)
  const result = await send({ type: 'dsh-assistant-session-list' })
  for (const item of result?.value?.items ?? []) view.session_menu.insertBefore(button((typeof item.projections?.values?.title === 'string' ? item.projections.values.title : item.cwd?.split(/[\\/]/u).at(-1) ?? '会话') + ' · ' + item.sessionId.slice(-8), async () => {
    await send({ type: 'dsh-assistant-session-bind', sessionId: item.sessionId }); view.session_menu.hidden = true
  }), create)
}
const configure = async () => {
  const baseUrl = view.base_url.value.trim() || DEFAULT_BASE_URL
  try { if (!['http:', 'https:'].includes(new URL(baseUrl).protocol)) throw new Error('invalid_url') } catch { notice('请输入有效的 HTTP(S) 地址'); return }
  if (!await chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] })) { notice('未授予所有网站访问权限'); return }
  editingUrl = false
  if (!await send({ type: 'dsh-assistant-configure', baseUrl })) return
  await send({ type: 'dsh-assistant-connect', scopes: ['session:interact', 'browser:read', 'browser:write', 'browser:observe'], origins: ['*'] })
}
const submit = mode => {
  const text = view.composer.value.trim()
  if (!text && !state?.contexts?.length || locked(state?.session?.pending)) return
  submittedText = text
  void send({ type: 'dsh-assistant-session-submit', text, mode }).then(result => {
    if (result?.ok && view.composer.value.trim() === text) { view.composer.value = ''; submittedText = null }
  })
}

byId('session-picker').addEventListener('click', () => { void openSessionMenu() })
byId('open-reader').addEventListener('click', () => showReader(true))
byId('show-conversation').addEventListener('click', () => {
  showReader(false)
  for (const id of ['monitors', 'activity', 'settings', 'session-menu']) byId(id).hidden = true
  byId('conversation').hidden = false; byId('contexts').hidden = false
  document.querySelector('.composer-wrap').hidden = false
})
byId('show-monitors').addEventListener('click', openMonitors)
byId('show-activity').addEventListener('click', openActivity)
byId('new-session')?.addEventListener('click', () => { void send({ type: 'dsh-assistant-session-create' }) })
byId('show-settings').addEventListener('click', () => { byId('settings').hidden = false })
byId('browser-engine').addEventListener('change', () => { void send({ type: 'dsh-assistant-browser-engine', engine: byId('browser-engine').value }) })
byId('hide-settings').addEventListener('click', () => { byId('settings').hidden = true })
byId('configure-model').addEventListener('click', () => { void send({ type: 'dsh-assistant-open-model-settings' }) })
byId('save-settings').addEventListener('click', () => { void configure() })
byId('disconnect').addEventListener('click', () => { void send({ type: 'dsh-assistant-disconnect' }) })
byId('open-assistant-window').addEventListener('click', () => { void send({ type: 'dsh-assistant-open-window' }) })
byId('base-url').addEventListener('input', () => { editingUrl = true })
byId('capture-selection').addEventListener('click', () => { void send({ type: 'dsh-assistant-context-capture', kind: 'selection' }) })
byId('capture-body').addEventListener('click', () => { void send({ type: 'dsh-assistant-context-capture', kind: 'page-body' }) })
byId('capture-screenshot').addEventListener('click', () => { void send({ type: 'dsh-assistant-context-capture', kind: 'screenshot' }) })
byId('stop-session').addEventListener('click', () => { void send({ type: 'dsh-assistant-session-stop' }) })
byId('send-queue').addEventListener('click', () => submit('queue'))
byId('send-steer').addEventListener('click', () => submit('steer'))
byId('open-session').addEventListener('click', () => { void send({ type: 'dsh-assistant-open-session' }) })
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'dsh-reader-follow-latest') { showReader(true); void readState() }
  if (message?.type === 'dsh-state-changed') void readState()
  if (message?.type === 'dsh-assistant-error') notice(message.error)
})
let presencePort
let presenceRetry
let closingView = false
const publishPresence = () => { try { presencePort?.postMessage({ type: 'presence', visible: document.visibilityState === 'visible' }) } catch {} }
const connectView = () => {
  if (closingView || typeof chrome.runtime.connect !== 'function') return
  try {
    const port = chrome.runtime.connect({ name: 'dsh-assistant-view' }); presencePort = port
    port.onDisconnect.addListener(() => {
      if (presencePort !== port) return
      presencePort = undefined
      if (!closingView) presenceRetry = setTimeout(connectView, 1000)
    })
    publishPresence()
  } catch { if (!closingView) presenceRetry = setTimeout(connectView, 1000) }
}
document.addEventListener('visibilitychange', publishPresence)
window.addEventListener('pagehide', () => { closingView = true; clearTimeout(presenceRetry); presencePort?.disconnect(); presencePort = undefined })
connectView()
void readState()
