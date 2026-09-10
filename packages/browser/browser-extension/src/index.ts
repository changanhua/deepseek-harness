import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import WebSocket, { WebSocketServer, type RawData } from 'ws'
import Browser from '@changanhua/dsh-browser'
import type { BrowserOperation, BrowserObservation, BrowserAction, BrowserActionResult, BrowserInstance,
  BrowserEntryEvent, BrowserPreparedAction, BrowserPreparedTicket } from '@changanhua/dsh-browser'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bridge } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { BrowserGrants, type GrantSummary } from './grants.ts'
import { BrowserRequests, sealBrowserInvocation } from './requests.ts'
import { approvalHtml, approvalScript } from './approval-ui.ts'
import { BrowserSessions } from './sessions.ts'
import { BrowserPreparations } from './prepared.ts'
import { BrowserApprovals } from './approvals.ts'
import { BrowserMonitors } from './monitors.ts'
import { BrowserActivities } from './activity.ts'
import { BrowserReadings } from './readings.ts'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { BROWSER_EXTENSION_PATH as API, approveSchema, browserActionSchema, connectSchema,
  exchangeSchema, extensionFrameSchema, extensionIdSchema, entryEventSchema, EntryEventInput, jsonValueSchema, requestSchema, revokeSchema, approvalPresenceSchema, approvalDecideSchema, browserAcknowledgeSchema } from './wire.ts'

/** Bounds for the Host connection, handshake, and retained operation receipts. */
export interface Config {
  requestTTL?: number
  pendingLimit?: number
  maxGrants?: number
  requestTimeoutMs?: number
  requestCapacity?: number
  maxRequestBytes?: number
  maxResultBytes?: number
  maxFrameBytes?: number
  handshakeTimeoutMs?: number
  heartbeatIntervalMs?: number
  receiptRetentionMs?: number
  maxSessionRequests?: number
  maxMounts?: number
}
interface Peer {
  readonly socket: WebSocket
  readonly extensionId: string
  readonly done: Promise<void>
  grant?: GrantSummary
  binding?: ReturnType<BrowserRequests['connect']>
  chain: Promise<void>
  queuedBytes: number
  lastSeen: number
  sessions?: BrowserSessions
  readings?: BrowserReadings
  approval?: { readonly id: string; readonly permit: () => boolean; readonly send: (frame: unknown) => void }
  readonly pending: Set<Promise<void>>
}

/** One live page entry mount; late clicks from another document are rejected against it. */
interface MountRegistration {
  readonly installationId: string
  readonly sessionId: string
  readonly grantEpoch: number
  readonly tabId: number
  readonly frameId: number
  readonly documentId: string
  readonly url: string
  readonly mountId: string
}

