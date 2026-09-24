import { modelSummary } from './model-summary.js'
import { renderMarkdown } from './preview.js'
import { renderContentMap } from './assistant-content-view.js'
import { renderSemanticNavigation } from './assistant-semantic-view.js'
import { createCognitionScope, compileCognitionContext, attachCognitionContext } from './assistant-cognition-workspace.js'
import { renderCognitionWorkspace, renderCognitionTaskScope } from './assistant-cognition-workspace-view.js'

const DEFAULT_BASE_URL = 'http://127.0.0.1:3080'
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const SURFACE_KEY = 'dsh.assistant.surface.v2'
const storedSurfaceId = sessionStorage.getItem(SURFACE_KEY)
const surfaceId = /^surface-[0-9a-f-]{36}$/u.test(storedSurfaceId ?? '') ? storedSurfaceId : `surface-${crypto.randomUUID()}`
sessionStorage.setItem(SURFACE_KEY, surfaceId)

const byId = id => document.getElementById(id)
const button = (text, handler, className = '') => {
  const node = document.createElement('button')
  node.type = 'button'; node.className = className; node.textContent = text
  node.addEventListener('click', () => { void handler() })
  return node
}
const bounded = (value, limit = 1024) => typeof value === 'string' ? value.slice(0, limit) : ''
const locked = pending => ['sending', 'unknown'].includes(pending?.status)

let state = null
let activeView = 'chat'
let functionScope = 'global'
let draftImages = []
const drafts = new Map()
// Draft-only selection; Host Session remains submission and history authority.
const cognitionScopes = new Map()
const cognitionNavigation = new Map()
let activeDraftKey = null
let recentSessions = []
let recentKey = null
let recentFlight = null
let selectedCognitionId = null
let selectedNodeIndex = null
let selectedAtlasPageId = null
let selectedAtlasRegionId = null
let cognitionDetailView = 'map'
let submitting = false
let editingUrl = false
let modelCatalog = null
let modelRequest = 0
let modelPicker = { open: false, phase: 'idle', sessionId: null, selection: null, applying: false }
let targetDialogTrigger = null
let approvalPollTimer
let approvalPolling = false
let closingView = false

const label = phase => ({ unconfigured: '尚未配置', configured: '尚未连接', pending: '等待批准', connecting: '正在连接', connected: '已连接', offline: '离线', unauthorized: '需要授权', invalid: '配置无效' })[phase] ?? '未知状态'
const messageError = error => ({ semantic_feedback_conflict: '这个节点已有新修正。草稿已保留，请核对最新版本后再保存。', semantic_feedback_capacity_exceeded: '本地修正记录已达到容量上限，草稿尚未保存。', semantic_feedback_storage_failed: '个人修正保存失败，草稿已保留，请重试。', semantic_feedback_unavailable: '找不到这份地图或节点，未保存修正。', network_error: '网络请求失败，请检查 DSH 服务后重试。', offline: '连接已中断，恢复连接后可继续。', result_unknown: '提交结果尚未确认，请重试原请求，不要重新发送。', pending_locked: '上次请求尚未确认，请先确认原请求。', session_changed: '会话已变化，请确认后重试。', target_changed: '操作目标已变化，请重新选择。', function_view_unavailable: '这个功能当前没有可打开的界面。', cognition_location_unavailable: '这个页面节点已经失效，请重新读取页面。', source_changed: '原文已变化，定位已取消。旧快照仍可查看，重新读取后可再定位。', source_unavailable: '这份快照的网页定位信息已失效。请重新读取页面，旧原文快照仍可查看。' })[error?.code ?? error?.message ?? error] ?? (error?.message || String(error ?? '操作未完成'))
const notice = text => { const node = byId('notice'); node.hidden = !text; node.textContent = text ?? '' }
const fallback = () => ({ connection: state?.connection ?? { phase: 'unconfigured' }, surface: { id: null },
  session: { binding: state?.session?.binding ?? null, phase: state?.session?.phase ?? 'idle', error: null, pending: state?.session?.pending ?? null, pendingCreate: state?.session?.pendingCreate ?? null, modelSelection: state?.session?.modelSelection ?? null, transcript: [] },
  target: { availability: 'unavailable', revision: null, selected: null, candidates: [], readError: null },
  cognition: { status: 'unread', pages: [], refreshPolicy: 'manual-or-agent-request', refresh: { status: 'idle' } },
  functions: { availability: 'unavailable', items: [] } })
const viewState = () => state?.assistantV2 ?? fallback()
const draftKey = current => {
  const binding = current?.session?.binding; const connection = current?.connection ?? {}
  return [binding?.baseUrl ?? connection.baseUrl ?? '', binding?.installationId ?? connection.grant?.installationId ?? '', binding?.sessionId ?? '__new__'].join('\u0000')
}
const applyState = next => {
  if (activeDraftKey !== null) drafts.set(activeDraftKey, { text: byId('composer').value, images: structuredClone(draftImages) })
  state = next
  const nextSessionId = (next?.assistantV2 ?? next)?.session?.binding?.sessionId ?? null
  if (modelPicker.open && !modelPicker.applying && nextSessionId !== modelPicker.sessionId) {
    modelRequest += 1; modelPicker = { open: false, phase: 'idle', sessionId: null, selection: null, applying: false }
  } else if (modelPicker.open && modelPicker.applying && modelPicker.sessionId !== null && nextSessionId !== modelPicker.sessionId) {
    modelRequest += 1; modelPicker = { open: false, phase: 'idle', sessionId: null, selection: null, applying: false }
  }
  const nextKey = draftKey(viewState())
  if (nextKey !== activeDraftKey) { const draft = drafts.get(nextKey); byId('composer').value = draft?.text ?? ''; draftImages = structuredClone(draft?.images ?? []); activeDraftKey = nextKey; renderDraftImages() }
  render(); void refreshRecent()
}
const send = async message => {
  try {
    const result = await chrome.runtime.sendMessage({ ...message, surfaceId })
    if (!result?.ok) throw new Error(result?.error ?? '操作未完成')
    if (result.state) applyState(result.state)
    notice(null)
    return result
  } catch (error) { notice(messageError(error)); return null }
}
const readState = () => send({ type: 'dsh-assistant-state' })
const selectedName = target => target?.title ?? target?.pageTitle ?? target?.url ?? (Number.isInteger(target?.tabId) ? `标签 ${target.tabId}` : '未固定目标标签')
const sessionName = item => bounded(item?.projections?.values?.title, 160) || bounded(item?.cwd?.split(/[\\/]/u).at(-1), 120) || '未命名对话'
const catalogRoute = selection => {
  if (!selection || !modelCatalog) return null
  const group = modelCatalog.groups?.find(candidate => candidate.id === selection.provider)
  const model = group?.models?.find(candidate => candidate.id === selection.model)
  const effort = model?.reasoning?.efforts?.find(candidate => candidate.id === selection.reasoningEffort)
  return model ? { group, model, effort } : null
}
const selectionLabel = selection => {
  if (!selection) return 'DSH 默认'
  const route = catalogRoute(selection)
  const model = route?.model?.name ?? selection.model
  const effort = route?.effort?.name ?? selection.reasoningEffort
  return effort ? `${model} · ${effort}` : model
}

