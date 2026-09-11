import { randomBytes, createHash, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { SessionId } from '@deepseek-ai/dsh-session'
import WebSocket from 'ws'
import { BrowserAuth } from '../../../client/connection/src/browser-auth.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import BrowserExtension from '../src/index.ts'
import type { BrowserInvocation } from '../src/types.ts'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'

const API = '/api/browser-extension/v1'
const extensionId = 'a'.repeat(32)
const origin = `chrome-extension://${extensionId}`
const cleanups: Array<() => Promise<void>> = []
interface GatewayFrame {
  readonly type: string
  readonly request?: BrowserInvocation
  readonly requestId?: string
  readonly result?: unknown
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected object')
  return value as Record<string, unknown>
}
function string(value: unknown): string { if (typeof value !== 'string') throw new Error('expected string'); return value }
function actionKind(frame: GatewayFrame, kind: string): boolean {
  return frame.type === 'execute' && frame.request !== undefined && object(frame.request.payload).kind === kind
}
function execute(frames: readonly GatewayFrame[], match: (request: BrowserInvocation) => boolean = () => true): BrowserInvocation {
  const found = frames.find(frame => frame.type === 'execute' && frame.request !== undefined && match(frame.request))
  if (found?.request === undefined) throw new Error('missing execute frame')
  return found.request
}
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function mounted() {
  const ctx = new Context()
  const credentials = ctx.plugin(MemoryCredentials); await credentials.await()
  const server = ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }); await server.await()
  const base = `http://127.0.0.1:${ctx.webServer.port}`
  const auth = await BrowserAuth.create(ctx, ctx.credentials, 1)
  new HostConnectionService(ctx, [], auth)
  // Session RPC behavior is exercised by BrowserSessions tests; these cases only use the browser transport.
  ctx.provide('sessionController', {} as SessionController)
  let cookie = ''
  auth.authorizeIndex({ method: 'GET', url: auth.authenticatedUrl(base), headers: { host: new URL(base).host } }, {
    writeHead(_status, headers) { cookie = headers?.['set-cookie']?.split(';')[0] ?? '' }, end() {},
  })
  expect(cookie.length > 0).toBe(true)
  const fiber = ctx.plugin(BrowserExtension, { heartbeatIntervalMs: 1000, handshakeTimeoutMs: 1000 }); await fiber.await()
  cleanups.push(async () => { await fiber.dispose(); await server.dispose(); await credentials.dispose() })
  const post = async (path: string, body: unknown, owner = false) => {
    const response = await fetch(base + API + path, { method: 'POST', headers: {
      'Content-Type': 'application/json', Origin: owner ? base : origin, ...(owner ? { Cookie: cookie } : {}),
    }, body: JSON.stringify(body) })
    return { status: response.status, body: object(await response.json().catch(() => ({}))) }
  }
  async function pair(scopes: readonly string[] = ['browser:read', 'browser:write']) {
    const installationId = randomUUID()
    const verifier = randomBytes(32).toString('base64url')
    const pending = await post('/connect', { extensionId, installationId,
      challenge: createHash('sha256').update(Buffer.from(verifier, 'base64url')).digest('base64url'),
      scopes, origins: ['https://example.test'] })
    expect(pending.status).toBe(201)
    const approved = await post('/owner/approve', { requestId: string(pending.body.requestId), scopes, origins: ['https://example.test'] }, true)
    expect(approved.status).toBe(200)
    const exchange = await post(`/connect/${string(pending.body.requestId)}/token`, { installationId, verifier })
    expect(exchange.status).toBe(200)
    return { installationId, token: string(exchange.body.token) }
  }
  return { ctx, base, pair, post, fiber, cookie }
}

async function peer(base: string, identity: { installationId: string; token: string }) {
  const socket = new WebSocket(base.replace('http', 'ws') + API + '/ws', { headers: { Origin: origin } })
  const frames: GatewayFrame[] = []
  socket.on('message', (raw) => {
    const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : Array.isArray(raw) ? Buffer.concat(raw).toString('utf8') : Buffer.from(raw).toString('utf8')
    const value: unknown = JSON.parse(text)
    const frame = object(value)
    if (typeof frame.type !== 'string') throw new Error('missing frame type')
    frames.push({ ...frame, type: frame.type })
  })
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  cleanups.push(async () => {
    if (socket.readyState === WebSocket.CLOSED) return
    const closed = new Promise<void>(resolve => socket.once('close', () => { resolve() }))
    socket.terminate(); await closed
  })
  socket.send(JSON.stringify({ type: 'hello', protocolVersion: 1, ...identity }))
  await expect.poll(() => frames.some(frame => frame.type === 'ready')).toBe(true)
  return { socket, frames }
}

