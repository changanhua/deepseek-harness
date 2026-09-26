import { normalizeBaseUrl } from './pending.js'

/** Configure the existing DSH connection without leaving the reading view. */
export const installReaderConnection = ({ send, refresh }) => {
  const el = id => document.getElementById(id)
  let connection = { phase: 'unconfigured' }, editing = false, busy = false, pollTimer
  const showError = error => {
    const labels = { offline: '无法连接 DSH，请确认服务已启动，地址和端口正确。',
      expired: '连接请求已过期，请重新连接。', permission_required: '请允许扩展访问 DSH 地址。',
      site_permission_required: '已保存的网站权限不可用，请检查 Chrome 扩展权限。',
      no_saved_connection: '原连接授权不可恢复，请重新连接 DSH。',
      fetch_failed: '无法访问 DSH，请检查地址和服务状态。' }
    el('connect-error').hidden = false
    el('connect-error').textContent = labels[error.message] ?? `连接未完成：${error.message}`
  }
  const update = state => {
    connection = state.connection ?? { phase: 'unconfigured' }
    const phase = connection.phase
    el('reader-connection').hidden = phase === 'connected'
    if (!editing) el('reader-base-url').value = connection.baseUrl ?? 'http://127.0.0.1:3080'
    const titles = { unconfigured: '连接 DSH，开始解读', configured: '连接 DSH，开始解读',
      pending: '完成 DSH 连接', connecting: '正在连接 DSH…', offline: '暂时连不上 DSH',
      unauthorized: '重新连接 DSH', invalid: '请重新设置 DSH 地址' }
    el('connect-title').textContent = titles[phase] ?? '连接 DSH'
    el('connect-description').textContent = phase === 'pending'
      ? '请在已打开的 DSH 页面完成首次连接，这里会自动继续。'
      : phase === 'offline' || phase === 'connecting'
        ? '请确认 DSH 正在运行；无法连接时可点击下方按钮重试，地址变化时也可修改。'
        : '填写正在运行的 DSH 地址。连接成功后，再点知乎问答旁的“AI 总结解读”。'
    el('reader-connect').textContent = phase === 'offline' || phase === 'connecting' ? '检查连接 / 保存地址' : '保存并连接'
    el('reader-connect').disabled = busy || phase === 'pending'
    el('reader-base-url').disabled = busy || phase === 'pending'
    el('connect-pending').hidden = phase !== 'pending'
    if (phase !== 'pending') { clearTimeout(pollTimer); pollTimer = undefined }
    else if (!pollTimer) pollTimer = setTimeout(() => {
      pollTimer = undefined
      void run('dsh-assistant-poll')
    }, 2000)
    if (phase === 'connected') { editing = false; el('connect-error').hidden = true }
  }
  const run = async type => {
    try { await send({ type }); await refresh() }
    catch (error) { showError(error) }
  }
  el('reader-base-url').addEventListener('input', () => { editing = true; el('connect-error').hidden = true })
  el('reader-connect-form').addEventListener('submit', async event => {
    event.preventDefault()
    if (busy) return
    busy = true; el('reader-connect').disabled = true; el('connect-error').hidden = true
    try {
      const baseUrl = normalizeBaseUrl(el('reader-base-url').value.trim())
      const changedAddress = baseUrl !== connection.baseUrl
      if (!changedAddress && connection.phase === 'offline') {
        await send({ type: 'dsh-assistant-retry' })
        editing = false
        return
      }
      if (!changedAddress && connection.phase === 'connecting') return
      // Chrome requires this call to originate in the submit gesture; existing permission is reused.
      if (!await chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] })) throw new Error('permission_required')
      if (changedAddress || connection.phase === 'invalid') await send({ type: 'dsh-assistant-configure', baseUrl })
      if (changedAddress || !['connecting', 'connected'].includes(connection.phase)) {
        await send({ type: 'dsh-assistant-connect', scopes: ['session:interact', 'browser:read', 'browser:write', 'browser:observe'], origins: ['*'] })
      }
      editing = false
    } catch (error) { showError(error) }
    finally { busy = false; await refresh() }
  })
  el('connect-open').addEventListener('click', () => { void run('dsh-assistant-open-approval') })
  el('connect-continue').addEventListener('click', () => { void run('dsh-assistant-poll') })
  el('connect-cancel').addEventListener('click', () => { void run('dsh-assistant-cancel') })
  window.addEventListener('pagehide', () => { clearTimeout(pollTimer); pollTimer = undefined })
  return { update }
}
