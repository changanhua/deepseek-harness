const clone = value => structuredClone(value)
const failure = code => Object.assign(new Error(code), { code })
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null
const page = value => value && Number.isInteger(value.tabId) && Number.isInteger(value.frameId)
  && text(value.documentId) && typeof value.url === 'string' && value.url.length > 0 && value.url.length <= 8192
  ? { tabId: value.tabId, frameId: value.frameId, documentId: value.documentId, url: value.url } : null
const samePage = (left, right) => left?.tabId === right?.tabId && left?.frameId === right?.frameId
  && left?.documentId === right?.documentId && left?.url === right?.url
const openTarget = value => {
  if (value?.kind === 'web' && text(value.sessionId)) return { kind: 'web', sessionId: value.sessionId }
  const resource = value?.kind === 'browser' ? value.resource : null
  const targetPage = page(resource?.page)
  if (!resource || !['region_render', 'entry_mount'].includes(resource.kind) || !text(resource.sessionId)
    || !text(resource.installationId) || !text(resource.mountId) || !targetPage) return null
  return { kind: 'browser', resource: { kind: resource.kind, sessionId: resource.sessionId,
    installationId: resource.installationId, page: targetPage, mountId: resource.mountId } }
}

/** Keep browser-function RPC wire details and untrusted catalogue validation out of the sidebar. */
const COMMANDS_KEY = 'dsh.assistant.function-commands.v1'

