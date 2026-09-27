import { normalizeBaseUrl } from './pending.js'
import { probeAssistantService } from './assistant-recovery.js'

const MAX_MESSAGE_BYTES = 16 * 1024 * 1024
const MAX_AUTO_RECONNECTS = 5
const STABLE_CONNECTION_MS = 30_000
const messageBytes = value => new TextEncoder().encode(value).byteLength

// This is deliberately declared by the installed executor, rather than inferred
// by the Host from its own tool registry. A missing declaration fails closed.
const executorCapabilities = Object.freeze({
  protocolVersion: 1,
  actionKinds: Object.freeze(['tabs', 'snapshot', 'page_map', 'entry_inspect', 'entry_mount', 'entry_unmount', 'region_render', 'region_clear',
    'navigate', 'click', 'fill', 'submit', 'scroll', 'wait', 'double_click', 'right_click', 'hover', 'press', 'select', 'check', 'drag', 'upload',
    'back', 'forward', 'reload', 'tab_open', 'tab_close', 'tab_focus', 'screenshot']),
  requestRecovery: true,
  restartStatusLookup: true,
  targetFreeOpen: true,
})

const channelError = (code, reason) => Object.assign(new Error(code), { code, ...(reason === undefined ? {} : { reason }) })
const clone = value => structuredClone(value)

const socketUrlFor = baseUrl => {
  const url = new URL(normalizeBaseUrl(baseUrl))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/api/browser-extension/v1/ws'
  return url.href
}

const validGrant = (grant, credentials) => grant && grant.installationId === credentials.installationId
  && grant.extensionId === credentials.grant.extensionId
  && grant.grantEpoch === credentials.grant.grantEpoch

const matchesRequestIdentity = (identity, credentials, prior = false) => identity?.protocolVersion === 1
  && identity.installationId === credentials.installationId
  && Number.isSafeInteger(identity.grantEpoch) && identity.grantEpoch > 0
  && (identity.grantEpoch === credentials.grant.grantEpoch || prior && identity.grantEpoch < credentials.grant.grantEpoch)
  && typeof identity.requestId === 'string' && typeof identity.sessionId === 'string'
  && Number.isSafeInteger(identity.deadline) && typeof identity.fingerprint === 'string'

const socketIsOpen = (socket, WebSocketImpl) => socket?.readyState === (WebSocketImpl.OPEN ?? 1)
const serializeFrame = frame => {
  const serialized = JSON.stringify(frame)
  return typeof serialized === 'string' && messageBytes(serialized) <= MAX_MESSAGE_BYTES ? serialized : null
}

/**
 * Creates the extension side of the browser-assistant WebSocket protocol.
 *
 * `stop()` prevents any future reconnect, settles pending RPC calls as unknown,
 * and requests that the current WebSocket close. It does not promise that the
 * underlying physical socket has already closed when `stop()` returns.
 */
