import { normalizeBaseUrl } from './pending.js'

const CONNECTION_KEY = 'dsh.assistant.connection.v1'
const failure = code => Object.assign(new Error(code), { code })
const clone = value => structuredClone(value)
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const EXTENSION_ID = /^[a-p]{32}$/u
const BASE64_32 = /^[A-Za-z0-9_-]{43}$/u
const validOrigin = origin => {
  if (origin === '*') return true
  try {
    const url = new URL(origin)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.origin === origin
  } catch { return false }
}
const validScopes = scopes => Array.isArray(scopes) && scopes.length > 0 && scopes.every(scope => typeof scope === 'string' && scope)

const approvalUrl = pending => `${pending.baseUrl}/browser-assistant?requestId=${encodeURIComponent(pending.requestId)}`

/**
 * Owns only the browser-assistant pairing state.  The existing content import
 * connection deliberately remains in its separate storage namespace.
 */
export const createAssistantConnection = ({
  storage,
  transport,
  createChannel,
  hasPermission,
  hasOrigins = async () => true,
  extensionId,
  createInstallationId = () => crypto.randomUUID(),
  openApprovalPage = async () => { throw failure('approval_unavailable') },
  onCommand = () => {},
  onEvent = () => {},
  changed = () => {},
}) => {
  let lane = Promise.resolve()
  let generation = 0
  let abort = null
  let inFlight = null
  let channel = null
  let cached = undefined
  let invalid = false
  let runtime = { phase: 'unconfigured', grant: null }

  /** @template T @param {() => T | Promise<T>} action @returns {Promise<T>} */
  const serial = action => {
    const result = lane.then(action, action)
    lane = result.then(() => {}, () => {})
    return result
  }
  const notify = record => { try { Promise.resolve(changed(visible(record))).catch(() => {}) } catch { /* observers cannot reopen authority */ } }
  const validRecord = value => {
    if (!value || typeof value !== 'object' || (value.baseUrl !== null && typeof value.baseUrl !== 'string') || !UUID_V4.test(value.installationId)) return false
    try { if (value.baseUrl !== null && normalizeBaseUrl(value.baseUrl) !== value.baseUrl) return false } catch { return false }
    if (value.pending && (!UUID_V4.test(value.pending.requestId) || !BASE64_32.test(value.pending.verifier) || value.pending.baseUrl !== value.baseUrl || value.pending.installationId !== value.installationId || value.pending.extensionId !== extensionId || !validScopes(value.pending.scopes) || !Array.isArray(value.pending.origins) || !value.pending.origins.every(validOrigin) || !Number.isFinite(Date.parse(value.pending.expiresAt)) || Date.parse(value.pending.expiresAt) <= Date.now())) return false
    if ((value.token === undefined) !== (value.grant === undefined)) return false
    return !value.grant || (typeof value.baseUrl === 'string' && BASE64_32.test(value.token) && value.grant.installationId === value.installationId && value.grant.extensionId === extensionId && Number.isSafeInteger(value.grant.grantEpoch) && value.grant.grantEpoch > 0 && validScopes(value.grant.scopes) && Array.isArray(value.grant.origins) && value.grant.origins.every(validOrigin))
  }
  const load = async () => {
    if (invalid) return null
    if (cached !== undefined) return clone(cached)
    const record = (await storage.get(CONNECTION_KEY))[CONNECTION_KEY]
    if (record) {
      if (!validRecord(record)) { invalid = true; runtime = { phase: 'invalid', grant: null }; return null }
      cached = clone(record)
      return clone(cached)
    }
    const initial = { baseUrl: null, installationId: createInstallationId() }
    await storage.set({ [CONNECTION_KEY]: initial })
    cached = clone(initial)
    return initial
  }
  const save = async record => {
    try {
      await storage.set({ [CONNECTION_KEY]: clone(record) })
      cached = clone(record)
    } catch (error) {
      invalid = true
      runtime = { phase: 'invalid', grant: null }
      stopChannel()
      throw error
    }
  }
  const stopChannel = () => {
    const current = channel
    channel = null
    runtime = { ...runtime, grant: null }
    try { current?.stop() } catch { /* stopping is best effort */ }
  }
  const phaseOf = record => invalid ? 'invalid' : runtime.phase === 'connected' || runtime.phase === 'connecting' || runtime.phase === 'offline' || runtime.phase === 'unauthorized' ? runtime.phase
    : record.pending ? 'pending'
      : record.error === 'unauthorized' ? 'unauthorized'
        : record.baseUrl ? 'configured' : 'unconfigured'
  const visible = record => ({ baseUrl: record.baseUrl, phase: phaseOf(record), ...(runtime.phase === 'connected' && runtime.grant ? { grant: clone(runtime.grant) } : {}), ...(record.error ? { error: record.error } : {}) })

  const onChannelState = async (candidate, epoch, state) => {
    if (channel !== candidate || generation !== epoch) return
    if (state?.phase === 'connected') {
      const current = await serial(load)
      if (channel !== candidate || generation !== epoch || !current || state.grant?.installationId !== current.installationId || state.grant?.extensionId !== extensionId || state.grant?.grantEpoch !== current.grant?.grantEpoch) return
      runtime = { phase: 'connected', grant: clone(state.grant) }
      notify(current)
      return
    }
    if (state?.phase === 'connecting' || state?.phase === 'offline' || state?.phase === 'stopped') {
      runtime = { phase: state.phase, grant: null }
      const current = await serial(load)
      if (current) notify(current)
      return
    }
    if (state?.phase !== 'unauthorized') return
    runtime = { phase: 'unauthorized', grant: null }
    await serial(async () => {
      if (channel !== candidate || generation !== epoch) return
      const current = await load()
      await save({ ...current, token: undefined, grant: undefined, pending: undefined, error: 'unauthorized' })
      channel = null
      notify({ ...current, token: undefined, grant: undefined, pending: undefined, error: 'unauthorized' })
    })
  }
  const startChannel = async (record, epoch) => {
    if (generation !== epoch || !record.token || !record.grant) throw failure('cancelled')
    stopChannel()
    runtime = { phase: 'connecting', grant: null }
    notify(record)
    let candidate
    candidate = createChannel({
      credentials: { baseUrl: record.baseUrl, installationId: record.installationId, token: record.token, grant: record.grant },
      onCommand: frame => { if (channel === candidate && generation === epoch && runtime.phase === 'connected') return onCommand(clone(frame)) },
      onEvent: frame => { if (channel === candidate && generation === epoch && runtime.phase === 'connected') return onEvent(clone(frame)) },
      onState: state => { void onChannelState(candidate, epoch, state).catch(() => { stopChannel(); runtime = { phase: 'invalid', grant: null }; notify(record) }) },
    })
    if (generation !== epoch) {
      try { candidate.stop() } catch { /* stale channel never becomes active */ }
      throw failure('cancelled')
    }
    channel = candidate
    candidate.start()
  }
  const requireAccess = async (baseUrl, origins) => {
    if (!await hasPermission(baseUrl)) throw failure('permission_required')
    if (origins.length && !await hasOrigins(clone(origins))) throw failure('site_permission_required')
  }
  const resumeChannel = async () => {
    const epoch = generation
    const record = await load()
    if (!record) return null
    if (record.token && record.grant && !channel) {
      try {
        await requireAccess(record.baseUrl, record.grant.origins ?? [])
        if (generation !== epoch) return record
        await startChannel(record, epoch)
      } catch {
        runtime = { phase: 'offline', grant: null }
        notify(record)
      }
    }
    return record
  }

  const api = {
    async read() {
      return serial(async () => {
        const record = await resumeChannel()
        return record ? visible(record) : { baseUrl: null, phase: 'invalid', error: 'invalid_state' }
      })
    },

    async configure(raw) {
      const baseUrl = normalizeBaseUrl(raw)
      generation += 1
      abort?.abort()
      abort = null
      inFlight = null
      stopChannel()
      runtime = { phase: 'configured', grant: null }
      if (!await hasPermission(baseUrl)) throw failure('permission_required')
      return serial(async () => {
        const old = await load()
        invalid = false
        const installationId = old?.baseUrl && old.baseUrl !== baseUrl ? createInstallationId() : old?.installationId ?? createInstallationId()
        const next = { baseUrl, installationId }
        await save(next)
        runtime = { phase: 'configured', grant: null }
        notify(next)
        return visible(next)
      })
    },

    async connect({ scopes, origins }) {
      if (inFlight) return inFlight
      const epoch = ++generation
      const controller = new AbortController()
      abort = controller
      stopChannel()
      runtime = { phase: 'configured', grant: null }
      const work = (async () => {
        const record = await serial(load)
        if (!record) throw failure('invalid_state')
        if (!record.baseUrl) throw failure('not_configured')
        await requireAccess(record.baseUrl, origins)
        if (record.pending) return visible(record)
        if (generation !== epoch || controller.signal.aborted) throw failure('cancelled')
        stopChannel()
        runtime = { phase: 'configured', grant: null }
        notify(record)
        const pending = await transport.begin({ baseUrl: record.baseUrl, installationId: record.installationId, extensionId, scopes, origins, signal: controller.signal })
        await serial(async () => {
          if (generation !== epoch || controller.signal.aborted) throw failure('cancelled')
          const latest = await load()
          if (latest.baseUrl !== record.baseUrl || latest.installationId !== record.installationId) throw failure('cancelled')
          await save({ ...latest, pending, token: undefined, grant: undefined, error: undefined })
        })
        return api.read()
      })()
      inFlight = work
      try { return await work } finally { if (inFlight === work) inFlight = null; if (abort === controller) abort = null }
    },

    async poll() {
      if (inFlight) return inFlight
      const epoch = ++generation
      const controller = new AbortController()
      abort = controller
      const work = (async () => {
        const record = await serial(load)
        if (!record) throw failure('invalid_state')
        if (!record.pending) throw failure('no_pending')
        await requireAccess(record.baseUrl, record.pending.origins)
        if (generation !== epoch || controller.signal.aborted) throw failure('cancelled')
        const result = await transport.exchange(clone(record.pending), { signal: controller.signal })
        if (result.phase === 'pending') return api.read()
        if (result.phase !== 'connected') throw failure('invalid_exchange')
        let connected
        await serial(async () => {
          if (generation !== epoch || controller.signal.aborted) throw failure('cancelled')
          const latest = await load()
          if (latest.pending?.requestId !== record.pending.requestId) throw failure('cancelled')
          connected = { ...latest, pending: undefined, token: result.token, grant: result.grant, error: undefined }
          await save(connected)
        })
        await startChannel(connected, epoch)
        return api.read()
      })()
      inFlight = work
      try { return await work } finally { if (inFlight === work) inFlight = null; if (abort === controller) abort = null }
    },

    async cancel() {
      generation += 1
      abort?.abort()
      abort = null
      inFlight = null
      stopChannel()
      runtime = { phase: 'configured', grant: null }
      return serial(async () => {
        const record = await load()
        if (!record) return { baseUrl: null, phase: 'invalid', error: 'invalid_state' }
        const next = { ...record, pending: undefined, error: undefined }
        runtime = { phase: next.baseUrl ? 'configured' : 'unconfigured', grant: null }
        await save(next)
        notify(next)
        return visible(next)
      })
    },

    async disconnect() {
      generation += 1
      abort?.abort()
      abort = null
      inFlight = null
      stopChannel()
      return serial(async () => {
        const record = await load()
        if (!record) return { baseUrl: null, phase: 'invalid', error: 'invalid_state' }
        const next = { ...record, pending: undefined, token: undefined, grant: undefined, error: undefined }
        runtime = { phase: next.baseUrl ? 'configured' : 'unconfigured', grant: null }
        await save(next)
        notify(next)
        return visible(next)
      })
    },

    async openApproval() {
      const record = await serial(load)
      if (!record) throw failure('invalid_state')
      if (!record.pending) throw failure('no_pending')
      await openApprovalPage(approvalUrl(record.pending))
    },

    call(...args) {
      if (!channel) return Promise.reject(failure('offline'))
      return channel.call(...args)
    },

    sendReceipt(receipt) { return channel?.sendReceipt(receipt) ?? false },
    getGrant() { return !invalid && channel && runtime.phase === 'connected' && runtime.grant ? clone(runtime.grant) : null },
    permit(request) {
      const grant = !invalid && channel && runtime.phase === 'connected' ? runtime.grant : null
      const scopes = Array.isArray(request?.scopes) ? request.scopes : request?.scope ? [request.scope] : []
      return !!grant && request?.installationId === grant.installationId && request?.grantEpoch === grant.grantEpoch && scopes.every(scope => grant.scopes.includes(scope))
    },
  }
  return api
}