/** Authenticated browser provider over the existing Host web server. */
export class BrowserExtension extends Browser {
  static inject = ['webServer', 'connection', 'credentials', 'sessionController']
  static Config: z<Config> = z.object({
    requestTTL: z.natural().min(1).max(300000).default(300000),
    pendingLimit: z.natural().min(1).max(32).default(32),
    maxGrants: z.natural().min(1).max(128).default(16),
    requestTimeoutMs: z.natural().min(1).max(120000).default(30000),
    requestCapacity: z.natural().min(1).max(256).default(128),
    maxRequestBytes: z.natural().min(1024).max(1048576).default(65536),
    maxResultBytes: z.natural().min(1024).max(1048576).default(524288),
    maxFrameBytes: z.natural().min(1024).max(16777216).default(16777216),
    handshakeTimeoutMs: z.natural().min(1).max(10000).default(5000),
    heartbeatIntervalMs: z.natural().min(1000).max(25000).default(20000),
    receiptRetentionMs: z.natural().min(1000).max(300000).default(60000),
    maxSessionRequests: z.natural().min(1).max(8).default(4),
    maxMounts: z.natural().min(1).max(16).default(8),
  })
  private readonly config: Required<Config>
  private readonly grants: BrowserGrants
  private readonly requests: BrowserRequests
  private readonly preparations: BrowserPreparations
  private readonly approvals: BrowserApprovals
  private readonly sockets: WebSocketServer
  private readonly peers = new Set<Peer>()
  private readonly installed = new Map<string, Peer>()
  private readonly mounts = new Map<string, MountRegistration>()
  private closed = false

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = BrowserExtension.Config(config) as Required<Config>
    this.requests = new BrowserRequests({ capacity: this.config.requestCapacity,
      maxRequestBytes: this.config.maxRequestBytes, maxResultBytes: this.config.maxResultBytes,
      maxDurationMs: this.config.requestTimeoutMs, receiptRetentionMs: this.config.receiptRetentionMs })
    this.preparations = new BrowserPreparations({ capacity: this.config.requestCapacity, requestTTL: this.config.requestTTL,
      requestDeadlineMs: this.config.requestTimeoutMs, permit: (operation, epoch) => {
        const grant = this.installed.get(operation.installationId)?.grant
        const scope = ['tabs', 'snapshot', 'wait', 'screenshot'].includes(operation.action.kind) ? 'browser:read' : 'browser:write'
        return !this.closed && grant !== undefined && grant.grantEpoch === epoch
          && grant.scopes.includes(scope) && this.grants.permit(grant)
      },
      verify: async (operation, epoch) => {
        const grant = (await this.grants.list()).find(candidate => candidate.installationId === operation.installationId)
        return !this.closed && grant !== undefined && grant.grantEpoch === epoch && this.grants.permit(grant)
      },
      dispatch: request => this.dispatch(request.operation, request.action, request.payload, request.mutates,
        request.target, request.deadline, request.signal, request.grantEpoch) })
    this.approvals = new BrowserApprovals({ maxPending: this.config.maxSessionRequests, ttl: this.config.requestTTL })
    ctx.effect(() => ctx.on('approval/request', (request, next) => this.approvals.answer(request, next), { prepend: true }), 'browser-extension: native approval answerer')
    this.grants = new BrowserGrants(ctx, this.config, (id) => { this.disconnect(id) })
    this.sockets = new WebSocketServer({ noServer: true, maxPayload: this.config.maxFrameBytes })
    ctx.effect(() => async () => {
      this.requests.dispose()
      this.preparations.dispose()
      this.approvals.dispose()
      this.closed = true
      this.mounts.clear()
      for (const peer of this.peers) peer.socket.terminate()
      await Promise.all([this.grants.dispose(), ...[...this.peers].map(peer => peer.done)])
      await new Promise<void>((resolve) => { this.sockets.close(() => { resolve() }) })
    }, 'browser-extension: connection lifetime')
  }

  async [Service.init](): Promise<void> {
    await this.grants.start()
    if (this.closed) return
    this.ctx.effect(() => this.ctx.webServer.register({ kind: 'prefix', path: API, handler: (req, res) => {
      const owner = new URL(req.url ?? '/', 'http://local').pathname.startsWith(API + '/owner/')
      const rejection = owner ? this.ctx.connection.requestRejection(req) : this.ctx.connection.requestAuthorityRejection(req)
      if (rejection !== undefined) { res.writeHead(rejection); res.end(); return }
      return bridge(req, res, { fetch: request => this.http(request, owner) }, this.config.maxFrameBytes)
    } }), 'browser-extension: HTTP protocol')
    this.ctx.effect(() => this.ctx.webServer.registerUpgrade({ path: API + '/ws', handler: (req, socket, head) => { this.upgrade(req, socket, head) } }), 'browser-extension: WebSocket route')
    this.ctx.effect(() => this.ctx.webServer.register({ kind: 'prefix', path: '/browser-assistant', handler: (req, res) => {
      if (this.ctx.connection.requestAuthorityRejection(req) !== undefined) { res.writeHead(403); res.end(); return }
      if (!this.ctx.connection.authorizeIndex(req, res)) return
      const path = new URL(req.url ?? '/', 'http://local').pathname
      if (req.method !== 'GET' || !['/browser-assistant', '/browser-assistant/app.js'].includes(path)) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'Content-Type': path.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
        'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" })
      res.end(path.endsWith('.js') ? approvalScript : approvalHtml)
    } }), 'browser-extension: owner approval page')
    this.ctx.effect(() => {
      const timer = setInterval(() => {
        for (const peer of this.peers) {
          if (Date.now() - peer.lastSeen > 2 * this.config.heartbeatIntervalMs) peer.socket.terminate()
          else if (peer.grant !== undefined && peer.socket.readyState === WebSocket.OPEN) peer.socket.send(JSON.stringify({ type: 'ping' }))
        }
      }, this.config.heartbeatIntervalMs)
      timer.unref()
      return () => { clearInterval(timer) }
    }, 'browser-extension: MV3 message heartbeat')
  }

  override async instances(): Promise<readonly BrowserInstance[]> {
    if (this.closed) return []
    return (await this.grants.list()).filter(grant => this.grants.permit(grant)).map(grant => ({
      installationId: grant.installationId, extensionId: grant.extensionId,
      grantEpoch: grant.grantEpoch, origins: [...grant.origins], scopes: [...grant.scopes],
      online: this.installed.has(grant.installationId) }))
  }

  override isAuthorized(instance: BrowserInstance): boolean {
    return !this.closed && this.grants.permit(instance)
  }

  override async execute(operation: BrowserOperation, signal: AbortSignal): Promise<BrowserActionResult> {
    const fixed = structuredClone(operation)
    const parsed = browserActionSchema.safeParse(fixed.action)
    if (!parsed.success) return this.failure(fixed, signal, 'invalid_action')
    const action = normalizeAction(parsed.data)
    const mutates = !['tabs', 'snapshot', 'entry_inspect', 'wait', 'screenshot'].includes(action.kind)
    if (action.kind === 'entry_mount' && this.mounts.size >= this.config.maxMounts
      && !this.mounts.has(`${fixed.installationId}\u0000${action.mountId}`)) {
      return this.failure(fixed, signal, 'mount_capacity')
    }
    return this.dispatch(fixed, action, jsonValueSchema.parse(action), mutates,
      'element' in action ? action.element.page : 'page' in action ? action.page : undefined, Date.now() + this.config.requestTimeoutMs, signal)
  }

  override observe(operation: BrowserObservation, signal: AbortSignal): Promise<BrowserActionResult> {
    const fixed = structuredClone(operation)
    const parsed = browserActionSchema.safeParse(fixed.action)
    if (!parsed.success || !['tabs', 'snapshot'].includes(parsed.data.kind)
      || !Number.isSafeInteger(fixed.grantEpoch) || fixed.grantEpoch < 1) {
      return Promise.resolve(this.failure(fixed, signal, 'invalid_observation'))
    }
    const action = normalizeAction(parsed.data)
    return this.dispatch(fixed, action, { kind: 'observe', action }, false, undefined,
      Date.now() + this.config.requestTimeoutMs, signal, fixed.grantEpoch, true)
  }

  override async prepare(operation: BrowserOperation, signal: AbortSignal): Promise<BrowserPreparedAction> {
    const fixed = structuredClone(operation)
    const parsed = browserActionSchema.safeParse(fixed.action)
    // Persistent mounts have no one-shot preparation or approval card.
    if (!parsed.success || ['entry_inspect', 'entry_mount', 'entry_unmount'].includes(parsed.data.kind)) throw Object.assign(new Error('invalid_action'), { code: 'invalid_action' })
    const action = normalizeAction(parsed.data)
    const grant = (await this.grants.list()).find(candidate => candidate.installationId === fixed.installationId)
    const mutates = !['tabs', 'snapshot', 'entry_inspect', 'wait', 'screenshot'].includes(action.kind)
    if (grant === undefined || !this.grants.permit(grant) || !grant.scopes.includes(mutates ? 'browser:write' : 'browser:read')) throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' })
    return this.preparations.prepare({ ...fixed, action }, signal, grant.grantEpoch)
  }

  override executePrepared(ticket: BrowserPreparedTicket, signal: AbortSignal): Promise<BrowserActionResult> {
    return this.preparations.execute(ticket, signal)
  }

  private async dispatch(
    operation: BrowserOperation,
    action: BrowserAction,
    payload: unknown,
    mutates: boolean,
    target: { readonly tabId: number; readonly frameId: number; readonly documentId: string; readonly url: string } | undefined,
    deadline: number,
    signal: AbortSignal,
    expectedEpoch?: number,
    observation = false,
  ): Promise<BrowserActionResult> {
    const unavailable = this.unavailable(signal)
    if (unavailable !== undefined) return this.failure(operation, signal, unavailable)
    const requestId = randomUUID()
    const grant = (await this.grants.list()).find(grant => grant.installationId === operation.installationId)
    if (grant === undefined || expectedEpoch !== undefined && grant.grantEpoch !== expectedEpoch || !this.grants.permit(grant) || !grant.scopes.includes(mutates ? 'browser:write' : 'browser:read')) return this.failure(operation, signal, 'unauthorized')
    if (observation && !grant.scopes.includes('browser:observe')) return this.failure(operation, signal, 'observation_not_authorized')
    if (target !== undefined && !allows(grant, target.url) || (action.kind === 'navigate' || action.kind === 'tab_open') && !allows(grant, action.url)) return this.failure(operation, signal, 'site_not_authorized')
    // `list()` may await a credential refresh. Fence its captured epoch immediately before dispatch.
    const finalUnavailable = this.unavailable(signal)
    if (finalUnavailable !== undefined || !this.grants.permit(grant)) {
      return this.failure(operation, signal, finalUnavailable ?? 'unauthorized')
    }
    // Scope decisions and the send permit are made by this provider, not by a model's mutates flag.
    const request = sealBrowserInvocation({ protocolVersion: 1, grantEpoch: grant.grantEpoch, requestId,
      sessionId: operation.sessionId, installationId: operation.installationId, deadline,
      mutates, payload: jsonValueSchema.parse(payload),
      ...(target === undefined ? {} : { target: { tabId: target.tabId, frameId: target.frameId, documentId: target.documentId } }),
    })
    const result = await this.requests.execute(request, signal)
    // Register or clear the page mount inside the dispatch that owns the grant
    // epoch, so late clicks are checked against the authorization that mounted them.
    if (action.kind === 'entry_mount') {
      if (result.outcome === 'observed') {
        this.mounts.set(`${operation.installationId}\u0000${action.mountId}`, {
          installationId: operation.installationId, sessionId: operation.sessionId, grantEpoch: grant.grantEpoch,
          tabId: action.page.tabId, frameId: action.page.frameId, documentId: action.page.documentId,
          url: action.page.url, mountId: action.mountId,
        })
      }
    } else if (action.kind === 'entry_unmount') {
      this.mounts.delete(`${operation.installationId}\u0000${action.mountId}`)
    }
    return {
      requestId: result.requestId,
      sessionId: operation.sessionId,
      installationId: result.installationId,
      outcome: result.outcome,
      delivery: result.delivery,
      ...(result.reason === undefined ? {} : { reason: result.reason }),
      ...(result.value === undefined ? {} : { value: result.value }),
    }
  }

  private failure(operation: BrowserOperation, signal: AbortSignal, reason: string): BrowserActionResult {
    return { requestId: randomUUID(), sessionId: operation.sessionId, installationId: operation.installationId,
      outcome: signal.aborted ? 'cancelled' : 'failed', delivery: 'not-sent', reason }
  }

  private unavailable(signal: AbortSignal): 'closed' | 'cancelled' | undefined {
    return this.closed ? 'closed' : signal.aborted ? 'cancelled' : undefined
  }

  private peerOpen(peer: Peer): boolean { return !this.closed && peer.socket.readyState === WebSocket.OPEN }

  private async http(request: Request, owner: boolean): Promise<Response> {
    const origin = request.headers.get('origin')
    const extension = origin?.startsWith('chrome-extension://') ? origin.slice('chrome-extension://'.length) : undefined
    if (!owner && !extensionIdSchema.safeParse(extension).success) return response(403, { error: 'forbidden' })
    const cors = owner ? undefined : origin ?? undefined
    if (this.closed) return response(503, { error: 'closed' }, cors)
    if (request.method === 'OPTIONS' && !owner) return response(200, {}, cors)
    if (request.method !== 'POST') return response(405, { error: 'method_not_allowed' }, cors)
    try {
      const path = new URL(request.url).pathname.slice(API.length)
      if (path === '/info') return response(200, { protocolVersion: 1, capabilities: ['browser:rpc'],
        scopes: ['session:interact', 'browser:read', 'browser:write', 'browser:observe'] }, cors)
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return response(415, { error: 'content_type' }, cors)
      const body: unknown = await request.json()
      if (path === '/connect' && !owner) {
        const input = connectSchema.parse(body)
        if (input.extensionId !== extension) return response(403, { error: 'forbidden' }, cors)
        return response(201, await this.grants.begin(input), cors)
      }
      const exchange = /^\/connect\/([^/]+)\/token$/u.exec(path)
      if (exchange?.[1] !== undefined && !owner) {
        if (extension === undefined) return response(403, { error: 'forbidden' }, cors)
        const result = await this.grants.exchange(exchange[1], { ...exchangeSchema.parse(body), extensionId: extension })
        return response(result.status === 'pending' ? 202 : 200, result, cors)
      }
      if (owner && path === '/owner/request') return response(200, this.grants.request(requestSchema.parse(body).requestId))
      if (owner && path === '/owner/approve') {
        const { requestId, ...choice } = approveSchema.parse(body)
        return response(200, await this.grants.approve(requestId, choice))
      }
      if (owner && path === '/owner/grants') return response(200, { grants: await this.grants.list() })
      if (owner && path === '/owner/revoke') { await this.grants.revoke(revokeSchema.parse(body).installationId); return response(200, { revoked: true }) }
      return response(404, { error: 'not_found' }, cors)
    } catch { return response(400, { error: 'request_unavailable' }, cors) }
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const raw = req.headers.origin
    const extension = typeof raw === 'string' && raw.startsWith('chrome-extension://') ? raw.slice('chrome-extension://'.length) : undefined
    const parsedExtension = extensionIdSchema.safeParse(extension)
    if (this.closed || this.ctx.connection.requestAuthorityRejection(req) !== undefined || !parsedExtension.success
      || this.peers.size >= this.config.maxGrants + this.config.pendingLimit) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    this.sockets.handleUpgrade(req, socket, head, (websocket) => { this.accept(websocket, parsedExtension.data) })
  }

  private accept(socket: WebSocket, extension: string): void {
    const closed = Promise.withResolvers<void>()
    const peer: Peer = { socket, extensionId: extension, chain: Promise.resolve(), queuedBytes: 0,
      lastSeen: Date.now(), pending: new Set(), done: closed.promise.then(async () => {
        await peer.chain
        await peer.sessions?.dispose()
        await Promise.allSettled([...peer.pending])
      }) }
    this.peers.add(peer)
    const timeout = setTimeout(() => { if (peer.grant === undefined) socket.terminate() }, this.config.handshakeTimeoutMs)
    timeout.unref()
    socket.on('message', (raw: RawData, binary: boolean) => {
      const data = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      const text = data.toString('utf8')
      const bytes = Buffer.byteLength(text)
      if (binary || peer.queuedBytes + bytes > this.config.maxFrameBytes) { socket.terminate(); return }
      peer.queuedBytes += bytes
      peer.chain = peer.chain.then(() => this.message(peer, text)).catch(() => { socket.terminate() })
        .finally(() => { peer.queuedBytes -= bytes })
    })
    socket.on('error', () => { socket.terminate() })
    socket.once('close', () => {
      clearTimeout(timeout)
      peer.readings?.dispose()
      peer.binding?.disconnect()
      if (peer.approval !== undefined) this.approvals.withdraw(peer.approval)
      void peer.sessions?.dispose().catch(() => {})
      if (peer.grant !== undefined && this.installed.get(peer.grant.installationId) === peer) {
        this.installed.delete(peer.grant.installationId)
      }
      closed.resolve()
    })
    void peer.done.then(() => { this.peers.delete(peer) })
  }

  private async message(peer: Peer, text: string): Promise<void> {
    if (!this.peerOpen(peer)) return
    const frame = extensionFrameSchema.parse(JSON.parse(text) as unknown)
    peer.lastSeen = Date.now()
    if (peer.grant === undefined) {
      if (frame.type !== 'hello') throw new Error('authentication required')
      const grant = await this.grants.authenticate(frame.token, peer.extensionId)
      if (grant === undefined || grant.installationId !== frame.installationId || !this.grants.permit(grant)) {
        peer.socket.close(4401, 'authorization required')
        return
      }
      if (!this.peerOpen(peer)) return
      this.disconnect(grant.installationId)
      peer.grant = grant
      this.installed.set(grant.installationId, peer)
      peer.sessions = new BrowserSessions(this.ctx.sessionController, {
        permit: () => !this.closed && peer.socket.readyState === WebSocket.OPEN
          && this.grants.permit(grant) && grant.scopes.includes('session:interact'),
        send: (frame) => { this.sendPeer(peer, frame) }, maxFrameBytes: this.config.maxFrameBytes,
      })
      peer.readings = new BrowserReadings(this.ctx,
        () => this.peerOpen(peer) && this.grants.permit(grant) && grant.scopes.includes('session:interact'),
        frame => this.sendPeer(peer, frame))
      peer.approval = { id: randomUUID(), permit: () => !this.closed && peer.socket.readyState === WebSocket.OPEN
        && this.grants.permit(grant) && grant.scopes.includes('session:interact'), send: (frame) => { this.sendPeer(peer, frame) } }
      peer.socket.send(JSON.stringify({ type: 'ready', protocolVersion: 1, grant, heartbeatIntervalMs: this.config.heartbeatIntervalMs }))
      peer.binding = this.requests.connect(grant.installationId, (outgoing) => {
        const oldCoordination = ['status', 'cancel'].includes(outgoing.type) && outgoing.request.grantEpoch < grant.grantEpoch
        if (this.closed || !this.grants.permit(grant) || !grant.scopes.includes('browser:write') && oldCoordination
          || outgoing.type === 'execute' && outgoing.request.grantEpoch !== grant.grantEpoch
          || !oldCoordination && outgoing.request.grantEpoch !== grant.grantEpoch
          || peer.socket.readyState !== WebSocket.OPEN) throw new Error('send permit withdrawn')
        peer.socket.send(JSON.stringify(outgoing))
      })
      return
    }
    if (!this.grants.permit(peer.grant)) throw new Error('grant revoked')
    if (frame.type === 'result') {
      const old = frame.receipt.grantEpoch < peer.grant.grantEpoch
      if (frame.receipt.installationId !== peer.grant.installationId || frame.receipt.grantEpoch > peer.grant.grantEpoch
        || old && (!peer.grant.scopes.includes('browser:write') || frame.receipt.value !== undefined || frame.receipt.reason !== undefined)) throw new Error('stale authorization epoch')
      const { value, reason, quiescent, ...receipt } = frame.receipt
      peer.binding?.receive({ ...receipt, ...(old ? { reason: 'prior_authorization' } : value === undefined ? {} : { value }),
        ...(old ? {} : reason === undefined ? {} : { reason }), ...(quiescent === undefined ? {} : { quiescent }) })
    }
    else if (frame.type === 'request') {
      if (peer.pending.size >= this.config.maxSessionRequests) {
        this.sendPeer(peer, { type: 'response', requestId: frame.requestId, result: { ok: false, error: { code: 'busy', message: 'Too many outstanding requests' } } })
        return
      }
      const work = this.rpc(peer, frame).finally(() => { peer.pending.delete(work) })
      peer.pending.add(work)
    } else if (frame.type !== 'pong') throw new Error('unexpected authentication frame')
  }

  private async rpc(peer: Peer, frame: { requestId: string; method: string; params?: unknown }): Promise<void> {
    try {
      const grant = peer.grant
      if (grant === undefined) throw new Error('authentication required')
      let value: unknown
      if (frame.method.startsWith('reading.')) {
        if (!peer.readings) throw new Error('reading_unavailable')
        value = await peer.readings.handle(frame.method, frame.params ?? {})
      } else if (frame.method === 'approval.presence') {
        value = this.approvals.presence(this.approvalPeer(peer), approvalPresenceSchema.parse(frame.params ?? {}).sessionId)
      } else if (frame.method === 'approval.decide') {
        value = { accepted: this.approvals.decide(this.approvalPeer(peer), approvalDecideSchema.parse(frame.params ?? {})) }
      } else if (frame.method === 'browser.acknowledge') {
        value = this.acknowledge(peer, browserAcknowledgeSchema.parse(frame.params ?? {}).receipt)
      } else if (frame.method === 'browser.entryEvent') {
        value = this.entryEvent(peer, entryEventSchema.parse(frame.params ?? {}))
      } else if (frame.method === 'instances') {
        value = (await this.instances()).filter(instance => instance.installationId === grant.installationId)
      } else if (frame.method.startsWith('activity.')) {
        const activity = this.ctx.get('browserActivity')
        if (activity === undefined) throw new Error('browser_activity_unavailable')
        value = await new BrowserActivities(activity, grant, () => this.peerOpen(peer) && this.grants.permit(grant))
          .handle(frame.method, frame.params ?? {})
      } else if (frame.method.startsWith('monitor.')) {
        const monitors = this.ctx.get('browserMonitor')
        if (monitors === undefined) throw new Error('browser_monitor_unavailable')
        value = await new BrowserMonitors(monitors, grant, () => this.peerOpen(peer) && this.grants.permit(grant))
          .handle(frame.method, frame.params ?? {})
      } else {
        if (peer.sessions === undefined) throw new Error('session connection unavailable')
        value = await peer.sessions.handle(frame.method, frame.params ?? {})
      }
      this.sendPeer(peer, { type: 'response', requestId: frame.requestId, result: { ok: true, value } })
    } catch (error) {
      const value = typeof error === 'object' && error !== null ? error as { code?: unknown; message?: unknown; failure?: { code?: unknown; message?: unknown } } : {}
      const code = value.failure?.code ?? value.code
      const message = value.failure?.message ?? value.message
      try { this.sendPeer(peer, { type: 'response', requestId: frame.requestId, result: { ok: false, error: {
        code: typeof code === 'string' ? code.slice(0, 128) : 'request_failed',
        message: typeof message === 'string' ? message.slice(0, 1024) : 'Session request failed',
      } } }) } catch { peer.socket.terminate() }
    }
  }

  private approvalPeer(peer: Peer): NonNullable<Peer['approval']> {
    if (peer.approval === undefined || !peer.approval.permit()) throw Object.assign(new Error('forbidden'), { code: 'forbidden' })
    return peer.approval
  }

  private acknowledge(peer: Peer, receipt: ReturnType<typeof browserAcknowledgeSchema.parse>['receipt']): { acknowledged: true } {
    const grant = peer.grant
    if (grant === undefined || !this.grants.permit(grant) || !grant.scopes.includes('browser:write')
      || receipt.installationId !== grant.installationId || receipt.grantEpoch > grant.grantEpoch) throw Object.assign(new Error('forbidden'), { code: 'forbidden' })
    peer.binding?.receive(receipt)
    if (!this.requests.acknowledgeUnknown(receipt)) throw Object.assign(new Error('acknowledgement_unconfirmed'), { code: 'acknowledgement_unconfirmed' })
    return { acknowledged: true }
  }

  /** Gate one page-entry click against the mount table: identity, epoch, and document must match. */
  private entryEvent(peer: Peer, input: EntryEventInput): { accepted: boolean } {
    const grant = peer.grant
    if (grant === undefined) throw Object.assign(new Error('authentication required'), { code: 'authentication required' })
    const key = `${grant.installationId}\u0000${input.mountId}`
    const mount = this.mounts.get(key)
    if (mount === undefined) return { accepted: false }
    if (mount.grantEpoch !== grant.grantEpoch || !this.grants.permit(grant) || !grant.scopes.includes('browser:write')
      || mount.tabId !== input.tabId || mount.frameId !== input.frameId
      || mount.documentId !== input.documentId || mount.url !== input.url) {
      if (mount.grantEpoch !== grant.grantEpoch) this.mounts.delete(key)
      return { accepted: false }
    }
    this.ctx.emit('browser/entry-click', {
      installationId: mount.installationId, sessionId: mount.sessionId as SessionId, mountId: input.mountId,
      entry: { title: input.title, link: input.link }, url: input.url, at: Date.now(),
    } satisfies BrowserEntryEvent)
    return { accepted: true }
  }

  private sendPeer(peer: Peer, frame: unknown): void {
    if (this.closed || peer.grant === undefined || !this.grants.permit(peer.grant) || peer.socket.readyState !== WebSocket.OPEN) throw new Error('send permit withdrawn')
    const text = JSON.stringify(frame)
    if (Buffer.byteLength(text) > this.config.maxFrameBytes || peer.socket.bufferedAmount > this.config.maxFrameBytes) throw new Error('peer output capacity')
    peer.socket.send(text)
  }

  private disconnect(id: string): void {
    const peer = this.installed.get(id)
    if (peer === undefined) return
    this.installed.delete(id)
    peer.binding?.disconnect()
    peer.socket.terminate()
  }
}

