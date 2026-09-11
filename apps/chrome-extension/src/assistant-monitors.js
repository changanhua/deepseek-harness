const KEY = 'dsh.assistant.monitor-create.v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const copy = value => structuredClone(value)
const failure = code => Object.assign(new Error(code), { code })
const httpUrl = value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password }
  catch { return false }
}
const keyOf = state => state?.phase === 'connected' && state.baseUrl && state.grant
  && ['session:interact', 'browser:read', 'browser:observe'].every(scope => state.grant.scopes.includes(scope))
  ? JSON.stringify([state.baseUrl, state.grant.installationId, state.grant.grantEpoch]) : null
const validInput = input => input && UUID.test(input.requestId) && typeof input.sessionId === 'string' && input.sessionId.length > 0
  && input.sessionId.length <= 128 && httpUrl(input.url) && input.url.length <= 8192 && typeof input.title === 'string'
  && input.title.trim().length > 0 && input.title.length <= 200
  && (input.intervalMs === null || Number.isSafeInteger(input.intervalMs) && input.intervalMs >= 1000 && input.intervalMs <= 86400000)
  && ['latest', 'skip'].includes(input.missedPolicy) && (input.match?.kind === 'changed'
    || ['appears', 'disappears'].includes(input.match?.kind) && typeof input.match.text === 'string' && input.match.text.length > 0 && input.match.text.length <= 1024)
const validatePlans = value => {
  if (!Array.isArray(value?.monitors) || value.monitors.length > 256 || new TextEncoder().encode(JSON.stringify(value)).byteLength > 16 * 1024 * 1024) throw failure('invalid_monitor_result')
  const ids = new Set(), notices = new Set()
  for (const plan of value.monitors) {
    if (!UUID.test(plan?.id) || !UUID.test(plan.revision) || ids.has(plan.id) || !httpUrl(plan.url)
      || typeof plan.sessionId !== 'string' || typeof plan.title !== 'string' || !Array.isArray(plan.outbox) || plan.outbox.length > 32) throw failure('invalid_monitor_result')
    ids.add(plan.id)
    for (const notice of plan.outbox) {
      if (!UUID.test(notice?.id) || notices.has(notice.id) || notice.monitorId !== plan.id || notice.sessionId !== plan.sessionId
        || typeof notice.title !== 'string' || typeof notice.message !== 'string') throw failure('invalid_monitor_result')
      notices.add(notice.id)
    }
  }
  return copy(value.monitors)
}

