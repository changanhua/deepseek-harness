import { modelSummary } from './model-summary.js'
import { renderMarkdown } from './preview.js'
import { createSbcCombReport, formatSbcCombReport } from './fc-sbc-comb-report.js'
import { createSbcRedactedSample, formatSbcRedactedSample } from './fc-sbc-redacted-sample.js'
import { updateFcSbcPageModel } from './fc-sbc-page-model.js'
import { createFcSbcSliceReport, createFcSbcVerificationRequest } from './fc-sbc-slice-report.js'

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
const recoveryFlights = new Set()
let activeDraftKey = null
let recentSessions = []
let recentKey = null
let recentFlight = null
let selectedCognitionId = null
let selectedNodeIndex = null
let submitting = false
let editingUrl = false
let modelCatalog = null
let modelRequest = 0
let modelPicker = { open: false, phase: 'idle', sessionId: null, selection: null, applying: false }
let targetDialogTrigger = null
let fcSbcScan = { phase: 'idle', request: 0, page: null, probe: null, model: null, slice: null, readMode: null,
  report: null, comb: null, sample: null, staleBinding: false, error: null }

const label = phase => ({ unconfigured: '尚未配置', configured: '尚未连接', pending: '等待批准', connecting: '正在连接', connected: '已连接', offline: '离线', unauthorized: '需要授权', invalid: '配置无效' })[phase] ?? '未知状态'
const sbcStatusLabel = status => ({ 'ready-for-approval': '可确认', 'draft-only': '草稿', blocked: '阻塞' })[status] ?? '未知'
const sbcDryRunStatusLabel = status => ({ ready: '可预演', blocked: '预演阻塞', 'no-purchases': '无采购' })[status] ?? '未知'
const sbcRiskStatusLabel = status => ({ clear: '无拟执行交易', caution: '需谨慎', blocked: '阻塞' })[status] ?? '未知'
const sbcApprovalPreviewStatusLabel = status => ({ ready: '可审阅', blocked: '预览阻塞' })[status] ?? '未知'
const sbcTaskLabel = type => ({ puzzle: '拼图 SBC', 'item-score': 'Item Score', unknown: '未知' })[type] ?? '未知'
const sbcMarketLabel = status => ({ visible: '可见', blocked: '受限', unknown: '未知' })[status] ?? '未知'
const sbcInventoryLabel = coverage => ({ complete: '完整', partial: '部分覆盖', 'visible-only': '仅可见页面', unread: '未读取' })[coverage] ?? '未知'
const sbcViewLabel = kind => ({ 'sbc-list': 'SBC 列表', 'sbc-group': '群组详情', club: '俱乐部', 'sbc-storage': 'SBC 仓库', unknown: '未知' })[kind] ?? '未知'
const sbcIssueLabel = code => ({
  'page-probe-not-run': '页面探针未运行',
  'capture-current-fc-sbc-page': '需要采集当前 FC SBC 页面',
  'login-required': '请先登录 EA 账号并打开 SBC 页面',
  'unsupported-page': '不是已识别的 FC 页面',
  'unsupported-task-type': '任务类型未纳入当前纵切',
  'item-score-executor-deferred': 'Item Score 执行器后续处理',
  'unknown-task-type': '任务类型未知',
  'classify-sbc-task-type': '需要识别 SBC 类型',
  'inventory-unread': '库存未读取',
  'inventory-visible-only': '库存只来自可见页面',
  'inventory-snapshot-invalid': '完整库存快照无效',
  'complete-inventory-adapter': '完整库存适配器待接入',
  'repair-inventory-snapshot': '需要修复库存快照',
  'plan-input-missing': '求解输入待接入',
  'solver-input-adapter-deferred': '求解输入适配器后续处理',
  'plan-input-invalid': '求解输入无效',
  'no-executable-plan': '暂无可执行方案',
  'market-access-blocked': '市场权限受限',
  'market-access-unverified': '市场权限未验证',
  'quote-missing': '缺少待买卡报价',
  'quote-stale': '待买卡报价已过期',
  'quote-invalid': '待买卡报价无效',
  'quote-platform-mismatch': '报价平台不匹配',
  'market-search-limit': '市场搜索量超过上限',
  'refresh-quotes-before-approval': '批准前需刷新报价',
  'invalid-purchase-row': '采购行缺少版本或价格',
  'duplicate-purchase-id': '采购项 ID 重复',
  'budget-exceeded': '预演预算超过上限',
  'automation-exposure-nonzero': '存在自动化暴露',
  'purchase-count-limit': '购买数量超过上限',
  'market-search-exposure-limit': '市场搜索尝试超过上限',
  'submit-count-limit': '提交数量超过上限',
  'transaction-readback-unknown': '交易读回仍未知',
  'execution-dry-run-blocked': '执行预演阻塞批准',
  'risk-preflight-blocked': '风险预检阻塞批准',
  'approval-window-invalid': '批准时间窗无效',
  'submit-scope-invalid': '提交范围不属于方案',
  'readiness-not-approvable': 'readiness 尚不可批准',
  'group-identity-unverified': '当前任务组或关卡数量未核实',
  'group-hint-unmatched': '当前任务组与应用数据不一致',
  'challenge-title-unmatched': '有可见关卡未在应用数据中找到',
  'inventory-coverage-incomplete': '俱乐部或 SBC 仓库尚未读全',
  'club-pagination-end-unverified': '俱乐部卡牌还有未核实的后续页',
  'sbc-storage-pagination-end-unverified': 'SBC 仓库还有未核实的后续页',
  'requirements-missing': '关卡要求尚未读取',
  'requirements-incomplete': '有要求尚未识别',
  'chemistry-model-unknown': 'FC27 队伍化学算法尚未验证',
  'chemistry-evaluator-missing': '缺少已验证的队伍化学计算',
  'squad-rating-model-unknown': '队伍评分算法尚未验证',
  'plan-identity-missing': '账号平台或任务组身份尚未核实',
  'challenge-set-empty': '未取得当前任务组的结构化关卡',
  'no-verifiable-candidate': '已有卡中暂无可验证的候选阵容',
  'candidate-search-limit-reached': '候选搜索已达本次上限',
  'search-incomplete': '候选搜索范围尚未覆盖全部已有卡',
  'no-cross-challenge-plan': '多关方案中有卡牌冲突',
  'squad-rating-evaluator-missing': '缺少已验证的队伍评分计算',
  'squad-rating-evaluator-unknown': '队伍评分未能核实',
  'native-chemistry-read-failed': 'FC27 原生化学复核未完成',
  'native-item-missing': '复核时有卡牌已无法读取',
  'formation-unverified': '当前关卡阵型尚未核实',
  'all-challenges-completed': '当前任务组已全部完成',
})[code] ?? code
const sbcFieldStatusLabel = status => ({ covered: '已覆盖', partial: '部分覆盖', missing: '缺样本' })[status] ?? status
const sbcFieldLabel = code => ({
  'page-url': '页面 URL',
  'page-title': '页面标题',
  'capture-time': '采集时间',
  'supported-fc-page': '已识别 FC 页面',
  'task-type': 'SBC 类型',
  'challenge-set-title': '任务组标题',
  'visible-challenge-count': '可见关卡数',
  'stable-challenge-ids': '稳定关卡 ID',
  'requirement-lines': '要求行',
  'reward-lines': '奖励行',
  'market-access-status': '市场权限状态',
  'market-access-evidence': '市场权限证据',
  'inventory-coverage': '完整库存未覆盖',
  'sbc-storage-visibility': 'SBC Storage 可见性',
  'visible-card-count': '可见卡牌数',
  'card-instance-ids': '卡实例 ID',
  'card-ratings': '卡牌评分',
  'purchase-result-readback': '购买结果读回未验证',
  'submission-result-readback': '提交结果读回未验证',
})[code] ?? code
const messageError = error => ({
  offline: '连接已中断，恢复连接后可继续。',
  no_saved_connection: '原连接授权不可恢复，请重新连接 DSH。',
  permission_required: '扩展无权访问 DSH 地址，请检查 Chrome 扩展权限。',
  site_permission_required: '已保存的网站权限不可用，请检查 Chrome 扩展权限。',
  result_unknown: '提交结果尚未确认，请重试原请求，不要重新发送。',
  pending_locked: '上次请求尚未确认，请先确认原请求。',
  session_changed: '会话已变化，请确认后重试。',
  target_changed: '操作目标已变化，请重新选择。',
  capture_target_changed: 'FC 标签已刷新或切换。请停留在当前任务组，重新梳理。',
  page_permission_required: '扩展无法读取当前标签。请切回 EA 页面，从扩展图标打开侧栏后重试。',
  sbc_view_changed: 'SBC 页面在读取期间切换了任务组或关卡，请停留在当前任务组重试。',
  function_view_unavailable: '这个功能当前没有可打开的界面。',
  cognition_location_unavailable: '这个页面节点已经失效，请重新读取页面。',
})[error?.code ?? error?.message ?? error] ?? (error?.message || String(error ?? '操作未完成'))
const notice = text => { const node = byId('notice'); node.hidden = !text; node.textContent = text ?? '' }
const fallback = () => ({ connection: state?.connection ?? { phase: 'unconfigured' }, surface: { id: null },
  session: { binding: state?.session?.binding ?? null, phase: state?.session?.phase ?? 'idle', error: null, pending: state?.session?.pending ?? null, pendingCreate: state?.session?.pendingCreate ?? null, modelSelection: state?.session?.modelSelection ?? null, transcript: [] },
  target: { availability: 'unavailable', revision: null, selected: null, candidates: [], readError: null },
  cognition: { status: 'unread', items: [], refreshPolicy: 'manual-or-agent-request' },
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
    return result
  } catch (error) { notice(messageError(error)); return null }
}
const readState = () => send({ type: 'dsh-assistant-state' })
const selectedName = target => target?.title ?? target?.pageTitle ?? target?.url ?? (Number.isInteger(target?.tabId) ? `标签 ${target.tabId}` : '未固定目标标签')
const sessionName = item => bounded(item?.projections?.values?.title, 160) || bounded(item?.cwd?.split(/[\\/]/u).at(-1), 120) || '未命名对话'
const targetIdentity = target => [target?.tabId, target?.frameId, target?.documentId, target?.url].join('\u0000')
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
  byId('connection-label').textContent = label(connection.phase)
  byId('connection-dot').className = `connection-dot ${connection.phase}`
  const panel = byId('connection-panel'); panel.replaceChildren(); panel.hidden = connection.phase === 'connected'
  if (connection.phase === 'pending') panel.append('等待 DSH 批准此扩展。', button('打开批准页', () => send({ type: 'dsh-assistant-open-approval' }), 'primary'), button('取消连接', () => send({ type: 'dsh-assistant-cancel' })))
  else if (connection.phase !== 'connected') {
    const action = button(connection.phase === 'offline' ? '重试连接' : '连接本机 DSH',
      connection.phase === 'offline' ? retryConnection : connect, 'primary')
    action.disabled = connection.phase === 'connecting'
    panel.append(`${label(connection.phase)}${connection.baseUrl ? ` · ${connection.baseUrl}` : ''}`, action)
    if (connection.phase === 'offline') panel.append(connection.retryPending
      ? '正在有限退避重试。' : '已暂停自动重试；服务页面恢复或重新打开侧栏时检查连接。')
  }
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
  const codex = current.codexConnection ?? { baseUrl: 'http://127.0.0.1:3091', phase: 'unconfigured' }
  const codexPanel = byId('codex-browser-connection'); codexPanel.replaceChildren()
  codexPanel.append(`Codex 网页连接：${label(codex.phase)}${codex.baseUrl ? ` · ${codex.baseUrl}` : ''}`)
  if (['connected', 'unauthorized', 'invalid'].includes(codex.phase)) {
    codexPanel.append(button('断开 Codex', () => send({ type: 'dsh-codex-browser-disconnect' })))
  }
  else {
    const action = button(codex.phase === 'offline' ? '重试 Codex' : '连接 Codex', () => send({ type: 'dsh-codex-browser-connect' }), 'primary')
    action.disabled = codex.phase === 'connecting'
    codexPanel.append(action)
  }
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
  const windowIds = [...new Set(candidates.map(item => item.windowId).filter(Number.isInteger))]
  const multipleWindows = windowIds.length > 1
  for (const item of candidates) {
    let host = ''
    try { host = new URL(item.url).hostname } catch {}
    const windowLabel = multipleWindows && Number.isInteger(item.windowId)
      ? `窗口 ${windowIds.indexOf(item.windowId) + 1} · ` : ''
    const states = [item.active ? multipleWindows ? '该窗口已选中' : '当前' : '',
      item.tabId === fixedTabId ? '已固定' : ''].filter(Boolean)
    const candidate = button(`${windowLabel}${states.length ? `${states.join(' · ')} · ` : ''}${bounded(item.title, 120) || host || `标签 ${item.tabId}`}${host ? ` · ${host}` : ''}`, async () => {
      const bound = await send({ type: 'dsh-assistant-target-bind', expectedRevision, tabId: item.tabId })
      if (bound) closeTargetDialog()
    })
    candidate.title = `${item.title ?? ''}\n${item.url ?? ''}`.trim()
    if (item.active && !multipleWindows) { candidate.classList.add('current-target'); candidate.setAttribute('aria-current', 'page') }
    if (item.tabId === fixedTabId) { candidate.classList.add('fixed-target'); candidate.setAttribute('aria-pressed', 'true') }
    panel.append(candidate)
  }
  if (!panel.childElementCount) panel.textContent = '没有可操作的网页标签。'
}
const renderTarget = () => {
  const current = viewState(); const target = current.target ?? {}; const panel = byId('target-panel'); panel.replaceChildren()
  const heading = document.createElement('strong'); heading.textContent = target.selected ? `已固定到此对话 · ${selectedName(target.selected)}` : '未固定操作标签'
  const connected = current.connection?.phase === 'connected'; const bound = Boolean(current.session?.binding)
  if (bound) heading.title = `对话 ${current.session.binding.sessionId}`
  const multipleWindows = new Set((target.candidates ?? []).map(item => item.windowId).filter(Number.isInteger)).size > 1
  const targetReady = target.availability === 'ready' && Number.isSafeInteger(target.revision)
  const hint = document.createElement('small'); hint.textContent = !connected ? '请先连接 DSH，再选择网页。'
    : !bound ? '按需选择网页；显式固定时会先新建对话。'
      : !targetReady ? `目标服务暂不可用，请稍后重试或重新连接。${target.readError?.message ? ` ${bounded(target.readError.message, 180)}` : ''}`
        : target.bindingState === 'other-installation' ? '原目标属于另一个浏览器，请重新固定。'
          : target.selected?.status === 'closed' ? '原网页已关闭，请重新选择。'
          : target.selected?.status === 'navigated' ? '网页已跳转，旧节点引用已失效。'
            : target.selected ? `仅此对话 ${current.session.binding.sessionId.slice(-8)} 可用；切换对话需重新固定。` : '选择网页本身不会读取正文。'
  const actions = document.createElement('div'); actions.className = 'target-actions'
  if (!bound) {
    const fixCurrent = button(multipleWindows ? '固定最近聚焦页' : '固定当前标签', createAndBindCurrent, 'primary')
    fixCurrent.disabled = !connected; if (fixCurrent.disabled) fixCurrent.title = hint.textContent
    actions.append(fixCurrent)
  }
  if (bound && !multipleWindows) {
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
  const selected = (await send({ type: 'dsh-assistant-target-current' }))?.value
  if (!selected || viewState().session?.binding) return notice('当前标签或对话已变化，请重新点击固定。')
  const created = await send({ type: 'dsh-assistant-session-create' })
  const createdBinding = created?.state?.assistantV2?.session?.binding
  const current = viewState()
  if (!createdBinding?.sessionId || current.session?.binding?.sessionId !== createdBinding.sessionId
    || !Number.isSafeInteger(current.target?.revision)) return notice('新对话尚未就绪，请稍后重试固定。')
  await send({ type: 'dsh-assistant-target-bind', expectedRevision: current.target.revision,
    tabId: selected.tabId, expectedPage: selected })
}
const bindCurrentTarget = async () => {
  const current = viewState()
  if (!current.session?.binding || !Number.isSafeInteger(current.target?.revision)) return notice('当前对话或目标尚未就绪。')
  const selected = (await send({ type: 'dsh-assistant-target-current' }))?.value
  if (!selected || viewState().session?.binding?.sessionId !== current.session.binding.sessionId
    || viewState().target?.revision !== current.target.revision) return notice('当前标签或对话已变化，请重新选择。')
  await send({ type: 'dsh-assistant-target-bind', expectedRevision: current.target.revision,
    tabId: selected.tabId, expectedPage: selected })
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
  const cognitionItems = current.cognition?.items ?? []; const assignedReceipts = new Set(); let previousAssistantSeq = -1
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
  byId('cognition-count').textContent = String(cognitionItems.length)
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
const nodeTitle = node => ({ tag: bounded(node.tag, 64) || node.kind, label: bounded(node.label || node.text || node.role, 256) || '无公开文字' })
const renderCognitionTree = (item, card) => {
  const nodes = item.tree?.nodes ?? []; const byIndex = new Map(nodes.map(node => [node.index, node])); const children = new Map()
  for (const node of nodes) { const parent = byIndex.has(node.parentIndex) ? node.parentIndex : null; const siblings = children.get(parent) ?? []; siblings.push(node); children.set(parent, siblings) }
  const select = node => { selectedCognitionId = item.id; selectedNodeIndex = node.index; renderCognition() }
  const branch = (node, depth) => {
    const nested = children.get(node.index) ?? []; const title = nodeTitle(node)
    if (!nested.length) { const leaf = button('', () => select(node), 'tree-node'); leaf.setAttribute('aria-current', String(selectedCognitionId === item.id && selectedNodeIndex === node.index)); const tag = document.createElement('code'); tag.textContent = title.tag; const label = document.createElement('span'); label.textContent = title.label; leaf.append(tag, label); return leaf }
    const details = document.createElement('details'); details.open = depth < 2 || selectedCognitionId === item.id && (selectedNodeIndex === node.index || nested.some(child => child.index === selectedNodeIndex))
    const summary = document.createElement('summary'); summary.className = 'tree-node'; summary.setAttribute('aria-current', String(selectedCognitionId === item.id && selectedNodeIndex === node.index)); const tag = document.createElement('code'); tag.textContent = title.tag; const label = document.createElement('span'); label.textContent = title.label; const inspect = button('详情', () => select(node), 'tree-detail'); inspect.addEventListener('click', event => event.stopPropagation()); summary.append(tag, label, inspect)
    const group = document.createElement('div'); group.className = 'tree-children'; for (const child of nested) group.append(branch(child, depth + 1)); details.append(summary, group); return details
  }
  const tree = document.createElement('div'); tree.className = 'cognition-tree'; for (const root of children.get(null) ?? []) tree.append(branch(root, 0)); card.append(tree)
  const selected = selectedCognitionId === item.id ? nodes.find(node => node.index === selectedNodeIndex) : null
  if (selected) { const nodeDetail = document.createElement('div'); nodeDetail.className = 'node-detail'; const title = nodeTitle(selected); nodeDetail.append(`${selected.kind}${selected.tag ? ` · ${selected.tag}` : ''}${selected.role ? ` · ${selected.role}` : ''}`, title.label); if (item.locatorsValid && selected.snapshotId && selected.elementId) nodeDetail.append(button('在页面中显示', () => send({ type: 'dsh-assistant-cognition-reveal-node', itemId: item.id, nodeIndex: selected.index }), 'primary')); card.append(nodeDetail) }
}
const renderCognition = () => {
  const current = viewState(); const cognition = current.cognition ?? {}; const panel = byId('cognition-content'); panel.replaceChildren()
  const refresh = byId('refresh-cognition'); const canRefresh = current.connection?.phase === 'connected' && Boolean(current.session?.binding) && current.target?.availability === 'ready' && Boolean(current.target?.selected) && !locked(current.session?.pending) && !current.session?.pendingCreate
  refresh.disabled = !canRefresh; refresh.title = canRefresh ? '让 Agent 对当前操作网页做一次新的有界读取' : '请先连接、选择对话并选择网页'
  if (!cognition.items?.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = cognition.status === 'unread' ? '还没有已送达 Agent 的页面认知。选择网页本身不会读取页面。' : '页面认知暂不可用。'; panel.append(empty); return }
  for (const item of cognition.items) {
    const card = document.createElement('article'); card.className = 'cognition-item'; const page = item.target?.page; const previous = item.documentState === 'previous-document'
    const title = document.createElement('strong'); title.textContent = `${previous ? '先前页面 · ' : ''}${page?.url ?? '已送达页面认知'}`
    const labels = item.preview?.labels?.length ? `可见控件：${item.preview.labels.join('、')}` : ''; const regions = item.preview?.regions?.flatMap(region => region.label || region.role ? [region.label ?? region.role] : []).join('、')
    const detail = document.createElement('p'); detail.textContent = item.preview?.text || labels || (regions ? `页面区域：${regions}` : '已记录读取事实，但没有可展示文字。')
    const scope = item.scope ?? {}; const omitted = Object.values(item.omissions ?? {}).some(value => value === true || value !== null && typeof value !== 'boolean')
    const meta = document.createElement('small'); meta.className = 'cognition-meta'; meta.textContent = [item.readMode, `正文 ${scope.textChars ?? 0} 字`, `控件 ${scope.elementCount ?? 0} 个`, `DOM ${scope.treeNodeCount ?? 0} 节点`, `区域 ${scope.regionCount ?? 0} 个`, omitted ? '有截断或后续页' : '未报告截断', previous ? '旧页面' : '当前页面'].join(' · ')
    card.append(title, detail, meta)
    if (item.locatorsValid) card.append(button('定位标签', () => send({ type: 'dsh-assistant-cognition-locate', itemId: item.id })))
    if (item.tree?.nodes?.length) renderCognitionTree(item, card)
    const unread = [item.omissions?.textTruncated && '正文超出本次读取范围', item.omissions?.scanTruncated && '其余可操作控件', item.omissions?.treeTruncated && '其余 DOM 节点', item.omissions?.nextOffset !== null && item.omissions?.nextOffset !== undefined && '后续正文分页', previous && '该页面后续状态'].filter(Boolean)
    if (unread.length) { const section = document.createElement('section'); section.className = 'cognition-unread'; const heading = document.createElement('strong'); heading.textContent = '尚未读取'; const copy = document.createElement('p'); copy.textContent = unread.join('、'); section.append(heading, copy); card.append(section) }
    panel.append(card)
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

const issueList = (title, items) => {
  const section = document.createElement('section'); section.className = 'sbc-issues'
  const heading = document.createElement('strong'); heading.textContent = title
  const list = document.createElement('ul')
  for (const item of items) { const row = document.createElement('li'); row.textContent = sbcIssueLabel(item.code); list.append(row) }
  section.append(heading, list)
  return section
}
const fieldAuditSection = (report, comb) => {
  const coverage = report.summary?.fieldCoverage ?? comb?.summary?.fieldCoverage
  const rawGaps = Array.isArray(report.fieldAudit?.gaps)
    ? report.fieldAudit.gaps.map(gap => ({ code: gap.code, status: gap.status }))
    : (comb?.fieldGaps ?? []).map(gap => ({ label: gap }))
  if (!coverage && !rawGaps.length) return null
  const section = document.createElement('section'); section.className = 'sbc-field-audit'
  const heading = document.createElement('strong'); heading.textContent = '字段覆盖'
  section.append(heading)
  if (coverage) {
    const summary = document.createElement('p'); summary.className = 'scope-note'
    summary.textContent = `已覆盖 ${coverage.covered ?? 0} · 部分 ${coverage.partial ?? 0} · 缺样本 ${coverage.missing ?? 0}`
    section.append(summary)
  }
  if (rawGaps.length) {
    const list = document.createElement('ul')
    for (const gap of rawGaps.slice(0, 12)) {
      const row = document.createElement('li')
      row.textContent = gap.label ?? `${sbcFieldLabel(gap.code)}：${sbcFieldStatusLabel(gap.status)}`
      list.append(row)
    }
    section.append(list)
  }
  return section
}
const executionDryRunSection = report => {
  const dryRun = report.executionDryRun
  if (!dryRun) return null
  const section = document.createElement('section'); section.className = 'sbc-dry-run'
  const heading = document.createElement('strong'); heading.textContent = '执行预演'
  const summary = dryRun.summary ?? {}
  const detail = document.createElement('p'); detail.className = 'scope-note'
  detail.textContent = `${sbcDryRunStatusLabel(dryRun.status)} · 购买 ${summary.purchaseCount ?? 0} · 预留 ${summary.reservedIfStarted ?? 0}/${summary.maxSpend ?? 0} · 提交 ${summary.submitCount ?? 0} · 每卡搜索 ${summary.maxSearchesPerPurchase ?? 0}`
  const safety = document.createElement('p'); safety.className = 'scope-note'
  safety.textContent = dryRun.sideEffects?.browserWrites === false && dryRun.sideEffects?.purchases === false
    && dryRun.sideEffects?.squadFill === false && dryRun.sideEffects?.submits === false
    ? '无副作用：不写浏览器、不购买、不填阵、不提交。'
    : '副作用边界未知，不能执行。'
  section.append(heading, detail, safety)
  if (dryRun.issues?.length) {
    const list = document.createElement('ul')
    for (const item of dryRun.issues.slice(0, 8)) {
      const row = document.createElement('li')
      row.textContent = sbcIssueLabel(item.code)
      list.append(row)
    }
    section.append(list)
  }
  return section
}
const riskPreflightSection = report => {
  const risk = report.riskPreflight
  if (!risk) return null
  const section = document.createElement('section'); section.className = 'sbc-risk-preflight'
  const heading = document.createElement('strong'); heading.textContent = '风险预检'
  const summary = risk.summary ?? {}
  const detail = document.createElement('p'); detail.className = 'scope-note'
  detail.textContent = `${sbcRiskStatusLabel(risk.status)} · 购买 ${summary.purchaseCount ?? 0} · 搜索 ${summary.plannedSearches ?? 0}/${summary.maxTotalSearches ?? 0} · 提交 ${summary.submitCount ?? 0}`
  const disclaimer = document.createElement('p'); disclaimer.className = 'scope-note'
  disclaimer.textContent = risk.disclaimer ?? '该预检只统计拟执行的市场搜索、购买和提交；未统计页面读取或内部服务调用风险，不能证明不会封禁。'
  section.append(heading, detail, disclaimer)
  if (risk.issues?.length) {
    const list = document.createElement('ul')
    for (const item of risk.issues.slice(0, 8)) {
      const row = document.createElement('li')
      row.textContent = sbcIssueLabel(item.code)
      list.append(row)
    }
    section.append(list)
  }
  return section
}
const approvalPreviewSection = report => {
  const preview = report.approvalPreview
  if (!preview) return null
  const section = document.createElement('section'); section.className = 'sbc-approval-preview'
  const heading = document.createElement('strong'); heading.textContent = '批准预览'
  const summary = preview.summary ?? {}
  const detail = document.createElement('p'); detail.className = 'scope-note'
  detail.textContent = `${sbcApprovalPreviewStatusLabel(preview.status)} · 预算 ${summary.maxSpend ?? 0} · 预留 ${summary.reservedIfStarted ?? 0} · 购买 ${summary.purchaseCount ?? 0} · 提交 ${summary.submitCount ?? 0}`
  const window = preview.approvalWindow ?? {}
  const timing = document.createElement('p'); timing.className = 'scope-note'
  timing.textContent = `启动 ${Math.round((window.startWithinMs ?? 0) / 60000)} 分钟内 · 过期 ${Math.round((window.expiresInMs ?? 0) / 60000)} 分钟内`
  const digest = document.createElement('p'); digest.className = 'scope-note'
  digest.textContent = preview.reviewDigest ? `摘要 ${preview.reviewDigest}` : ''
  const notice = document.createElement('p'); notice.className = 'scope-note'
  notice.textContent = preview.notice ?? '只生成批准预览；不会购买、填阵或提交。'
  section.append(heading, detail, timing)
  if (preview.reviewDigest) section.append(digest)
  section.append(notice)
  if (preview.issues?.length) {
    const list = document.createElement('ul')
    for (const item of preview.issues.slice(0, 8)) {
      const row = document.createElement('li')
      row.textContent = sbcIssueLabel(item.code)
      list.append(row)
    }
    section.append(list)
  }
  return section
}
const renderFcSbc = () => {
  const current = viewState(); const selected = current.target?.selected; const content = byId('fc-sbc-content'); content.replaceChildren()
  const fixedPage = current.target?.availability === 'ready' && Number.isInteger(selected?.tabId)
    && typeof selected?.documentId === 'string' && typeof selected?.url === 'string'
  const scan = byId('scan-fc-sbc')
  scan.disabled = fcSbcScan.phase === 'scanning'
  scan.title = fixedPage ? '只读梳理已固定的 FC 页面' : '只读梳理当前活动的 FC 标签页'
  if (fcSbcScan.phase === 'idle') {
    const empty = document.createElement('div'); empty.className = 'empty'
    empty.textContent = fixedPage ? '已固定页面尚未梳理。' : '切到 FC 页面后，可直接梳理当前标签。'
    content.append(empty); return
  }
  if (fcSbcScan.phase === 'scanning') {
    const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '正在梳理当前页面。'
    content.append(empty); return
  }
  if (fcSbcScan.phase === 'error') {
    const error = document.createElement('div'); error.className = 'empty error-state'
    error.textContent = fcSbcScan.error === 'target-changed' ? '目标页已变化，请重新梳理。' : '梳理未完成。'
    content.append(error); return
  }
  const probe = fcSbcScan.probe ?? {}; const report = fcSbcScan.report ?? {}; const summary = report.summary ?? {}
  const card = document.createElement('article'); card.className = 'sbc-report'
  const title = document.createElement('strong'); title.textContent = probe.challengeSet?.title ?? probe.title ?? 'FC SBC'
  const status = document.createElement('span'); status.className = `status-pill ${report.canApproveExecution ? 'running' : ''}`
  status.textContent = sbcStatusLabel(report.status)
  const meta = document.createElement('small'); meta.className = 'scope-note'
  meta.textContent = bounded(fcSbcScan.page?.url ?? probe.url, 300)
  const metrics = document.createElement('dl'); metrics.className = 'sbc-metrics'
  const addMetric = (name, value) => {
    const term = document.createElement('dt'); term.textContent = name
    const detail = document.createElement('dd'); detail.textContent = value
    metrics.append(term, detail)
  }
  addMetric('任务', sbcTaskLabel(summary.taskType))
  addMetric('读取方式', fcSbcScan.readMode === 'full-read' ? '应用数据' : '仅当前页面可见内容')
  addMetric('页面', sbcViewLabel(fcSbcScan.model?.view?.kind))
  if (fcSbcScan.model?.group) addMetric('详情', `已读取关卡详情 ${fcSbcScan.model.group.observedDetailCount}/${fcSbcScan.model.group.visibleChallengeCount}（仅可见关卡）`)
  addMetric('市场', sbcMarketLabel(summary.marketAccess))
  addMetric('库存', sbcInventoryLabel(summary.inventoryCoverage))
  addMetric('关卡', String(summary.visibleChallengeCount ?? 0))
  addMetric('方案', String(summary.variantCount ?? 0))
  if (fcSbcScan.staleBinding) addMetric('DSH 固定目标', '旧文档已失效，发送前请重新固定')
  if (fcSbcScan.slice) {
    const slice = fcSbcScan.slice
    addMetric('应用关卡', `${slice.groupSummary.challengeCount}/${summary.visibleChallengeCount ?? 0}`)
    addMetric('已读卡牌', String(slice.inventorySummary.cardCount))
    addMetric('求解', slice.puzzle.status === 'ready' ? '已生成可验证方案' : '缺少验证依据')
    if (slice.searchLimited) addMetric('候选搜索', '有限范围，尚未证明最优')
    const provisionalCount = slice.puzzle.provisionalByChallenge?.reduce((sum, row) => sum + row.candidateCount, 0) ?? 0
    if (provisionalCount) addMetric('待核验候选', String(provisionalCount))
  }
  card.append(title, status, meta, metrics)
  if (fcSbcScan.slice?.issues?.length) card.append(issueList('本次纵切缺口', fcSbcScan.slice.issues.slice(0, 12)))
  const fields = fieldAuditSection(report, fcSbcScan.comb)
  if (fields) card.append(fields)
  const dryRun = executionDryRunSection(report)
  if (dryRun) card.append(dryRun)
  const risk = riskPreflightSection(report)
  if (risk) card.append(risk)
  const approvalPreview = approvalPreviewSection(report)
  if (approvalPreview) card.append(approvalPreview)
  if (report.blockers?.length) card.append(issueList('阻塞项', report.blockers))
  if (report.deferred?.length) card.append(issueList('后续缺口', report.deferred))
  if (report.warnings?.length) {
    const warnings = document.createElement('p'); warnings.className = 'scope-note'
    warnings.textContent = `页面警告：${report.warnings.map(sbcIssueLabel).join('、')}`
    card.append(warnings)
  }
  if (fcSbcScan.comb) {
    const handoff = document.createElement('details'); handoff.className = 'sbc-handoff'
    const heading = document.createElement('summary'); heading.textContent = '交接摘要'
    const body = document.createElement('pre'); body.textContent = formatSbcCombReport(fcSbcScan.comb)
    const actions = document.createElement('div'); actions.className = 'function-actions'
    const sendReport = button('发送给对话', sendFcSbcComb, 'primary')
    const sendSample = button('发送样本包', sendFcSbcSample)
    sendReport.disabled = !current.session?.binding || current.connection?.phase !== 'connected'
      || locked(current.session?.pending) || Boolean(current.session?.pendingCreate) || fcSbcScan.staleBinding
    sendSample.disabled = sendReport.disabled || !fcSbcScan.sample
    actions.append(sendReport, sendSample)
    handoff.append(heading, body, actions)
    card.append(handoff)
  }
  content.append(card)
}

const renderRecent = () => renderSessionList(byId('recent-list'), recentSessions.slice(0, 3))
const normalizeSessions = value => (Array.isArray(value?.items) ? value.items : []).filter(item => typeof item?.sessionId === 'string' && item.sessionId).slice(0, 50)
const renderSessionList = (container, items, after = () => {}) => {
  container.replaceChildren()
  for (const item of items) {
    const row = button('', async () => { const result = await send({ type: 'dsh-assistant-session-bind', sessionId: item.sessionId }); if (result) after() })
    row.title = `对话 ${item.sessionId}`
    const title = document.createElement('span'); title.textContent = sessionName(item)
    const action = document.createElement('small'); action.textContent = item.sessionId.slice(-8)
    row.append(title, action); container.append(row)
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
const render = () => {
  const current = viewState(); const connection = current.connection ?? {}; const session = current.session ?? {}; const blocked = locked(session.pending) || Boolean(session.pendingCreate)
  renderConnection(); renderSettings(); renderTarget(); renderConversation(); renderPending(); renderApprovals(); renderCognition(); renderFunctions(); renderFcSbc(); renderRecent(); renderModelPicker()
  for (const name of ['chat', 'cognition', 'functions', 'fc-sbc']) { byId(`${name}-panel`).hidden = activeView !== name; for (const node of document.querySelectorAll(`[data-view="${name}"]`)) node.setAttribute('aria-selected', String(activeView === name)) }
  byId('composer-wrap').hidden = activeView !== 'chat'
  const offline = connection.phase !== 'connected' || session.phase === 'foreign'
  byId('composer').disabled = blocked; byId('send-queue').disabled = blocked || offline || submitting; byId('send-steer').disabled = blocked || offline || submitting; byId('stop-session').disabled = offline || !session.binding; byId('new-session').disabled = offline || blocked; byId('session-picker').disabled = offline || blocked
  const status = session.phase === 'foreign' ? '当前对话属于另一台 DSH，请恢复原连接。' : offline ? '请先连接 DSH，草稿会留在输入框中。' : session.pendingCreate ? '正在确认新对话。' : locked(session.pending) ? '上次提交尚未确认。' : session.error?.message ? `对话读取失败：${bounded(session.error.message, 300)}` : !session.binding ? '选择“新对话”或继续已有对话后即可发送。' : ''
  byId('send-status').textContent = status; byId('send-status').hidden = !status
}

const connect = async () => { try { if (!await chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] })) return notice('未授予所有网站访问权限'); await send({ type: 'dsh-assistant-connect', scopes: ['session:interact', 'browser:read', 'browser:write', 'browser:observe'], origins: ['*'] }) } catch (error) { notice(messageError(error)) } }
const retryConnection = () => send({ type: 'dsh-assistant-retry' })
const configure = async () => { const baseUrl = byId('base-url').value.trim() || DEFAULT_BASE_URL; try { if (!['http:', 'https:'].includes(new URL(baseUrl).protocol)) throw new Error('invalid_url') } catch { return notice('请输入有效的 HTTP(S) 地址') }; editingUrl = false; if (await send({ type: 'dsh-assistant-configure', baseUrl })) await connect() }
const openSessionMenu = async menuId => { const menu = byId(menuId); menu.hidden = false; const result = await send({ type: 'dsh-assistant-session-list' }); renderSessionList(menu, normalizeSessions(result?.value), () => { menu.hidden = true }) }
const scanFcSbc = async () => {
  const current = viewState(); const selected = current.target?.selected
  const fixedPage = current.target?.availability === 'ready' && Number.isInteger(selected?.tabId)
    && typeof selected?.documentId === 'string' && typeof selected?.url === 'string'
  const request = fcSbcScan.request + 1
  fcSbcScan = { phase: 'scanning', request, page: fixedPage ? structuredClone(selected) : null, probe: null,
    model: fcSbcScan.model, slice: null, readMode: null, report: null, comb: null, sample: null, staleBinding: false, error: null }
  renderFcSbc()
  const probed = await send({ type: 'dsh-assistant-fc-sbc-slice', mode: 'page-only',
    ...(fixedPage ? { tabId: selected.tabId, expectedPage: selected } : {}) })
  if (request !== fcSbcScan.request) return
  if (!probed?.value?.probe) { fcSbcScan = { ...fcSbcScan, phase: 'error', error: 'probe-failed' }; renderFcSbc(); return }
  const latestTarget = viewState().target?.selected
  if (fixedPage && targetIdentity(latestTarget) !== targetIdentity(selected)) {
    fcSbcScan = { ...fcSbcScan, phase: 'error', error: 'target-changed' }; renderFcSbc(); return
  }
  const staleBinding = fixedPage && targetIdentity(probed.value.page) !== targetIdentity(selected)
  const main = probed.value.readMode === 'full-read' ? probed.value.main : null
  const verificationRequest = createFcSbcVerificationRequest({ probe: probed.value.probe, main })
  let verification = null
  if (verificationRequest.status === 'ready' && verificationRequest.groups.length) {
    const captured = probed.value.probe
    const checked = await send({ type: 'dsh-assistant-fc-sbc-evaluate-chemistry', tabId: probed.value.page.tabId,
      expectedPage: probed.value.page, groups: verificationRequest.groups,
      expectedView: { kind: captured.view?.kind, title: captured.challengeSet?.title,
        challenges: captured.challengeSet?.challenges?.map(challenge => ({ title: challenge.title, completed: challenge.completed })) ?? [] } })
    if (request !== fcSbcScan.request) return
    if (fixedPage && targetIdentity(viewState().target?.selected) !== targetIdentity(selected)) {
      fcSbcScan = { ...fcSbcScan, phase: 'error', error: 'target-changed' }; renderFcSbc(); return
    }
    verification = checked?.value?.verification ?? { url: probed.value.page.url, status: 'unknown', results: [],
      issues: [{ code: 'native-chemistry-read-failed' }] }
  }
  const slice = createFcSbcSliceReport({ probe: probed.value.probe, main,
    verificationRequest, verification })
  const report = probed.value.report ?? slice.report
  const model = updateFcSbcPageModel(fcSbcScan.model, { page: probed.value.page, probe: probed.value.probe })
  const comb = createSbcCombReport({ page: probed.value.page, probe: probed.value.probe, readiness: report })
  const sample = createSbcRedactedSample({ page: probed.value.page, probe: probed.value.probe,
    pageModel: model, readiness: report, comb })
  fcSbcScan = { phase: 'ready', request, page: probed.value.page, probe: probed.value.probe, model,
    slice, readMode: probed.value.readMode ?? 'page-only', report, comb, sample, staleBinding, error: null }
  renderFcSbc()
}
const sendFcSbcComb = async () => {
  const current = viewState()
  if (!fcSbcScan.comb || !current.session?.binding) return notice('请先梳理当前 SBC。')
  if (fcSbcScan.staleBinding) return notice('固定目标已过期，请重新固定当前页后发送。')
  await send({ type: 'dsh-assistant-session-submit',
    text: formatSbcCombReport(fcSbcScan.comb),
    mode: 'queue',
    expectedSessionId: current.session.binding.sessionId,
    ...(Number.isSafeInteger(current.target?.revision) ? { expectedTargetRevision: current.target.revision } : {}) })
}
const sendFcSbcSample = async () => {
  const current = viewState()
  if (!fcSbcScan.sample || !current.session?.binding) return notice('请先梳理当前 SBC。')
  if (fcSbcScan.staleBinding) return notice('固定目标已过期，请重新固定当前页后发送。')
  await send({ type: 'dsh-assistant-session-submit',
    text: formatSbcRedactedSample(fcSbcScan.sample),
    mode: 'queue',
    expectedSessionId: current.session.binding.sessionId,
    ...(Number.isSafeInteger(current.target?.revision) ? { expectedTargetRevision: current.target.revision } : {}) })
}
const submit = async (mode = 'queue') => { const text = byId('composer').value.trim(); const current = viewState(); if ((!text && !draftImages.length) || submitting || locked(current.session?.pending) || current.session?.pendingCreate) return; if (current.connection?.phase !== 'connected' || current.session?.phase === 'foreign') return render(); const submittedDraftKey = activeDraftKey; submitting = true; render(); try { const result = await send({ type: 'dsh-assistant-session-submit', text, mode, expectedSessionId: current.session?.binding?.sessionId ?? null, ...(Number.isSafeInteger(current.target?.revision) ? { expectedTargetRevision: current.target.revision } : {}), ...(draftImages.length ? { images: structuredClone(draftImages) } : {}) }); if (result) { const command = result.value?.command?.result; if (command) notice(command.text || (command.kind === 'success' ? '命令已完成。' : '命令未完成。')); drafts.delete(submittedDraftKey); if (activeDraftKey === submittedDraftKey) { byId('composer').value = ''; draftImages = []; renderDraftImages() } } } finally { submitting = false; render() } }
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
byId('scan-fc-sbc').addEventListener('click', () => { void scanFcSbc() })
byId('create-function').addEventListener('click', () => {
  activeView = 'chat'
  render()
  byId('composer').value = `帮我创建一个${functionScope === 'page' ? '当前目标页面' : '全局'}功能：`
  byId('composer').focus()
})
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
chrome.runtime.onMessage.addListener(message => { if (message?.type === 'dsh-state-changed') void readState(); if (message?.type === 'dsh-assistant-error') notice(message.error) })

let presencePort; let presenceRetry; let presenceFailures = 0; let closingView = false
const presenceRecoveryNotice = '扩展后台连接正在恢复。'
const invalidatedExtensionContext = error => /Extension context invalidated/iu.test(String(error?.message ?? error ?? ''))
const stopInvalidatedView = () => {
  closingView = true
  clearTimeout(presenceRetry)
  presenceRetry = undefined
  notice('扩展已更新，请重新打开侧栏。')
}
const publishPresence = () => {
  try { presencePort?.postMessage({ type: 'presence', visible: document.visibilityState === 'visible', surfaceId }) }
  catch (error) { if (invalidatedExtensionContext(error)) stopInvalidatedView() }
}
const retryView = () => {
  if (closingView || presenceRetry) return
  const delay = Math.min(1000 * 2 ** presenceFailures, 30_000)
  presenceFailures = Math.min(presenceFailures + 1, 5)
  if (presenceFailures === 5) notice(presenceRecoveryNotice)
  presenceRetry = setTimeout(() => { presenceRetry = undefined; connectView() }, delay)
}
const connectView = () => {
  if (closingView || typeof chrome.runtime.connect !== 'function') return
  try {
    const port = chrome.runtime.connect({ name: 'dsh-assistant-view' })
    const connectedAt = Date.now()
    presencePort = port
    port.onMessage.addListener(message => {
      if (presencePort !== port || message?.type !== 'presence-ready') return
      presenceFailures = 0
      if (byId('notice').textContent === presenceRecoveryNotice) notice(null)
    })
    port.onDisconnect.addListener(() => {
      if (presencePort !== port) return
      presencePort = undefined
      if (Date.now() - connectedAt >= 30_000) presenceFailures = 0
      retryView()
    })
    publishPresence()
  } catch (error) { if (invalidatedExtensionContext(error)) stopInvalidatedView(); else retryView() }
}
document.addEventListener('visibilitychange', publishPresence)
window.addEventListener('online', () => { void send({ type: 'dsh-assistant-recover' }) })
window.addEventListener('pagehide', () => { closingView = true; clearTimeout(presenceRetry); presencePort?.disconnect(); presencePort = undefined })
render(); connectView(); void readState()