const renderConnection = () => {
  const connection = viewState().connection ?? { phase: 'unconfigured' }
  if (connection.phase !== 'pending') { clearTimeout(approvalPollTimer); approvalPollTimer = undefined }
  else if (!closingView && !approvalPollTimer && !approvalPolling) {
    approvalPollTimer = setTimeout(async () => {
      approvalPollTimer = undefined
      if (closingView || viewState().connection?.phase !== 'pending') return
      approvalPolling = true
      try { await send({ type: 'dsh-assistant-poll' }) }
      finally {
        approvalPolling = false
        if (!closingView && viewState().connection?.phase === 'pending') renderConnection()
      }
    }, 2000)
  }
  byId('connection-label').textContent = label(connection.phase)
  byId('connection-dot').className = `connection-dot ${connection.phase}`
  const panel = byId('connection-panel'); panel.replaceChildren(); panel.hidden = connection.phase === 'connected'
  if (connection.phase === 'pending') panel.append('等待 DSH 批准此扩展。', button('打开批准页', () => send({ type: 'dsh-assistant-open-approval' }), 'primary'), button('取消连接', () => send({ type: 'dsh-assistant-cancel' })))
  else if (connection.phase !== 'connected') panel.append(`${label(connection.phase)}${connection.baseUrl ? ` · ${connection.baseUrl}` : ''}`, button('连接本机 DSH', connect, 'primary'))
}

const renderSettings = () => {
  const current = viewState(); const connection = current.connection ?? {}
  if (!editingUrl) byId('base-url').value = connection.baseUrl ?? DEFAULT_BASE_URL
  byId('browser-engine').value = state?.browserEngine ?? 'puppeteer'
  const summary = modelSummary(current.session)
  byId('model-selection').textContent = summary
  const selection = current.session?.modelSelection?.next ?? current.session?.modelSelection?.lastUsed
  byId('composer-model').textContent = selectionLabel(selection)
  byId('composer-model').title = summary
  byId('model-status').textContent = selection ? '下一条消息生效' : ''
  byId('model-status').hidden = !selection
  byId('configure-model').disabled = connection.phase !== 'connected'
  const access = byId('site-access'); access.replaceChildren()
  const grant = connection.grant
  const covered = grant?.origins?.includes('*') && ['browser:read', 'browser:write', 'browser:observe'].every(scope => grant.scopes?.includes(scope))
  access.append(covered ? '所有网站已授权，直到你撤销。' : '尚未授权所有网站。')
  if (!covered && connection.phase === 'connected') access.append(button('授权所有网站', connect, 'primary'))
}

const chooseModel = (group, model) => {
  const defaultEffort = model.reasoning?.defaultEffort
  modelPicker.selection = { provider: group.id, model: model.id,
    ...(defaultEffort === undefined ? {} : { reasoningEffort: defaultEffort }) }
  renderModelPicker()
}
const renderModelPicker = () => {
  const popover = byId('model-popover'); popover.hidden = !modelPicker.open
  if (!modelPicker.open) return
  const status = byId('model-picker-status'); const options = byId('model-options'); const confirm = byId('confirm-model')
  options.replaceChildren(); confirm.hidden = true; confirm.disabled = modelPicker.applying
  if (modelPicker.phase === 'loading') { status.textContent = '正在读取 Host 模型目录…'; return }
  if (modelPicker.phase === 'error') { status.textContent = '无法读取模型目录，请检查 DSH 连接或打开完整模型设置。'; return }
  const groups = Array.isArray(modelCatalog?.groups) ? modelCatalog.groups.filter(group => Array.isArray(group.models) && group.models.length) : []
  if (!groups.length) { status.textContent = '没有可用模型，请先在 DSH 中配置服务商和模型。'; return }
  status.textContent = modelPicker.applying ? '正在应用选择…' : '选择会绑定当前对话，并从下一条消息开始生效。'
  for (const group of groups) {
    const section = document.createElement('section'); section.className = 'model-provider'
    const heading = document.createElement('h3'); heading.textContent = group.name ?? group.id
    const list = document.createElement('div'); list.className = 'model-list'
    for (const model of group.models) {
      const node = button(model.name ?? model.id, () => chooseModel(group, model))
      node.dataset.model = model.id; node.setAttribute('aria-pressed', String(modelPicker.selection?.provider === group.id && modelPicker.selection?.model === model.id))
      list.append(node)
    }
    section.append(heading, list); options.append(section)
  }
  const route = catalogRoute(modelPicker.selection)
  const efforts = route?.model?.reasoning?.efforts
  if (Array.isArray(efforts) && efforts.length) {
    const section = document.createElement('section'); section.className = 'effort-group'
    const heading = document.createElement('h3'); heading.textContent = '推理强度'
    const list = document.createElement('div'); list.className = 'effort-list'
    for (const effort of efforts) {
      const node = button(effort.name ?? effort.id, () => {
        modelPicker.selection = { provider: route.group.id, model: route.model.id, reasoningEffort: effort.id }; renderModelPicker()
      })
      node.dataset.effort = effort.id; node.setAttribute('aria-pressed', String(modelPicker.selection?.reasoningEffort === effort.id)); list.append(node)
    }
    section.append(heading, list); options.append(section)
  }
  confirm.hidden = !modelPicker.selection
}
const closeModelPicker = (restoreFocus = false) => {
  modelRequest += 1; modelPicker = { open: false, phase: 'idle', sessionId: null, selection: null, applying: false }
  renderModelPicker(); if (restoreFocus) byId('composer-model').focus()
}
const openModelPicker = async () => {
  const expectedSessionId = viewState().session?.binding?.sessionId ?? null
  const request = ++modelRequest
  modelPicker = { open: true, phase: 'loading', sessionId: expectedSessionId, selection: null, applying: false }
  renderModelPicker(); byId('close-model-popover').focus()
  const result = await send({ type: 'dsh-assistant-session-models' })
  if (request !== modelRequest || (viewState().session?.binding?.sessionId ?? null) !== expectedSessionId) return closeModelPicker()
  if (!result?.value) { modelPicker.phase = 'error'; renderModelPicker(); return }
  modelCatalog = structuredClone(result.value)
  const groups = Array.isArray(modelCatalog.groups) ? modelCatalog.groups : []
  const current = viewState().session?.modelSelection?.next ?? viewState().session?.modelSelection?.lastUsed ?? modelCatalog.default
  const route = groups.flatMap(group => (group.models ?? []).map(model => ({ group, model })))
    .find(candidate => candidate.group.id === current?.provider && candidate.model.id === current?.model)
    ?? groups.flatMap(group => (group.models ?? []).map(model => ({ group, model })))[0]
  modelPicker.phase = 'ready'
  if (route) {
    const effortIds = route.model.reasoning?.efforts?.map(effort => effort.id) ?? []
    const effort = effortIds.includes(current?.reasoningEffort) ? current.reasoningEffort : route.model.reasoning?.defaultEffort
    modelPicker.selection = { provider: route.group.id, model: route.model.id, ...(effort === undefined ? {} : { reasoningEffort: effort }) }
  }
  renderModelPicker()
}
const confirmModel = async () => {
  if (!modelPicker.open || !modelPicker.selection || modelPicker.applying) return
  const request = modelRequest; const expectedSessionId = modelPicker.sessionId; const selection = structuredClone(modelPicker.selection)
  modelPicker.applying = true; renderModelPicker()
  const result = await send({ type: 'dsh-assistant-session-select-model', selection, expectedSessionId })
  if (request !== modelRequest) return
  if (!result) { modelPicker.applying = false; modelPicker.phase = 'error'; renderModelPicker(); return }
  modelPicker = { open: false, phase: 'idle', sessionId: null, selection: null, applying: false }; renderModelPicker()
}

