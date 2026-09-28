const CONNECTION_KEY = 'dsh.codex.browser.connection.v1'
const DEFAULT_BASE_URL = 'http://127.0.0.1:3091'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const EXTENSION_ID = /^[a-p]{32}$/u
const BASE64_URL_32 = /^[A-Za-z0-9_-]{43}$/u
const TERMINAL_REASONS = ['authorization_revoked', 'invalid_credentials', 'extension_not_trusted', 'origin_mismatch', 'protocol_rejected']

const clone = value => structuredClone(value)
const failure = code => Object.assign(new Error(code), { code })
const loopbackUrl = raw => {
  let url
  try { url = new URL(raw) } catch { throw failure('invalid_codex_bridge_url') }
  if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' && url.pathname !== ''
    || url.search || url.hash || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw failure('invalid_codex_bridge_url')
  return url.href.replace(/\/$/u, '')
}
const validGrant = (grant, installationId, extensionId) => grant && grant.installationId === installationId
  && grant.extensionId === extensionId && Number.isSafeInteger(grant.grantEpoch) && grant.grantEpoch > 0
  && Array.isArray(grant.origins) && grant.origins.every(origin => typeof origin === 'string')
  && Array.isArray(grant.scopes) && grant.scopes.includes('browser:read') && grant.scopes.includes('browser:write')
  && typeof grant.createdAt === 'string' && Number.isFinite(Date.parse(grant.createdAt))

