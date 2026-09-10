const KEY = 'dsh.assistant.activity-buffer.v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const copy = value => structuredClone(value)
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength
const fail = code => Object.assign(new Error(code), { code })
const http = value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password }
  catch { return false }
}
const keyOf = state => state?.phase === 'connected' && http(state.baseUrl) && state.grant
  && ['session:interact', 'browser:read', 'browser:observe'].every(scope => state.grant.scopes.includes(scope))
  ? JSON.stringify([state.baseUrl, state.grant.installationId, state.grant.grantEpoch]) : null
export const validActivitySettings = input => input && typeof input.enabled === 'boolean'
  && typeof input.sessionId === 'string' && input.sessionId.length > 0 && input.sessionId.length <= 128
  && Array.isArray(input.origins) && input.origins.length > 0 && input.origins.length <= 16
  && input.origins.every(origin => http(origin) && new URL(origin).origin === origin)
  && new Set(input.origins).size === input.origins.length
  && Array.isArray(input.kinds) && input.kinds.length > 0 && input.kinds.length <= 3
  && input.kinds.every(kind => ['visit', 'dwell', 'dom-change'].includes(kind)) && new Set(input.kinds).size === input.kinds.length
  && [['minIntervalMs', 1000, 60000], ['retentionDays', 1, 30], ['maxEvents', 10, 2000], ['maxTextChars', 0, 4000]]
    .every(([key, min, max]) => Number.isSafeInteger(input[key]) && input[key] >= min && input[key] <= max)
const validBatch = input => input && UUID.test(input.id) && UUID.test(input.revision) && Number.isSafeInteger(input.sequence)
  && input.sequence > 0 && Array.isArray(input.events) && input.events.length > 0 && input.events.length <= 32
  && input.events.every(event => UUID.test(event?.id) && http(event.url) && event.url.length <= 8192
    && ['visit', 'dwell', 'dom-change'].includes(event.kind) && Number.isSafeInteger(event.at) && event.at >= 0
    && Number.isSafeInteger(event.tabId) && event.tabId >= 0 && typeof event.title === 'string' && event.title.length <= 256
    && (event.text === undefined || typeof event.text === 'string' && event.text.length <= 4000)
    && (event.documentId === undefined || typeof event.documentId === 'string' && event.documentId.length <= 128)
    && (event.durationMs === undefined || Number.isSafeInteger(event.durationMs) && event.durationMs >= 0 && event.durationMs <= 60000))