const openHistory = async () => {
  byId('history-dialog').hidden = false
  const result = await send({ type: 'dsh-assistant-session-list' })
  if (result) recentSessions = normalizeSessions(result.value)
  renderSessionList(byId('history-list'), recentSessions, () => { byId('history-dialog').hidden = true })
}
const positionTargetDialog = dialog => {
  const shell = document.querySelector('.shell').getBoundingClientRect()
  const anchor = byId('target-panel').getBoundingClientRect()
  dialog.style.setProperty('--target-dialog-top', `${Math.max(8, Math.round(anchor.bottom - shell.top + 6))}px`)
}
const closeTargetDialog = (restoreFocus = false) => {
  const dialog = byId('target-dialog')
  if (dialog.hidden) return
  dialog.hidden = true
  const focusTarget = targetDialogTrigger?.isConnected
    ? targetDialogTrigger
    : document.querySelector('[data-target-dialog-trigger]')
  if (restoreFocus) focusTarget?.focus()
  targetDialogTrigger = null
}
const openTargetDialog = async () => {
  const current = viewState(); const dialog = byId('target-dialog'); const panel = byId('target-candidates')
  targetDialogTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.hidden = false; positionTargetDialog(dialog); panel.replaceChildren()
  dialog.querySelector('[data-close-modal="target-dialog"]')?.focus()
  if (!current.session?.binding) {
    panel.append(button('新建对话后选择网页', async () => { closeTargetDialog(); await send({ type: 'dsh-assistant-session-create' }) }, 'primary'),
      button('继续已有对话', async () => { closeTargetDialog(); await openHistory() }))
    return
  }
  const expectedSessionId = current.session.binding.sessionId; const expectedRevision = current.target?.revision
  panel.append('正在读取可选标签…')
  const result = await send({ type: 'dsh-assistant-target-candidates' })
  const latest = viewState()
  if (!result || latest.session?.binding?.sessionId !== expectedSessionId || latest.target?.revision !== expectedRevision) {
    panel.textContent = '会话或目标已变化，请重新打开选择器。'; return
  }
  panel.replaceChildren()
  const fixedTabId = current.target?.selected?.tabId
  const candidates = (Array.isArray(result.value?.items) ? result.value.items : [])
    .filter(item => Number.isInteger(item?.tabId))
    .sort((left, right) => Number(right.active === true) - Number(left.active === true)
      || Number(right.tabId === fixedTabId) - Number(left.tabId === fixedTabId))
  for (const item of candidates) {
    let host = ''
    try { host = new URL(item.url).hostname } catch {}
    const states = [item.active ? '当前' : '', item.tabId === fixedTabId ? '已固定' : ''].filter(Boolean)
    const candidate = button(`${states.length ? `${states.join(' · ')} · ` : ''}${bounded(item.title, 120) || host || `标签 ${item.tabId}`}${host ? ` · ${host}` : ''}`, async () => {
      const bound = await send({ type: 'dsh-assistant-target-bind', expectedRevision, tabId: item.tabId })
      if (bound) closeTargetDialog()
    })
    if (item.active) { candidate.classList.add('current-target'); candidate.setAttribute('aria-current', 'page') }
    if (item.tabId === fixedTabId) { candidate.classList.add('fixed-target'); candidate.setAttribute('aria-pressed', 'true') }
    panel.append(candidate)
  }
  if (!panel.childElementCount) panel.textContent = '没有可操作的网页标签。'
}
const renderTarget = () => {
  const current = viewState(); const target = current.target ?? {}; const panel = byId('target-panel'); panel.replaceChildren()
  const heading = document.createElement('strong'); heading.textContent = target.selected ? `已固定 · ${selectedName(target.selected)}` : '未固定操作标签'
  const connected = current.connection?.phase === 'connected'; const bound = Boolean(current.session?.binding)
  const targetReady = target.availability === 'ready' && Number.isSafeInteger(target.revision)
  const hint = document.createElement('small'); hint.textContent = !connected ? '请先连接 DSH，再选择网页。'
    : !bound ? '按需选择网页；显式固定时会先新建对话。'
      : !targetReady ? `目标服务暂不可用，请稍后重试或重新连接。${target.readError?.message ? ` ${bounded(target.readError.message, 180)}` : ''}`
        : target.bindingState === 'other-installation' ? '原目标属于另一个浏览器，请重新固定。'
          : target.selected?.status === 'closed' ? '原网页已关闭，请重新选择。'
          : target.selected?.status === 'navigated' ? '网页已跳转，旧节点引用已失效。'
            : target.selected ? '切换浏览标签不会改变操作目标。' : '选择网页本身不会读取正文。'
  const actions = document.createElement('div'); actions.className = 'target-actions'
  if (!bound) {
    const fixCurrent = button('固定当前标签', createAndBindCurrent, 'primary')
    fixCurrent.disabled = !connected; if (fixCurrent.disabled) fixCurrent.title = hint.textContent
    actions.append(fixCurrent)
  }
  if (bound) {
    const switchCurrent = button('切到当前页', bindCurrentTarget, !target.selected ? 'primary' : '')
    switchCurrent.disabled = !connected || !targetReady; if (switchCurrent.disabled) switchCurrent.title = hint.textContent
    actions.append(switchCurrent)
  }
  const choose = button(bound ? '选择其他标签' : '选择', openTargetDialog, bound && !target.selected ? 'primary' : '')
  choose.dataset.targetDialogTrigger = 'true'
  choose.disabled = !connected || bound && !targetReady; if (choose.disabled) choose.title = hint.textContent
  actions.append(choose)
  if (target.selected) { const clear = button('清除', () => send({ type: 'dsh-assistant-target-clear', expectedRevision: target.revision })); clear.disabled = !targetReady; actions.append(clear) }
  panel.append(heading, hint, actions)
}

const createAndBindCurrent = async () => {
  if (viewState().session?.binding) return notice('对话已变化，请重新点击固定。')
  const created = await send({ type: 'dsh-assistant-session-create' })
  const createdBinding = created?.state?.assistantV2?.session?.binding
  const current = viewState()
  if (!createdBinding?.sessionId || current.session?.binding?.sessionId !== createdBinding.sessionId
    || !Number.isSafeInteger(current.target?.revision)) return notice('新对话尚未就绪，请稍后重试固定。')
  await send({ type: 'dsh-assistant-target-bind', expectedRevision: current.target.revision })
}
const bindCurrentTarget = async () => {
  const current = viewState()
  if (!current.session?.binding || !Number.isSafeInteger(current.target?.revision)) return notice('当前对话或目标尚未就绪。')
  await send({ type: 'dsh-assistant-target-bind', expectedRevision: current.target.revision })
}