/** A local-only Codex bridge. Its credentials and WebSocket lifecycle never depend on DSH. */
export const createCodexBrowserConnection = ({ storage, extensionId, fetchImpl = fetch, createChannel, createInstallationId = () => crypto.randomUUID(),
  changed = () => {}, onCommand = () => {}, onEvent = () => {} }) => {
  let record = null
  let channel = null
  let initialized = false
  let activeGrant = null
  let phase = 'unconfigured'
  let retryPending = false
  let retryPaused = false
  let initializing = null
  let revision = 0
  let persistence = Promise.resolve()
  let pairing = null
  let connecting = null

  const view = () => ({ baseUrl: record?.baseUrl ?? null, installationId: record?.installationId ?? null,
    phase, ...(record?.blockedReason ? { reason: record.blockedReason } : {}),
    ...(phase === 'offline' ? { retryPaused, retryPending } : {}), ...(activeGrant ? { grant: clone(activeGrant) } : {}) })
  const publish = () => { changed(view()) }
  const persist = patch => {
    const work = persistence.then(() => storage.set(patch))
    persistence = work.catch(() => {})
    return work
  }
  const validate = candidate => {
    if (!candidate || typeof candidate !== 'object') return null
    const baseUrl = loopbackUrl(candidate.baseUrl ?? DEFAULT_BASE_URL)
    if (!UUID_V4.test(candidate.installationId)) throw failure('invalid_codex_connection')
    if (candidate.token === undefined && candidate.grant === undefined) return { baseUrl, installationId: candidate.installationId,
      ...(candidate.reauthorize === true ? { reauthorize: true } : {}),
      ...(candidate.blocked === true ? { blocked: true } : {}),
      ...(TERMINAL_REASONS.includes(candidate.blockedReason) ? { blockedReason: candidate.blockedReason } : {}),
      ...(candidate.retryPaused === true ? { retryPaused: true } : {}) }
    if (!BASE64_URL_32.test(candidate.token) || !validGrant(candidate.grant, candidate.installationId, extensionId)) throw failure('invalid_codex_connection')
    return { baseUrl, installationId: candidate.installationId, token: candidate.token, grant: clone(candidate.grant),
      ...(candidate.retryPaused === true ? { retryPaused: true } : {}) }
  }
  const start = (once = false) => {
    if (!record || record.blocked || (!record.token || !record.grant) && !record.reauthorize || channel) return
    const expectedRecord = record
    const expectedRevision = revision
    phase = 'connecting'
    let nextChannel
    const current = () => channel === nextChannel && record === expectedRecord && revision === expectedRevision
    nextChannel = createChannel({ credentials: clone(record),
      renewCredentials: () => authorize(expectedRecord, expectedRevision),
      onCommand: (frame) => { if (current()) onCommand(clone(frame), { sendReceipt: (...args) => nextChannel.sendReceipt(...args) }) },
      onEvent: frame => { if (current()) onEvent(clone(frame)) },
      onState: state => {
        if (!current()) return
        if (state.phase === 'connected' && validGrant(state.grant, record?.installationId, extensionId)) {
          activeGrant = clone(state.grant); phase = 'connected'
        } else if (state.phase === 'stable') {
          phase = 'connected'
          delete record.retryPaused
          void persist({ [CONNECTION_KEY]: clone(record) }).catch(() => {})
        } else if (state.phase === 'credentials-expired') {
          activeGrant = null
          delete record.token; delete record.grant
          record.reauthorize = true
          void persist({ [CONNECTION_KEY]: clone(record) }).catch(() => {
            if (current()) { nextChannel.stop(); phase = 'invalid'; publish() }
          })
        } else if (['offline', 'unauthorized', 'invalid', 'stopped'].includes(state.phase)) {
          activeGrant = null; phase = state.phase
          retryPending = state.retryPending === true
          retryPaused = state.retryPaused === true
          if (state.phase === 'offline' && (state.pauseOnRestart || state.retryPaused)) {
            record.retryPaused = true
            void persist({ [CONNECTION_KEY]: clone(record) }).catch(() => {
              if (current()) { nextChannel.stop(); phase = 'invalid'; publish() }
            })
          }
          if (state.phase === 'unauthorized' || state.phase === 'invalid') {
            delete record.token; delete record.grant; delete record.retryPaused; delete record.reauthorize
            record.blocked = true
            record.blockedReason = TERMINAL_REASONS.includes(state.reason) ? state.reason : 'authorization_revoked'
            void persist({ [CONNECTION_KEY]: clone(record) }).catch(() => {})
          }
        } else if (state.phase === 'connecting') phase = 'connecting'
        publish()
      },
    })
    channel = nextChannel
    if (once) nextChannel.start({ once: true })
    else nextChannel.start()
    publish()
  }
  const initialize = async () => {
    if (initialized) return view()
    if (initializing) return initializing
    initializing = (async () => {
      const stored = (await storage.get(CONNECTION_KEY))[CONNECTION_KEY]
      if (stored !== undefined) {
        try {
          record = validate(stored); phase = 'configured'
          if (record?.blocked) phase = 'unauthorized'
          else if (record?.retryPaused) { phase = 'offline'; retryPaused = true; retryPending = false }
          else start()
        }
        catch { record = null; phase = 'invalid' }
      } else phase = 'unconfigured'
      initialized = true
      publish()
      return view()
    })().finally(() => { initializing = null })
    return initializing
  }
  const configure = async raw => {
    await initialize()
    const baseUrl = loopbackUrl(raw)
    if (record?.baseUrl === baseUrl) return view()
    revision += 1
    channel?.stop(); channel = null; activeGrant = null
    record = { baseUrl, installationId: record?.installationId ?? createInstallationId() }
    if (!UUID_V4.test(record.installationId)) throw failure('invalid_installation_id')
    phase = 'configured'
    await persist({ [CONNECTION_KEY]: clone(record) })
    publish()
    return view()
  }
  const authorize = (requestedRecord, requestedRevision) => {
    if (pairing?.revision === requestedRevision) return pairing.promise
    const current = () => revision === requestedRevision && record === requestedRecord
    const promise = (async () => {
      await persistence
      if (!current()) throw failure('connection_cancelled')
      const response = await fetchImpl(`${requestedRecord.baseUrl}/browser-connector/connect`, {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ extensionId, installationId: requestedRecord.installationId }), credentials: 'omit', redirect: 'error',
        signal: AbortSignal.timeout(3000),
      }).catch(() => { throw failure('codex_bridge_offline') })
      let body
      try { body = await response.json() } catch { throw failure('invalid_codex_bridge_response') }
      if (!current()) throw failure('connection_cancelled')
      if (response?.status !== 200) {
        const code = body?.error?.code
        throw failure(response?.status === 403 && ['authorization_revoked', 'extension_not_trusted', 'origin_mismatch'].includes(code)
          ? code : 'codex_bridge_connect_failed')
      }
      const next = validate({ baseUrl: requestedRecord.baseUrl, installationId: requestedRecord.installationId, token: body?.token, grant: body?.grant })
      Object.assign(record, next)
      delete record.reauthorize; delete record.blocked; delete record.blockedReason
      await persist({ [CONNECTION_KEY]: clone(record) })
      if (!current()) throw failure('connection_cancelled')
      return clone(record)
    })().finally(() => { if (pairing?.promise === promise) pairing = null })
    pairing = { revision: requestedRevision, promise }
    return promise
  }
  const connect = () => {
    if (connecting) return connecting
    const work = (async () => {
      await initialize()
      if (!EXTENSION_ID.test(extensionId)) throw failure('invalid_extension_id')
      if (!record) await configure(DEFAULT_BASE_URL)
      if (record.blocked) return view()
      if (channel && ['connecting', 'connected'].includes(phase)) return view()
      if (record.reauthorize || record.token && record.grant) { await retrySaved(); return view() }
      const expectedRevision = revision
      phase = 'connecting'; publish()
      try { await authorize(record, expectedRevision) }
      catch (error) {
        if (revision !== expectedRevision) return view()
        phase = ['authorization_revoked', 'extension_not_trusted', 'origin_mismatch'].includes(error.code) ? 'unauthorized' : 'offline'
        if (phase === 'unauthorized') {
          record.blocked = true; record.blockedReason = error.code
          await persist({ [CONNECTION_KEY]: clone(record) })
        }
        publish()
        throw error
      }
      if (revision === expectedRevision) start()
      return view()
    })().finally(() => { if (connecting === work) connecting = null })
    connecting = work
    return work
  }
  const restore = async () => { await initialize(); return view() }
  const retrySaved = async ({ once = false } = {}) => {
    await initialize()
    if (!record || record.blocked || (!record.token || !record.grant) && !record.reauthorize || phase === 'unauthorized' || phase === 'invalid') return false
    if (phase === 'connecting' || phase === 'connected') return true
    const expectedRecord = record, expectedRevision = revision
    phase = 'connecting'; retryPending = false; retryPaused = false
    if (!once) delete record.retryPaused
    await persist({ [CONNECTION_KEY]: clone(record) })
    if (record !== expectedRecord || revision !== expectedRevision) return false
    if (channel) {
      phase = 'connecting'; retryPending = false; retryPaused = false
      if (once) channel.start({ once: true })
      else channel.start()
      publish()
    } else start(once)
    return true
  }
  const disconnect = async () => {
    await initialize()
    revision += 1
    connecting = null
    channel?.stop(); channel = null; activeGrant = null
    if (record) { record = { baseUrl: record.baseUrl, installationId: record.installationId }; await persist({ [CONNECTION_KEY]: clone(record) }) }
    phase = record ? 'configured' : 'unconfigured'; publish(); return view()
  }
  return {
    restore, configure, connect, disconnect, retrySaved,
    read: async () => { await initialize(); return view() },
    getGrant: () => activeGrant ? clone(activeGrant) : null,
    call: (...args) => channel ? channel.call(...args) : Promise.reject(failure('offline')),
    sendReceipt: (...args) => channel?.sendReceipt(...args) ?? false,
  }
}