/** Chrome retains one unconfirmed batch and configuration intent. The Host owns searchable history. */
export const createAssistantActivity = ({ storage, call, getConnection, hasOrigins = async () => false, changed = () => {}, pollMs = 15000 }) => {
  let disk = { version: 1, owner: null, configuration: null, batch: null, hold: false }
  let loaded = false, faulted = false, stopped = false, suspended = true
  let key = null, generation = 0, timer = null, chain = Promise.resolve(), configuring = false
  let state = { revision: null, policy: null, sequence: 0, authorizationChanged: false }
  let phase = 'unavailable', error = null, buffer = [], discarded = 0, results = []
  let refresh = null, flushing = null
  let syncRequested = false, synchronizedGeneration = null
  const read = () => copy({ phase, error, policy: state.policy, revision: state.revision,
    authorizationChanged: state.authorizationChanged, buffered: buffer.length + (disk.batch?.events.length ?? 0),
    discarded, synchronized: synchronizedGeneration === generation, pendingConfiguration: disk.configuration !== null, results })
  const publish = () => { try { changed(read()) } catch { /* A view cannot control persistence. */ } }
  const assertStore = () => { if (faulted || stopped) throw fail('activity_storage_unavailable') }
  const serial = action => {
    const work = chain.then(action)
    chain = work.catch(() => {})
    return work
  }
  const save = async value => {
    assertStore()
    if (bytes(value) > 512 * 1024) throw fail('activity_buffer_limit')
    try { await storage.set({ [KEY]: copy(value) }); disk = copy(value) }
    catch { faulted = true; suspended = true; phase = 'error'; error = 'activity_storage_unavailable'; publish(); throw fail(error) }
  }
  const restore = () => serial(async () => {
    if (loaded) return assertStore()
    try {
      const value = (await storage.get(KEY))[KEY]
      if (value !== undefined) {
        if (value?.version !== 1 || bytes(value) > 512 * 1024 || value.hold !== undefined && typeof value.hold !== 'boolean'
          || value.owner !== null && (!http(value.owner?.baseUrl) || !UUID.test(value.owner?.installationId))
          || value.configuration !== null && (!UUID.test(value.configuration?.requestId)
            || value.configuration.expectedRevision !== null && !UUID.test(value.configuration.expectedRevision)
            || !validActivitySettings(value.configuration.settings))
          || value.batch !== null && !validBatch(value.batch)
          || (value.configuration || value.batch) && !value.owner) throw fail('activity_storage_invalid')
        disk = { ...copy(value), hold: value.hold ?? false }
      }
      loaded = true; publish()
    } catch (cause) { faulted = true; error = cause.code ?? 'activity_storage_unavailable'; phase = 'error'; publish(); throw fail(error) }
  })
  const target = () => {
    assertStore()
    const connection = getConnection()
    if (!key || key !== keyOf(connection)) throw fail('observation_not_authorized')
    return { key, generation, baseUrl: connection.baseUrl, installationId: connection.grant.installationId }
  }
  const same = fixed => fixed.key === keyOf(getConnection()) && fixed.generation === generation && !stopped
  const ownerMatches = fixed => !disk.owner || disk.owner.baseUrl === fixed.baseUrl && disk.owner.installationId === fixed.installationId
  const applyState = value => {
    if (!value || value.revision !== null && !UUID.test(value.revision) || !Number.isSafeInteger(value.sequence) || value.sequence < 0
      || typeof value.authorizationChanged !== 'boolean' || value.policy !== null && (!validActivitySettings(value.policy)
        || value.policy.revision !== value.revision || value.policy.grantEpoch !== getConnection().grant.grantEpoch)) throw fail('invalid_activity_state')
    state = copy(value)
  }
  const updatePhase = () => {
    phase = disk.configuration ? 'unconfirmed' : disk.hold ? 'paused-local' : state.authorizationChanged ? 'authorization-changed'
      : state.policy?.enabled && !suspended ? 'collecting' : state.policy ? 'paused' : 'unconfigured'
    publish()
  }
  const syncWork = async () => {
    const fixed = target()
    if (!ownerMatches(fixed) && (disk.batch || disk.configuration)) throw fail('activity_target_changed')
    const value = await call('activity.state', {})
    if (!same(fixed)) return
    applyState(value)
    synchronizedGeneration = generation
    if (state.policy && !await hasOrigins(state.policy.origins)) {
      if (same(fixed)) { suspended = true; phase = 'error'; error = 'page_permission_required'; publish() }
      return
    }
    if (!same(fixed)) return
    if (disk.batch && disk.batch.revision !== state.revision) {
      const count = disk.batch.events.length
      await save({ ...disk, batch: null }); discarded += count
      if (!same(fixed)) return
    }
    if (!disk.configuration && !configuring) suspended = disk.hold
    error = null; updatePhase()
  }
  const sync = () => {
    syncRequested = true
    if (refresh) return refresh
    refresh = serial(async () => {
      do {
        syncRequested = false
        if (!key) return
        const before = generation
        try { await syncWork() } catch (cause) { if (before === generation) throw cause }
      } while (syncRequested)
    }).catch(cause => {
      suspended = true; phase = 'error'; error = cause.code ?? 'activity_sync_failed'; publish(); throw cause
    }).finally(() => { refresh = null })
    return refresh
  }
  const connectionChanged = connection => {
    const next = keyOf(connection)
    if (next === key) return Promise.resolve()
    key = next; generation += 1; synchronizedGeneration = null; suspended = true; discarded += buffer.length; buffer = []; results = []
    state = { revision: null, policy: null, sequence: 0, authorizationChanged: false }
    phase = 'unavailable'; clearInterval(timer); timer = null; publish()
    if (!key || stopped) return Promise.resolve()
    timer = setInterval(() => { void sync().then(flush).catch(() => {}) }, pollMs)
    return sync().then(flush)
  }
  const policy = () => !suspended && phase === 'collecting' && key === keyOf(getConnection()) && !faulted && !stopped
    ? copy(state.policy) : null
  const enqueue = events => {
    const current = policy()
    if (!current || !Array.isArray(events) || events.length === 0) return
    const input = { id: crypto.randomUUID(), revision: current.revision, sequence: state.sequence + 1, events }
    if (!validBatch(input) || events.some(event => !current.origins.includes(new URL(event.url).origin)
      || !current.kinds.includes(event.kind) || (event.text?.length ?? 0) > current.maxTextChars)) throw fail('activity_outside_policy')
    for (const event of events) {
      if (buffer.length >= 32 || bytes([...buffer, event]) > 240 * 1024) { discarded += 1; continue }
      buffer.push(copy(event))
    }
    publish()
  }
  const flushWork = async () => {
    const fixed = target()
    if (!ownerMatches(fixed) || disk.configuration || suspended || !state.policy?.enabled) return
    if (!disk.batch && buffer.length) {
      const events = buffer.slice(0, 32)
      await save({ ...disk, owner: { baseUrl: fixed.baseUrl, installationId: fixed.installationId },
        batch: { id: crypto.randomUUID(), revision: state.revision, sequence: state.sequence + 1, events } })
      buffer.splice(0, events.length)
    }
    if (!same(fixed) || suspended || !disk.batch) return
    const batch = copy(disk.batch)
    if (batch.revision !== state.revision) return
    if (!await hasOrigins([...new Set(batch.events.map(event => new URL(event.url).origin))])) {
      suspended = true; phase = 'error'; throw fail('page_permission_required')
    }
    if (!same(fixed) || suspended) return
    const receipt = await call('activity.append', batch)
    if (!same(fixed)) return
    if (receipt?.sequence !== batch.sequence || !Number.isSafeInteger(receipt.accepted) || receipt.accepted < 0
      || receipt.accepted > batch.events.length) throw fail('invalid_activity_receipt')
    await save({ ...disk, batch: null })
    if (!same(fixed)) return
    state.sequence = receipt.sequence; error = null; publish()
  }
  const flush = () => {
    if (flushing) return flushing
    flushing = serial(flushWork).catch(cause => {
      error = cause.code ?? 'activity_upload_unconfirmed'; publish(); throw cause
    }).finally(() => { flushing = null })
    return flushing
  }
  const submitConfiguration = async () => {
    const fixed = target()
    if (!ownerMatches(fixed)) throw fail('activity_target_changed')
    if (!disk.configuration) throw fail('no_pending_activity_configuration')
    if (disk.configuration.settings.enabled && !await hasOrigins(disk.configuration.settings.origins)) throw fail('page_permission_required')
    if (!same(fixed)) throw fail('activity_target_changed')
    const value = await call('activity.configure', copy(disk.configuration))
    if (!same(fixed)) throw fail('activity_target_changed')
    applyState(value)
    if (!state.policy || state.revision === disk.configuration.expectedRevision
      || !Object.entries(disk.configuration.settings).every(([name, value]) => JSON.stringify(state.policy[name]) === JSON.stringify(value))) {
      throw fail('invalid_activity_state')
    }
    const count = disk.batch?.events.length ?? 0
    await save({ ...disk, configuration: null, batch: null, hold: false })
    if (!same(fixed)) return
    discarded += count + buffer.length; buffer = []; suspended = false; error = null; updatePhase()
  }
  const configure = settings => {
    if (!validActivitySettings(settings)) throw fail('invalid_activity_settings')
    if (synchronizedGeneration !== generation) throw fail('activity_sync_required')
    if (configuring) throw fail('activity_configuration_pending')
    const fixed = target(), input = copy(settings)
    configuring = true; suspended = true; phase = 'configuring'; publish()
    return serial(async () => {
      if (!same(fixed) || !ownerMatches(fixed) && (disk.batch || disk.configuration)) throw fail('activity_target_changed')
      if (disk.configuration) throw fail('activity_configuration_pending')
      if (input.enabled && !await hasOrigins(input.origins)) throw fail('page_permission_required')
      if (!same(fixed)) throw fail('activity_target_changed')
      await save({ ...disk, hold: true, owner: { baseUrl: fixed.baseUrl, installationId: fixed.installationId },
        configuration: { requestId: crypto.randomUUID(), expectedRevision: state.revision, settings: input } })
      if (!same(fixed)) throw fail('activity_target_changed')
      await submitConfiguration()
    }).catch(configurationFailed)
      .finally(() => { configuring = false })
  }
  const retry = () => {
    if (configuring) throw fail('activity_configuration_pending')
    configuring = true; suspended = true
    return serial(submitConfiguration).catch(configurationFailed).finally(() => { configuring = false })
  }
  const configurationFailed = async cause => {
    if (['activity_configuration_changed', 'activity_configuration_conflict'].includes(cause.code) && disk.configuration) {
      await save({ ...disk, configuration: null, hold: true })
      await serial(syncWork)
    }
    error = cause.code ?? 'activity_configuration_unconfirmed'; updatePhase(); throw cause
  }
  const query = input => serial(async () => {
    const fixed = target()
    const value = await call('activity.query', input)
    if (!same(fixed)) return
    if (!Array.isArray(value?.events) || value.events.length > 100 || bytes(value) > 257 * 1024) throw fail('invalid_activity_result')
    results = copy(value.events); publish()
  })
  const stop = () => { stopped = true; suspended = true; generation += 1; clearInterval(timer); buffer = []; results = [] }
  return { read, restore, sync, connectionChanged, policy, enqueue, flush, configure, retry, query, stop }
}