export const createAssistantChannel = ({
  credentials,
  WebSocketImpl = WebSocket,
  fetchImpl = fetch,
  onState = /** @returns {unknown} */ () => {},
  onCommand = /** @returns {unknown} */ () => {},
  onEvent = /** @returns {unknown} */ () => {},
  runtime,
  reconnectDelayMs = 1000,
  maxPending = 32,
  requestTimeoutMs = 10_000,
}) => {
  const channelCredentials = clone(credentials)
  const runtimeMetadata = typeof runtime?.version === 'string' && runtime.version.length > 0 && runtime.version.length <= 64
    ? { version: runtime.version } : undefined
  let socket = null
  let activeGrant = null
  let stopped = false
  let reconnectTimer = null
  let autoReconnects = 0
  let probe = null
  let oneShot = false
  let connectedAt = null
  let stableTimer = null
  const pending = new Map()
  const authorityCleanups = new Set()

  const report = state => {
    try { Promise.resolve(onState(clone(state))).catch(() => {}) } catch { /* observer failures cannot change transport state */ }
  }

  const settleAll = error => {
    for (const entry of pending.values()) {
      entry.finish()
      entry.reject(error)
    }
    pending.clear()
  }

  const scheduleReconnect = () => {
    if (stopped) return
    if (reconnectTimer || probe) return
    if (oneShot || autoReconnects >= MAX_AUTO_RECONNECTS) {
      report({ phase: 'offline', retryPaused: true, retryPending: false, pauseOnRestart: true })
      return
    }
    const delay = reconnectDelayMs * 2 ** autoReconnects
    autoReconnects += 1
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null
      const controller = new AbortController()
      probe = controller
      const available = await probeAssistantService(channelCredentials.baseUrl, fetchImpl, controller.signal)
      if (probe !== controller || stopped) return
      probe = null
      if (available) connect()
      else scheduleReconnect()
    }, delay)
    report({ phase: 'offline', retryPaused: false, retryPending: true, pauseOnRestart: true })
  }

  const closeCurrent = code => {
    try { socket?.close(code) } catch { /* closing is best effort */ }
  }

  const cleanupAuthority = (grant, acknowledgeSocket = null) => {
    if (!grant) return
    const key = `${grant.installationId}:${grant.grantEpoch}`
    if (authorityCleanups.has(key)) return
    authorityCleanups.add(key)
    const frame = { type: 'authority-revoked', installationId: grant.installationId, grantEpoch: grant.grantEpoch }
    Promise.resolve().then(() => onCommand(clone(frame))).then(() => {
      if (acknowledgeSocket && socket === acknowledgeSocket && socketIsOpen(acknowledgeSocket, WebSocketImpl)) {
        acknowledgeSocket.send(JSON.stringify({ type: 'authority-cleaned', installationId: grant.installationId,
          grantEpoch: grant.grantEpoch }))
      }
    }).catch(() => {})
  }

  const dispatchCommand = frame => {
    const prior = frame.type !== 'execute' && activeGrant?.scopes?.includes('browser:write')
    if (frame.type === 'status-query') {
      const locator = frame.locator
      if (!locator || locator.kind !== 'extension-journal-v1' || locator.protocolVersion !== 1
        || locator.installationId !== channelCredentials.installationId
        || !Number.isSafeInteger(locator.grantEpoch) || locator.grantEpoch < 1 || locator.grantEpoch > activeGrant?.grantEpoch
        || typeof locator.transportRequestId !== 'string' || !locator.transportRequestId
        || typeof frame.sessionId !== 'string' || !frame.sessionId
        || !activeGrant?.scopes?.includes('browser:read')) return
      void Promise.resolve(onCommand(clone(frame))).catch(() => {})
      return
    }
    if (!['execute', 'status', 'cancel'].includes(frame.type) || !matchesRequestIdentity(frame.request, channelCredentials, prior)) return
    Promise.resolve().then(() => onCommand(clone(frame))).catch(() => {})
  }

  const connect = () => {
    if (stopped) return
    let next
    try { next = new WebSocketImpl(socketUrlFor(channelCredentials.baseUrl)) } catch {
      scheduleReconnect()
      return
    }
    socket = next
    activeGrant = null
    report({ phase: 'connecting' })

    next.onopen = () => {
      if (socket !== next || stopped) return
      try {
        next.send(JSON.stringify({ type: 'hello', protocolVersion: 1, installationId: channelCredentials.installationId, token: channelCredentials.token,
          capabilities: executorCapabilities, ...(runtimeMetadata === undefined ? {} : { runtime: runtimeMetadata }) }))
      } catch {
        closeCurrent()
      }
    }
    next.onmessage = event => {
      if (socket !== next || stopped || typeof event.data !== 'string' || messageBytes(event.data) > MAX_MESSAGE_BYTES) {
        if (socket === next && typeof event.data === 'string' && messageBytes(event.data) > MAX_MESSAGE_BYTES) closeCurrent(1009)
        return
      }
      let frame
      try { frame = JSON.parse(event.data) } catch { return }
      if (!frame || typeof frame !== 'object') return
      if (frame.type === 'ready') {
        if (frame.protocolVersion !== 1 || !validGrant(frame.grant, channelCredentials)) {
          closeCurrent(1008)
          return
        }
        activeGrant = clone(frame.grant)
        connectedAt = Date.now()
        if (stableTimer) clearTimeout(stableTimer)
        stableTimer = setTimeout(() => {
          stableTimer = null
          if (socket !== next || stopped || !activeGrant) return
          autoReconnects = 0
          oneShot = false
          report({ phase: 'stable' })
        }, STABLE_CONNECTION_MS)
        report({ phase: 'connected', grant: clone(activeGrant) })
        return
      }
      if (!activeGrant) return
      if (frame.type === 'authority-revoked') {
        if (frame.installationId !== activeGrant.installationId || frame.grantEpoch !== activeGrant.grantEpoch) return
        cleanupAuthority(activeGrant, next)
        return
      }
      if (frame.type === 'reading' && typeof frame.id === 'string' && typeof frame.text === 'string'
        || frame.type === 'event' && typeof frame.streamId === 'string' && frame.streamId.length <= 128
        || frame.type === 'approval' && typeof frame.sessionId === 'string' && frame.sessionId.length <= 256 && Array.isArray(frame.requests)) {
        try { Promise.resolve(onEvent(clone(frame))).catch(() => {}) } catch { /* invalid consumer state cannot take down the carrier */ }
        return
      }
      if (frame.type === 'ping') {
        try { next.send(JSON.stringify({ type: 'pong' })) } catch { closeCurrent() }
        return
      }
      if (frame.type === 'response' && typeof frame.requestId === 'string') {
        const entry = pending.get(frame.requestId)
        if (!entry) return
        pending.delete(frame.requestId)
        entry.finish()
        if (frame.result?.ok === true) entry.resolve(frame.result.value)
        else entry.reject(frame.result?.error ?? channelError('invalid_response'))
        return
      }
      dispatchCommand(frame)
    }
    next.onclose = event => {
      if (socket !== next) return
      if (stableTimer) clearTimeout(stableTimer)
      stableTimer = null
      if (connectedAt !== null && Date.now() - connectedAt >= STABLE_CONNECTION_MS) autoReconnects = 0
      connectedAt = null
      const priorGrant = activeGrant ?? channelCredentials.grant
      socket = null
      activeGrant = null
      settleAll(channelError('result_unknown', 'connection_lost'))
      if (stopped) return
      if (event.code === 4401) {
        cleanupAuthority(priorGrant)
        stopped = true
        report({ phase: 'unauthorized' })
        return
      }
      scheduleReconnect()
    }
    next.onerror = () => {}
  }

  const start = ({ once = false } = {}) => {
    if (stopped || socket) return
    probe?.abort()
    probe = null
    oneShot = once
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
    autoReconnects = 0
    connectedAt = null
    if (stableTimer) clearTimeout(stableTimer)
    stableTimer = null
    connect()
  }

  const stop = () => {
    stopped = true
    probe?.abort()
    probe = null
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
    connectedAt = null
    if (stableTimer) clearTimeout(stableTimer)
    stableTimer = null
    settleAll(channelError('result_unknown', 'connection_lost'))
    const current = socket
    socket = null
    activeGrant = null
    try { current?.close() } catch { /* closing is best effort */ }
    report({ phase: 'stopped' })
  }

  const sendReceipt = (receipt, options = {}) => {
    const lookup = options.restartLookup
    const restartLookup = lookup?.type === 'status-query' && activeGrant?.scopes?.includes('browser:read')
      && lookup.locator?.kind === 'extension-journal-v1' && lookup.locator.protocolVersion === 1
      && lookup.locator.transportRequestId === receipt?.requestId
      && lookup.locator.installationId === receipt?.installationId
      && lookup.locator.grantEpoch === receipt?.grantEpoch
      && lookup.sessionId === receipt?.sessionId
      && receipt?.grantEpoch <= activeGrant.grantEpoch
    if (!socketIsOpen(socket, WebSocketImpl) || !activeGrant
      || !matchesRequestIdentity(receipt, channelCredentials, restartLookup || activeGrant.scopes?.includes('browser:write'))) return false
    try {
      const value = receipt.grantEpoch === activeGrant.grantEpoch || restartLookup ? clone(receipt) : {
        ...Object.fromEntries(['protocolVersion', 'grantEpoch', 'requestId', 'sessionId', 'installationId', 'deadline', 'fingerprint'].map(key => [key, receipt[key]])),
        outcome: receipt.outcome, quiescent: receipt.quiescent === true,
      }
      const frame = serializeFrame({ type: 'result', receipt: value })
      if (frame === null) return false
      socket.send(frame)
      return true
    } catch { return false }
  }

  const call = (method, params, { signal, timeoutMs = requestTimeoutMs } = {}) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(channelError('cancelled')); return }
    if (!socketIsOpen(socket, WebSocketImpl) || !activeGrant) { reject(channelError('offline')); return }
    if (pending.size >= maxPending) { reject(channelError('max_pending')); return }
    const requestId = crypto.randomUUID()
    let frame
    try { frame = serializeFrame({ type: 'request', requestId, method, params }) } catch {
      reject(channelError('invalid_request'))
      return
    }
    if (frame === null) { reject(channelError('request_too_large')); return }
    let timer = null
    let sent = false
    const finish = () => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      if (!pending.delete(requestId)) return
      finish()
      reject(sent ? channelError('result_unknown', 'cancelled') : channelError('cancelled'))
    }
    pending.set(requestId, { resolve, reject, finish })
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => {
      if (!pending.delete(requestId)) return
      finish()
      reject(channelError('result_unknown', 'request_timeout'))
    }, timeoutMs)
    try {
      socket.send(frame)
      sent = true
    } catch {
      if (pending.delete(requestId)) { finish(); reject(channelError('result_unknown', 'connection_lost')) }
    }
  })

  return { start, stop, sendReceipt, call }
}
