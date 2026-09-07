import { renderMarkdown } from './preview.js'

const DEFAULT_BASE_URL = 'http://127.0.0.1:3080'
const element = id => document.getElementById(id)
const view = {
  notice: element('notice'), empty: element('empty'), capture: element('capture'), settings: element('settings'), footer: element('footer'),
  connection: element('connection-status'), pageTitle: element('page-title'), emptyHint: element('empty-hint'), captureSelection: element('capture-selection'), chooseReply: element('choose-reply'),
  source: element('source-label'), title: element('title'), editTitle: element('edit-title'), destination: element('capture-destination'), markdown: element('markdown'), enableSite: element('enable-site'),
  baseUrl: element('base-url'), settingsPhase: element('settings-phase'), settingsCurrentUrl: element('settings-current-url'),
}

let state = null
let showingSettings = false
let notice = null
let editingBaseUrl = false
let readGeneration = 0

const phaseLabel = phase => ({ configured: '尚未连接', pending: '等待 DSH 批准', connected: '已连接', offline: 'DSH 暂不可用', unauthorized: '需要重新授权' })[phase] ?? '尚未配置'
const sourceLabel = source => ({ 'chatgpt.com': 'ChatGPT', 'www.zhihu.com': '知乎', generic: '网页' })[source?.site] ?? source?.site ?? '网页'
const actionError = error => ({ authorization_required: '请先在 DSH 批准此扩展', permission_required: '未授予目标服务的访问权限', target_changed: '待保存内容属于另一台 DSH，不能迁移发送', pending_exists: '已有一份待保存内容', pending_unconfirmed: '上次保存结果尚未确认，请先重试原请求', result_unknown: '上次保存结果尚未确认', capture_changed: '这份内容已被更新，请检查后重试', capture_frozen: '已经开始保存的内容不能再修改标题', connection_expired: '连接请求已过期，请重新连接', unauthorized: '授权已失效，请重新连接', offline: 'DSH 暂不可用，请稍后重试', network_error: '网络不可用，请稍后重试', request_timeout: '请求超时，请重试原保存操作', busy: '正在处理另一项保存，请稍后再试', capture_too_large: '采集内容超过 1 MiB，请缩小选区' })[error?.message] ?? (error?.message || String(error || '操作未完成'))
const currentCapture = () => state?.capture ?? null
const isDraft = capture => capture?.status === 'draft' && capture.attempted === false

const setNotice = (text, kind = '') => {
  notice = text ? { text, kind } : null
  view.notice.hidden = !notice
  view.notice.textContent = notice?.text ?? ''
  view.notice.className = `notice ${notice?.kind ?? ''}`
}

const send = async message => {
  try {
    const result = await chrome.runtime.sendMessage(message)
    if (result?.state) applyState(result.state)
    if (!result?.ok) throw new Error(result?.error || '操作未完成')
    if (!result?.state) await readState()
    return result
  } catch (error) {
    setNotice(actionError(error), 'error')
    return null
  }
}

const readState = async () => {
  const generation = ++readGeneration
  try {
    const result = await chrome.runtime.sendMessage({ type: 'dsh-ui-state' })
    if (!result?.ok) throw new Error(result?.error || '无法读取扩展状态')
    if (generation === readGeneration) applyState(result.state)
  } catch (error) {
    setNotice(actionError(error), 'error')
  }
}

const applyState = next => {
  readGeneration += 1
  state = next
  if (next?.capture?.status === 'saved') setNotice(null)
  render()
}

const footer = children => view.footer.replaceChildren(...children)
const button = (label, className, handler, disabled = false) => {
  const node = document.createElement('button')
  node.type = 'button'
  node.className = className
  node.textContent = label
  node.disabled = disabled
  node.addEventListener('click', () => { void handler() })
  return node
}

const renderConnection = connection => {
  const phase = connection?.phase ?? 'configured'
  view.connection.className = `connection-status ${phase === 'connected' ? 'connected' : phase === 'pending' ? 'pending' : ''}`
  view.connection.title = `${phaseLabel(phase)}${connection?.baseUrl ? `：${connection.baseUrl}` : ''}`
  view.connection.textContent = phaseLabel(phase)
  view.settingsPhase.textContent = phaseLabel(phase)
  view.settingsCurrentUrl.textContent = connection?.baseUrl ?? DEFAULT_BASE_URL
  if (!editingBaseUrl) view.baseUrl.value = connection?.baseUrl ?? DEFAULT_BASE_URL
}

const renderEmpty = () => {
  const page = state?.page ?? {}
  view.pageTitle.textContent = page.title || '当前页面'
  view.captureSelection.disabled = page.site === 'unsupported'
  view.emptyHint.textContent = page.site === 'chatgpt'
    ? '在回复下方点“收藏到 DSH”，也可以选择一条回复。'
    : page.site === 'zhihu'
      ? '选中一段文字即可收藏；完整回答需要先展开。'
      : '在网页中选中文字，再右键选择“收藏选区到 DSH”。'
  element('choose-reply').hidden = !['chatgpt', 'zhihu'].includes(page.site)
  view.enableSite.hidden = !(['chatgpt', 'zhihu'].includes(page.site) && !page.quickEnabled)
}

const renderCapture = capture => {
  const scope = capture.source?.kind === 'selection' ? '选区' : capture.source?.site === 'chatgpt.com' ? '一条回复 · 文本' : '一条回答 · 文本'
  view.source.textContent = `${sourceLabel(capture.source)} · ${scope}`
  view.title.value = capture.title || '未命名收藏'
  view.title.readOnly = true
  view.editTitle.hidden = !isDraft(capture)
  const differentTab = capture.sourceTabId !== undefined && capture.sourceTabId !== state?.page?.tabId
  const target = capture.status === 'saved'
    ? '已保存到内容库'
    : `将保存到 ${capture.baseUrl === DEFAULT_BASE_URL ? '本机 DSH' : capture.baseUrl}`
  view.destination.textContent = differentTab ? `来自另一标签页：${capture.source?.pageTitle || capture.source?.url || '原页面'} · ${target}` : target
  renderMarkdown(view.markdown, capture.markdown)
}