describe('browser extension gateway over the real HTTP and WebSocket carriers', () => {
  it('preserves semantic query, pagination and text budgets on the actual extension wire', async () => {
    const test = await mounted(), identity = await test.pair(), extension = await peer(test.base, identity)
    const action = { kind: 'snapshot' as const, tabId: 12, frameId: 0, query: '空气炸锅', offset: 128, limit: 4, textLimit: 0 }
    const pending = test.ctx.browser.execute({ sessionId: SessionId('test-session'), installationId: identity.installationId, action }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'snapshot'))).toBe(true)
    const issued = execute(extension.frames)
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: issued.protocolVersion, grantEpoch: issued.grantEpoch,
      requestId: issued.requestId, sessionId: issued.sessionId, installationId: issued.installationId, deadline: issued.deadline,
      fingerprint: issued.fingerprint, outcome: 'observed', quiescent: true, value: { text: '', elements: [] } } }))
    await pending
    expect(issued.payload).toEqual(action)
  })
  it('binds a finite background observation to its separate scope and exact grant epoch', async () => {
    const test = await mounted(); const ordinary = await test.pair(); const first = await peer(test.base, ordinary)
    const ordinaryGrant = (await test.ctx.browser.instances()).find(item => item.installationId === ordinary.installationId)
    if (ordinaryGrant === undefined) throw new Error('missing grant')
    const input = { sessionId: SessionId('monitor-session'), installationId: ordinary.installationId,
      grantEpoch: ordinaryGrant.grantEpoch, action: { kind: 'tabs' as const } }
    expect(await test.ctx.browser.observe(input, new AbortController().signal)).toMatchObject({
      outcome: 'failed', delivery: 'not-sent', reason: 'observation_not_authorized',
    })
    expect(first.frames.some(frame => frame.type === 'execute')).toBe(false)
    const authorized = await test.pair(['browser:read', 'browser:observe']); const extension = await peer(test.base, authorized)
    const grant = (await test.ctx.browser.instances()).find(item => item.installationId === authorized.installationId)
    if (grant === undefined) throw new Error('missing observation grant')
    expect(grant.scopes).toContain('browser:observe')
    const observation = { ...input, installationId: grant.installationId, grantEpoch: grant.grantEpoch }
    const reading = test.ctx.browser.observe(observation, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'observe'))).toBe(true)
    const issued = execute(extension.frames)
    expect(issued.mutates).toBe(false)
    expect(issued.payload).toEqual({ kind: 'observe', action: { kind: 'tabs' } })
    extension.socket.send(JSON.stringify({ type: 'result', receipt: {
      protocolVersion: 1, grantEpoch: issued.grantEpoch, requestId: issued.requestId, sessionId: issued.sessionId,
      installationId: issued.installationId, deadline: issued.deadline, fingerprint: issued.fingerprint,
      outcome: 'observed', quiescent: true, value: { tabs: [] },
    } }))
    await expect(reading).resolves.toMatchObject({ outcome: 'observed', value: { tabs: [] } })
    expect(await test.ctx.browser.observe({ ...observation, grantEpoch: grant.grantEpoch + 1 }, new AbortController().signal))
      .toMatchObject({ outcome: 'failed', delivery: 'not-sent', reason: 'unauthorized' })
    expect(extension.frames.filter(frame => frame.type === 'execute')).toHaveLength(1)
  })
  it('separates signed-in approval from an extension connection request', async () => {
    const test = await mounted()
    const info = await test.post('/info', {})
    expect(info.status).toBe(200)
    expect(info.body.protocolVersion).toBe(1)
    expect((await test.post('/owner/approve', { requestId: randomUUID(), scopes: ['browser:write'], origins: ['*'] })).status).toBe(403)
    const identity = await test.pair()
    expect((await test.ctx.browser.instances())[0]).toMatchObject({ installationId: identity.installationId, online: false })
  })

  it('authenticates an installation and correlates a real bidirectional request and response', async () => {
    const test = await mounted(); const identity = await test.pair(); const extension = await peer(test.base, identity)
    expect((await test.ctx.browser.instances())[0]?.online).toBe(true)
    const pending = test.ctx.browser.execute({ sessionId: SessionId('test-session'), installationId: identity.installationId, action: { kind: 'tabs' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => frame.type === 'execute')).toBe(true)
    const request = execute(extension.frames)
    expect(request.payload).toEqual({ kind: 'tabs' })
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: request.protocolVersion,
      grantEpoch: request.grantEpoch, installationId: request.installationId, sessionId: request.sessionId,
      requestId: request.requestId, deadline: request.deadline, fingerprint: request.fingerprint,
      outcome: 'observed', value: [{ tabId: 12, title: 'Fixture tab' }] } }))
    expect(await pending).toEqual({
      requestId: request.requestId,
      sessionId: 'test-session',
      installationId: identity.installationId,
      outcome: 'observed',
      delivery: 'sent',
      value: [{ tabId: 12, title: 'Fixture tab' }],
    })
  })

  it('keeps page preparation opaque to callers and commits its exact action once', async () => {
    const test = await mounted(); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const action = { kind: 'click' as const, intent: '打开详情', element: {
      page: { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }, snapshotId: 'snapshot-1', elementId: 'element-1',
    } }
    const preparing = test.ctx.browser.prepare(
      { sessionId: SessionId('test-session'), installationId: identity.installationId, action }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'prepare'))).toBe(true)
    const prepare = execute(extension.frames, request => object(request.payload).kind === 'prepare')
    expect(prepare.mutates).toBe(false)
    expect(prepare.payload).toMatchObject({ kind: 'prepare', action })
    const preparationPayload = object(prepare.payload)
    const expiresAt = preparationPayload.expiresAt
    if (typeof expiresAt !== 'number') throw new Error('missing prepare expiry')
    expect(expiresAt).toBeGreaterThan(Date.now())
    const preparationId = randomUUID()
    extension.socket.send(JSON.stringify({ type: 'result', receipt: {
      protocolVersion: prepare.protocolVersion, grantEpoch: prepare.grantEpoch,
      installationId: prepare.installationId, sessionId: prepare.sessionId, requestId: prepare.requestId,
      deadline: prepare.deadline, fingerprint: prepare.fingerprint,
      outcome: 'observed', value: { preparationId, expiresAt, description: {
        kind: 'click', page: action.element.page, title: '示例页面', target: { tag: 'button', label: '详情', type: 'button' }, effect: 'unknown',
      } } } }))
    const ticket = await preparing
    expect(ticket.ticket).not.toBe(preparationId)
    const committing = test.ctx.browser.executePrepared(
      ticket.ticket, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'commit'))).toBe(true)
    const commit = execute(extension.frames, request => object(request.payload).kind === 'commit')
    expect(commit.mutates).toBe(true)
    expect(commit.payload).toEqual({ kind: 'commit', action, preparationId })
    extension.socket.send(JSON.stringify({ type: 'result', receipt: {
      protocolVersion: commit.protocolVersion, grantEpoch: commit.grantEpoch,
      installationId: commit.installationId, sessionId: commit.sessionId, requestId: commit.requestId,
      deadline: commit.deadline, fingerprint: commit.fingerprint,
      outcome: 'observed', value: { clicked: true } } }))
    expect(await committing).toMatchObject({ outcome: 'observed', value: { clicked: true } })
  })

  it('preserves a sent action as unknown across disconnect and only queries it on reconnect', async () => {
    const test = await mounted(); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const pending = test.ctx.browser.execute({ sessionId: SessionId('test-session'), installationId: identity.installationId, action: { kind: 'tabs' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => frame.type === 'execute')).toBe(true)
    extension.socket.terminate()
    expect(await pending).toMatchObject({ outcome: 'unknown', delivery: 'sent' })
    const replacement = await peer(test.base, identity)
    await expect.poll(() => replacement.frames.some(frame => frame.type === 'status')).toBe(true)
    expect(replacement.frames.some(frame => frame.type === 'execute')).toBe(false)
  })

  it('accepts an operator-verified quiescent receipt and releases an unknown write lock', async () => {
    const test = await mounted(); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const action = { kind: 'click' as const, intent: '打开详情', element: {
      page: { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }, snapshotId: 'snapshot-1', elementId: 'element-1',
    } }
    const pending = test.ctx.browser.execute({ sessionId: SessionId('test-session'), installationId: identity.installationId, action }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => frame.type === 'execute')).toBe(true)
    const issued = execute(extension.frames)
    extension.socket.terminate()
    expect(await pending).toMatchObject({ outcome: 'unknown', delivery: 'sent' })
    const replacement = await peer(test.base, identity)
    const requestId = randomUUID()
    const wrongIdentityRequest = randomUUID()
    replacement.socket.send(JSON.stringify({ type: 'request', requestId: wrongIdentityRequest, method: 'browser.acknowledge', params: { receipt: {
      protocolVersion: issued.protocolVersion, grantEpoch: issued.grantEpoch, requestId: issued.requestId, sessionId: 'wrong-session',
      installationId: issued.installationId, deadline: issued.deadline, fingerprint: issued.fingerprint, outcome: 'unknown', quiescent: true,
    } } }))
    await expect.poll(() => replacement.frames.find(frame => frame.type === 'response' && frame.requestId === wrongIdentityRequest)?.result)
      .toMatchObject({ ok: false, error: { code: 'acknowledgement_unconfirmed' } })
    replacement.socket.send(JSON.stringify({ type: 'request', requestId, method: 'browser.acknowledge', params: { receipt: {
      protocolVersion: issued.protocolVersion, grantEpoch: issued.grantEpoch, requestId: issued.requestId, sessionId: issued.sessionId,
      installationId: issued.installationId, deadline: issued.deadline, fingerprint: issued.fingerprint, outcome: 'unknown', quiescent: true,
    } } }))
    await expect.poll(() => replacement.frames.find(frame => frame.type === 'response' && frame.requestId === requestId)?.result).toEqual({ ok: true, value: { acknowledged: true } })
    const next = test.ctx.browser.execute(
      { sessionId: SessionId('test-session'), installationId: identity.installationId, action }, new AbortController().signal)
    await expect.poll(() => replacement.frames.some(frame => frame.type === 'execute' && frame.request?.requestId !== issued.requestId)).toBe(true)
    const retry = execute(replacement.frames, request => request.requestId !== issued.requestId)
    replacement.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: retry.protocolVersion, grantEpoch: retry.grantEpoch,
      installationId: retry.installationId, sessionId: retry.sessionId, requestId: retry.requestId,
      deadline: retry.deadline, fingerprint: retry.fingerprint,
      outcome: 'observed' } }))
    await expect(next).resolves.toMatchObject({ outcome: 'observed' })
  })

  it('revokes a captured connection before allowing any later operation', async () => {
    const test = await mounted(); const identity = await test.pair(); const extension = await peer(test.base, identity)
    expect((await test.post('/owner/revoke', { installationId: identity.installationId }, true)).status).toBe(200)
    await expect.poll(() => extension.socket.readyState).toBe(WebSocket.CLOSED)
    expect(await test.ctx.browser.execute({ sessionId: SessionId('test-session'), installationId: identity.installationId, action: { kind: 'tabs' } }, new AbortController().signal)).toMatchObject({ delivery: 'not-sent', reason: 'unauthorized' })
    expect(extension.frames.some(frame => frame.type === 'execute')).toBe(false)
  })

  it('lists authorized offline installations but fences revocation before its write completes', async () => {
    const test = await mounted(); const identity = await test.pair(['browser:read', 'browser:observe'])
    const instances = await test.ctx.browser.instances()
    expect(instances).toMatchObject([{ installationId: identity.installationId, online: false }])
    expect(test.ctx.browser.isAuthorized(instances[0]!)).toBe(true)
    const modify = test.ctx.credentials.modifyRecord.bind(test.ctx.credentials)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const pendingWrite = vi.spyOn(test.ctx.credentials, 'modifyRecord').mockImplementationOnce(async (key, mutate) => {
      entered.resolve(undefined)
      await release.promise
      return modify(key, mutate)
    })
    const revoking = test.post('/owner/revoke', { installationId: identity.installationId }, true)
    try {
      await entered.promise
      expect(await test.ctx.browser.instances()).toEqual([])
      expect(test.ctx.browser.isAuthorized(instances[0]!)).toBe(false)
    } finally {
      release.resolve(undefined)
      await revoking
      pendingWrite.mockRestore()
    }
    expect(await test.ctx.browser.instances()).toEqual([])
  })

  it('unregisters its routes and closes its installed connections with the fiber', async () => {
    const test = await mounted(); const identity = await test.pair(); const extension = await peer(test.base, identity)
    await test.fiber.dispose()
    await expect.poll(() => extension.socket.readyState).toBe(WebSocket.CLOSED)
    expect((await test.post('/info', {})).status).toBe(404)
  })

  it('serves pairing approval only to the signed-in owner with embedding disabled', async () => {
    const test = await mounted()
    expect((await fetch(test.base + '/browser-assistant')).status).toBe(401)
    const page = await fetch(test.base + '/browser-assistant', { headers: { Cookie: test.cookie } })
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(await page.text()).toContain('/browser-assistant/app.js')
  })
})