export const createAssistantFunctions = ({ call, getConnection, storage, changed = () => {},
  setTimer = setTimeout, clearTimer = clearTimeout, pollMs = 1500 }) => {
  let snapshot = { availability: 'unavailable', readError: null, items: [] }
  const commands = new Map()
  let pollTimer = null
  const terminal = status => ['completed', 'failed', 'revoked', 'host-lost'].includes(status)
  const save = async () => {
    if (!storage?.set) return
    const associated = new Set(snapshot.items.map(item => item.pluginId))
    const retired = [...commands.values()].filter(entry => terminal(entry.status) && !associated.has(entry.pluginId))
      .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    for (const entry of retired.slice(64)) commands.delete(commandKey(entry.kind, entry.pluginId, entry.baseUrl, entry.installationId))
    const entries = [...commands.values()].map(({ promise: _promise, ...entry }) => entry)
    await storage.set({ [COMMANDS_KEY]: entries })
  }
  const emit = () => { try { changed() } catch { /* a visual refresh cannot mutate function ownership */ } }
  const usable = () => getConnection()?.phase === 'connected' && text(getConnection()?.grant?.installationId)
  const normalize = response => {
    const rows = Array.isArray(response) ? response : Array.isArray(response?.functions) ? response.functions : []
    return rows.flatMap(row => {
      const pluginId = text(row?.pluginId), name = text(row?.name), purpose = text(row?.purpose)
      const currentPackageId = text(row?.currentPackageId)
      const scope = row?.delivery?.scope
      if (!pluginId || !name || !purpose || !currentPackageId || !scope || !['global', 'page'].includes(scope.kind)) return []
      const activeRun = row?.activeRun?.pluginRunId && text(row.activeRun.pluginRunId)
        ? { pluginRunId: row.activeRun.pluginRunId, packageId: text(row.activeRun.packageId) ?? currentPackageId } : null
      const visualTarget = openTarget(row?.openTarget)
      if (scope.kind === 'global') return [{ pluginId, name, purpose, currentPackageId, activeRun, scope: 'global',
        target: null, targetRevision: null, status: activeRun ? 'running' : 'stopped', inspection: null,
        ...(visualTarget ? { openTarget: visualTarget } : {}) }]
      const target = page(scope.target)
      if (!target || !Number.isSafeInteger(scope.targetRevision) || scope.targetRevision < 0) return []
      return [{ pluginId, name, purpose, currentPackageId, activeRun, scope: 'page',
        target, targetRevision: scope.targetRevision, status: activeRun ? 'running' : 'stopped', inspection: null,
        ...(visualTarget ? { openTarget: visualTarget } : {}) }]
    })
  }
  const find = pluginId => {
    if (!text(pluginId)) throw failure('invalid_function')
    const item = snapshot.items.find(candidate => candidate.pluginId === pluginId)
    if (!item) throw failure('function_unavailable')
    return item
  }
  const parameters = item => {
    if (!item.activeRun?.pluginRunId) throw failure('function_not_running')
    return { pluginId: item.pluginId, expectedPackageId: item.currentPackageId, expectedPluginRunId: item.activeRun.pluginRunId }
  }
  const refresh = async () => {
    if (!usable()) { snapshot = { availability: 'unavailable', readError: { code: 'offline', message: 'DSH is offline' }, items: [] }; emit(); return clone(snapshot) }
    snapshot = { ...snapshot, availability: 'loading', readError: null }; emit()
    try {
      const response = await call('function.list', {})
      snapshot = { availability: 'ready', readError: null, items: normalize(response) }
      await save()
      emit(); return clone(snapshot)
    } catch (error) {
      snapshot = { availability: 'unavailable', readError: { code: String(error?.code ?? 'function_list_failed').slice(0, 128),
        message: String(error?.message ?? 'Function catalogue unavailable').slice(0, 1024) }, items: [] }; emit(); throw error
    }
  }
  const inspect = async pluginId => {
    if (!usable()) throw failure('offline')
    const item = find(pluginId)
    const inspection = await call('function.inspect', parameters(item))
    const visualTarget = openTarget(inspection?.function?.openTarget ?? inspection?.openTarget)
    snapshot = { ...snapshot, items: snapshot.items.map(candidate => candidate.pluginId === item.pluginId
      ? { ...candidate, inspection: clone(inspection), ...(visualTarget ? { openTarget: visualTarget } : {}) } : candidate) }
    emit(); return clone(inspection)
  }
  const stop = async pluginId => {
    if (!usable()) throw failure('offline')
    const item = find(pluginId)
    const result = await call('function.stop', parameters(item))
    await refresh()
    return clone(result)
  }
  const commandKey = (kind, pluginId, baseUrl = '', installationId = '') => `${baseUrl}:${installationId}:${kind}:${pluginId}`
  const targetRevision = (kind, item, target) => {
    if (item.scope === 'global') return null
    const current = target?.availability === 'ready' && Number.isSafeInteger(target?.revision) && target.revision >= 0 && target?.selected
    if (!current || kind === 'run' && (target.revision !== item.targetRevision || !samePage(target.selected, item.target))) throw failure('target_changed')
    return target.revision
  }
  const command = async (kind, pluginId, { sessionId, target, instruction } = {}) => {
    if (!usable()) throw failure('offline')
    if (!text(sessionId)) throw failure('session_changed')
    const item = find(pluginId)
    const key = commandKey(kind, pluginId, getConnection().baseUrl, getConnection().grant.installationId)
    const previous = commands.get(key)
    if (previous && !['failed', 'revoked', 'host-lost', 'completed'].includes(previous.status)) {
      if (kind === 'edit' && previous.instruction !== instruction) throw failure('command_pending')
      return previous.promise ?? Promise.resolve(clone(previous))
    }
    const requestId = crypto.randomUUID()
    const params = { requestId, functionId: item.pluginId, expectedVersion: item.currentPackageId,
      sessionId, expectedTargetRevision: targetRevision(kind, item, target),
      ...(kind === 'run' ? { expectedRunId: item.activeRun?.pluginRunId ?? null } : { instruction }) }
    const pending = { kind, pluginId: item.pluginId, requestId, instruction, expectedVersion: item.currentPackageId,
      baseUrl: getConnection().baseUrl, installationId: getConnection().grant.installationId, sessionId,
      payload: clone(params), status: 'pending', updatedAt: Date.now(), promise: null }
    const work = call(`function.${kind}`, params).then(async value => {
      pending.status = 'accepted'; pending.updatedAt = Date.now()
      pending.promise = null
      await save()
      await refresh()
      schedulePoll()
      return clone(value)
    }).catch(error => {
      if ((error?.code ?? error?.message) === 'result_unknown') {
        pending.status = 'unknown'
      } else pending.status = 'failed'
      pending.updatedAt = Date.now()
      pending.promise = null; void save(); schedulePoll(); emit()
      throw error
    })
    pending.promise = work; commands.set(key, pending); void save(); emit()
    return work
  }
  const run = (pluginId, input) => command('run', pluginId, input)
  const edit = (pluginId, input) => {
    if (!text(input?.instruction)) throw failure('invalid_instruction')
    return command('edit', pluginId, input)
  }
  const read = ({ target, installationId } = {}) => {
    const matchesInstallation = usable() && installationId === getConnection().grant.installationId
    if (!matchesInstallation) return { availability: 'unavailable', items: [] }
    const items = snapshot.items.map(item => item.scope !== 'page' ? clone(item) : {
      ...clone(item), scopeStatus: target?.availability === 'ready' && target?.selected && target.revision === item.targetRevision
        && target.selected.status !== 'closed' && target.selected.status !== 'navigated' && samePage(target.selected, item.target)
        ? 'current-target' : 'stale-target',
    })
    return { availability: snapshot.availability, ...(snapshot.readError ? { readError: clone(snapshot.readError) } : {}), items: items.map(item => {
      const run = commands.get(commandKey('run', item.pluginId, getConnection().baseUrl, getConnection().grant.installationId))
      const edit = commands.get(commandKey('edit', item.pluginId, getConnection().baseUrl, getConnection().grant.installationId))
      return run ?? edit ? { ...item, command: { kind: run ? 'run' : 'edit', status: (run ?? edit).status, requestId: (run ?? edit).requestId } } : item
    }) }
  }
  const restore = async () => {
    if (!storage?.get) return
    const stored = (await storage.get(COMMANDS_KEY))[COMMANDS_KEY]
    if (!Array.isArray(stored)) return
    for (const entry of stored) {
      if (!entry || !['run', 'edit'].includes(entry.kind) || !text(entry.pluginId) || !text(entry.requestId)
        || !text(entry.expectedVersion) || !entry.payload || typeof entry.status !== 'string') continue
      commands.set(commandKey(entry.kind, entry.pluginId, entry.baseUrl, entry.installationId), { ...clone(entry), promise: null })
    }
    emit()
  }
  const reconcile = async () => {
    if (!usable()) return
    for (const entry of commands.values()) {
      if (entry.baseUrl !== getConnection().baseUrl || entry.installationId !== getConnection().grant.installationId) continue
      if (terminal(entry.status)) continue
      try {
        const state = await call('function.command.status', { requestId: entry.requestId })
        if (!state || state.status === 'missing') entry.status = 'host-lost'
        else if (state.status === 'completed') entry.status = 'completed'
        else if (state.status === 'settled') entry.status = state.receipt?.ok === false ? 'failed' : 'completed'
        else if (state.status === 'failed' || state.status === 'revoked') entry.status = state.status
        else entry.status = state.status === 'pending' ? 'accepted' : state.status
      } catch { entry.status = 'unknown' }
      entry.updatedAt = Date.now()
    }
    await save(); emit(); schedulePoll()
  }
  const schedulePoll = () => {
    if (pollTimer !== null) return
    const active = [...commands.values()].some(entry => !terminal(entry.status) && entry.baseUrl === getConnection()?.baseUrl
      && entry.installationId === getConnection()?.grant?.installationId)
    if (!active || !usable()) return
    pollTimer = setTimer(() => { pollTimer = null; void reconcile().catch(() => {}) }, pollMs)
  }
  const connectionChanged = async connection => {
    if (connection?.phase !== 'connected' || !text(connection.grant?.installationId)) {
      if (pollTimer !== null) { clearTimer(pollTimer); pollTimer = null }
      snapshot = { availability: 'unavailable', readError: { code: 'offline', message: 'DSH is offline' }, items: [] }; emit(); return
    }
    await refresh(); await reconcile()
  }
  return { read: (input = {}) => ({ ...read(input), orphanCommands: [...commands.values()]
    .filter(entry => entry.baseUrl === getConnection()?.baseUrl && entry.installationId === getConnection()?.grant?.installationId
      && !snapshot.items.some(item => item.pluginId === entry.pluginId))
    .map(({ kind, pluginId, requestId, status }) => ({ kind, pluginId, requestId, status })) }),
  scope: pluginId => find(pluginId).scope, refresh, inspect, stop, run, edit, restore, connectionChanged }
}
