/** Browser-extension bridge for the personal Content library. */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { bridge } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { ContentError, WebSourceSchema } from '@changanhua/dsh-content'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z as wire } from 'zod'
import type { BrowserConnectRequest, BrowserGrantSummary, ContentBrowserImportResponse } from './types.ts'

export type { BrowserConnectRequest, BrowserGrantSummary, ContentBrowserImportResponse } from './types.ts'

export const CONTENT_BROWSER_PATH = '/api/content-browser/v1'
const GRANT_KEY = credentialKey('content-browser', 'grant')
const EXTENSION_ID = /^[a-p]{32}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const requestSchema = wire.object({
  challenge: wire.string().regex(/^[A-Za-z0-9_-]{43}$/), installationId: wire.string().regex(UUID),
  extensionId: wire.string().regex(EXTENSION_ID),
}).strict()
const tokenSchema = wire.object({
  installationId: wire.string().regex(UUID), verifier: wire.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict()
const importSchema = wire.object({
  captureId: wire.string().regex(UUID), title: wire.string(), markdown: wire.string(),
  source: wire.object({
    url: wire.string(), pageTitle: wire.string(), site: wire.string(), kind: wire.enum(['selection', 'single-reply']),
    capturedAt: wire.string(), externalMessageId: wire.string().min(1).max(512).optional(),
  }).strict(),
}).strict()

export interface ContentBrowserConfig { requestTTL?: number; pendingLimit?: number; maxRequestBodyBytes?: number }
export const Config: z<ContentBrowserConfig> = z.object({
  requestTTL: z.natural().min(1).max(5 * 60 * 1000).default(5 * 60 * 1000), pendingLimit: z.natural().min(1).max(32).default(32),
  maxRequestBodyBytes: z.natural().min(1).max(1024 * 1024).default(1024 * 1024),
})

interface Pending {
  readonly requestId: string
  readonly installationId: string
  readonly extensionId: string
  readonly expiresAt: string
  status: 'pending' | 'approved' | 'rejected'
  readonly challenge: string
  token?: string
}
interface StoredGrant extends BrowserGrantSummary { readonly tokenHash: string }
interface StoredPayload { readonly version: 1; readonly grants: readonly StoredGrant[] }
const storedGrantSchema = wire.object({
  installationId: wire.string().regex(UUID), extensionId: wire.string().regex(EXTENSION_ID), createdAt: wire.iso.datetime(),
  scope: wire.literal('content:import'), tokenHash: wire.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict()
const storedPayloadSchema = wire.object({ version: wire.literal(1), grants: wire.array(storedGrantSchema) }).strict()

declare module '@deepseek-ai/cordis' { interface Context { contentBrowser: ContentBrowser } }

/** Host service and signed-in Remote owner for extension grants. */
export class ContentBrowser extends TypertRemoteService {
  static inject = ['webServer', 'connection', 'credentials', 'content']
  static Config = Config
  private readonly pending = new Map<string, Pending>()
  private grantGeneration = 0
  private readonly queues = new Map<string, Promise<void>>()
  private active = true
  private readonly ttl: number
  private readonly limit: number

  constructor(ctx: Context, config: ContentBrowserConfig = {}) {
    super(ctx, 'contentBrowser', { namespace: 'contentBrowser' })
    this.ttl = config.requestTTL ?? 5 * 60 * 1000
    this.limit = config.pendingLimit ?? 32
    const maxRequestBodyBytes = config.maxRequestBodyBytes ?? 1024 * 1024
    const route = { kind: 'prefix' as const, path: CONTENT_BROWSER_PATH, handler: (req: Parameters<typeof bridge>[0], res: Parameters<typeof bridge>[1]) => {
      if (ctx.connection.requestAuthorityRejection(req) !== undefined) { res.writeHead(403); res.end(); return Promise.resolve() }
      return bridge(req, res, { fetch: request => this.fetch(request) }, maxRequestBodyBytes)
    } }
    ctx.effect(() => ctx.webServer.register(route), 'content-browser: HTTP bridge')
    ctx.on('credentials/record-updated', (key) => { if (key === GRANT_KEY) this.grantGeneration += 1 })
    ctx.effect(() => {
      const timer = setInterval(() => { this.expire() }, Math.min(this.ttl, 1000))
      timer.unref()
      return () => {
        this.active = false
        this.grantGeneration += 1
        clearInterval(timer)
        this.pending.clear()
        this.queues.clear()
      }
    }, 'content-browser: authorization lifecycle')
  }

  /**
   * Dispatch a bounded extension request after the route checks the Host authority.
   * @param request - HTTP request carrying a verified extension Origin and operation credentials.
   * @returns Narrow protocol data or a payload-free error response.
   */
  async fetch(request: Request): Promise<Response> {
    const origin = extensionOrigin(request.headers.get('origin'))
    if (origin === undefined) return failure(403, 'forbidden')
    if (!this.active || request.signal.aborted) return failure(503, 'unavailable', origin)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })
    try {
      const path = new URL(request.url).pathname
      if (path === `${CONTENT_BROWSER_PATH}/info` && request.method === 'POST') return json(200, { protocolVersion: 1, capabilities: ['content:import'] }, origin)
      if (path === `${CONTENT_BROWSER_PATH}/connect` && request.method === 'POST') return await this.connect(request, origin)
      const token = /^\/api\/content-browser\/v1\/connect\/([^/]+)\/token$/u.exec(path)
      if (token?.[1] !== undefined && request.method === 'POST') return await this.exchange(request, origin, token[1])
      if (path === `${CONTENT_BROWSER_PATH}/import` && request.method === 'POST') return await this.import(request, origin)
      return failure(404, 'not_found', origin)
    } catch { return failure(503, 'unavailable', origin) }
  }

  /**
   * Read an approval request without exposing exchange credentials.
   * @param requestId - Identity from the extension link.
   * @param signal - Active authenticated Connection signal.
   * @returns Detached metadata; absent, expired or unauthorized reads reject.
   */
  @Remote request(requestId: string, signal: AbortSignal): BrowserConnectRequest {
    this.authorize(signal)
    return view(this.requestOf(requestId))
  }
  /**
   * Grant import access after explicit approval by the signed-in user.
   * @param requestId - Pending request identity.
   * @param signal - Active authenticated Connection signal, checked again before mutation.
   * @returns Metadata after durable grant commit; never a bearer token.
   */
  @Remote async approve(requestId: string, signal: AbortSignal): Promise<BrowserConnectRequest> {
    this.authorize(signal); const pending = this.requestOf(requestId); if (pending.status === 'rejected') return view(pending)
    return this.serial(pending.installationId, async () => {
      this.authorize(signal)
      const current = this.requestOf(requestId)
      if (current.status !== 'pending') return view(current)
      await this.upsertGrant(current.installationId, current.extensionId, current.token ?? this.mintToken(current), () => {
        this.authorize(signal)
        if (expired(current)) throw unavailable()
      })
      current.status = 'approved'; return view(current)
    })
  }
  /**
   * Reject a pending request in the same installation lane as approval.
   * @param requestId - Pending request identity.
   * @param signal - Active authenticated Connection signal.
   * @returns Rejected metadata; an already approved request requires revocation instead.
   */
  @Remote async reject(requestId: string, signal: AbortSignal): Promise<BrowserConnectRequest> {
    this.authorize(signal); const pending = this.requestOf(requestId)
    return this.serial(pending.installationId, () => {
      this.authorize(signal)
      const current = this.requestOf(requestId)
      if (current.status === 'approved') throw unavailable()
      current.status = 'rejected'; return view(current)
    })
  }
  /**
   * List authorized installations using explicit non-secret metadata.
   * @param signal - Active authenticated Connection signal.
   * @returns Grant summaries; invalid owner records fail closed.
   */
  @Remote async grants(signal: AbortSignal): Promise<BrowserGrantSummary[]> {
    this.authorize(signal)
    return (await this.grantsRecord()).map(grant => ({
      installationId: grant.installationId, extensionId: grant.extensionId, createdAt: grant.createdAt, scope: grant.scope,
    }))
  }
  /**
   * Revoke an installation, token delivery and its not-yet-committed imports.
   * @param installationId - Identity from the signed-in grant list.
   * @param signal - Active authenticated Connection signal.
   * @returns Resolves after credential commit; previously saved content remains.
   */
  @Remote async revoke(installationId: string, signal: AbortSignal): Promise<void> {
    this.authorize(signal); await this.serial(installationId, async () => {
      await this.ctx.credentials.modifyRecord(GRANT_KEY, (current) => {
        this.authorize(signal)
        return Promise.resolve<CredentialRecord>({
          kind: 'grant', payload: { version: 1, grants: payload(current).grants.filter(grant => grant.installationId !== installationId) },
        })
      })
      for (const pending of this.pending.values()) if (pending.installationId === installationId) {
        pending.status = 'rejected'
        delete pending.token
      }
    })
  }

  private async connect(request: Request, origin: string): Promise<Response> {
    const parsed = await parse(request, requestSchema); if (parsed === undefined) return failure(400, 'invalid_request', origin)
    if (`chrome-extension://${parsed.extensionId}` !== origin) return failure(403, 'forbidden', origin)
    this.expire(); const same = [...this.pending.values()].find(value => value.installationId === parsed.installationId && value.status === 'pending')
    if (same !== undefined && (same.challenge !== parsed.challenge || same.extensionId !== parsed.extensionId)) return failure(409, 'conflict', origin)
    if (same !== undefined) return json(200, view(same), origin)
    if (this.pending.size >= this.limit) return failure(503, 'unavailable', origin)
    const now = new Date(); const value: Pending = { requestId: randomUUID(), ...parsed, expiresAt: new Date(now.getTime() + this.ttl).toISOString(), status: 'pending' }
    this.pending.set(value.requestId, value); return json(201, view(value), origin)
  }

  private async exchange(request: Request, origin: string, requestId: string): Promise<Response> {
    const parsed = await parse(request, tokenSchema); if (parsed === undefined) return failure(400, 'invalid_request', origin)
    const pending = this.pending.get(requestId); if (pending === undefined || expired(pending)) return failure(410, 'expired', origin)
    const verifierHash = verifierDigest(parsed.verifier)
    if (pending.installationId !== parsed.installationId || origin !== `chrome-extension://${pending.extensionId}` || verifierHash === undefined || !matches(pending.challenge, verifierHash)) return failure(403, 'forbidden', origin)
    if (pending.status === 'pending') return json(202, { status: 'pending' }, origin, { 'Retry-After': '1' })
    if (pending.status === 'rejected') return failure(410, 'expired', origin)
    const token = pending.token
    if (token === undefined || !(await this.grantsRecord()).some(grant => grant.installationId === pending.installationId && grant.extensionId === pending.extensionId && matches(grant.tokenHash, hash(token)))) return failure(410, 'expired', origin)
    return json(200, { token }, origin)
  }

  private async import(request: Request, origin: string): Promise<Response> {
    const bearer = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]+)$/u)?.[1]
    if (bearer === undefined) return failure(401, 'unauthorized', origin)
    const parsed = await parse(request, importSchema)
    if (parsed === undefined) return failure(400, 'invalid_request', origin)
    const capturedGeneration = this.grantGeneration
    const grant = (await this.grantsRecord()).find(value => matches(value.tokenHash, hash(bearer)) && `chrome-extension://${value.extensionId}` === origin)
    if (grant === undefined) return failure(401, 'unauthorized', origin)
    try {
      const source = WebSourceSchema.parse({
        type: 'web-page', scope: parsed.source.kind, verification: 'unverified', url: parsed.source.url,
        pageTitle: parsed.source.pageTitle, site: parsed.source.site, capturedAt: parsed.source.capturedAt,
        ...parsed.source.externalMessageId === undefined ? {} : { externalMessageId: parsed.source.externalMessageId },
      })
      const receipt = await this.ctx.content.execute({ type: 'save-text', entryId: `web:${parsed.captureId}`, operationId: parsed.captureId, title: parsed.title, body: parsed.markdown, source }, () => {
        if (!this.active || request.signal.aborted || this.grantGeneration !== capturedGeneration) throw new ContentError('forbidden')
      })
      return json(200, { receipt } satisfies ContentBrowserImportResponse, origin)
    } catch (error) {
      if (error instanceof wire.ZodError) return failure(400, 'invalid_request', origin)
      const code = error instanceof ContentError ? error.code : 'unavailable'
      const status = code === 'capacity_exceeded' ? 413 : code === 'forbidden' || code === 'closed' ? 403
        : code === 'operation_conflict' || code === 'source_conflict' ? 409 : code === 'invalid_request' ? 400 : 503
      return failure(status, code, origin)
    }
  }

  private requestOf(requestId: string): Pending {
    this.expire()
    const value = this.pending.get(requestId)
    if (value === undefined) throw unavailable()
    return value
  }
  private authorize(signal: AbortSignal): void {
    if (!this.active || signal.aborted) throw unavailable()
    try { this.ctx.connection.assertAuthorized(signal) } catch { throw unavailable() }
  }
  private mintToken(pending: Pending): string { return pending.token ??= `${pending.installationId.replaceAll('-', '')}_${randomBytes(32).toString('base64url')}` }
  private async grantsRecord(): Promise<readonly StoredGrant[]> { return payload(await this.ctx.credentials.readRecord(GRANT_KEY)).grants }
  private async upsertGrant(installationId: string, extensionId: string, token: string, authorize: () => void): Promise<void> {
    const createdAt = new Date().toISOString()
    await this.ctx.credentials.modifyRecord(GRANT_KEY, (current) => {
      authorize()
      return Promise.resolve<CredentialRecord>({ kind: 'grant', payload: {
        version: 1, grants: [...payload(current).grants.filter(value => value.installationId !== installationId),
          { installationId, extensionId, createdAt, scope: 'content:import', tokenHash: hash(token) }],
      } })
    })
  }
  private serial<T>(id: string, operation: () => T | Promise<T>): Promise<T> {
    const prior = this.queues.get(id) ?? Promise.resolve()
    const next = prior.then(operation, operation)
    const settled = next.then(() => undefined, () => undefined)
    this.queues.set(id, settled)
    void settled.then(() => { if (this.queues.get(id) === settled) this.queues.delete(id) })
    return next
  }
  private expire(): void { for (const [id, value] of this.pending) if (expired(value)) this.pending.delete(id) }
}