const renderTranscriptImage = (message, attachment) => {
  if (!attachment?.attachmentId) return
  const image = document.createElement('img'); image.alt = '会话图片'; message.append(image)
  void chrome.runtime.sendMessage({ type: 'dsh-assistant-session-attachment', attachmentId: attachment.attachmentId, surfaceId }).then(result => {
    if (!result?.ok || typeof result.value?.data !== 'string') return
    const mediaType = result.value?.attachment?.mediaType ?? attachment.mediaType
    if (IMAGE_TYPES.has(mediaType)) image.src = `data:${mediaType};base64,${result.value.data}`
  }).catch(() => {})
}
const renderConversation = () => {
  const current = viewState(); const transcript = current.session?.transcript ?? []; const conversation = byId('conversation'); const home = byId('home')
  byId('session-controls').hidden = !current.session?.binding
  byId('conversation-label').textContent = current.session?.binding ? '当前对话' : '新对话'
  home.hidden = Boolean(current.session?.binding || transcript.length); conversation.hidden = !home.hidden; conversation.replaceChildren()
  const cognitionPages = current.cognition?.pages ?? []; const cognitionItems = cognitionPages.flatMap(page => page.observations ?? []); const assignedReceipts = new Set(); let previousAssistantSeq = -1
  const receiptNode = items => { const receipt = document.createElement('div'); receipt.className = 'reading-receipt'; receipt.append(`已读取的页面内容 ${items.length} 条`, button('查看', () => { activeView = 'cognition'; selectedCognitionId = items.at(-1)?.id ?? null; render() })); return receipt }
  for (const item of transcript) {
    const message = document.createElement('article'); message.className = `message ${item.role === 'user' ? 'user' : 'assistant'}`
    const meta = document.createElement('small'); meta.textContent = item.role === 'user' ? '你' : item.live ? 'DSH · 正在回答' : 'DSH'
    const copy = document.createElement('div')
    if (item.role === 'assistant') { copy.className = 'markdown-body'; renderMarkdown(copy, item.text ?? '') } else copy.textContent = item.text ?? ''
    message.append(meta, copy)
    for (const attachment of item.images ?? []) renderTranscriptImage(message, attachment)
    const assistantSeq = item.role === 'assistant' ? Number.parseInt(String(item.key ?? '').split(':').at(-1), 10) : Number.NaN
    if (Number.isSafeInteger(assistantSeq)) {
      const receipts = cognitionItems.filter(candidate => Number.isSafeInteger(candidate.source?.toolResultSeq)
        && candidate.source.toolResultSeq > previousAssistantSeq && candidate.source.toolResultSeq <= assistantSeq)
      for (const receipt of receipts) assignedReceipts.add(receipt.id)
      if (receipts.length) message.append(receiptNode(receipts))
      previousAssistantSeq = assistantSeq
    }
    conversation.append(message)
  }
  if (!transcript.length && home.hidden) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = current.session?.error?.message ? `对话暂不可用：${bounded(current.session.error.message, 300)}` : '这个对话还没有消息。'; conversation.append(empty) }
  const pendingReceipts = cognitionItems.filter(item => !assignedReceipts.has(item.id))
  if (pendingReceipts.length && home.hidden) conversation.append(receiptNode(pendingReceipts))
  const liveFunctions = (current.functions?.availability === 'ready' ? current.functions.items ?? [] : []).filter(item => item.activeRun).slice(0, 3)
  if (liveFunctions.length && home.hidden) { const rail = document.createElement('section'); rail.className = 'conversation-functions'; const heading = document.createElement('strong'); heading.textContent = '可用功能'; rail.append(heading); for (const item of liveFunctions) rail.append(renderFunctionCard(item, true)); conversation.append(rail) }
  byId('cognition-count').textContent = String(cognitionPages.length)
  const functions = current.functions?.items ?? []
  byId('function-count').textContent = String(functions.filter(item => item.scope !== 'page' || item.scopeStatus === 'current-target').length)
}

const renderPending = () => {
  const current = viewState(); const pending = current.session?.pending; const panel = byId('pending-actions'); panel.replaceChildren()
  if (current.session?.pendingCreate) panel.append('正在确认新对话。')
  else if (pending?.status === 'accepted') panel.append('已送达 DSH。')
  else if (locked(pending)) panel.append('上次提交尚未确认。', button('重试原请求', () => send({ type: 'dsh-assistant-session-retry' }), 'primary'))
  else if (pending) panel.append(`上次请求${pending.status === 'failed' ? '失败' : '尚未发送'}。`, button('重试原请求', () => send({ type: 'dsh-assistant-session-retry' })))
}
const renderApprovals = () => {
  const panel = byId('action-approvals'); panel.replaceChildren(); panel.hidden = true
  const current = viewState(); const items = current.connection?.phase === 'connected' && current.session?.binding?.sessionId && state?.approvals?.sessionId === current.session.binding.sessionId ? state.approvals.requests ?? [] : []
  for (const item of items) {
    const card = document.createElement('article'); const title = document.createElement('strong'); title.textContent = '确认浏览器操作'
    const reason = document.createElement('pre'); reason.textContent = item.reason ?? '请确认是否允许本次浏览器操作。'
    const controls = document.createElement('div'); controls.className = 'approval-controls'
    const decide = async decision => { for (const action of controls.querySelectorAll('button')) action.disabled = true; const result = await send({ type: 'dsh-assistant-approval-decide', id: item.id, decision }); if (!result && card.isConnected) for (const action of controls.querySelectorAll('button')) action.disabled = false }
    controls.append(button('允许这一次', () => decide('allowed-once'), 'primary'), button('拒绝', () => decide('rejected'))); card.append(title, reason, controls); panel.append(card); panel.hidden = false
  }
}
const renderUnresolved = () => {
  const panel = byId('unresolved-actions'); panel.replaceChildren(); panel.hidden = true
  for (const item of state?.unresolved ?? []) {
    const row = document.createElement('article'); const text = document.createElement('p'); text.textContent = `标签 ${item.target?.tabId} · 会话 ${item.identity.sessionId.slice(-12)}：${item.acknowledgementPending ? '已人工核对，等待同步到 DSH。' : '旧操作结果未知，同一标签的后续操作已暂停。请先查看页面。'}`
    row.append(text, button('查看目标标签', () => send({ type: 'dsh-assistant-reveal-target', requestId: item.identity.requestId })), button(item.acknowledgementPending ? '同步核对结果' : '我已核对页面，接受未知结果', () => send({ type: 'dsh-assistant-acknowledge', identity: item.identity })))
    panel.append(row); panel.hidden = false
  }
}