const renderFooter = capture => {
  if (showingSettings) {
    const phase = state?.connection?.phase
    const label = phase === 'pending' ? '确认已批准' : '连接此服务'
    footer([button(label, 'primary full', saveAndConnect)])
    return
  }
  if (!capture) {
    footer([])
    return
  }
  if (capture.status === 'saved') {
    footer([button('在 DSH 中打开 ↗', 'primary full', () => send({ type: 'dsh-open-entry', entryId: capture.entryId })), button('继续采集', 'link-button', () => send({ type: 'dsh-discard', captureId: capture.captureId }))])
    return
  }
  if (capture.status === 'saving') {
    footer([button('保存中…', 'primary full', async () => {}, true)])
    return
  }
  const mismatch = state?.connection?.baseUrl && capture.baseUrl && state.connection.baseUrl !== capture.baseUrl
  const reconnect = mismatch || ['offline', 'unauthorized', 'pending'].includes(state?.connection?.phase)
  const label = capture.status === 'unknown' ? '重新确认保存' : reconnect ? '连接并保存' : capture.status === 'failed' ? '重试保存' : '保存到内容库'
  const row = document.createElement('div')
  row.className = 'footer-row'
  const hint = document.createElement('span')
  hint.className = 'micro'
  hint.textContent = capture.status === 'unknown' ? '上次保存结果尚未确认' : capture.status === 'failed' ? '上次保存失败，材料仍在这里' : '保存当前内容'
  row.append(hint, button(label, 'primary', async () => {
    if (mismatch) { showingSettings = true; setNotice('这份材料绑定了另一台 DSH，请恢复原服务后再保存。'); render(); return }
    await send({ type: 'dsh-save', captureId: capture.captureId })
  }))
  const nodes = capture.status === 'failed' ? [row] : [row]
  if (isDraft(capture)) nodes.push(button('丢弃这份草稿', 'link-button', async () => {
    if (window.confirm('丢弃这份尚未保存的内容？')) await send({ type: 'dsh-discard', captureId: capture.captureId })
  }))
  footer(nodes)
}

const render = () => {
  const capture = currentCapture()
  renderConnection(state?.connection)
  view.empty.hidden = showingSettings || Boolean(capture)
  view.capture.hidden = showingSettings || !capture
  view.settings.hidden = !showingSettings
  if (showingSettings) renderConnection(state?.connection)
  else if (capture) renderCapture(capture)
  else renderEmpty()
  renderFooter(capture)
}

const requestCapture = action => send({ type: 'dsh-capture-request', action })

const requestOrigin = async (baseUrl, rootOnly = true) => {
  let origin
  try {
    const value = new URL(baseUrl)
    if (!['http:', 'https:'].includes(value.protocol) || value.username || value.password || (rootOnly && (value.pathname !== '/' || value.search || value.hash))) throw new Error()
    origin = `${value.origin}/*`
  } catch {
    setNotice('请输入 HTTP(S) 服务根地址，例如 http://127.0.0.1:3080', 'error')
    return false
  }
  try {
    // Permission prompt must remain directly in this click's user gesture.
    return await chrome.permissions.request({ origins: [origin] })
  } catch (error) {
    setNotice(actionError(error), 'error')
    return false
  }
}

const saveAndConnect = async () => {
  const baseUrl = view.baseUrl.value.trim() || DEFAULT_BASE_URL
  if (!await requestOrigin(baseUrl)) { setNotice('未授予该 DSH 服务的访问权限', 'error'); return }
  editingBaseUrl = false
  const saved = await send({ type: 'dsh-connection-save', baseUrl })
  if (saved) await send({ type: state?.connection?.phase === 'pending' ? 'dsh-connection-resume' : 'dsh-connection-connect' })
}

const enableCurrentSite = async () => {
  const url = state?.page?.url
  if (!url) return
  if (!await requestOrigin(url, false)) { setNotice('未授予当前网站的访问权限', 'error'); return }
  await send({ type: 'dsh-enable-site' })
}

element('capture-selection').addEventListener('click', () => { void requestCapture('selection') })
element('choose-reply').addEventListener('click', () => { void requestCapture('single-reply') })
element('enable-site').addEventListener('click', () => { void enableCurrentSite() })
element('show-settings').addEventListener('click', () => { showingSettings = true; editingBaseUrl = false; render() })
element('connection-status').addEventListener('click', () => { showingSettings = true; editingBaseUrl = false; render() })
element('hide-settings').addEventListener('click', () => { showingSettings = false; editingBaseUrl = false; setNotice(null); render() })
element('open-source').addEventListener('click', () => { void send({ type: 'dsh-open-source' }) })
element('edit-title').addEventListener('click', () => { if (isDraft(currentCapture())) { view.title.readOnly = false; view.title.focus(); view.title.select() } })
view.title.addEventListener('change', () => {
  const capture = currentCapture()
  if (isDraft(capture)) void send({ type: 'dsh-title', captureId: capture.captureId, title: view.title.value })
})
view.baseUrl.addEventListener('input', () => { editingBaseUrl = true })

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'dsh-state-changed') void readState()
  if (message?.type === 'dsh-capture-error') setNotice(actionError({ message: message.error }), 'error')
})

void (async () => {
  await readState()
  await send({ type: 'dsh-connection-check' })
})()