function payload(record: CredentialRecord | undefined): StoredPayload {
  if (record === undefined) return { version: 1, grants: [] }
  if (record.kind !== 'grant') throw unavailable()
  const parsed = storedPayloadSchema.safeParse(record.payload)
  if (!parsed.success) throw unavailable()
  return parsed.data
}
function hash(value: string): string { return createHash('sha256').update(value).digest('base64url') }
/** Hash the exact 32 verifier bytes; reject non-canonical base64url before comparing. */
function verifierDigest(value: string): string | undefined {
  try {
    const decoded = Buffer.from(value, 'base64url')
    return decoded.length === 32 && decoded.toString('base64url') === value
      ? createHash('sha256').update(decoded).digest('base64url')
      : undefined
  } catch { return undefined }
}
function matches(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
function expired(value: BrowserConnectRequest): boolean { return Date.parse(value.expiresAt) <= Date.now() }
function view(value: Pending): BrowserConnectRequest {
  return {
    requestId: value.requestId, installationId: value.installationId, extensionId: value.extensionId,
    expiresAt: value.expiresAt, status: value.status,
  }
}
function extensionOrigin(value: string | null): string | undefined {
  return value !== null && /^chrome-extension:\/\/[a-p]{32}$/u.test(value) ? value : undefined
}
function cors(origin: string): Headers { return new Headers({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }) }
function json(status: number, value: unknown, origin: string, headers: Record<string, string> = {}): Response { const responseHeaders = cors(origin); responseHeaders.set('Content-Type', 'application/json'); for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value); return new Response(JSON.stringify(value), { status, headers: responseHeaders }) }
function failure(status: number, error: string, origin?: string): Response { return new Response(JSON.stringify({ error }), { status, headers: origin === undefined ? { 'Content-Type': 'application/json' } : (() => { const h = cors(origin); h.set('Content-Type', 'application/json'); return h })() }) }
async function parse<T>(request: Request, schema: wire.ZodType<T>): Promise<T | undefined> { try { if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return undefined; const value = schema.safeParse(await request.json()); return value.success ? value.data : undefined } catch { return undefined } }
function unavailable(): TypertRemoteFailure { return new TypertRemoteFailure({ code: 'forbidden', message: 'content browser request is unavailable', details: {} }) }
export default ContentBrowser