const nodeTitle = node => ({ tag: bounded(node.tag, 64) || node.kind, label: bounded(node.label || node.text || node.role, 256) || '无公开文字' })
const exactPage = (left, right) => left?.tabId === right?.tabId && left?.frameId === right?.frameId && left?.documentId === right?.documentId && left?.url === right?.url
const currentTargetPage = (page, current) => {
  const observed = page?.target?.page, pinned = current.target?.selected
  if (!observed || !pinned || page.documentState !== 'current' || observed.tabId !== pinned.tabId || observed.frameId !== pinned.frameId
    || current.connection?.grant?.installationId && page.target.installationId !== current.connection.grant.installationId) return false
  return exactPage(observed, pinned) || pinned.liveUrl === observed.url && Number.isSafeInteger(pinned.boundAt)
    && page.observations?.some(item => Number.isSafeInteger(item.observedAt) && item.observedAt >= pinned.boundAt)
}
const contentSummary = page => page.sourceSnapshot ? `${page.sourceSnapshot.blocks.length} 块原文` : `${page.content?.groups.length ?? 0} 个内容分组`
const cognitionCommand = (type, page, extra = {}) => {
  const current = viewState()
  return send({ type, pageId: page.id, expectedSessionId: current.session?.binding?.sessionId ?? null, expectedTargetRevision: current.target?.revision, ...extra })
}
const renderCognitionTree = (page, observation, card) => {
  const canLocate = page.locatorsValid && currentTargetPage(page, viewState())
  const nodes = observation.tree?.nodes ?? []; const byIndex = new Map(nodes.map(node => [node.index, node])); const children = new Map()
  for (const node of nodes) { const parent = byIndex.has(node.parentIndex) ? node.parentIndex : null; const siblings = children.get(parent) ?? []; siblings.push(node); children.set(parent, siblings) }
  const select = node => { selectedCognitionId = observation.id; selectedNodeIndex = node.index; renderCognition() }
  const branch = (node, depth) => {
    const nested = children.get(node.index) ?? []; const title = nodeTitle(node)
    if (!nested.length) { const leaf = button('', () => select(node), 'tree-node'); leaf.setAttribute('aria-current', String(selectedCognitionId === observation.id && selectedNodeIndex === node.index)); const tag = document.createElement('code'); tag.textContent = title.tag; const label = document.createElement('span'); label.textContent = title.label; leaf.append(tag, label); return leaf }
    const details = document.createElement('details'); details.open = depth < 2 || selectedCognitionId === observation.id && (selectedNodeIndex === node.index || nested.some(child => child.index === selectedNodeIndex))
    const summary = document.createElement('summary'); summary.className = 'tree-node'; summary.setAttribute('aria-current', String(selectedCognitionId === observation.id && selectedNodeIndex === node.index)); const tag = document.createElement('code'); tag.textContent = title.tag; const label = document.createElement('span'); label.textContent = title.label; const inspect = button('详情', () => select(node), 'tree-detail'); inspect.addEventListener('click', event => event.stopPropagation()); summary.append(tag, label, inspect)
    const group = document.createElement('div'); group.className = 'tree-children'; for (const child of nested) group.append(branch(child, depth + 1)); details.append(summary, group); return details
  }
  const tree = document.createElement('div'); tree.className = 'cognition-tree'; for (const root of children.get(null) ?? []) tree.append(branch(root, 0)); card.append(tree)
  const selected = selectedCognitionId === observation.id ? nodes.find(node => node.index === selectedNodeIndex) : null
  if (selected) { const nodeDetail = document.createElement('div'); nodeDetail.className = 'node-detail'; const title = nodeTitle(selected); nodeDetail.append(`${selected.kind}${selected.tag ? ` · ${selected.tag}` : ''}${selected.role ? ` · ${selected.role}` : ''}`, title.label); if (canLocate && selected.snapshotId && selected.elementId) nodeDetail.append(button('在页面中显示', () => cognitionCommand('dsh-assistant-cognition-reveal-node', page, { observationId: observation.id, nodeIndex: selected.index }), 'primary')); card.append(nodeDetail) }
}
const renderCognition = () => {
  const focused = document.activeElement, previousView = focused?.closest('.semantic-navigation')
  const focusKey = focused?.dataset?.semanticFocus, previousKey = previousView?.dataset.semanticView
  const previousPane = previousView?.closest('.pane'), previousScroll = previousPane?.scrollTop
  const current = viewState(); const cognition = current.cognition ?? {}; const panel = byId('cognition-content'); panel.replaceChildren()
  const refresh = byId('refresh-cognition'); const refreshStatus = cognition.refresh?.status ?? 'idle'; const canRefresh = current.connection?.phase === 'connected' && Boolean(current.session?.binding) && current.target?.availability === 'ready' && Boolean(current.target?.selected) && !locked(current.session?.pending) && !current.session?.pendingCreate && !['submitting', 'waiting', 'unknown'].includes(refreshStatus)
  refresh.disabled = !canRefresh; refresh.textContent = ({ submitting: '正在提交…', waiting: '等待新证据…', complete: '刷新完成', 'no-new-evidence': '没有新证据', failed: '刷新失败' })[refreshStatus] ?? '刷新'; refresh.title = canRefresh ? '让 Agent 对当前操作网页做一次新的有界读取' : '请先连接、选择对话并选择网页'
  const pages = cognition.pages ?? []
  const generate = () => { const value = viewState(); void send({ type: 'dsh-assistant-cognition-generate', expectedSessionId: value.session?.binding?.sessionId, expectedTargetRevision: value.target?.revision }) }
  const readPage = () => { const value = viewState(); void send({ type: 'dsh-assistant-cognition-refresh', expectedSessionId: value.session?.binding?.sessionId, expectedTargetRevision: value.target?.revision }) }
  if (!pages.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = cognition.status === 'unread' ? '还没有已送达 Agent 的页面认知。选择网页本身不会读取页面。' : '页面认知暂不可用。'; const start = button('读取页面认知', readPage, 'semantic-generate'); start.disabled = !canRefresh; empty.append(start); panel.append(empty); return }
  const selected = pages.find(page => page.id === selectedAtlasPageId) ?? pages.find(page => currentTargetPage(page, current)) ?? pages.find(page => page.documentState === 'current') ?? pages.at(-1)
  selectedAtlasPageId = selected.id
  const cards = document.createElement('div'); cards.className = 'atlas-pages'
  for (const page of pages) { const card = button('', () => { selectedAtlasPageId = page.id; selectedAtlasRegionId = null; renderCognition() }, 'atlas-page-card'); card.setAttribute('aria-pressed', String(page.id === selected.id)); card.append(`${page.documentState === 'previous-document' ? '先前页面 · ' : ''}${page.title || page.target?.page?.url || '已送达页面'} · ${contentSummary(page)}`); cards.append(card) }
  if (pages.length > 1) panel.append(cards)
  const canLocate = selected.locatorsValid && currentTargetPage(selected, current)
  const detail = document.createElement('article'); detail.className = 'atlas-detail'; const heading = document.createElement('header'); const title = document.createElement('h2'); title.textContent = selected.documentState === 'previous-document' ? '先前页面的读取记录' : '当前页面的理解范围'; const meta = document.createElement('small'); meta.className = 'cognition-meta'; meta.textContent = `${selected.coverage?.observationCount ?? 0} 次读取 · ${contentSummary(selected)} · 仅展示已读部分`; heading.append(title, meta)
  if (selected.locatorsValid) { const locate = button('定位标签', () => cognitionCommand('dsh-assistant-cognition-locate', selected)); locate.disabled = !canLocate; if (!canLocate) locate.title = '固定目标已变化，不能定位旧页面。'; heading.append(locate) }
  if (cognitionDetailView !== 'map') detail.append(heading)
  const tabs = document.createElement('div'); tabs.className = 'atlas-tabs'; for (const [id, copy] of [['map', '认知'], ['reading', '阅读'], ['structure', '结构'], ['evidence', '证据']]) { const tab = button(copy, () => { cognitionDetailView = id; renderCognition() }); tab.setAttribute('aria-pressed', String(cognitionDetailView === id)); tabs.append(tab) }; detail.append(tabs)
  if (cognitionDetailView === 'structure') { const observation = selected.observations?.at(-1); if (observation?.tree?.nodes?.length) renderCognitionTree(selected, observation, detail); else detail.append('没有已送达的 DOM 树。') }
  else if (cognitionDetailView === 'evidence') { const evidence = document.createElement('div'); evidence.className = 'atlas-evidence'; for (const observation of selected.observations ?? []) { const row = document.createElement('p'); row.textContent = `${observation.id} · ${observation.readMode} · ${new Date(observation.observedAt ?? 0).toLocaleString()} · 正文 ${observation.scope?.textChars ?? 0} 字${observation.omissions?.textTruncated ? ' · 正文截断' : ''}`; evidence.append(row) }; if (selected.omissions?.length) evidence.append(`遗漏：${selected.omissions.join('、')}`); detail.append(evidence) }
  else if (cognitionDetailView === 'map') {
    const latest = selected.observations?.at(-1)
    const navigationKey = JSON.stringify([selected.id, latest?.id, latest?.snapshotId])
    if (!cognitionNavigation.has(navigationKey)) {
      cognitionNavigation.set(navigationKey, {})
      if (cognitionNavigation.size > 64) cognitionNavigation.delete(cognitionNavigation.keys().next().value)
    }
    const updateScope = (objectId, correction) => {
      const value = viewState(), key = draftKey(value)
      if (submitting || locked(value.session?.pending) || value.session?.pendingCreate) return
      const existing = cognitionScopes.get(key)
      let ids = [], corrections = {}
      if (existing?.pageId === selected.id) {
        try { compileCognitionContext(existing, selected, value); ids = [...existing.objectIds]; corrections = { ...existing.corrections } } catch { /* Explicit selection replaces a stale draft, never remaps old IDs. */ }
      }
      if (correction !== undefined) { if (!ids.includes(objectId)) ids.push(objectId); corrections[objectId] = correction }
      else if (ids.includes(objectId)) { ids = ids.filter(id => id !== objectId); delete corrections[objectId] }
      else ids.push(objectId)
      try {
        if (ids.length) cognitionScopes.set(key, createCognitionScope(selected, value, ids, corrections))
        else cognitionScopes.delete(key)
        render(); byId('composer').focus({ preventScroll: true })
      } catch (error) { notice(error.message) }
    }
    detail.append(renderCognitionWorkspace(selected, {
      navigation: cognitionNavigation.get(navigationKey), scope: cognitionScopes.get(activeDraftKey),
      canUse: currentTargetPage(selected, current) && current.connection?.phase === 'connected'
        && Boolean(current.session?.binding) && !submitting && !locked(current.session?.pending) && !current.session?.pendingCreate,
      canLocate: currentTargetPage(selected, current),
      onUse: objectId => updateScope(objectId), onCorrect: (objectId, correction) => updateScope(objectId, correction),
      onRevealSource: (blockId, snapshotId) => cognitionCommand('dsh-assistant-cognition-reveal-source', selected, { blockId, snapshotId }),
      onRevealAction: actionId => cognitionCommand('dsh-assistant-cognition-reveal-action', selected, { actionId }),
    }))
  }
  else if (selected.sourceSnapshot?.blocks.length) detail.append(renderSemanticNavigation(selected, {
    canLocate: currentTargetPage(selected, current), canGenerate: canRefresh && currentTargetPage(selected, current), generating: ['submitting', 'waiting', 'unknown'].includes(refreshStatus),
    onGenerate: generate,
    onReveal: (blockId, snapshotId) => cognitionCommand('dsh-assistant-cognition-reveal-source', selected, { blockId, snapshotId }),
    canReview: current.connection?.phase === 'connected' && Boolean(current.session?.binding),
    onFeedback: (mapId, nodeId, update) => cognitionCommand('dsh-assistant-semantic-feedback', selected, { mapId, nodeId, ...update }),
  }))
  else {
    const start = button('读取并生成语义地图', generate, 'semantic-generate')
    start.disabled = !canRefresh || !exactPage(selected.target?.page, current.target?.selected)
    detail.append(start, renderContentMap(selected, { canLocate, selectedId: selectedAtlasRegionId,
      onSelect: id => { selectedAtlasRegionId = id },
      onReveal: actionId => cognitionCommand('dsh-assistant-cognition-reveal-action', selected, { actionId }) }))
  }
  panel.append(detail)
  if (previousKey && focusKey) {
    const nextView = [...panel.querySelectorAll('[data-semantic-view]')].find(node => node.dataset.semanticView === previousKey)
    const nextFocus = [...nextView?.querySelectorAll('[data-semantic-focus]') ?? []].find(node => node.dataset.semanticFocus === focusKey)
    if (nextFocus) { if (nextFocus.tagName === 'H3') nextFocus.tabIndex = -1; nextFocus.focus({ preventScroll: true }) }
    if (nextView && previousPane && previousScroll !== undefined) previousPane.scrollTop = previousScroll
  }
}

