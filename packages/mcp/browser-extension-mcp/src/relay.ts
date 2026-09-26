import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { z } from 'zod'
import { configSchema, rpcSchema } from './schema.ts'
import type { ConnectorConfig, Grant, Invocation, Receipt, RpcInput } from './types.ts'

const identityKeys = ['protocolVersion', 'grantEpoch', 'requestId', 'sessionId', 'installationId', 'deadline', 'fingerprint'] as const
const MAX_BODY = 64 * 1024
const MAX_RESULT = 3 * 1024 * 1024
const DEADLINE_MS = 20_000

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
function equal(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
function fail(code: string, status = 400): Error { return Object.assign(new Error(code), { code, status }) }
function json(res: ServerResponse, status: number, value: unknown) {
  if (res.destroyed) return
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk as Uint8Array)
    length += bytes.length
    if (length > MAX_BODY) throw fail('request_too_large', 413)
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}
const connectSchema = z.object({ installationId: z.uuid(), extensionId: z.string().regex(/^[a-p]{32}$/u) }).strict()
const capabilitiesSchema = z.object({
  protocolVersion: z.literal(1), requestRecovery: z.literal(true), actionKinds: z.array(z.string().min(1).max(64)).max(64),
  restartStatusLookup: z.literal(true).optional(), targetFreeOpen: z.literal(true).optional(),
}).strict().refine(value => new Set(value.actionKinds).size === value.actionKinds.length)
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** Standalone loopback relay. It imports no Harness runtime and never calls a model. */
export async function startBrowserRelay(input: ConnectorConfig) {
  // Direct server callers receive the bound port; persisted client configuration requires a fixed port.
  const config = configSchema.extend({ port: z.number().int().min(0).max(65535) }).parse(input)
  const grants = new Map<string, Grant>()
  const peers = new Map<string, { socket: WebSocket; capabilities?: z.infer<typeof capabilitiesSchema> }>()
  const calls = new Map<string, {
    request: Invocation
    response: Promise<Receipt>
    result?: Receipt
    expectedUrl?: string
    expiresAt: number
    cleanup?: ReturnType<typeof setTimeout>
    retainedBytes: number
    finish: (result: Receipt) => void
  }>()
  const lookups = new Map<string, {
    installationId: string
    sessionId: string
    grantEpoch: number
    response: Promise<Receipt>
    finish: (result: Receipt) => void
    cleanup: ReturnType<typeof setTimeout>
  }>()
  let retainedBytes = 0
  const forget = (id: string) => {
    const call = calls.get(id)
    if (!call) return
    clearTimeout(call.cleanup)
    retainedBytes -= call.retainedBytes
    calls.delete(id)
  }
  const sockets = new Set<WebSocket>()
  const tokenFor = (id: string) => createHmac('sha256', config.secret).update(id).digest('base64url')
  let port = config.port
  const local = (req: IncomingMessage) => ['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress ?? '')
    && ['127.0.0.1', 'localhost', '[::1]'].some(host => req.headers.host === `${host}:${port}`)
  const trustedOrigin = (req: IncomingMessage) => config.extensionIds.some(id => req.headers.origin === `chrome-extension://${id}`)
  const authorized = (req: IncomingMessage) => req.headers.origin === undefined && equal(req.headers.authorization ?? '', `Bearer ${config.secret}`)
  const unknown = (request: Invocation, reason: string): Receipt => ({ outcome: 'unknown', quiescent: false, requestId: request.requestId,
    sessionId: request.sessionId, installationId: request.installationId, reason })
  const dispatch = async (rpc: RpcInput, signal: AbortSignal): Promise<unknown> => {
    if (rpc.method === 'instances') return { instances: [...grants.values()].map((grant) => {
      const peer = peers.get(grant.installationId)
      return { installationId: grant.installationId, online: peer !== undefined, scopes: grant.scopes,
        capabilities: peer?.capabilities
          ? { targetFreeOpen: peer.capabilities.targetFreeOpen === true, actionKinds: peer.capabilities.actionKinds }
          : { targetFreeOpen: false, actionKinds: [] } }
    }) }
    const installationId = rpc.installationId
    if (!installationId) throw fail('installation_required')
    if (rpc.method === 'status') {
      const requestId = rpc.requestId
      if (!requestId) throw fail('request_id_required')
      const call = calls.get(requestId)
      if (call && (call.request.sessionId !== rpc.sessionId || call.request.installationId !== installationId)) throw fail('request_conflict', 409)
      if (call?.result !== undefined && call.result.outcome !== 'unknown') return call.result
      const peer = peers.get(installationId)
      if (call) {
        if (peer?.socket.readyState === WebSocket.OPEN) peer.socket.send(JSON.stringify({ type: 'status', request: call.request }))
        return call.result ?? unknown(call.request, 'in_flight')
      }
      const grant = grants.get(installationId)
      if (!peer || !grant || peer.socket.readyState !== WebSocket.OPEN || peer.capabilities?.restartStatusLookup !== true) {
        return { outcome: 'unknown', quiescent: false, requestId, sessionId: rpc.sessionId, installationId, reason: 'receipt_unavailable' } satisfies Receipt
      }
      const priorLookup = lookups.get(requestId)
      if (priorLookup) {
        if (priorLookup.installationId !== installationId || priorLookup.sessionId !== rpc.sessionId || priorLookup.grantEpoch !== grant.grantEpoch) throw fail('request_conflict', 409)
        return priorLookup.response
      }
      if (lookups.size >= 256) throw fail('request_capacity', 429)
      let resolveLookup: (result: Receipt) => void = () => {}
      const response = new Promise<Receipt>((resolve) => { resolveLookup = resolve })
      const complete = (result: Receipt) => {
        const lookup = lookups.get(requestId)
        if (!lookup) return
        clearTimeout(lookup.cleanup); lookups.delete(requestId); resolveLookup(result)
      }
      const cleanup = setTimeout(() => complete({ outcome: 'unknown', quiescent: false, requestId, sessionId: rpc.sessionId, installationId, reason: 'receipt_unavailable' }), 2_000)
      cleanup.unref()
      lookups.set(requestId, { installationId, sessionId: rpc.sessionId, grantEpoch: grant.grantEpoch,
        response, finish: complete, cleanup })
      try {
        peer.socket.send(JSON.stringify({ type: 'status-query', locator: { kind: 'extension-journal-v1', protocolVersion: 1,
          installationId, grantEpoch: grant.grantEpoch, transportRequestId: requestId }, sessionId: rpc.sessionId }))
      } catch {
        complete({ outcome: 'unknown', quiescent: false, requestId, sessionId: rpc.sessionId, installationId, reason: 'connection_lost' })
      }
      return response
    }
    const peer = peers.get(installationId), action = rpc.action
    if (!peer || peer.socket.readyState !== WebSocket.OPEN) throw fail('browser_offline', 503)
    if (!action) throw fail('action_required')
    if (action.kind === 'snapshot' && !rpc.expectedUrl) throw fail('expected_url_required')
    if (action.kind === 'tab_open' && !rpc.requestId) throw fail('request_id_required')
    if (rpc.requestId && action.kind !== 'tab_open') throw fail('request_id_not_supported')
    if (action.kind === 'tab_open' && (peer.capabilities?.targetFreeOpen !== true || !peer.capabilities.actionKinds.includes('tab_open'))) throw fail('capability_unavailable', 409)
    if (peer.capabilities && !peer.capabilities.actionKinds.includes(action.kind)) throw fail('capability_unavailable', 409)
    for (const [key, call] of calls) if (call.result && call.expiresAt < Date.now()) forget(key)
    const requestId = rpc.requestId ?? randomUUID()
    const prior = calls.get(requestId)
    if (prior) {
      if (prior.request.sessionId !== rpc.sessionId || prior.request.installationId !== installationId
        || prior.expectedUrl !== rpc.expectedUrl || canonical(prior.request.payload) !== canonical(action)) throw fail('request_conflict', 409)
      return prior.result ?? prior.response
    }
    if (calls.size >= 256) throw fail('request_capacity', 429)
    const page = 'page' in action ? action.page : 'element' in action ? action.element.page : undefined
    const body = { protocolVersion: 1 as const, grantEpoch: 1, requestId, sessionId: rpc.sessionId, installationId,
      deadline: Date.now() + DEADLINE_MS, mutates: !['tabs', 'snapshot', 'screenshot'].includes(action.kind), payload: action,
      ...(page ? { target: { tabId: page.tabId, frameId: page.frameId, documentId: page.documentId } } : {}) }
    const request: Invocation = { ...body, fingerprint: createHash('sha256').update(canonical(body)).digest('hex') }
    let resolveResponse: (result: Receipt) => void = () => {}
    const response = new Promise<Receipt>((resolve) => { resolveResponse = resolve })
    let settled = false
    const finish = (result: Receipt) => {
      const call = calls.get(request.requestId)
      if (call) {
        retainedBytes -= call.retainedBytes
        call.result = result; call.expiresAt = Date.now() + 60_000
        call.retainedBytes = Buffer.byteLength(JSON.stringify(result))
        retainedBytes += call.retainedBytes
        clearTimeout(call.cleanup)
        call.cleanup = setTimeout(() => { forget(request.requestId) }, 60_000)
        call.cleanup.unref()
        for (const [id, old] of calls) {
          if (retainedBytes <= 16 * 1024 * 1024) break
          if (old.result) forget(id)
        }
      }
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      resolveResponse(result)
    }
    const abort = () => {
      if (peer.socket.readyState === WebSocket.OPEN) peer.socket.send(JSON.stringify({ type: 'cancel', request }))
      finish(unknown(request, 'cancelled_or_timeout'))
    }
    const timer = setTimeout(abort, DEADLINE_MS + 1000)
    calls.set(request.requestId, { request, response, finish, expiresAt: request.deadline + 60_000, retainedBytes: 0,
      ...(rpc.expectedUrl ? { expectedUrl: rpc.expectedUrl } : {}) })
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return response }
    try { peer.socket.send(JSON.stringify({ type: 'execute', request })) }
    catch { finish(unknown(request, 'connection_lost')) }
    return response
  }
  const server = createServer((req, res) => {
    void (async () => {
      if (!local(req)) throw fail('local_only', 403)
      const path = new URL(req.url ?? '/', `http://127.0.0.1:${port}`).pathname
      if (trustedOrigin(req)) {
        res.setHeader('access-control-allow-origin', req.headers.origin ?? '')
        res.setHeader('vary', 'Origin')
        if (req.method === 'OPTIONS') {
          res.setHeader('access-control-allow-methods', 'POST')
          res.setHeader('access-control-allow-headers', 'content-type')
          res.writeHead(204); res.end(); return
        }
      }
      if (path === '/health' && req.method === 'GET' && authorized(req)) { json(res, 200, { service: 'browser-extension-connector', protocolVersion: 1 }); return }
      if (req.method !== 'POST') throw fail('method_not_allowed', 405)
      if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw fail('json_required', 415)
      if (path === '/browser-connector/connect') {
        if (!trustedOrigin(req)) throw fail('extension_not_trusted', 403)
        const pair = connectSchema.parse(await readBody(req))
        if (req.headers.origin !== `chrome-extension://${pair.extensionId}`) throw fail('origin_mismatch', 403)
        const existing = grants.get(pair.installationId)
        if (existing && existing.extensionId !== pair.extensionId) throw fail('installation_conflict', 409)
        if (!existing && grants.size >= 32) throw fail('installation_capacity', 429)
        const grant: Grant = existing ?? { ...pair, grantEpoch: 1, origins: ['*'], scopes: ['browser:read', 'browser:write'], createdAt: new Date().toISOString() }
        grants.set(pair.installationId, grant)
        json(res, 200, { token: tokenFor(pair.installationId), grant }); return
      }
      if (path !== '/rpc' || !authorized(req)) throw fail('unauthorized', 403)
      const rpc = rpcSchema.parse(await readBody(req))
      const controller = new AbortController()
      const closed = () => { controller.abort() }
      res.once('close', closed)
      try { json(res, 200, await dispatch(rpc, controller.signal)) }
      finally { res.off('close', closed) }
    })().catch((error: unknown) => {
      const value = record(error)
      json(res, typeof value?.status === 'number' ? value.status : 400, { error: { code: typeof value?.code === 'string' ? value.code : 'invalid_request' } })
    })
  })
  server.headersTimeout = 5000
  server.requestTimeout = 5000
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_RESULT })
  server.on('upgrade', (req, socket, head) => {
    if (!local(req) || !trustedOrigin(req) || req.url !== '/api/browser-extension/v1/ws') { socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws, req) })
  })
  wss.on('connection', (ws, req) => {
    sockets.add(ws)
    let installationId: string | undefined
    const handshake = setTimeout(() =>{  ws.close(1008) }, 5000)
    ws.on('error', () => {})
    ws.on('close', () => {
      clearTimeout(handshake); sockets.delete(ws)
      if (!installationId) return
      const peer = peers.get(installationId)
      if (!peer || peer.socket !== ws) return
      peers.delete(installationId)
      for (const call of calls.values()) if (!call.result && call.request.installationId === installationId) call.finish(unknown(call.request, 'connection_lost'))
    })
    ws.on('message', (bytes) => {
      let frame: Record<string, unknown> | undefined
      const buffer = Array.isArray(bytes) ? Buffer.concat(bytes) : Buffer.from(bytes as ArrayBuffer)
      try { frame = record(JSON.parse(buffer.toString('utf8')) as unknown) } catch { ws.close(1008); return }
      if (!frame) { ws.close(1008); return }
      if (!installationId) {
        const id = typeof frame.installationId === 'string' ? frame.installationId : ''
        const grant = grants.get(id)
        if (frame.type !== 'hello' || frame.protocolVersion !== 1 || !grant || req.headers.origin !== `chrome-extension://${grant.extensionId}`
          || typeof frame.token !== 'string' || !equal(frame.token, tokenFor(id))) { ws.close(1008); return }
        const parsedCapabilities = frame.capabilities === undefined ? undefined : capabilitiesSchema.safeParse(frame.capabilities)
        if (parsedCapabilities && !parsedCapabilities.success) { ws.close(1008); return }
        const old = peers.get(id)
        installationId = id
        peers.set(id, { socket: ws, ...(parsedCapabilities ? { capabilities: parsedCapabilities.data } : {}) })
        clearTimeout(handshake)
        if (old) {
          for (const call of calls.values()) if (!call.result && call.request.installationId === id) call.finish(unknown(call.request, 'connection_replaced'))
          old.socket.terminate()
        }
        ws.send(JSON.stringify({ type: 'ready', protocolVersion: 1, grant })); return
      }
      if (peers.get(installationId)?.socket !== ws) { ws.terminate(); return }
      if (frame.type === 'request' && typeof frame.requestId === 'string') {
        ws.send(JSON.stringify({ type: 'response', requestId: frame.requestId,
          result: { ok: false, error: { code: 'unsupported_method' } } })); return
      }
      if (frame.type !== 'result') return
      const receipt = record(frame.receipt)
      if (!receipt || typeof receipt.requestId !== 'string') return
      const lookup = lookups.get(receipt.requestId)
      if (lookup && lookup.installationId === installationId && lookup.sessionId === receipt.sessionId
        && lookup.grantEpoch === receipt.grantEpoch
        && ['observed', 'failed', 'cancelled', 'unknown'].includes(String(receipt.outcome)) && typeof receipt.quiescent === 'boolean') {
        lookup.finish({ requestId: receipt.requestId, sessionId: lookup.sessionId, installationId, outcome: receipt.outcome as Receipt['outcome'], quiescent: receipt.quiescent,
          ...(typeof receipt.reason === 'string' ? { reason: receipt.reason.slice(0, 1024) } : {}), ...(receipt.value === undefined ? {} : { value: receipt.value }) })
        return
      }
      const call = calls.get(receipt.requestId)
      if (!call || call.request.installationId !== installationId || !identityKeys.every(key => receipt[key] === call.request[key])) return
      if (!['observed', 'failed', 'cancelled', 'unknown'].includes(String(receipt.outcome)) || typeof receipt.quiescent !== 'boolean'
        || receipt.outcome !== 'unknown' && ! receipt.quiescent) return
      const result: Receipt = { requestId: call.request.requestId, sessionId: call.request.sessionId, installationId,
        outcome: receipt.outcome as Receipt['outcome'], quiescent: receipt.quiescent,
        ...(typeof receipt.reason === 'string' ? { reason: receipt.reason.slice(0, 1024) } : {}),
        ...(receipt.value === undefined ? {} : { value: receipt.value }) }
      if (result.outcome === 'observed' && call.request.payload.kind === 'snapshot') {
        const value = record(result.value), page = record(value?.page), action = call.request.payload
        if (!page || page.url !== call.expectedUrl || page.tabId !== action.tabId || page.frameId !== action.frameId
          || typeof page.documentId !== 'string' || action.documentId && page.documentId !== action.documentId) {
          delete result.value; result.outcome = 'failed'; result.reason = 'page_changed'
        } else if (value?.error) { delete result.value; result.outcome = 'failed'; result.reason = 'snapshot_expired' }
      }
      call.finish(result)
    })
  })
  const heartbeat = setInterval(() => { for (const peer of peers.values()) if (peer.socket.readyState === WebSocket.OPEN) peer.socket.send(JSON.stringify({ type: 'ping' })) }, 15000)
  heartbeat.unref()
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.port, '127.0.0.1', resolve) })
  } catch (error) { clearInterval(heartbeat); wss.close(); throw error }
  const address = server.address()
  if (typeof address !== 'object' || !address) throw new Error('listener_missing')
  port = address.port
  return { port, close: async () => {
    clearInterval(heartbeat)
    for (const call of calls.values()) if (!call.result) call.finish(unknown(call.request, 'connector_stopped'))
    for (const [requestId, lookup] of lookups) lookup.finish({ outcome: 'unknown', quiescent: false, requestId, sessionId: lookup.sessionId, installationId: lookup.installationId, reason: 'connector_stopped' })
    for (const id of calls.keys()) forget(id)
    for (const ws of sockets) ws.terminate()
    wss.close()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() })
  } }
}
