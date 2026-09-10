import { normalizeBaseUrl } from './pending.js'

const MAX_MESSAGE_BYTES = 16 * 1024 * 1024
const messageBytes = value => new TextEncoder().encode(value).byteLength

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
  onState = /** @returns {unknown} */ () => {},
  onCommand = /** @returns {unknown} */ () => {},
  onEvent = /** @returns {unknown} */ () => {},
  reconnectDelayMs = 1000,
  maxPending = 32,
  requestTimeoutMs = 10_000,
}) => {
  const channelCredentials = clone(credentials)
  let socket = null
  let activeGrant = null
  let stopped = false
  let reconnectTimer = null
  const pending = new Map()

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
    if (stopped || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, reconnectDelayMs)
  }

  const closeCurrent = code => {
    try { socket?.close(code) } catch { /* closing is best effort */ }
  }

  const dispatchCommand = frame => {
    const prior = frame.type !== 'execute' && activeGrant?.scopes?.includes('browser:write')
    if (!['execute', 'status', 'cancel'].includes(frame.type) || !matchesRequestIdentity(frame.request, channelCredentials, prior)) return
    Promise.resolve().then(() => onCommand(clone(frame))).catch(() => {})
  }

  const connect = () => {
    if (stopped) return
    let next
    try { next = new WebSocketImpl(socketUrlFor(channelCredentials.baseUrl)) } catch {
      report({ phase: 'offline' })
      scheduleReconnect()
      return
    }
    socket = next
    activeGrant = null
    report({ phase: 'connecting' })

    next.onopen = () => {
      if (socket !== next || stopped) return
      try {
        next.send(JSON.stringify({ type: 'hello', protocolVersion: 1, installationId: channelCredentials.installationId, token: channelCredentials.token }))
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
        report({ phase: 'connected', grant: clone(activeGrant) })
        return
      }
      if (!activeGrant) return
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
      socket = null
      activeGrant = null
      settleAll(channelError('result_unknown', 'connection_lost'))
      if (stopped) return
      if (event.code === 4401) {
        stopped = true
        report({ phase: 'unauthorized' })
        return
      }
      report({ phase: 'offline' })
      scheduleReconnect()
    }
    next.onerror = () => {}
  }

  const start = () => {
    if (stopped) return
    if (!socket && !reconnectTimer) connect()
  }

  const stop = () => {
    stopped = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
    settleAll(channelError('result_unknown', 'connection_lost'))
    const current = socket
    socket = null
    activeGrant = null
    try { current?.close() } catch { /* closing is best effort */ }
    report({ phase: 'stopped' })
  }

  const sendReceipt = receipt => {
    if (!socketIsOpen(socket, WebSocketImpl) || !activeGrant || !matchesRequestIdentity(receipt, channelCredentials, activeGrant.scopes?.includes('browser:write'))) return false
    try {
      const value = receipt.grantEpoch === activeGrant.grantEpoch ? clone(receipt) : {
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