const renderFunctionCard = (item, compact = false) => {
  const card = document.createElement('article'); card.className = `function${compact ? ' compact' : ''}`
  const title = document.createElement('strong'); title.textContent = item.name ?? item.functionId ?? '未命名功能'
  const description = document.createElement('p'); description.textContent = item.purpose ?? '目录没有提供用途说明。'
  const status = document.createElement('span'); status.className = `status-pill ${item.status === 'running' ? 'running' : ''}`; status.textContent = item.status === 'running' ? '运行中' : '已停止'
  const note = document.createElement('small'); note.className = 'scope-note'; note.textContent = `版本 ${item.currentPackageId ?? '未知'} · ${item.scope === 'page' ? '当前目标页面' : '全局'}`
  const actions = document.createElement('div'); actions.className = 'function-actions'
  const openLabel = item.openTarget?.kind === 'web' ? '在 DSH 中打开' : item.openTarget?.kind === 'browser' ? '在页面中打开' : '没有可打开的界面'
  const open = button(openLabel, () => send({ type: 'dsh-assistant-function-open', pluginId: item.pluginId }), 'primary'); open.disabled = !item.openTarget; if (open.disabled) open.title = '这个功能当前没有可打开的界面'; actions.append(open)
  if (item.status === 'stopped') actions.append(button('运行', () => send({ type: 'dsh-assistant-function-run', pluginId: item.pluginId })))
  else { actions.append(button('检查运行', () => send({ type: 'dsh-assistant-function-inspect', pluginId: item.pluginId }))); actions.append(button('停止', () => send({ type: 'dsh-assistant-function-stop', pluginId: item.pluginId }))) }
  const metadata = document.createElement('details'); metadata.className = 'function-metadata'; const metadataTitle = document.createElement('summary'); metadataTitle.textContent = '详情'; const metadataBody = document.createElement('p'); metadataBody.textContent = [`ID ${item.pluginId}`, `版本 ${item.currentPackageId ?? '未知'}`, item.scope === 'page' ? '范围 当前目标页面' : '范围 全局', item.status === 'running' ? `运行 ${item.activeRun?.pluginRunId ?? '活动中'}` : '当前未运行'].join(' · '); metadata.append(metadataTitle, metadataBody)
  card.append(title, description, status, note, actions, metadata)
  if (!compact) {
    const hasSession = Boolean(viewState().session?.binding)
    const run = [...actions.querySelectorAll('button')].find(action => action.textContent === '运行')
    if (run && !hasSession) { run.disabled = true; run.title = '开始或选择对话后可运行' }
    const edit = document.createElement('div'); edit.className = 'function-edit'; const input = document.createElement('input'); input.type = 'text'; input.maxLength = 8192; input.placeholder = '用一句话说明要怎样修改'; input.setAttribute('aria-label', `修改${title.textContent}`)
    const apply = button('修改', () => { const instruction = input.value.trim(); if (!instruction) return notice('请先写下要怎样修改'); void send({ type: 'dsh-assistant-function-edit', pluginId: item.pluginId, instruction }) }); input.disabled = !hasSession; apply.disabled = !hasSession; if (!hasSession) { input.title = '开始或选择对话后可修改'; apply.title = input.title }; edit.append(input, apply); card.append(edit)
    if (!hasSession) { const hint = document.createElement('small'); hint.className = 'scope-note'; hint.textContent = '开始或选择对话后可运行和修改。'; card.append(hint) }
    if (item.command) { const progress = document.createElement('small'); progress.className = 'scope-note'; progress.textContent = item.command.status === 'unknown' ? '上次请求结果未确认；原请求 ID 会保留等待恢复。' : item.command.status === 'host-lost' ? 'DSH Host 已找不到该请求，未自动重发。' : `请求状态：${item.command.status}`; card.append(progress) }
    if (item.inspection != null) { const detail = document.createElement('pre'); detail.className = 'function-inspection'; const raw = JSON.stringify(item.inspection, null, 2); detail.textContent = raw.length > 8192 ? `${raw.slice(0, 8192)}\n…（详情已截断）` : raw; card.append(detail) }
  }
  return card
}
const renderFunctions = () => {
  const functions = viewState().functions ?? { availability: 'unavailable', items: [] }; const panel = byId('functions-content'); panel.replaceChildren()
  for (const node of document.querySelectorAll('[data-scope]')) node.setAttribute('aria-pressed', String(node.dataset.scope === functionScope))
  byId('refresh-functions').disabled = functions.availability === 'loading' || viewState().connection?.phase !== 'connected'
  if (functions.availability !== 'ready') { const empty = document.createElement('div'); empty.className = `empty${functions.readError ? ' error-state' : ''}`; empty.textContent = functions.availability === 'loading' ? '正在加载功能。' : functions.readError ? `功能暂不可用：${bounded(functions.readError.message || functions.readError.code, 300)}` : '功能暂不可用。'; panel.append(empty); return }
  const items = (functions.items ?? []).filter(item => functionScope === 'global' ? item.scope === 'global' : item.scope === 'page' && item.scopeStatus === 'current-target')
  if (!items.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = functionScope === 'page' ? '当前操作网页没有可用功能。' : '还没有全局功能。'; panel.append(empty) }
  for (const item of items) panel.append(renderFunctionCard(item))
  for (const command of functions.orphanCommands ?? []) { const orphan = document.createElement('div'); orphan.className = 'empty'; orphan.textContent = `未归属的${command.kind === 'edit' ? '修改' : '运行'}请求：${command.status ?? '未知'}`; panel.append(orphan) }
}