function allows(grant: GrantSummary, url: string): boolean {
  try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) && (grant.origins.includes('*') || grant.origins.includes(parsed.origin)) } catch { return false }
}
function normalizeAction(action: ReturnType<typeof browserActionSchema.parse>): BrowserAction {
  if (action.kind === 'entry_inspect') {
    return { kind: action.kind, page: action.page, regionSelector: action.regionSelector, selector: action.selector,
      ...(action.titleSelector === undefined ? {} : { titleSelector: action.titleSelector }),
      ...(action.linkSelector === undefined ? {} : { linkSelector: action.linkSelector }),
      ...(action.sampleLimit === undefined ? {} : { sampleLimit: action.sampleLimit }) }
  }
  if (action.kind === 'entry_mount') {
    return { kind: action.kind, page: action.page, mountId: action.mountId, selector: action.selector, label: action.label,
      ...(action.regionSelector === undefined ? {} : { regionSelector: action.regionSelector }),
      ...(action.titleSelector === undefined ? {} : { titleSelector: action.titleSelector }),
      ...(action.linkSelector === undefined ? {} : { linkSelector: action.linkSelector }),
      ...(action.collected === undefined ? {} : { collected: action.collected }) }
  }
  return action.kind === 'snapshot'
    ? { kind: action.kind, tabId: action.tabId, frameId: action.frameId,
      ...(action.documentId === undefined ? {} : { documentId: action.documentId }),
      ...(action.query === undefined ? {} : { query: action.query }),
      ...(action.offset === undefined ? {} : { offset: action.offset }),
      ...(action.limit === undefined ? {} : { limit: action.limit }),
      ...(action.textLimit === undefined ? {} : { textLimit: action.textLimit }),
      ...(action.tree === undefined ? {} : { tree: action.tree }),
      ...(action.treeCursor === undefined ? {} : { treeCursor: action.treeCursor }),
      ...(action.treeLimit === undefined ? {} : { treeLimit: action.treeLimit }),
      ...(action.includeOptions === undefined ? {} : { includeOptions: action.includeOptions }) }
    : action
}
function response(status: number, body: object, origin?: string): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...(origin === undefined ? {} : {
    'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }) } })
}
export default BrowserExtension
