import { renderMarkdown } from './preview.js'
import { installReadingModels } from './reading-models.js'
import { installReaderConnection } from './reader-connection.js'

if (window.self !== window.top) document.documentElement.classList.add('embedded')
const el = id => document.getElementById(id)
const send = async message => {
  const result = await chrome.runtime.sendMessage(message)
  if (!result?.ok) throw new Error(result?.error ?? '无法连接 DSH')
  return result
}
const models = installReadingModels({ send })
const connectionUi = installReaderConnection({ send, refresh: () => refresh() })
let selected = null, followed = null, followLatest = true, lastState, fontSize = 20, renderKey = '', pickerKey = ''
let loading = false, queued = false
const safeUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && ['www.zhihu.com', 'zhuanlan.zhihu.com'].includes(url.hostname)
    && !url.username && !url.password ? url.href : null }
  catch { return null }
}
const update = state => {
  const readings = state.readings ?? { items: [] }
  const items = readings.items
  models.update(state)
  connectionUi.update(state)
  if (readings.selectedId !== followed) { followed = readings.selectedId; selected = followed; followLatest = true }
  if (followLatest || !items.some(item => item.id === selected)) selected = readings.selectedId ?? items.at(-1)?.id ?? null
  const choices = JSON.stringify(items.map(item => [item.id, item.title]))
  if (pickerKey !== choices) {
    pickerKey = choices
    el('answer-picker').replaceChildren(...items.map((item, index) => {
      const option = document.createElement('option'); option.value = item.id
      option.textContent = `${index + 1}. ${item.title}`; return option
    }))
  }
  el('answer-picker').value = selected ?? ''
  el('answer-picker').disabled = !items.length
  const item = items.find(row => row.id === selected)
  const nextRender = JSON.stringify([item?.id, item?.text])
  if (renderKey !== nextRender) {
    const switching = el('answer').dataset.answerId !== (item?.id ?? '')
    renderKey = nextRender
    renderMarkdown(el('answer'), item?.text ?? '')
    el('answer').dataset.answerId = item?.id ?? ''
    if (switching) window.scrollTo({ top: 0 })
  }
  el('empty').hidden = Boolean(item)
  el('title').textContent = item?.title || '解读内容'
  document.title = item ? `${item.title} · DSH 解读` : 'DSH · 解读'
  const source = safeUrl(item?.url)
  el('source').hidden = !source
  if (source) el('source').href = source
  const online = state.connection?.phase === 'connected'
  document.querySelector('.toolbar').hidden = !online && !items.length
  document.querySelector('.reading-settings').hidden = !online
  el('model-summary').hidden = !online
  el('title').hidden = !online && !item
  el('empty').hidden = Boolean(item) || !online
  document.querySelector('.history-note').hidden = !items.length
  el('status').hidden = !online && !item
  el('stop-reading').hidden = !items.some(row => row.status === 'running')
  el('status').textContent = item?.status === 'unknown' ? '连接中断，解读结果未知；未自动重试'
    : item?.status === 'error' ? `解读未完成：${item.error}。可再次点击原问答的解读链接重试。`
    : item?.status === 'running' ? '正在解读当前回答…'
      : !online ? '尚未连接 DSH · 已有解读仍可阅读' : '独立解读 · 不携带之前的问答'
}
const refresh = async () => {
  if (loading) { queued = true; return }
  loading = true
  try {
    do {
      queued = false
      lastState = (await send({ type: 'dsh-assistant-state' })).state
      update(lastState)
    } while (queued)
  } catch { el('status').textContent = '暂时无法连接扩展，请重新打开侧栏' }
  finally { loading = false }
}
el('answer-picker').addEventListener('change', () => {
  selected = el('answer-picker').value; followLatest = false
  if (lastState) update(lastState)
})
el('latest').addEventListener('click', () => {
  followLatest = false; selected = lastState?.readings?.items.at(-1)?.id
  if (lastState) update(lastState)
})
el('model-settings').addEventListener('click', () => {
  void send({ type: 'dsh-assistant-open-model-settings' }).catch(error => { el('status').textContent = error.message })
})
el('stop-reading').addEventListener('click', () => {
  void send({ type: 'dsh-assistant-reading-stop' }).catch(error => { el('status').textContent = error.message })
})
const resize = delta => { fontSize = Math.min(30, Math.max(16, fontSize + delta)); document.documentElement.style.setProperty('--font-size', `${fontSize}px`) }
el('smaller').addEventListener('click', () => resize(-2))
el('larger').addEventListener('click', () => resize(2))
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'dsh-reader-follow-latest') { followLatest = true; void refresh() }
  if (message?.type === 'dsh-state-changed') void refresh()
})
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { void models.reload(); void refresh() } })
window.addEventListener('focus', () => { void models.reload() })
window.addEventListener('pageshow', () => { void refresh() })
void refresh()