const renderRecent = () => renderSessionList(byId('recent-list'), recentSessions.slice(0, 3))
const normalizeSessions = value => (Array.isArray(value?.items) ? value.items : []).filter(item => typeof item?.sessionId === 'string' && item.sessionId).slice(0, 50)
const renderSessionList = (container, items, after = () => {}) => {
  container.replaceChildren()
  for (const item of items) {
    const row = button('', async () => { const result = await send({ type: 'dsh-assistant-session-bind', sessionId: item.sessionId }); if (result) after() })
    const title = document.createElement('span'); title.textContent = sessionName(item); const action = document.createElement('small'); action.textContent = '继续对话'; row.append(title, action); container.append(row)
  }
  if (!container.childElementCount) { const empty = document.createElement('p'); empty.className = 'recent-empty'; empty.textContent = '还没有可继续的对话。'; container.append(empty) }
}
const refreshRecent = async () => {
  const current = viewState(); const key = current.connection?.phase === 'connected' ? `${current.connection.baseUrl ?? ''}:${current.connection.grant?.installationId ?? ''}` : null
  if (!key || recentKey === key || recentFlight) { renderRecent(); return }
  recentFlight = chrome.runtime.sendMessage({ type: 'dsh-assistant-session-list', surfaceId }).then(result => {
    const latest = viewState(); const latestKey = latest.connection?.phase === 'connected' ? `${latest.connection.baseUrl ?? ''}:${latest.connection.grant?.installationId ?? ''}` : null
    if (result?.ok && latestKey === key) { recentSessions = normalizeSessions(result.value); recentKey = key }
  }).catch(() => {}).finally(() => {
    recentFlight = null; renderRecent()
    const latest = viewState(); const latestKey = latest.connection?.phase === 'connected' ? `${latest.connection.baseUrl ?? ''}:${latest.connection.grant?.installationId ?? ''}` : null
    if (latestKey && latestKey !== key) void refreshRecent()
  })
  await recentFlight
}

const renderDraftImages = () => { const rail = byId('draft-images'); rail.replaceChildren(); for (const [index, image] of draftImages.entries()) { const card = document.createElement('div'); card.className = 'draft-image'; const preview = document.createElement('img'); preview.alt = image.name; preview.src = `data:${image.mediaType};base64,${image.data}`; const remove = button('×', () => { draftImages = draftImages.filter((_, candidate) => candidate !== index); renderDraftImages() }); remove.setAttribute('aria-label', `移除图片 ${image.name}`); card.append(preview, remove); rail.append(card) } }
const renderCognitionDraftScope = () => {
  byId('cognition-draft-scope')?.remove()
  const scope = cognitionScopes.get(activeDraftKey)
  if (!scope) return
  const current = viewState(), page = current.cognition?.pages?.find(item => item.id === scope.pageId)
  const rail = renderCognitionTaskScope(scope, page, current, {
    disabled: submitting || locked(current.session?.pending) || Boolean(current.session?.pendingCreate),
    onClear: () => { cognitionScopes.delete(activeDraftKey); cognitionNavigation.clear(); render() },
  })
  rail.id = 'cognition-draft-scope'; byId('composer-wrap').prepend(rail)
}
const render = () => {
  const current = viewState(); const connection = current.connection ?? {}; const session = current.session ?? {}; const blocked = locked(session.pending) || Boolean(session.pendingCreate)
  renderConnection(); renderSettings(); renderTarget(); renderConversation(); renderPending(); renderApprovals(); renderUnresolved(); renderCognition(); renderFunctions(); renderRecent(); renderModelPicker()
  for (const name of ['chat', 'cognition', 'functions']) { byId(`${name}-panel`).hidden = activeView !== name; for (const node of document.querySelectorAll(`[data-view="${name}"]`)) node.setAttribute('aria-selected', String(activeView === name)) }
  byId('composer-wrap').hidden = activeView === 'functions'
  renderCognitionDraftScope()
  const offline = connection.phase !== 'connected' || session.phase === 'foreign'
  byId('composer').disabled = blocked; byId('send-queue').disabled = blocked || offline || submitting; byId('send-steer').disabled = blocked || offline || submitting; byId('stop-session').disabled = offline || !session.binding; byId('new-session').disabled = offline || blocked; byId('session-picker').disabled = offline || blocked
  const status = session.phase === 'foreign' ? '当前对话属于另一台 DSH，请恢复原连接。' : offline ? '请先连接 DSH，草稿会留在输入框中。' : session.pendingCreate ? '正在确认新对话。' : locked(session.pending) ? '上次提交尚未确认。' : session.error?.message ? `对话读取失败：${bounded(session.error.message, 300)}` : !session.binding ? '选择“新对话”或继续已有对话后即可发送。' : ''
  byId('send-status').textContent = status; byId('send-status').hidden = !status
}