/** Host owns plans and the notification inbox. Only an unconfirmed creation intent is retained locally. */
export const createAssistantMonitors = ({ storage, call, getConnection, changed = () => {}, pollMs = 15000 }) => {
  let phase = 'unavailable', error = null, monitors = [], pendingCreate = null
  let loaded = false, loading = null, storageFault = false
  let key = null, generation = 0, timer = null, syncing = null, syncRequested = false, creating = null
  const controls = new Set()
  const read = () => copy({ phase, monitors, pendingCreate, error })
  const publish = () => { try { changed(read()) } catch { /* A view cannot change persistence or authority. */ } }
  const assertStorage = () => { if (storageFault) throw failure('monitor_storage_failed') }
  const restore = () => {
    if (loaded) { assertStorage(); return Promise.resolve() }
    if (loading) return loading
    loading = (async () => {
      try {
        const record = (await storage.get(KEY))[KEY]
        if (record !== undefined && (record?.version !== 1 || record.pending !== null && (!httpUrl(record.pending?.baseUrl)
          || !UUID.test(record.pending.installationId) || !validInput(record.pending.input)
          || new TextEncoder().encode(JSON.stringify(record.pending)).byteLength > 16384))) throw failure('monitor_storage_invalid')
        pendingCreate = copy(record?.pending ?? null)
        loaded = true
        publish()
      } catch (cause) { storageFault = true; error = cause.code ?? 'monitor_storage_failed'; publish(); throw failure(error) }
    })().finally(() => { loading = null })
    return loading
  }
  const savePending = async value => {
    assertStorage()
    try { await storage.set({ [KEY]: { version: 1, pending: copy(value) } }) }
    catch { storageFault = true; error = 'monitor_storage_failed'; publish(); throw failure(error) }
    pendingCreate = copy(value); publish()
  }
  const current = () => {
    const state = getConnection()
    const currentKey = keyOf(state)
    if (!currentKey || currentKey !== key) throw failure('observation_not_authorized')
    return { baseUrl: state.baseUrl, installationId: state.grant.installationId, key: currentKey, generation }
  }
  const same = target => target.key === keyOf(getConnection()) && target.generation === generation
  const sync = () => {
    syncRequested = true
    if (syncing) return syncing
    const work = (async () => {
      do {
        syncRequested = false
        if (!key) return
        const target = current()
        phase = 'syncing'; publish()
        try {
          const result = await call('monitor.list', {})
          if (!same(target)) continue
          monitors = validatePlans(result); phase = 'ready'; error = storageFault ? 'monitor_storage_failed' : null
        } catch (cause) { if (same(target)) { phase = 'error'; error = cause.code ?? 'monitor_sync_failed' } }
        publish()
      } while (syncRequested)
    })().finally(() => { syncing = null })
    syncing = work
    return work
  }
  const connectionChanged = state => {
    const next = keyOf(state)
    if (next === key) return Promise.resolve()
    key = next; generation += 1
    clearInterval(timer); timer = null
    monitors = []; phase = 'unavailable'; error = storageFault ? 'monitor_storage_failed' : null; publish()
    if (!key) return Promise.resolve()
    timer = setInterval(() => { void sync().catch(() => {}) }, pollMs)
    return sync()
  }
  const submitPending = async () => {
    const target = current()
    const fixed = pendingCreate
    if (!fixed) throw failure('no_pending_monitor')
    if (fixed.baseUrl !== target.baseUrl || fixed.installationId !== target.installationId) throw failure('target_changed')
    try {
      const receipt = await call('monitor.create', copy(fixed.input))
      if (receipt?.id !== fixed.input.requestId || receipt.sessionId !== fixed.input.sessionId || receipt.url !== fixed.input.url) throw failure('invalid_monitor_receipt')
      if (!same(target)) throw failure('target_changed')
      await savePending(null)
      await sync()
    } catch (cause) { error = cause.code ?? 'monitor_create_unconfirmed'; publish(); throw failure(error) }
  }
  const exclusiveCreate = action => {
    if (creating) throw failure('monitor_create_pending')
    const work = action().finally(() => { creating = null })
    creating = work
    return work
  }
  const create = input => {
    const fixed = copy(input)
    if (!validInput(fixed)) throw failure('invalid_monitor_input')
    const target = current()
    return exclusiveCreate(async () => {
      await restore(); assertStorage()
      if (pendingCreate) throw failure('monitor_create_pending')
      if (!same(target)) throw failure('target_changed')
      await savePending({ baseUrl: target.baseUrl, installationId: target.installationId, input: fixed })
      if (!same(target)) throw failure('target_changed')
      await submitPending()
    })
  }
  const retry = () => exclusiveCreate(async () => { await restore(); assertStorage(); await submitPending() })
  const find = id => {
    current()
    const plan = monitors.find(item => item.id === id)
    if (!plan) throw failure('monitor_not_found')
    return copy(plan)
  }
  const control = async (method, params) => {
    const target = current(), plan = find(params.id)
    if (controls.has(plan.id)) throw failure('monitor_control_pending')
    if (!['monitor.pause', 'monitor.resume', 'monitor.acknowledge'].includes(method)) throw failure('invalid_monitor_control')
    if (method === 'monitor.acknowledge' ? !plan.outbox.some(notice => notice.id === params.noticeId) : params.revision !== plan.revision) throw failure('control_superseded')
    controls.add(plan.id)
    try {
      await call(method, method === 'monitor.acknowledge' ? { id: plan.id, noticeId: params.noticeId } : { id: plan.id, revision: plan.revision })
      if (!same(target)) throw failure('target_changed')
      await sync()
    } finally { controls.delete(plan.id) }
  }
  const stop = () => { key = null; generation += 1; clearInterval(timer); timer = null; monitors = []; phase = 'unavailable' }
  return { read, restore, connectionChanged, sync, create, retry, control, find, stop }
}