const connect = async () => { try { if (!await chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] })) return notice('未授予所有网站访问权限'); await send({ type: 'dsh-assistant-connect', scopes: ['session:interact', 'browser:read', 'browser:write', 'browser:observe'], origins: ['*'] }) } catch (error) { notice(messageError(error)) } }
const configure = async () => { const baseUrl = byId('base-url').value.trim() || DEFAULT_BASE_URL; try { if (!['http:', 'https:'].includes(new URL(baseUrl).protocol)) throw new Error('invalid_url') } catch { return notice('请输入有效的 HTTP(S) 地址') }; editingUrl = false; if (await send({ type: 'dsh-assistant-configure', baseUrl })) await connect() }
const openSessionMenu = async menuId => { const menu = byId(menuId); menu.hidden = false; const result = await send({ type: 'dsh-assistant-session-list' }); renderSessionList(menu, normalizeSessions(result?.value), () => { menu.hidden = true }) }
const submit = async (mode = 'queue') => {
  const instruction = byId('composer').value.trim(), current = viewState()
  if ((!instruction && !draftImages.length) || submitting || locked(current.session?.pending) || current.session?.pendingCreate) return
  if (current.connection?.phase !== 'connected' || current.session?.phase === 'foreign') return render()
  const submittedDraftKey = activeDraftKey, scope = cognitionScopes.get(submittedDraftKey)
  let text = instruction
  if (scope) {
    try {
      const page = current.cognition?.pages?.find(item => item.id === scope.pageId)
      text = attachCognitionContext(instruction, compileCognitionContext(scope, page, current))
    } catch (error) { notice(error.message); return }
  }
  submitting = true; render()
  try {
    const result = await send({ type: 'dsh-assistant-session-submit', text, mode,
      expectedSessionId: current.session?.binding?.sessionId ?? null,
      ...(Number.isSafeInteger(current.target?.revision) ? { expectedTargetRevision: current.target.revision } : {}),
      ...(draftImages.length ? { images: structuredClone(draftImages) } : {}) })
    if (result) {
      const command = result.value?.command?.result
      if (command) notice(command.text || (command.kind === 'success' ? '命令已完成。' : '命令未完成。'))
      drafts.delete(submittedDraftKey); cognitionScopes.delete(submittedDraftKey)
      if (activeDraftKey === submittedDraftKey) { byId('composer').value = ''; draftImages = []; renderDraftImages() }
    }
  } finally { submitting = false; render() }
}
const imageData = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('image_read_failed')); reader.onload = () => { const match = /^data:([^;]+);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(String(reader.result ?? '')); if (!match) return reject(new Error('image_read_failed')); resolve({ type: 'image', mediaType: match[1], data: match[2], name: file.name || 'clipboard-image' }) }; reader.readAsDataURL(file) })
const addFiles = async files => { const candidates = [...files].filter(file => file instanceof File); if (!candidates.length) return; const totalBytes = draftImages.reduce((total, image) => total + Math.floor(image.data.length * 3 / 4), 0) + candidates.reduce((total, file) => total + file.size, 0); if (draftImages.length + candidates.length > 4 || candidates.some(file => !IMAGE_TYPES.has(file.type) || file.size > 2 * 1024 * 1024) || totalBytes > 3 * 1024 * 1024) return notice('最多添加 4 张、每张不超过 2MB 且合计不超过 3MB 的 PNG、JPG、WebP 或 GIF 图片。'); try { draftImages = [...draftImages, ...await Promise.all(candidates.map(imageData))]; renderDraftImages() } catch (error) { notice(messageError(error)) } }

for (const node of document.querySelectorAll('[data-view]')) node.addEventListener('click', () => { activeView = node.dataset.view; render() })
for (const node of document.querySelectorAll('[data-scope]')) node.addEventListener('click', () => { functionScope = node.dataset.scope; renderFunctions() })
for (const node of document.querySelectorAll('[data-close-modal]')) node.addEventListener('click', () => {
  if (node.dataset.closeModal === 'target-dialog') closeTargetDialog(true)
  else byId(node.dataset.closeModal).hidden = true
})
for (const node of document.querySelectorAll('[data-starter]')) node.addEventListener('click', () => { byId('composer').value = node.dataset.starter; byId('composer').focus() })
byId('home-functions').addEventListener('click', () => { activeView = 'functions'; render() })
byId('show-settings').addEventListener('click', () => { byId('settings').hidden = false })
byId('hide-settings').addEventListener('click', () => { byId('settings').hidden = true })
byId('history-button').addEventListener('click', () => { void openHistory() })
byId('top-new-session').addEventListener('click', () => { void send({ type: 'dsh-assistant-session-create' }) })
byId('base-url').addEventListener('input', () => { editingUrl = true })
byId('save-settings').addEventListener('click', () => { void configure() })
byId('disconnect').addEventListener('click', () => { void send({ type: 'dsh-assistant-disconnect' }) })
byId('configure-model').addEventListener('click', () => { void send({ type: 'dsh-assistant-open-model-settings' }) })
byId('composer-model').addEventListener('click', () => { void openModelPicker() })
byId('close-model-popover').addEventListener('click', () => { closeModelPicker(true) })
byId('confirm-model').addEventListener('click', () => { void confirmModel() })
byId('open-model-settings').addEventListener('click', () => { void send({ type: 'dsh-assistant-open-model-settings' }) })
byId('browser-engine').addEventListener('change', () => { void send({ type: 'dsh-assistant-browser-engine', engine: byId('browser-engine').value }) })
byId('new-session').addEventListener('click', () => { void send({ type: 'dsh-assistant-session-create' }) })
byId('session-picker').addEventListener('click', () => { void openSessionMenu('session-menu') })
byId('session-new').addEventListener('click', () => { void send({ type: 'dsh-assistant-session-create' }) })
byId('session-switch').addEventListener('click', () => { void openSessionMenu('session-switch-menu') })
byId('refresh-cognition').addEventListener('click', () => { const current = viewState(); void send({ type: 'dsh-assistant-cognition-refresh', expectedSessionId: current.session?.binding?.sessionId ?? null, expectedTargetRevision: current.target?.revision }) })
byId('refresh-functions').addEventListener('click', () => { void send({ type: 'dsh-assistant-functions-refresh' }) })
byId('create-function').addEventListener('click', () => { activeView = 'chat'; byId('composer').value = `帮我创建一个${functionScope === 'page' ? '当前页面' : '全局'}功能：`; render(); byId('composer').focus() })
byId('attach-image').addEventListener('click', () => byId('image-input').click())
byId('image-input').addEventListener('change', event => { void addFiles(event.target.files); event.target.value = '' })
byId('composer').addEventListener('paste', event => { const files = [...(event.clipboardData?.items ?? [])].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean); if (files.length) { event.preventDefault(); void addFiles(files) } })
byId('composer').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submit() } })
byId('send-queue').addEventListener('click', () => { void submit() })
byId('send-steer').addEventListener('click', () => { void submit('steer') })
byId('stop-session').addEventListener('click', () => { void send({ type: 'dsh-assistant-session-stop' }) })
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return
  if (modelPicker.open) { event.preventDefault(); closeModelPicker(true) }
  if (!byId('target-dialog').hidden) { event.preventDefault(); closeTargetDialog(true) }
})
document.addEventListener('click', event => {
  const path = event.composedPath()
  if (modelPicker.open && !path.includes(byId('composer-model')) && !path.includes(byId('model-popover'))) closeModelPicker()
  if (!byId('target-dialog').hidden && !path.includes(byId('target-panel')) && !path.includes(byId('target-dialog'))) closeTargetDialog()
})
chrome.runtime.onMessage.addListener(message => { if (message?.type === 'dsh-state-changed') void readState(); if (message?.type === 'dsh-assistant-error') notice(messageError(message.error)) })

let presencePort; let presenceRetry
const publishPresence = () => { try { presencePort?.postMessage({ type: 'presence', visible: document.visibilityState === 'visible' }) } catch {} }
const connectView = () => { if (closingView || typeof chrome.runtime.connect !== 'function') return; try { const port = chrome.runtime.connect({ name: 'dsh-assistant-view' }); presencePort = port; port.onDisconnect.addListener(() => { if (presencePort !== port) return; presencePort = undefined; if (!closingView) presenceRetry = setTimeout(connectView, 1000) }); publishPresence() } catch { if (!closingView) presenceRetry = setTimeout(connectView, 1000) } }
document.addEventListener('visibilitychange', publishPresence)
window.addEventListener('pagehide', () => { closingView = true; clearTimeout(approvalPollTimer); clearTimeout(presenceRetry); presencePort?.disconnect(); presencePort = undefined })
render(); connectView(); void readState()
