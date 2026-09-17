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
import type { BrowserActionResult, BrowserPage } from '@changanhua/dsh-browser'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'

const API = '/api/browser-extension/v1'
const extensionId = 'a'.repeat(32)
const origin = `chrome-extension://${extensionId}`
const executorCapabilities = {
  protocolVersion: 1 as const,
  actionKinds: ['tabs', 'snapshot', 'page_map', 'entry_inspect', 'entry_mount', 'entry_unmount', 'region_render', 'region_clear',
    'navigate', 'click', 'fill', 'submit', 'scroll', 'wait', 'double_click', 'right_click', 'hover', 'press', 'select', 'check', 'drag', 'upload',
    'back', 'forward', 'reload', 'tab_open', 'tab_close', 'tab_focus', 'screenshot'],
  requestRecovery: true,
  restartStatusLookup: true as const,
}
const cleanups: Array<() => Promise<void>> = []
interface GatewayFrame {
  readonly type: string
  readonly request?: BrowserInvocation
  readonly locator?: { readonly grantEpoch?: number }
  readonly sessionId?: string
  readonly requestId?: string
  readonly result?: unknown
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected object')
  return value as Record<string, unknown>
}
function string(value: unknown): string { if (typeof value !== 'string') throw new Error('expected string'); return value }
function matching(value: Record<string, unknown>): unknown {
  return expect.objectContaining(value) as unknown
}
function actionKind(frame: GatewayFrame, kind: string): boolean {
  return frame.type === 'execute' && frame.request !== undefined && object(frame.request.payload).kind === kind
}
function execute(frames: readonly GatewayFrame[], match: (request: BrowserInvocation) => boolean = () => true): BrowserInvocation {
  const found = frames.find(frame => frame.type === 'execute' && frame.request !== undefined && match(frame.request))
  if (found?.request === undefined) throw new Error('missing execute frame')
  return found.request
}
function mappedRegion(result: BrowserActionResult, index = 0): string {
  const value = object(result.value)
  const regions = value.regions
  if (!Array.isArray(regions)) throw new Error('missing mapped regions')
  return string(object(regions[index]).regionRef)
}
function regionRender(page: BrowserPage, mountId: string, regionRef: string, summary: string, mode?: 'append' | 'replace') {
  return { kind: 'region_render' as const, page, mountId, regionRef: regionRef as never,
    ...(mode === undefined ? {} : { mode }), presentation: { summary } }
}
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks() })

async function mounted(config: Record<string, unknown> = {}) {
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
  const fiber = ctx.plugin(BrowserExtension, { heartbeatIntervalMs: 1000, handshakeTimeoutMs: 1000, ...config }); await fiber.await()
  cleanups.push(async () => { await fiber.dispose(); await server.dispose(); await credentials.dispose() })
  const post = async (path: string, body: unknown, owner = false) => {
    const response = await fetch(base + API + path, { method: 'POST', headers: {
      'Content-Type': 'application/json', Origin: owner ? base : origin, ...(owner ? { Cookie: cookie } : {}),
    }, body: JSON.stringify(body) })
    return { status: response.status, body: object(await response.json().catch(() => ({}))) }
  }
  async function pair(scopes: readonly string[] = ['browser:read', 'browser:write'], existingInstallationId?: string) {
    const installationId = existingInstallationId ?? randomUUID()
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

async function peer(base: string, identity: { installationId: string; token: string }, capabilities = executorCapabilities) {
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
  socket.send(JSON.stringify({ type: 'hello', protocolVersion: 1, ...identity, capabilities }))
  await expect.poll(() => frames.some(frame => frame.type === 'ready')).toBe(true)
  return { socket, frames }
}

describe('browser extension gateway over the real HTTP and WebSocket carriers', () => {
  it('auto-connects a configured trusted extension without owner approval or retained-grant growth', async () => {
    const h = await mounted({ trustedExtensionIds: [extensionId], maxGrants: 1 })
    const connect = async (installationId: string) => h.post('/connect', { extensionId, installationId,
      challenge: createHash('sha256').update(randomBytes(32)).digest('base64url'),
      scopes: ['browser:read', 'browser:write'], origins: ['https://example.test'] })
    const first = await connect(randomUUID())
    const firstPeer = await peer(h.base, {
      installationId: string(object(first.body.grant).installationId), token: string(first.body.token),
    })
    const firstClosed = new Promise<void>(resolve => firstPeer.socket.once('close', () => { resolve() }))
    const second = await connect(randomUUID())

    expect(first.status).toBe(200)
    expect(second).toMatchObject({ status: 200, body: { status: 'connected' } })
    await firstClosed
    const grants = (await h.post('/owner/grants', {}, true)).body.grants as Array<{ installationId: string }>
    expect(grants).toEqual([expect.objectContaining({ installationId: object(second.body.grant).installationId })])
    await peer(h.base, { installationId: string(object(second.body.grant).installationId), token: string(second.body.token) })
  })

  it('reports grant_capacity instead of replacing an online installation', async () => {
    const h = await mounted({ maxGrants: 1 })
    const current = await h.pair(['browser:read'])
    await peer(h.base, current)
    const nextId = randomUUID()
    const verifier = randomBytes(32).toString('base64url')
    const pending = await h.post('/connect', { extensionId, installationId: nextId,
      challenge: createHash('sha256').update(Buffer.from(verifier, 'base64url')).digest('base64url'),
      scopes: ['browser:read'], origins: ['https://example.test'] })
    const approved = await h.post('/owner/approve', { requestId: string(pending.body.requestId),
      scopes: ['browser:read'], origins: ['https://example.test'] }, true)
    expect(approved).toMatchObject({ status: 409, body: { error: 'grant_capacity' } })
    expect((await h.post('/owner/grants', {}, true)).body.grants).toEqual([
      expect.objectContaining({ installationId: current.installationId }),
    ])
  })

  it('waits for the dispatch-intent policy before an execute frame can cross the provider boundary', async () => {
    const test=await mounted({ requestTimeoutMs:500 });const identity=await test.pair();const extension=await peer(test.base,identity)
    const entered=Promise.withResolvers<undefined>(),release=Promise.withResolvers<undefined>()
    let policyEntered=false
    test.ctx.on('browser/dispatch-intent' as never,(async(_context:unknown,next:()=>Promise<unknown>)=>{
      policyEntered=true;entered.resolve(undefined);await release.promise;return next()
    }) as never)
    const operation={ requestId:randomUUID(),sessionId:SessionId('test-session'),installationId:identity.installationId,
      action:{ kind:'tabs' as const } }
    const pending=test.ctx.browser.execute(operation,new AbortController().signal)
    await Promise.race([entered.promise,expect.poll(()=>extension.frames.some(frame=>actionKind(frame,'tabs'))).toBe(true)])
    expect(policyEntered).toBe(true)
    expect(extension.frames.some(frame=>actionKind(frame,'tabs'))).toBe(false)
    release.resolve(undefined);await expect.poll(()=>extension.frames.some(frame=>actionKind(frame,'tabs'))).toBe(true)
    const request=execute(extension.frames,request=>object(request.payload).kind==='tabs')
    extension.socket.send(JSON.stringify({ type:'result',receipt:{ protocolVersion:request.protocolVersion,grantEpoch:request.grantEpoch,
      installationId:request.installationId,sessionId:request.sessionId,requestId:request.requestId,deadline:request.deadline,
      fingerprint:request.fingerprint,outcome:'observed',quiescent:true,value:{ tabs:[] } } }))
    await expect(pending).resolves.toMatchObject({ outcome:'observed',delivery:'sent' })
  })
  it('allows operation policy to reject a logical action before provider preconditions run', async () => {
    const test=await mounted();const identity=await test.pair();const extension=await peer(test.base,identity)
    const requestId=randomUUID(),sessionId=SessionId('test-session')
    let observedContext:unknown
    test.ctx.on('browser/operation-intent' as never,(async(context:unknown)=>{
      observedContext=context
      return { kind:'deny',result:{ requestId,sessionId,installationId:identity.installationId,
        outcome:'failed',delivery:'not-sent',reason:'task_recovery_required' } }
    }) as never)
    const result=await test.ctx.browser.execute({ requestId,sessionId,installationId:identity.installationId,
      action:regionRender({ tabId:12,frameId:0,documentId:'document-1',url:'https://example.test/page' },'summary','11111111-1111-4111-8111-111111111111','摘要') },new AbortController().signal)
    expect(observedContext).toMatchObject({ phase:'execute',operation:{ requestId,sessionId },logicalMutates:true })
    expect(result).toMatchObject({ outcome:'failed',delivery:'not-sent',reason:'task_recovery_required' })
    expect(extension.frames.some(frame=>actionKind(frame,'region_render'))).toBe(false)
  })
  it('publishes an early provider rejection as the logical operation settlement', async () => {
    const test=await mounted();const identity=await test.pair();await peer(test.base,identity)
    const settlements:unknown[]=[]
    test.ctx.on('browser/operation-settled' as never,((context:unknown,settlement:unknown)=>{
      settlements.push({ context,settlement })
    }) as never)
    const requestId=randomUUID(),sessionId=SessionId('test-session')
    const result=await test.ctx.browser.execute({ requestId,sessionId,installationId:identity.installationId,
      action:regionRender({ tabId:12,frameId:0,documentId:'document-1',url:'https://example.test/page' },'summary','11111111-1111-4111-8111-111111111111','摘要') },new AbortController().signal)
    expect(result).toMatchObject({ delivery:'not-sent',reason:'page_map_evidence_required' })
    const expected: unknown = [matching({
      context: matching({ phase: 'execute', operation: matching({ requestId }) }),
      settlement: { kind: 'result', result: matching({ requestId, delivery: 'not-sent', reason: 'page_map_evidence_required' }) },
    })]
    expect(settlements).toEqual(expected)
  })
  it('fails closed when a later pre-send policy listener throws', async () => {
    const test=await mounted();const identity=await test.pair()
    const settlements:unknown[]=[]
    test.ctx.on('browser/operation-intent' as never,((_:unknown,next:()=>unknown)=>next()) as never)
    test.ctx.on('browser/operation-intent' as never,(()=>{ throw new Error('late_policy_failure') }) as never)
    test.ctx.on('browser/operation-settled' as never,((_:unknown,settlement:unknown)=>{settlements.push(settlement)}) as never)
    const result=await test.ctx.browser.execute({ requestId:randomUUID(),sessionId:SessionId('test-session'),installationId:identity.installationId,
      action:{ kind:'tabs' } },new AbortController().signal)
    expect(result).toMatchObject({ outcome:'failed',delivery:'not-sent',reason:'browser_policy_internal_error' })
    const expected: unknown = [matching({
      kind: 'result', result: matching({ outcome: 'failed', delivery: 'not-sent' }),
    })]
    expect(settlements).toEqual(expected)
  })
  it('requires a complete executor capability handshake before an installation becomes online', async () => {
    const test = await mounted(); const identity = await test.pair()
    const socket = new WebSocket(test.base.replace('http', 'ws') + API + '/ws', { headers: { Origin: origin } })
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
    cleanups.push(async () => { if (socket.readyState !== WebSocket.CLOSED) socket.terminate() })
    socket.send(JSON.stringify({ type: 'hello', protocolVersion: 1, ...identity }))
    await expect.poll(() => socket.readyState).toBe(WebSocket.CLOSED)
    expect((await test.ctx.browser.instances())[0]).toMatchObject({ online: false })
  })
  it('rejects a direct region render until this session maps the exact document', async () => {
    const test = await mounted({ requestTimeoutMs: 25 }); const identity = await test.pair()
    const extension = await peer(test.base, identity)
    const page = { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }
    const pending = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: regionRender(page, 'summary', '11111111-1111-4111-8111-111111111111', '摘要') }, new AbortController().signal)
    await expect(pending).resolves.toMatchObject({ delivery: 'not-sent', reason: 'page_map_evidence_required' })
    expect(extension.frames.some(frame => actionKind(frame, 'region_render'))).toBe(false)
  })

  it('requires mapped disposable evidence before replacing a page region', async () => {
    const test = await mounted({ requestTimeoutMs: 500 }); const identity = await test.pair()
    const extension = await peer(test.base, identity)
    const page = { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }
    const mapped = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'page_map', page } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'page_map'))).toBe(true)
    const request = execute(extension.frames)
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: request.protocolVersion, grantEpoch: request.grantEpoch,
      installationId: request.installationId, sessionId: request.sessionId, requestId: request.requestId,
      deadline: request.deadline, fingerprint: request.fingerprint,
      outcome: 'observed', quiescent: true, value: { page, regions: [{ selector: '#main', disposable: true, protected: true }] },
    } }))
    const mappedResult = await mapped
    expect(mappedResult).toMatchObject({ outcome: 'observed', value: { page, regions: [{ disposable: true, protected: true }] } })
    expect(JSON.stringify(mappedResult)).not.toContain('#main')
    const regionRef = mappedRegion(mappedResult)
    const pending = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: regionRender(page, 'summary', regionRef, '摘要', 'replace') }, new AbortController().signal)
    await expect(pending).resolves.toMatchObject({ delivery: 'not-sent', reason: 'region_replace_not_permitted' })
    expect(extension.frames.filter(frame => actionKind(frame, 'region_render'))).toHaveLength(0)
  })

  it('reserves region capacity before dispatch and retains it after an unknown render', async () => {
    const test = await mounted({ maxMounts: 1 }); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const page = { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }
    const mapped = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'page_map', page } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'page_map'))).toBe(true)
    const mapRequest = execute(extension.frames)
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: mapRequest.protocolVersion, grantEpoch: mapRequest.grantEpoch,
      installationId: mapRequest.installationId, sessionId: mapRequest.sessionId, requestId: mapRequest.requestId,
      deadline: mapRequest.deadline, fingerprint: mapRequest.fingerprint,
      outcome: 'observed', quiescent: true, value: { page, regions: [
        { selector: '#one', disposable: true, protected: false }, { selector: '#two', disposable: true, protected: false },
      ] },
    } }))
    const mappedResult = await mapped
    const [oneRef, twoRef] = [mappedRegion(mappedResult), mappedRegion(mappedResult, 1)]
    const first = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: regionRender(page, 'one', oneRef, '一') }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'region_render'))).toBe(true)
    extension.socket.terminate()
    await expect(first).resolves.toMatchObject({ outcome: 'unknown', delivery: 'sent' })
    await expect(test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: regionRender(page, 'two', twoRef, '二') }, new AbortController().signal))
      .resolves.toMatchObject({ delivery: 'not-sent', reason: 'mount_capacity' })
  })

  it('joins concurrent direct region renders before policy and rejects a conflicting reuse without settling it', async () => {
    const test = await mounted({ maxMounts: 1 }); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const page = { tabId: 12, frameId: 0, documentId: 'document-direct-lifecycle', url: 'https://example.test/page' }
    const mapped = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('direct-lifecycle'), installationId: identity.installationId,
      action: { kind: 'page_map', page } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'page_map'))).toBe(true)
    const map = execute(extension.frames, request => object(request.payload).kind === 'page_map')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: map.protocolVersion, grantEpoch: map.grantEpoch,
      installationId: map.installationId, sessionId: map.sessionId, requestId: map.requestId, deadline: map.deadline,
      fingerprint: map.fingerprint,
      outcome: 'observed', quiescent: true, value: { page, regions: [{ selector: '#summary', disposable: true, protected: false }] } } }))
    const regionRef = mappedRegion(await mapped)
    const requestId = randomUUID(); const sessionId = SessionId('direct-lifecycle')
    const action = regionRender(page, 'summary', regionRef, '第一份摘要')
    const intents: unknown[] = []; const settlements: unknown[] = []
    test.ctx.on('browser/operation-intent' as never, ((context: { operation: { requestId: string } }, next: () => unknown) => {
      if (context.operation.requestId === requestId) intents.push(context)
      return next()
    }) as never)
    test.ctx.on('browser/operation-settled' as never, ((context: { operation: { requestId: string } }, settlement: unknown) => {
      if (context.operation.requestId === requestId) settlements.push(settlement)
    }) as never)
    const operation = { requestId, sessionId, installationId: identity.installationId, action }
    const first = test.ctx.browser.execute(operation, new AbortController().signal)
    const second = test.ctx.browser.execute(structuredClone(operation), new AbortController().signal)
    await expect.poll(() => extension.frames.filter(frame => actionKind(frame, 'region_render'))).toHaveLength(1)
    const conflict = await test.ctx.browser.execute({ ...operation, action: regionRender(page, 'summary', regionRef, '另一份摘要') }, new AbortController().signal)
    expect(conflict).toMatchObject({ outcome: 'failed', delivery: 'not-sent', reason: 'request_conflict' })
    expect(intents).toHaveLength(1)
    expect(settlements).toHaveLength(0)
    const gateway = test.ctx.browser as unknown as { readonly regions: Map<string, unknown> }
    expect(gateway.regions).toHaveLength(1)
    const render = execute(extension.frames, request => object(request.payload).kind === 'region_render')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: render.protocolVersion, grantEpoch: render.grantEpoch,
      installationId: render.installationId, sessionId: render.sessionId, requestId: render.requestId, deadline: render.deadline,
      fingerprint: render.fingerprint, outcome: 'observed', quiescent: true, value: { rendered: 1 } } }))
    const result = await first
    expect(await second).toEqual(result)
    expect(await test.ctx.browser.execute(structuredClone(operation), new AbortController().signal)).toEqual(result)
    expect(result).toMatchObject({ outcome: 'observed', delivery: 'sent', value: { rendered: 1 } })
    expect(extension.frames.filter(frame => actionKind(frame, 'region_render'))).toHaveLength(1)
    expect(intents).toHaveLength(1)
    expect(settlements).toHaveLength(1)
    expect(gateway.regions).toHaveLength(1)
  })

  it('region_clear 只在 cleared 或精确 absent 证明后释放 Host 预留容量', async () => {
    const test = await mounted({ maxMounts: 1 }); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const page = { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }
    const mapped = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'page_map', page } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'page_map'))).toBe(true)
    const map = execute(extension.frames)
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: map.protocolVersion, grantEpoch: map.grantEpoch,
      installationId: map.installationId, sessionId: map.sessionId, requestId: map.requestId,
      deadline: map.deadline, fingerprint: map.fingerprint,
      outcome: 'observed', quiescent: true, value: { page, regions: [
        { selector: '#one', disposable: true, protected: false }, { selector: '#two', disposable: true, protected: false },
      ] },
    } }))
    const mappedResult = await mapped
    const [oneRef, twoRef] = [mappedRegion(mappedResult), mappedRegion(mappedResult, 1)]
    const rendered = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: regionRender(page, 'one', oneRef, '一') }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'region_render'))).toBe(true)
    const render = execute(extension.frames, request => object(request.payload).kind === 'region_render')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: render.protocolVersion, grantEpoch: render.grantEpoch,
      installationId: render.installationId, sessionId: render.sessionId, requestId: render.requestId,
      deadline: render.deadline, fingerprint: render.fingerprint,
      outcome: 'observed', quiescent: true, value: { rendered: 1 },
    } }))
    await rendered
    const clearing = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'region_clear', page, mountId: 'one' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.filter(frame => actionKind(frame, 'region_clear'))).toHaveLength(1)
    const clear = execute(extension.frames, request => object(request.payload).kind === 'region_clear')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: clear.protocolVersion, grantEpoch: clear.grantEpoch,
      installationId: clear.installationId, sessionId: clear.sessionId, requestId: clear.requestId,
      deadline: clear.deadline, fingerprint: clear.fingerprint,
      outcome: 'observed', quiescent: true, value: { cleared: false, restored: 0 },
    } }))
    await expect(clearing).resolves.toMatchObject({ outcome: 'observed', value: { cleared: false } })
    await expect(test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: regionRender(page, 'two', twoRef, '二') }, new AbortController().signal))
      .resolves.toMatchObject({ delivery: 'not-sent', reason: 'mount_capacity' })
    const absent = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'region_clear', page, mountId: 'one' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.filter(frame => actionKind(frame, 'region_clear'))).toHaveLength(2)
    const absentClear = execute(extension.frames, request => request.requestId !== clear.requestId && object(request.payload).kind === 'region_clear')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: absentClear.protocolVersion, grantEpoch: absentClear.grantEpoch,
      installationId: absentClear.installationId, sessionId: absentClear.sessionId, requestId: absentClear.requestId,
      deadline: absentClear.deadline, fingerprint: absentClear.fingerprint,
      outcome: 'observed', quiescent: true, value: { cleared: false, restored: 0, disposition: 'absent' },
    } }))
    await expect(absent).resolves.toMatchObject({ outcome: 'observed', value: { disposition: 'absent' } })
    const replacement = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: regionRender(page, 'two', twoRef, '二') }, new AbortController().signal)
    await expect.poll(() => extension.frames.filter(frame => actionKind(frame, 'region_render')).length).toBe(2)
    const rerender = execute(extension.frames, request => request.requestId !== render.requestId && object(request.payload).kind === 'region_render')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: rerender.protocolVersion, grantEpoch: rerender.grantEpoch,
      installationId: rerender.installationId, sessionId: rerender.sessionId, requestId: rerender.requestId,
      deadline: rerender.deadline, fingerprint: rerender.fingerprint, outcome: 'observed', quiescent: true, value: { rendered: 1 },
    } }))
    await expect(replacement).resolves.toMatchObject({ outcome: 'observed' })
  })

  it('更新已挂载 region 失败时保留旧 lease，而非把它当作新 reservation 回收', async () => {
    const test = await mounted({ maxMounts: 1 }); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const page = { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }
    const map = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'page_map', page } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'page_map'))).toBe(true)
    const mapRequest = execute(extension.frames)
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: mapRequest.protocolVersion, grantEpoch: mapRequest.grantEpoch,
      installationId: mapRequest.installationId, sessionId: mapRequest.sessionId, requestId: mapRequest.requestId,
      deadline: mapRequest.deadline, fingerprint: mapRequest.fingerprint, outcome: 'observed', quiescent: true,
      value: { page, regions: [{ selector: '#one', disposable: true, protected: false }, { selector: '#two', disposable: true, protected: false }] },
    } }))
    const mappedResult = await map
    const [oneRef, twoRef] = [mappedRegion(mappedResult), mappedRegion(mappedResult, 1)]
    const renderPanel = (mountId: string, regionRef: string) => test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'),
      installationId: identity.installationId, action: regionRender(page, mountId, regionRef, mountId) }, new AbortController().signal)
    const first = renderPanel('one', oneRef)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'region_render'))).toBe(true)
    const initial = execute(extension.frames, request => object(request.payload).kind === 'region_render')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: initial.protocolVersion, grantEpoch: initial.grantEpoch,
      installationId: initial.installationId, sessionId: initial.sessionId, requestId: initial.requestId,
      deadline: initial.deadline, fingerprint: initial.fingerprint, outcome: 'observed', quiescent: true, value: { rendered: 1 },
    } }))
    await first
    const update = renderPanel('one', oneRef)
    await expect.poll(() => extension.frames.filter(frame => actionKind(frame, 'region_render')).length).toBe(2)
    const updateRequest = execute(extension.frames, request => request.requestId !== initial.requestId && object(request.payload).kind === 'region_render')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: updateRequest.protocolVersion, grantEpoch: updateRequest.grantEpoch,
      installationId: updateRequest.installationId, sessionId: updateRequest.sessionId, requestId: updateRequest.requestId,
      deadline: updateRequest.deadline, fingerprint: updateRequest.fingerprint, outcome: 'failed', quiescent: true, reason: 'region_target_not_found',
    } }))
    await expect(update).resolves.toMatchObject({ outcome: 'failed', reason: 'region_target_not_found' })
    await expect(renderPanel('two', twoRef)).resolves.toMatchObject({ delivery: 'not-sent', reason: 'mount_capacity' })
  })

  it('仅 document_replaced 回收失去页面运行时的 entry lease', async () => {
    const test = await mounted({ maxMounts: 1 }); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const oldPage = { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }
    const mount = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_mount', page: oldPage, mountId: 'old-entry', regionSelector: 'body', selector: ':scope .row', label: '收集' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'entry_mount'))).toBe(true)
    const mountRequest = execute(extension.frames, request => object(request.payload).kind === 'entry_mount')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: mountRequest.protocolVersion, grantEpoch: mountRequest.grantEpoch,
      installationId: mountRequest.installationId, sessionId: mountRequest.sessionId, requestId: mountRequest.requestId,
      deadline: mountRequest.deadline, fingerprint: mountRequest.fingerprint, outcome: 'observed', quiescent: true, value: { mounted: 1 },
    } }))
    await mount
    const unmount = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_unmount', page: oldPage, mountId: 'old-entry' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'entry_unmount'))).toBe(true)
    const unmountRequest = execute(extension.frames, request => object(request.payload).kind === 'entry_unmount')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: unmountRequest.protocolVersion, grantEpoch: unmountRequest.grantEpoch,
      installationId: unmountRequest.installationId, sessionId: unmountRequest.sessionId, requestId: unmountRequest.requestId,
      deadline: unmountRequest.deadline, fingerprint: unmountRequest.fingerprint, outcome: 'failed', quiescent: true, reason: 'document_replaced',
    } }))
    await expect(unmount).resolves.toMatchObject({ outcome: 'failed', reason: 'document_replaced' })
    const newPage = { ...oldPage, documentId: 'document-2', url: 'https://example.test/next' }
    const replacement = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_mount', page: newPage, mountId: 'new-entry', regionSelector: 'body', selector: ':scope .row', label: '收集' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.filter(frame => actionKind(frame, 'entry_mount')).length).toBe(2)
    const replacementRequest = execute(extension.frames, request => request.requestId !== mountRequest.requestId && object(request.payload).kind === 'entry_mount')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: replacementRequest.protocolVersion, grantEpoch: replacementRequest.grantEpoch,
      installationId: replacementRequest.installationId, sessionId: replacementRequest.sessionId, requestId: replacementRequest.requestId,
      deadline: replacementRequest.deadline, fingerprint: replacementRequest.fingerprint, outcome: 'observed', quiescent: true, value: { mounted: 1 },
    } }))
    await expect(replacement).resolves.toMatchObject({ outcome: 'observed' })
  })

  it('document_replaced 释放已由扩展丢弃的 region lease，但 URL 漂移不在此路径释放', async () => {
    const test = await mounted({ maxMounts: 1 }); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const oldPage = { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }
    const map = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'page_map', page: oldPage } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'page_map'))).toBe(true)
    const mapRequest = execute(extension.frames)
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: mapRequest.protocolVersion, grantEpoch: mapRequest.grantEpoch,
      installationId: mapRequest.installationId, sessionId: mapRequest.sessionId, requestId: mapRequest.requestId,
      deadline: mapRequest.deadline, fingerprint: mapRequest.fingerprint, outcome: 'observed', quiescent: true,
      value: { page: oldPage, regions: [{ selector: '#one', disposable: true, protected: false }] },
    } }))
    const oldMap = await map
    const oldRef = mappedRegion(oldMap)
    const render = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: regionRender(oldPage, 'old-region', oldRef, '一') }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'region_render'))).toBe(true)
    const renderRequest = execute(extension.frames, request => object(request.payload).kind === 'region_render')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: renderRequest.protocolVersion, grantEpoch: renderRequest.grantEpoch,
      installationId: renderRequest.installationId, sessionId: renderRequest.sessionId, requestId: renderRequest.requestId,
      deadline: renderRequest.deadline, fingerprint: renderRequest.fingerprint, outcome: 'observed', quiescent: true, value: { rendered: 1 },
    } }))
    await render
    const staleClear = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'region_clear', page: oldPage, mountId: 'old-region' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'region_clear'))).toBe(true)
    const staleRequest = execute(extension.frames, request => object(request.payload).kind === 'region_clear')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: staleRequest.protocolVersion, grantEpoch: staleRequest.grantEpoch,
      installationId: staleRequest.installationId, sessionId: staleRequest.sessionId, requestId: staleRequest.requestId,
      deadline: staleRequest.deadline, fingerprint: staleRequest.fingerprint, outcome: 'failed', quiescent: true, reason: 'target_url_stale',
    } }))
    await staleClear
    const blocked = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: regionRender(oldPage, 'still-blocked', oldRef, '二') }, new AbortController().signal)
    await expect(blocked).resolves.toMatchObject({ delivery: 'not-sent', reason: 'mount_capacity' })
    const replacedClear = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'region_clear', page: oldPage, mountId: 'old-region' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.filter(frame => actionKind(frame, 'region_clear')).length).toBe(2)
    const replacedRequest = execute(extension.frames, request => request.requestId !== staleRequest.requestId && object(request.payload).kind === 'region_clear')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: replacedRequest.protocolVersion, grantEpoch: replacedRequest.grantEpoch,
      installationId: replacedRequest.installationId, sessionId: replacedRequest.sessionId, requestId: replacedRequest.requestId,
      deadline: replacedRequest.deadline, fingerprint: replacedRequest.fingerprint, outcome: 'failed', quiescent: true, reason: 'document_replaced',
    } }))
    await expect(replacedClear).resolves.toMatchObject({ outcome: 'failed', reason: 'document_replaced' })
    const newPage = { ...oldPage, documentId: 'document-2', url: 'https://example.test/next' }
    const newMap = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'page_map', page: newPage } }, new AbortController().signal)
    await expect.poll(() => extension.frames.filter(frame => actionKind(frame, 'page_map')).length).toBe(2)
    const newMapRequest = execute(extension.frames, request => request.requestId !== mapRequest.requestId && object(request.payload).kind === 'page_map')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: newMapRequest.protocolVersion, grantEpoch: newMapRequest.grantEpoch,
      installationId: newMapRequest.installationId, sessionId: newMapRequest.sessionId, requestId: newMapRequest.requestId,
      deadline: newMapRequest.deadline, fingerprint: newMapRequest.fingerprint, outcome: 'observed', quiescent: true,
      value: { page: newPage, regions: [{ selector: '#two', disposable: true, protected: false }] },
    } }))
    const newMapResult = await newMap
    const newRef = mappedRegion(newMapResult)
    const replacement = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: regionRender(newPage, 'new-region', newRef, '二') }, new AbortController().signal)
    await expect.poll(() => extension.frames.filter(frame => actionKind(frame, 'region_render')).length).toBe(2)
    const replacementRequest = execute(extension.frames, request => request.requestId !== renderRequest.requestId && object(request.payload).kind === 'region_render')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: replacementRequest.protocolVersion, grantEpoch: replacementRequest.grantEpoch,
      installationId: replacementRequest.installationId, sessionId: replacementRequest.sessionId, requestId: replacementRequest.requestId,
      deadline: replacementRequest.deadline, fingerprint: replacementRequest.fingerprint, outcome: 'observed', quiescent: true, value: { rendered: 1 },
    } }))
    await expect(replacement).resolves.toMatchObject({ outcome: 'observed' })
  })

  it('更高 grantEpoch 只能回收同页面的旧 region，回收后释放容量', async () => {
    const test = await mounted({ maxMounts: 1 }); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const page = { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }
    const mapped = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'page_map', page } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'page_map'))).toBe(true)
    const map = execute(extension.frames)
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: map.protocolVersion, grantEpoch: map.grantEpoch,
      installationId: map.installationId, sessionId: map.sessionId, requestId: map.requestId,
      deadline: map.deadline, fingerprint: map.fingerprint,
      outcome: 'observed', quiescent: true, value: { page, regions: [
        { selector: '#one', disposable: true, protected: false }, { selector: '#two', disposable: true, protected: false },
      ] },
    } }))
    const mappedResult = await mapped
    const oneRef = mappedRegion(mappedResult)
    const rendered = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: regionRender(page, 'one', oneRef, '一') }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'region_render'))).toBe(true)
    const render = execute(extension.frames, request => object(request.payload).kind === 'region_render')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: render.protocolVersion, grantEpoch: render.grantEpoch,
      installationId: render.installationId, sessionId: render.sessionId, requestId: render.requestId,
      deadline: render.deadline, fingerprint: render.fingerprint,
      outcome: 'observed', quiescent: true, value: { rendered: 1 },
    } }))
    await rendered
    const renewed = await test.pair(['browser:read', 'browser:write'], identity.installationId)
    const replacement = await peer(test.base, renewed)
    const clearing = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'region_clear', page, mountId: 'one' } }, new AbortController().signal)
    await expect.poll(() => replacement.frames.some(frame => actionKind(frame, 'region_clear'))).toBe(true)
    const clear = execute(replacement.frames, request => object(request.payload).kind === 'region_clear')
    extension.socket.terminate()
    replacement.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: clear.protocolVersion, grantEpoch: clear.grantEpoch,
      installationId: clear.installationId, sessionId: clear.sessionId, requestId: clear.requestId,
      deadline: clear.deadline, fingerprint: clear.fingerprint,
      outcome: 'observed', quiescent: true, value: { cleared: true, restored: 0 },
    } }))
    await expect(clearing).resolves.toMatchObject({ outcome: 'observed', value: { cleared: true } })
    const remapped = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'page_map', page } }, new AbortController().signal)
    await expect.poll(() => replacement.frames.filter(frame => actionKind(frame, 'page_map'))).toHaveLength(1)
    const remap = execute(replacement.frames, request => object(request.payload).kind === 'page_map')
    replacement.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: remap.protocolVersion, grantEpoch: remap.grantEpoch,
      installationId: remap.installationId, sessionId: remap.sessionId, requestId: remap.requestId,
      deadline: remap.deadline, fingerprint: remap.fingerprint,
      outcome: 'observed', quiescent: true, value: { page, regions: [{ selector: '#two', disposable: true, protected: false }] },
    } }))
    const remappedResult = await remapped
    const twoRef = mappedRegion(remappedResult)
    const next = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: regionRender(page, 'two', twoRef, '二') }, new AbortController().signal)
    await expect.poll(() => replacement.frames.filter(frame => actionKind(frame, 'region_render'))).toHaveLength(1)
    const nextRequest = execute(replacement.frames, request => object(request.payload).kind === 'region_render')
    replacement.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: nextRequest.protocolVersion, grantEpoch: nextRequest.grantEpoch,
      installationId: nextRequest.installationId, sessionId: nextRequest.sessionId,
      requestId: nextRequest.requestId, deadline: nextRequest.deadline, fingerprint: nextRequest.fingerprint,
      outcome: 'observed', quiescent: true, value: { rendered: 1 },
    } }))
    await expect(next).resolves.toMatchObject({ outcome: 'observed', value: { rendered: 1 } })
  })

  it('entry mount 在发送前预留容量，未知结果不能被另一个 mountId 绕过', async () => {
    const test = await mounted({ maxMounts: 1 }); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const page = { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }
    const first = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_mount', page, mountId: 'one', regionSelector: 'body', selector: ':scope .row', label: '收集' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'entry_mount'))).toBe(true)
    extension.socket.terminate()
    await expect(first).resolves.toMatchObject({ outcome: 'unknown', delivery: 'sent' })
    await expect(test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_mount', page, mountId: 'two', regionSelector: 'body', selector: ':scope .row', label: '收集' } }, new AbortController().signal))
      .resolves.toMatchObject({ delivery: 'not-sent', reason: 'mount_capacity' })
  })

  it('已挂载 entry 的更新失败保留 Host registration、容量与点击门', async () => {
    const test = await mounted({ maxMounts: 1 }); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const page = { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }
    const mount = () => test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_mount', page, mountId: 'one', regionSelector: 'body', selector: ':scope .row', label: '收集' } }, new AbortController().signal)
    const first = mount()
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'entry_mount'))).toBe(true)
    const initial = execute(extension.frames, request => object(request.payload).kind === 'entry_mount')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: initial.protocolVersion, grantEpoch: initial.grantEpoch,
      installationId: initial.installationId, sessionId: initial.sessionId, requestId: initial.requestId,
      deadline: initial.deadline, fingerprint: initial.fingerprint, outcome: 'observed', quiescent: true, value: { mounted: 1 },
    } }))
    await first
    const update = mount()
    await expect.poll(() => extension.frames.filter(frame => actionKind(frame, 'entry_mount')).length).toBe(2)
    const updateRequest = execute(extension.frames, request => request.requestId !== initial.requestId && object(request.payload).kind === 'entry_mount')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: updateRequest.protocolVersion, grantEpoch: updateRequest.grantEpoch,
      installationId: updateRequest.installationId, sessionId: updateRequest.sessionId, requestId: updateRequest.requestId,
      deadline: updateRequest.deadline, fingerprint: updateRequest.fingerprint, outcome: 'failed', quiescent: true, reason: 'stale_binding',
    } }))
    await expect(update).resolves.toMatchObject({ outcome: 'failed', reason: 'stale_binding' })
    await expect(test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_mount', page, mountId: 'two', regionSelector: 'body', selector: ':scope .row', label: '收集' } }, new AbortController().signal))
      .resolves.toMatchObject({ delivery: 'not-sent', reason: 'mount_capacity' })
    const clickId = randomUUID()
    extension.socket.send(JSON.stringify({ type: 'request', requestId: clickId, method: 'browser.entryEvent', params: {
      mountId: 'one', tabId: page.tabId, frameId: page.frameId, documentId: page.documentId, url: page.url, title: '标题', link: 'https://example.test/item',
    } }))
    await expect.poll(() => extension.frames.find(frame => frame.type === 'response' && frame.requestId === clickId)?.result)
      .toEqual({ ok: true, value: { accepted: true } })
  })

  it('本地 not-sent document_replaced 不释放 entry、region、页面证据或容量', async () => {
    const test = await mounted({ maxMounts: 2 }); const identity = await test.pair()
    const gateway = test.ctx.browser as unknown as {
      readonly mounts: Map<string, object>
      readonly regions: Map<string, object>
      readonly pageMaps: Map<string, object>
      dispatch: (...args: unknown[]) => Promise<unknown>
    }
    const grant = (await test.ctx.browser.instances()).find(instance => instance.installationId === identity.installationId)
    if (grant === undefined) throw new Error('missing grant')
    const page = { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }
    const base = { installationId: identity.installationId, sessionId: SessionId('test-session'), grantEpoch: grant.grantEpoch,
      tabId: page.tabId, frameId: page.frameId, documentId: page.documentId, url: page.url, state: 'mounted' }
    gateway.mounts.set(`${identity.installationId}\u0000entry`, { ...base, mountId: 'entry', acceptingClicks: true })
    gateway.regions.set(`${identity.installationId}\u0000region`, { ...base, mountId: 'region' })
    gateway.pageMaps.set('old-page-evidence', {})
    vi.spyOn(gateway, 'dispatch').mockResolvedValue({ requestId: randomUUID(), sessionId: SessionId('test-session'),
      installationId: identity.installationId, outcome: 'failed', delivery: 'not-sent', reason: 'document_replaced' })
    await expect(test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_unmount', page, mountId: 'entry' } }, new AbortController().signal))
      .resolves.toMatchObject({ delivery: 'not-sent', reason: 'document_replaced' })
    await expect(test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'region_clear', page, mountId: 'region' } }, new AbortController().signal))
      .resolves.toMatchObject({ delivery: 'not-sent', reason: 'document_replaced' })
    expect(gateway.mounts).toHaveLength(1)
    expect(gateway.mounts.get(`${identity.installationId}\u0000entry`)).toMatchObject({ acceptingClicks: true })
    expect(gateway.regions).toHaveLength(1)
    expect(gateway.pageMaps).toHaveLength(1)
    await expect(test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_mount', page, mountId: 'blocked', regionSelector: 'body', selector: ':scope .row', label: '收集' } }, new AbortController().signal))
      .resolves.toMatchObject({ delivery: 'not-sent', reason: 'mount_capacity' })
  })

  it('旧 route 的 region_clear 晚回执不会删除同 mountId 的新 route registration', async () => {
    const test = await mounted({ maxMounts: 1 }); const identity = await test.pair()
    const gateway = test.ctx.browser as unknown as {
      readonly regions: Map<string, object>
      dispatch: (...args: unknown[]) => Promise<unknown>
    }
    const grant = (await test.ctx.browser.instances()).find(instance => instance.installationId === identity.installationId)
    if (grant === undefined) throw new Error('missing grant')
    const oldPage = { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/old' }
    const oldRegistration = { installationId: identity.installationId, sessionId: SessionId('test-session'), grantEpoch: grant.grantEpoch,
      tabId: oldPage.tabId, frameId: oldPage.frameId, documentId: oldPage.documentId, url: oldPage.url, mountId: 'panel', state: 'mounted' }
    const key = `${identity.installationId}\u0000panel`
    gateway.regions.set(key, oldRegistration)
    const entered = Promise.withResolvers<undefined>()
    const deferred = Promise.withResolvers<unknown>()
    vi.spyOn(gateway, 'dispatch').mockImplementation(async () => { entered.resolve(undefined); return deferred.promise })
    const clearing = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'region_clear', page: oldPage, mountId: 'panel' } }, new AbortController().signal)
    await entered.promise
    const newPage = { ...oldPage, url: 'https://example.test/new' }
    const newRegistration = { ...oldRegistration, url: newPage.url }
    gateway.regions.set(key, newRegistration)
    deferred.resolve({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      outcome: 'observed', delivery: 'sent', value: { cleared: true, restored: 0 } })
    await expect(clearing).resolves.toMatchObject({ outcome: 'observed', value: { cleared: true } })
    expect(gateway.regions.get(key)).toBe(newRegistration)
    await expect(test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_mount', page: newPage, mountId: 'other', regionSelector: 'body', selector: ':scope .row', label: '收集' } }, new AbortController().signal))
      .resolves.toMatchObject({ delivery: 'not-sent', reason: 'mount_capacity' })
  })

  it('同页 region_clear 的旧 unknown 状态不会删除后来重渲染的同 mountId registration', async () => {
    const test=await mounted({ maxMounts:1 });const identity=await test.pair();const extension=await peer(test.base,identity)
    const gateway=test.ctx.browser as unknown as { readonly regions:Map<string,object> }
    const sessionId=SessionId('test-session');const page={ tabId:12,frameId:0,documentId:'document-1',url:'https://example.test/page' }
    const mapped=test.ctx.browser.execute({ requestId:randomUUID(),sessionId,installationId:identity.installationId,
      action:{ kind:'page_map',page } },new AbortController().signal)
    await expect.poll(()=>extension.frames.some(frame=>actionKind(frame,'page_map'))).toBe(true)
    const mapRequest=execute(extension.frames,request=>object(request.payload).kind==='page_map')
    extension.socket.send(JSON.stringify({ type:'result',receipt:{ protocolVersion:mapRequest.protocolVersion,grantEpoch:mapRequest.grantEpoch,
      installationId:mapRequest.installationId,sessionId:mapRequest.sessionId,requestId:mapRequest.requestId,deadline:mapRequest.deadline,
      fingerprint:mapRequest.fingerprint,outcome:'observed',quiescent:true,value:{ page,regions:[{ selector:'#side',disposable:true,protected:false }] } } }))
    const mappedResult = await mapped
    const regionRef = mappedRegion(mappedResult)
    const render=(requestId:string)=>test.ctx.browser.execute({ requestId,sessionId,installationId:identity.installationId,
      action:regionRender(page,'panel',regionRef,'证据') },new AbortController().signal)
    const firstId=randomUUID();const first=render(firstId)
    await expect.poll(()=>extension.frames.some(frame=>actionKind(frame,'region_render'))).toBe(true)
    const firstRequest=execute(extension.frames,request=>request.requestId===firstId)
    extension.socket.send(JSON.stringify({ type:'result',receipt:{ protocolVersion:firstRequest.protocolVersion,grantEpoch:firstRequest.grantEpoch,
      installationId:firstRequest.installationId,sessionId:firstRequest.sessionId,requestId:firstRequest.requestId,
      deadline:firstRequest.deadline,
      fingerprint:firstRequest.fingerprint,outcome:'observed',quiescent:true,value:{ rendered:1 } } }))
    await first
    const clearId=randomUUID();const clearing=test.ctx.browser.execute({ requestId:clearId,sessionId,installationId:identity.installationId,
      action:{ kind:'region_clear',page,mountId:'panel' } },new AbortController().signal)
    await expect.poll(()=>extension.frames.some(frame=>frame.type==='execute'&&frame.request?.requestId===clearId)).toBe(true)
    const clearRequest=execute(extension.frames,request=>request.requestId===clearId)
    extension.socket.terminate();await expect(clearing).resolves.toMatchObject({ outcome:'unknown',delivery:'sent' })
    const replacement=await peer(test.base,identity)
    await expect.poll(()=>replacement.frames.some(frame=>frame.type==='status')).toBe(true)
    replacement.socket.send(JSON.stringify({ type:'result',receipt:{ protocolVersion:clearRequest.protocolVersion,grantEpoch:clearRequest.grantEpoch,
      installationId:clearRequest.installationId,sessionId:clearRequest.sessionId,requestId:clearRequest.requestId,
      deadline:clearRequest.deadline,
      fingerprint:clearRequest.fingerprint,outcome:'unknown',quiescent:true,reason:'clear_unknown' } }))
    await expect.poll(async()=>test.ctx.browser.requestStatus({ requestId:clearId,sessionId,installationId:identity.installationId }))
      .toMatchObject({ outcome:'unknown',quiescent:true })
    const acknowledgementId=randomUUID()
    replacement.socket.send(JSON.stringify({ type:'request',requestId:acknowledgementId,method:'browser.acknowledge',params:{ receipt:{
      protocolVersion:clearRequest.protocolVersion,grantEpoch:clearRequest.grantEpoch,installationId:clearRequest.installationId,
      sessionId:clearRequest.sessionId,requestId:clearRequest.requestId,deadline:clearRequest.deadline,fingerprint:clearRequest.fingerprint,
      outcome:'unknown',quiescent:true } } }))
    await expect.poll(()=>replacement.frames.find(frame=>frame.type==='response'&&frame.requestId===acknowledgementId)?.result)
      .toEqual({ ok:true,value:{ acknowledged:true } })
    const secondId=randomUUID();const second=render(secondId)
    await expect.poll(()=>replacement.frames.some(frame=>frame.type==='execute'&&frame.request?.requestId===secondId)).toBe(true)
    const secondRequest=execute(replacement.frames,request=>request.requestId===secondId)
    replacement.socket.send(JSON.stringify({ type:'result',receipt:{ protocolVersion:secondRequest.protocolVersion,grantEpoch:secondRequest.grantEpoch,
      installationId:secondRequest.installationId,sessionId:secondRequest.sessionId,requestId:secondRequest.requestId,
      deadline:secondRequest.deadline,
      fingerprint:secondRequest.fingerprint,outcome:'observed',quiescent:true,value:{ rendered:1 } } }))
    await second
    replacement.socket.send(JSON.stringify({ type:'result',receipt:{ protocolVersion:clearRequest.protocolVersion,grantEpoch:clearRequest.grantEpoch,
      installationId:clearRequest.installationId,sessionId:clearRequest.sessionId,requestId:clearRequest.requestId,
      deadline:clearRequest.deadline,
      fingerprint:clearRequest.fingerprint,outcome:'observed',quiescent:true,value:{ cleared:true,restored:0 } } }))
    await expect.poll(async()=>test.ctx.browser.requestStatus({ requestId:clearId,sessionId,installationId:identity.installationId }))
      .toMatchObject({ outcome:'observed',value:{ cleared:true } })
    expect(gateway.regions.has(`${identity.installationId}\u0000panel`)).toBe(true)
  })

  it('新一代同 mountId 渲染确定失败时不会遗忘上一代已经晚到的清理证明', async()=>{
    const test=await mounted();const identity=await test.pair();const sessionId=SessionId('test-session')
    const page={ tabId:12,frameId:0,documentId:'document-1',url:'https://example.test/page' }
    const gateway=test.ctx.browser as unknown as {
      readonly mounts:Map<string,object>
      readonly regions:Map<string,object>
      settleResourceAction(pending:unknown,result:unknown):void }
    const key=`${identity.installationId}\u0000panel`
    const region={ installationId:identity.installationId,sessionId,grantEpoch:1,...page,mountId:'panel',state:'mounted',generation:2 }
    gateway.regions.set(key,region)
    const operation={ requestId:'clear-old',sessionId,installationId:identity.installationId,action:{ kind:'region_clear',page,mountId:'panel' } }
    gateway.settleResourceAction({ operation,action:operation.action,mount:undefined,region,mountCreated:false,regionCreated:false,
      regionGeneration:1 },{ requestId:'clear-old',outcome:'observed',delivery:'sent',value:{ cleared:true } })
    expect(gateway.regions.has(key)).toBe(true)
    const render={ ...operation,requestId:'render-new',action:regionRender(page,'panel','11111111-1111-4111-8111-111111111111','证据') }
    gateway.settleResourceAction({ operation:render,action:render.action,mount:undefined,region,mountCreated:false,regionCreated:false,
      regionGeneration:2,regionPreviousGeneration:1 },{ requestId:'render-new',outcome:'failed',delivery:'not-sent',reason:'offline' })
    expect(gateway.regions.has(key)).toBe(false)
    const mountKey=`${identity.installationId}\u0000entry`
    const mount={ ...region,mountId:'entry',acceptingClicks:false,generation:2 }
    gateway.mounts.set(mountKey,mount)
    const unmount={ ...operation,requestId:'unmount-old',action:{ kind:'entry_unmount',page,mountId:'entry' } }
    gateway.settleResourceAction({ operation:unmount,action:unmount.action,mount,region:undefined,mountCreated:false,regionCreated:false,
      mountGeneration:1 },{ requestId:'unmount-old',outcome:'observed',delivery:'sent',value:{ unmounted:true,remaining:0 } })
    const remount={ ...operation,requestId:'mount-new',action:{ kind:'entry_mount',page,mountId:'entry',selector:'.row',label:'收集' } }
    gateway.settleResourceAction({ operation:remount,action:remount.action,mount,region:undefined,mountCreated:false,regionCreated:false,
      mountGeneration:2,mountPreviousGeneration:1 },{ requestId:'mount-new',outcome:'failed',delivery:'not-sent',reason:'offline' })
    expect(gateway.mounts.has(mountKey)).toBe(false)
  })

  it('重连 status 以未知 document_replaced 确认旧目标消失后释放其 mount 容量', async () => {
    const test = await mounted({ maxMounts: 1 }); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const page = { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }
    const mount = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_mount', page, mountId: 'old', regionSelector: 'body', selector: ':scope .row', label: '收集' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'entry_mount'))).toBe(true)
    const mountRequest = execute(extension.frames, request => object(request.payload).kind === 'entry_mount')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: mountRequest.protocolVersion, grantEpoch: mountRequest.grantEpoch,
      installationId: mountRequest.installationId, sessionId: mountRequest.sessionId, requestId: mountRequest.requestId,
      deadline: mountRequest.deadline, fingerprint: mountRequest.fingerprint, outcome: 'observed', quiescent: true, value: { mounted: 1 },
    } }))
    await mount
    const click = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'click', intent: '打开', element: { page, snapshotId: 'snapshot', elementId: 'button' } } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'click'))).toBe(true)
    const clickRequest = execute(extension.frames, request => object(request.payload).kind === 'click')
    extension.socket.terminate()
    await expect(click).resolves.toMatchObject({ outcome: 'unknown', delivery: 'sent' })
    const replacement = await peer(test.base, identity)
    await expect.poll(() => replacement.frames.some(frame => frame.type === 'status')).toBe(true)
    replacement.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: clickRequest.protocolVersion, grantEpoch: clickRequest.grantEpoch,
      installationId: clickRequest.installationId, sessionId: clickRequest.sessionId, requestId: clickRequest.requestId,
      deadline: clickRequest.deadline, fingerprint: clickRequest.fingerprint, outcome: 'unknown', quiescent: true, reason: 'document_replaced',
    } }))
    await expect.poll(async () => test.ctx.browser.requestStatus({
      requestId: clickRequest.requestId, sessionId: SessionId(clickRequest.sessionId), installationId: clickRequest.installationId,
    })).toMatchObject({ outcome: 'unknown', quiescent: true, reason: 'document_replaced' })
    const newPage = { ...page, documentId: 'document-2', url: 'https://example.test/next' }
    const replacementMount = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_mount', page: newPage, mountId: 'new', regionSelector: 'body', selector: ':scope .row', label: '收集' } }, new AbortController().signal)
    await expect.poll(() => replacement.frames.some(frame => actionKind(frame, 'entry_mount'))).toBe(true)
    const replacementRequest = execute(replacement.frames, request => object(request.payload).kind === 'entry_mount')
    replacement.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: replacementRequest.protocolVersion, grantEpoch: replacementRequest.grantEpoch,
      installationId: replacementRequest.installationId, sessionId: replacementRequest.sessionId, requestId: replacementRequest.requestId,
      deadline: replacementRequest.deadline, fingerprint: replacementRequest.fingerprint, outcome: 'observed', quiescent: true, value: { mounted: 1 },
    } }))
    await expect(replacementMount).resolves.toMatchObject({ outcome: 'observed' })
  })

  it('重连的终态 entry_mount 回执按原调用重新打开点击门', async () => {
    const test = await mounted({ maxMounts: 1 }); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const page = { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }
    const mounting = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_mount', page, mountId: 'retained', regionSelector: 'body', selector: ':scope .row', label: '收集' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'entry_mount'))).toBe(true)
    const issued = execute(extension.frames, request => object(request.payload).kind === 'entry_mount')
    extension.socket.terminate()
    await expect(mounting).resolves.toMatchObject({ outcome: 'unknown', delivery: 'sent' })
    const replacement = await peer(test.base, identity)
    await expect.poll(() => replacement.frames.some(frame => frame.type === 'status')).toBe(true)
    replacement.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: issued.protocolVersion, grantEpoch: issued.grantEpoch,
      installationId: issued.installationId, sessionId: issued.sessionId, requestId: issued.requestId, deadline: issued.deadline,
      fingerprint: issued.fingerprint, outcome: 'observed', quiescent: true, value: { mounted: 1 },
    } }))
    await expect.poll(async () => test.ctx.browser.requestStatus({
      requestId: issued.requestId, sessionId: SessionId(issued.sessionId), installationId: issued.installationId,
    }))
      .toMatchObject({ outcome: 'observed', quiescent: true })
    const eventId = randomUUID()
    replacement.socket.send(JSON.stringify({ type: 'request', requestId: eventId, method: 'browser.entryEvent', params: {
      mountId: 'retained', tabId: page.tabId, frameId: page.frameId, documentId: page.documentId, url: page.url, title: '标题', link: 'https://example.test/item',
    } }))
    await expect.poll(() => replacement.frames.find(frame => frame.type === 'response' && frame.requestId === eventId)?.result)
      .toEqual({ ok: true, value: { accepted: true } })
  })

  it('待结算资源以 session、安装和 requestId 共同隔离', async () => {
    const test = await mounted(); const identity = await test.pair()
    const gateway = test.ctx.browser as unknown as {
      readonly pendingResourceSettlements: Map<string, unknown>
      settleResourceAction: (pending: unknown, result: unknown) => void
    }
    const page = { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }
    for (const sessionId of ['session-one', 'session-two']) {
      gateway.settleResourceAction({ operation: { requestId: 'shared-request', sessionId, installationId: identity.installationId },
        action: { kind: 'entry_mount', page, mountId: `mount-${sessionId}` }, mount: undefined, region: undefined,
        mountCreated: false, regionCreated: false }, { requestId: 'shared-request', outcome: 'unknown', delivery: 'sent' })
    }
    expect(gateway.pendingResourceSettlements).toHaveLength(2)
  })

  it('quiescent document_replaced status 会清掉对应资源的待结算记录', async () => {
    const test = await mounted({ maxMounts: 1 }); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const gateway = test.ctx.browser as unknown as { readonly pendingResourceSettlements: Map<string, unknown> }
    const page = { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }
    const mounting = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_mount', page, mountId: 'gone', regionSelector: 'body', selector: ':scope .row', label: '收集' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'entry_mount'))).toBe(true)
    const issued = execute(extension.frames, request => object(request.payload).kind === 'entry_mount')
    extension.socket.terminate()
    await expect(mounting).resolves.toMatchObject({ outcome: 'unknown', delivery: 'sent' })
    expect(gateway.pendingResourceSettlements).toHaveLength(1)
    const replacement = await peer(test.base, identity)
    await expect.poll(() => replacement.frames.some(frame => frame.type === 'status')).toBe(true)
    replacement.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: issued.protocolVersion, grantEpoch: issued.grantEpoch,
      installationId: issued.installationId, sessionId: issued.sessionId, requestId: issued.requestId, deadline: issued.deadline,
      fingerprint: issued.fingerprint, outcome: 'unknown', quiescent: true, reason: 'document_replaced',
    } }))
    await expect.poll(async () => test.ctx.browser.requestStatus({
      requestId: issued.requestId, sessionId: SessionId(issued.sessionId), installationId: issued.installationId,
    })).toMatchObject({ outcome: 'unknown', quiescent: true, reason: 'document_replaced' })
    expect(gateway.pendingResourceSettlements).toHaveLength(0)
  })

  it('未发出的 entry_unmount 不会把仍在页面上的按钮永久关门', async () => {
    const test = await mounted({ maxMounts: 2 }); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const page = { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }
    const mounting = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_mount', page, mountId: 'still-live', regionSelector: 'body',
        selector: ':scope .row', label: '收集' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'entry_mount'))).toBe(true)
    const mountRequest = execute(extension.frames, request => object(request.payload).kind === 'entry_mount')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: {
      protocolVersion: mountRequest.protocolVersion, grantEpoch: mountRequest.grantEpoch,
      installationId: mountRequest.installationId, sessionId: mountRequest.sessionId,
      requestId: mountRequest.requestId, deadline: mountRequest.deadline,
      fingerprint: mountRequest.fingerprint, outcome: 'observed', quiescent: true, value: { mounted: 1 },
    } }))
    await mounting
    const busy = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'click', intent: '打开', element: { page, snapshotId: 'snapshot', elementId: 'button' } } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'click'))).toBe(true)
    extension.socket.terminate()
    await expect(busy).resolves.toMatchObject({ outcome: 'unknown', delivery: 'sent' })
    const replacement = await peer(test.base, identity)
    await expect(test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_unmount', page, mountId: 'still-live' } }, new AbortController().signal))
      .resolves.toMatchObject({ delivery: 'not-sent', reason: 'target_busy' })
    const eventId = randomUUID()
    replacement.socket.send(JSON.stringify({ type: 'request', requestId: eventId, method: 'browser.entryEvent', params: {
      mountId: 'still-live', tabId: page.tabId, frameId: page.frameId, documentId: page.documentId, url: page.url, title: '标题', link: 'https://example.test/item',
    } }))
    await expect.poll(() => replacement.frames.find(frame => frame.type === 'response' && frame.requestId === eventId)?.result)
      .toEqual({ ok: true, value: { accepted: true } })
  })

  it('只接受页面运行时的精确 route discard，并把其 tombstone 交给后续 release', async () => {
    const test = await mounted({ maxMounts: 1 }); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const page = { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }
    const mount = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_mount', page, mountId: 'old-entry', regionSelector: 'body', selector: ':scope .row', label: '收集' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'entry_mount'))).toBe(true)
    const mountRequest = execute(extension.frames, request => object(request.payload).kind === 'entry_mount')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: mountRequest.protocolVersion, grantEpoch: mountRequest.grantEpoch,
      installationId: mountRequest.installationId, sessionId: mountRequest.sessionId, requestId: mountRequest.requestId,
      deadline: mountRequest.deadline, fingerprint: mountRequest.fingerprint, outcome: 'observed', quiescent: true, value: { mounted: 1 },
    } }))
    await mount
    const rejectId = randomUUID()
    extension.socket.send(JSON.stringify({ type: 'request', requestId: rejectId, method: 'browser.routeDiscard', params: {
      resource: 'entry', mountId: 'old-entry', sessionId: 'test-session', installationId: identity.installationId, grantEpoch: 1,
      page, currentUrl: page.url,
    } }))
    await expect.poll(() => extension.frames.find(frame => frame.type === 'response' && frame.requestId === rejectId)?.result)
      .toEqual({ ok: true, value: { released: false } })
    const blocked = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_mount', page, mountId: 'blocked-entry', regionSelector: 'body', selector: ':scope .row', label: '收集' } }, new AbortController().signal)
    await expect(blocked).resolves.toMatchObject({ delivery: 'not-sent', reason: 'mount_capacity' })
    const discardId = randomUUID()
    extension.socket.send(JSON.stringify({ type: 'request', requestId: discardId, method: 'browser.routeDiscard', params: {
      resource: 'entry', mountId: 'old-entry', sessionId: 'test-session', installationId: identity.installationId, grantEpoch: 1,
      page, currentUrl: 'https://example.test/next',
    } }))
    await expect.poll(() => extension.frames.find(frame => frame.type === 'response' && frame.requestId === discardId)?.result)
      .toEqual({ ok: true, value: { released: true, reason: 'route_discarded' } })
    const release = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_unmount', page, mountId: 'old-entry' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.filter(frame => actionKind(frame, 'entry_unmount')).length).toBe(1)
    const releaseRequest = execute(extension.frames, request => object(request.payload).kind === 'entry_unmount')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: releaseRequest.protocolVersion, grantEpoch: releaseRequest.grantEpoch,
      installationId: releaseRequest.installationId, sessionId: releaseRequest.sessionId, requestId: releaseRequest.requestId,
      deadline: releaseRequest.deadline, fingerprint: releaseRequest.fingerprint, outcome: 'observed', quiescent: true,
      value: { unmounted: true, remaining: 0, disposition: 'route_discarded' },
    } }))
    await expect(release).resolves.toMatchObject({ outcome: 'observed', delivery: 'sent', value: { disposition: 'route_discarded' } })
    const replacement = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'entry_mount', page: { ...page, url: 'https://example.test/next' }, mountId: 'new-entry', regionSelector: 'body', selector: ':scope .row', label: '收集' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.filter(frame => actionKind(frame, 'entry_mount')).length).toBe(2)
    const replacementRequest = execute(extension.frames, request => request.requestId !== mountRequest.requestId && object(request.payload).kind === 'entry_mount')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: replacementRequest.protocolVersion, grantEpoch: replacementRequest.grantEpoch,
      installationId: replacementRequest.installationId, sessionId: replacementRequest.sessionId, requestId: replacementRequest.requestId,
      deadline: replacementRequest.deadline, fingerprint: replacementRequest.fingerprint, outcome: 'observed', quiescent: true, value: { mounted: 1 },
    } }))
    await expect(replacement).resolves.toMatchObject({ outcome: 'observed' })
  })

  it('拒绝未由调用方持久化的 requestId', async () => {
    const test = await mounted(); const identity = await test.pair(); const extension = await peer(test.base, identity)
    await expect(test.ctx.browser.execute({ sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'tabs' } } as never, new AbortController().signal)).resolves.toMatchObject({ delivery: 'not-sent', reason: 'invalid_request_id' })
    expect(extension.frames.some(frame => frame.type === 'execute')).toBe(false)
  })

  it('does not expose a retained request status through a write-only grant', async () => {
    const test = await mounted(); const identity = await test.pair(['browser:write']); await peer(test.base, identity)
    await expect(test.ctx.browser.requestStatus({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId }))
      .resolves.toMatchObject({ delivery: 'not-sent', reason: 'unauthorized' })
  })

  it('preserves semantic query, pagination, text budgets, and presentation evidence queries on the actual extension wire', async () => {
    const test = await mounted(), identity = await test.pair(), extension = await peer(test.base, identity)
    const action = { kind: 'snapshot' as const, tabId: 12, frameId: 0, query: '空气炸锅', offset: 128, limit: 4, textLimit: 0,
      presentationQueries: [{ mountId: 'analysis-panel', text: '证据分歧' }] }
    const pending = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId, action }, new AbortController().signal)
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
    const instance = (await test.ctx.browser.instances())[0]
    expect(instance?.online).toBe(true)
    expect(instance?.capabilities).toEqual(executorCapabilities)
    ;(instance?.capabilities?.actionKinds as string[] | undefined)?.push('forged')
    expect((await test.ctx.browser.instances())[0]?.capabilities?.actionKinds).toEqual(executorCapabilities.actionKinds)
    const callerRequestId = randomUUID()
    const pending = test.ctx.browser.execute({ sessionId: SessionId('test-session'), installationId: identity.installationId, requestId: callerRequestId,
      action: { kind: 'tabs' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => frame.type === 'execute')).toBe(true)
    const request = execute(extension.frames)
    expect(request.requestId).toBe(callerRequestId)
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
    const intents:string[]=[];const settlements:string[]=[]
    test.ctx.on('browser/operation-intent' as never,((context:{ phase:string },next:()=>unknown)=>{
      intents.push(context.phase);return next()
    }) as never)
    test.ctx.on('browser/operation-settled' as never,((context:{ phase:string })=>{
      settlements.push(context.phase)
    }) as never)
    const action = { kind: 'click' as const, intent: '打开详情', element: {
      page: { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }, snapshotId: 'snapshot-1', elementId: 'element-1',
    } }
    const callerRequestId = randomUUID()
    const preparing = test.ctx.browser.prepare(
      { sessionId: SessionId('test-session'), installationId: identity.installationId, requestId: callerRequestId, action }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'prepare'))).toBe(true)
    const prepare = execute(extension.frames, request => object(request.payload).kind === 'prepare')
    expect(prepare.requestId).not.toBe(callerRequestId)
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
    const committing = test.ctx.browser.executePrepared(ticket.ticket, new AbortController().signal)
    const concurrent = test.ctx.browser.executePrepared(ticket.ticket, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'commit'))).toBe(true)
    const commit = execute(extension.frames, request => object(request.payload).kind === 'commit')
    expect(commit.requestId).toBe(callerRequestId)
    expect(commit.mutates).toBe(true)
    expect(commit.payload).toEqual({ kind: 'commit', action, preparationId })
    extension.socket.send(JSON.stringify({ type: 'result', receipt: {
      protocolVersion: commit.protocolVersion, grantEpoch: commit.grantEpoch,
      installationId: commit.installationId, sessionId: commit.sessionId, requestId: commit.requestId,
      deadline: commit.deadline, fingerprint: commit.fingerprint,
      outcome: 'observed', value: { clicked: true } } }))
    const first=await committing;const second=await concurrent
    expect(first).toMatchObject({ outcome: 'observed', value: { clicked: true } })
    expect(second).toEqual(first)
    expect(await test.ctx.browser.executePrepared(ticket.ticket,new AbortController().signal)).toEqual(first)
    expect(extension.frames.filter(frame=>frame.type==='execute'
      &&object(object(frame.request).payload).kind==='commit')).toHaveLength(1)
    expect(intents.filter(phase=>phase==='prepared-commit')).toHaveLength(1)
    expect(settlements.filter(phase=>phase==='prepared-commit')).toHaveLength(1)
  })

  it('retains an expired in-flight prepared lifecycle through another preparation prune', async () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const test = await mounted({ requestTTL: 20, receiptRetentionMs: 1000 })
    const identity = await test.pair(); const extension = await peer(test.base, identity)
    const action = { kind: 'click' as const, intent: '打开详情', element: {
      page: { tabId: 12, frameId: 0, documentId: 'document-prepared-race', url: 'https://example.test/page' }, snapshotId: 'snapshot-1', elementId: 'element-1',
    } }
    const requestId = randomUUID()
    let preparedCommitIntents = 0; const preparedCommitSettlements: unknown[] = []
    test.ctx.on('browser/operation-intent' as never, ((context: { phase: string }, next: () => unknown) => {
      if (context.phase === 'prepared-commit') {
        preparedCommitIntents += 1
        // If the expired lifecycle were deleted, this second policy path would
        // turn the duplicate into a conclusively not-sent result.
        if (preparedCommitIntents > 1) return { kind: 'deny', result: { requestId, sessionId: 'prepared-race',
          installationId: identity.installationId, outcome: 'failed', delivery: 'not-sent', reason: 'duplicate_commit' } }
      }
      return next()
    }) as never)
    test.ctx.on('browser/operation-settled' as never, ((context: { phase: string }) => {
      if (context.phase === 'prepared-commit') preparedCommitSettlements.push(context)
    }) as never)
    const preparing = test.ctx.browser.prepare({ sessionId: SessionId('prepared-race'), installationId: identity.installationId,
      requestId, action }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'prepare'))).toBe(true)
    const prepare = execute(extension.frames, frame => object(frame.payload).kind === 'prepare')
    const expiresAt = object(prepare.payload).expiresAt
    if (typeof expiresAt !== 'number') throw new Error('missing prepare expiry')
    const preparationId = randomUUID()
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: prepare.protocolVersion, grantEpoch: prepare.grantEpoch,
      installationId: prepare.installationId, sessionId: prepare.sessionId, requestId: prepare.requestId, deadline: prepare.deadline,
      fingerprint: prepare.fingerprint, outcome: 'observed', value: { preparationId, expiresAt, description: {
        kind: 'click', page: action.element.page, title: '示例页面', effect: 'unknown' } } } }))
    const ticket = await preparing
    const first = test.ctx.browser.executePrepared(ticket.ticket, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'commit'))).toBe(true)
    now += 21
    // A fresh preparation exercises both Host and BrowserPreparations pruning
    // while the first commit is deliberately still in flight.
    const another = test.ctx.browser.prepare({ sessionId: SessionId('prepared-race'), installationId: identity.installationId,
      requestId: randomUUID(), action }, new AbortController().signal)
    await expect.poll(() => extension.frames.filter(frame => actionKind(frame, 'prepare')).length).toBe(2)
    const secondPrepare = [...extension.frames].reverse().find(frame => actionKind(frame, 'prepare'))?.request
    if (secondPrepare === undefined) throw new Error('missing second prepare')
    const secondExpiresAt = object(secondPrepare.payload).expiresAt
    if (typeof secondExpiresAt !== 'number') throw new Error('missing second prepare expiry')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: secondPrepare.protocolVersion,
      grantEpoch: secondPrepare.grantEpoch, installationId: secondPrepare.installationId, sessionId: secondPrepare.sessionId,
      requestId: secondPrepare.requestId, deadline: secondPrepare.deadline, fingerprint: secondPrepare.fingerprint, outcome: 'observed',
      value: { preparationId: randomUUID(), expiresAt: secondExpiresAt, description: { kind: 'click', page: action.element.page,
        title: '示例页面', effect: 'unknown' } } } }))
    await another
    const duplicate = test.ctx.browser.executePrepared(ticket.ticket, new AbortController().signal)
    expect(extension.frames.filter(frame => actionKind(frame, 'commit'))).toHaveLength(1)
    const commit = execute(extension.frames, frame => object(frame.payload).kind === 'commit')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: commit.protocolVersion, grantEpoch: commit.grantEpoch,
      installationId: commit.installationId, sessionId: commit.sessionId, requestId: commit.requestId, deadline: commit.deadline,
      fingerprint: commit.fingerprint, outcome: 'observed', value: { clicked: true } } }))
    const result = await first
    // The controlled clock also expires the transport deadline, so the first
    // caller must retain its sent/unknown result rather than accepting the
    // duplicate policy's not-sent denial.
    expect(result).toMatchObject({ outcome: 'unknown', delivery: 'sent' })
    expect(await duplicate).toEqual(result)
    expect(preparedCommitIntents).toBe(1)
    expect(preparedCommitSettlements).toHaveLength(1)
  })

  it('retains a settled prepared result for the receipt window then rejects the ticket without resend', async () => {
    let now = 2_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const test = await mounted({ requestTTL: 20, receiptRetentionMs: 1000 })
    const identity = await test.pair(); const extension = await peer(test.base, identity)
    const action = { kind: 'click' as const, intent: '打开详情', element: {
      page: { tabId: 12, frameId: 0, documentId: 'document-prepared-retention', url: 'https://example.test/page' }, snapshotId: 'snapshot-1', elementId: 'element-1',
    } }
    const preparing = test.ctx.browser.prepare({ sessionId: SessionId('prepared-retention'), installationId: identity.installationId,
      requestId: randomUUID(), action }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'prepare'))).toBe(true)
    const prepare = execute(extension.frames, frame => object(frame.payload).kind === 'prepare')
    const expiresAt = object(prepare.payload).expiresAt
    if (typeof expiresAt !== 'number') throw new Error('missing prepare expiry')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: prepare.protocolVersion, grantEpoch: prepare.grantEpoch,
      installationId: prepare.installationId, sessionId: prepare.sessionId, requestId: prepare.requestId, deadline: prepare.deadline,
      fingerprint: prepare.fingerprint, outcome: 'observed', value: { preparationId: randomUUID(), expiresAt, description: {
        kind: 'click', page: action.element.page, title: '示例页面', effect: 'unknown' } } } }))
    const ticket = await preparing
    const pending = test.ctx.browser.executePrepared(ticket.ticket, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'commit'))).toBe(true)
    const commit = execute(extension.frames, frame => object(frame.payload).kind === 'commit')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: commit.protocolVersion, grantEpoch: commit.grantEpoch,
      installationId: commit.installationId, sessionId: commit.sessionId, requestId: commit.requestId, deadline: commit.deadline,
      fingerprint: commit.fingerprint, outcome: 'observed', value: { clicked: true } } }))
    const result = await pending
    now += 999
    expect(await test.ctx.browser.executePrepared(ticket.ticket, new AbortController().signal)).toEqual(result)
    now += 1
    await expect(test.ctx.browser.executePrepared(ticket.ticket, new AbortController().signal)).rejects.toMatchObject({ code: 'ticket_unavailable' })
    expect(extension.frames.filter(frame => actionKind(frame, 'commit'))).toHaveLength(1)
  })

  it('settles a prepared-commit policy exception as conclusively not-sent',async()=>{
    const test=await mounted();const identity=await test.pair();const extension=await peer(test.base,identity)
    const action={ kind:'click' as const,intent:'open',element:{ page:{ tabId:12,frameId:0,
      documentId:'document-policy-commit',url:'https://example.test/page' },snapshotId:'snapshot-1',elementId:'element-1' } }
    const requestId=randomUUID();const preparing=test.ctx.browser.prepare({ sessionId:SessionId('prepared-policy'),
      installationId:identity.installationId,requestId,action },new AbortController().signal)
    await expect.poll(()=>extension.frames.some(frame=>frame.type==='execute'
      &&object(object(frame.request).payload).kind==='prepare')).toBe(true)
    const prepare=execute(extension.frames,value=>object(value.payload).kind==='prepare')
    const expiresAt=object(prepare.payload).expiresAt
    if(typeof expiresAt!=='number')throw new Error('missing prepare expiry')
    extension.socket.send(JSON.stringify({ type:'result',receipt:{ protocolVersion:prepare.protocolVersion,
      grantEpoch:prepare.grantEpoch,installationId:prepare.installationId,sessionId:prepare.sessionId,
      requestId:prepare.requestId,deadline:prepare.deadline,fingerprint:prepare.fingerprint,outcome:'observed',
      value:{ preparationId:randomUUID(),expiresAt,description:{ kind:'click',page:action.element.page,
        title:'Example',effect:'unknown' } } } }))
    const ticket=await preparing;const settlements:unknown[]=[]
    test.ctx.on('browser/operation-intent' as never,((context:{ phase:string },next:()=>unknown)=>{
      if(context.phase==='prepared-commit')throw new Error('commit_policy_failure')
      return next()
    }) as never)
    test.ctx.on('browser/operation-settled' as never,((context:unknown,settlement:unknown)=>{
      settlements.push({ context,settlement })
    }) as never)
    await expect(test.ctx.browser.executePrepared(ticket.ticket,new AbortController().signal)).resolves.toMatchObject({
      requestId,outcome:'failed',delivery:'not-sent',reason:'browser_policy_internal_error' })
    expect(extension.frames.some(frame=>frame.type==='execute'
      &&object(object(frame.request).payload).kind==='commit')).toBe(false)
    const expected: unknown = [matching({
      context: matching({ phase: 'prepared-commit' }),
      settlement: matching({ kind: 'result', result: matching({ delivery: 'not-sent' }) }),
    })]
    expect(settlements).toEqual(expected)
  })

  it('preserves a sent action as unknown across disconnect and only queries it on reconnect', async () => {
    const test = await mounted(); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const pending = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId, action: { kind: 'tabs' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => frame.type === 'execute')).toBe(true)
    extension.socket.terminate()
    expect(await pending).toMatchObject({ outcome: 'unknown', delivery: 'sent' })
    const replacement = await peer(test.base, identity)
    await expect.poll(() => replacement.frames.some(frame => frame.type === 'status')).toBe(true)
    expect(replacement.frames.some(frame => frame.type === 'execute')).toBe(false)
  })

  it('uses a read-only journal lookup to reconcile an old unknown write after write access is revoked',async()=>{
    const test=await mounted();const identity=await test.pair();const extension=await peer(test.base,identity)
    const sessionId=SessionId('read-only-recovery');const requestId=randomUUID()
    const operation={ requestId,sessionId,installationId:identity.installationId,action:{ kind:'click' as const,
      intent:'open',element:{ page:{ tabId:12,frameId:0,documentId:'document-1',url:'https://example.test/page' },
        snapshotId:'snapshot-1',elementId:'button-1' } } }
    const pending=test.ctx.browser.execute(operation,new AbortController().signal)
    await expect.poll(()=>extension.frames.some(frame=>frame.type==='execute')).toBe(true)
    const issued=execute(extension.frames,request=>request.requestId===requestId)
    extension.socket.terminate()
    await expect(pending).resolves.toMatchObject({ outcome:'unknown',delivery:'sent' })
    const renewed=await test.pair(['browser:read'],identity.installationId)
    const replacement=await peer(test.base,renewed)
    await expect.poll(()=>replacement.frames.some(frame=>frame.type==='status-query')).toBe(true)
    expect(replacement.frames.some(frame=>frame.type==='execute')).toBe(false)
    replacement.socket.send(JSON.stringify({ type:'result',receipt:{ protocolVersion:issued.protocolVersion,
      grantEpoch:issued.grantEpoch,installationId:issued.installationId,sessionId:issued.sessionId,
      requestId:issued.requestId,deadline:issued.deadline,fingerprint:issued.fingerprint,
      outcome:'observed',quiescent:true,value:{ clicked:true } } }))
    await expect.poll(async()=>test.ctx.browser.requestStatus({ requestId,sessionId,
      installationId:identity.installationId })).toMatchObject({ outcome:'observed',delivery:'sent',value:{ clicked:true } })
    const executeFrames=replacement.frames.filter(frame=>frame.type==='execute').length
    await expect(test.ctx.browser.execute(operation,new AbortController().signal)).resolves.toMatchObject({
      outcome:'observed',delivery:'sent',value:{ clicked:true } })
    expect(replacement.frames.filter(frame=>frame.type==='execute')).toHaveLength(executeFrames)
  })

  it('queries an older-epoch extension journal after Host request memory is lost without replay', async () => {
    const test=await mounted();const identity=await test.pair();const extension=await peer(test.base,identity)
    const sessionId=SessionId('restart-session');const requestId=randomUUID()
    const operation={ requestId,sessionId,installationId:identity.installationId,
      action:{ kind:'click' as const,intent:'open',element:{ page:{ tabId:12,frameId:0,documentId:'document-1',
        url:'https://example.test/page' },snapshotId:'snapshot-1',elementId:'button-1' } } }
    const executing=test.ctx.browser.execute(operation,new AbortController().signal)
    await expect.poll(()=>extension.frames.some(frame=>frame.type==='execute')).toBe(true)
    const issued=execute(extension.frames,request=>request.requestId===requestId)
    const receipt={ protocolVersion:issued.protocolVersion,grantEpoch:issued.grantEpoch,
      installationId:issued.installationId,sessionId:issued.sessionId,requestId:issued.requestId,
      deadline:issued.deadline,fingerprint:issued.fingerprint,outcome:'observed' as const,quiescent:true,value:{ clicked:true } }
    extension.socket.send(JSON.stringify({ type:'result',receipt }))
    await expect(executing).resolves.toMatchObject({ outcome:'observed' })
    const gateway=test.ctx.browser as unknown as { requests:{ entries:Map<string,unknown> } }
    gateway.requests.entries.clear()
    const renewed=await test.pair(['browser:read','browser:write'],identity.installationId)
    const replacement=await peer(test.base,renewed)
    const status=test.ctx.browser.requestStatus({ requestId,sessionId,installationId:identity.installationId,
      recoveryLocator:{ kind:'extension-journal-v1',protocolVersion:1,transportRequestId:requestId,
        installationId:identity.installationId,grantEpoch:issued.grantEpoch } })
    await expect.poll(()=>replacement.frames.some(frame=>frame.type==='status-query')).toBe(true)
    const query=replacement.frames.find(frame=>frame.type==='status-query')
    expect(query).toMatchObject({ type:'status-query',sessionId,locator:{ grantEpoch:issued.grantEpoch } })
    expect(replacement.frames.some(frame=>frame.type==='execute')).toBe(false)
    replacement.socket.send(JSON.stringify({ type:'result',receipt }))
    await expect(status).resolves.toMatchObject({ outcome:'observed',delivery:'sent',value:{ clicked:true } })
  })

  it('accepts an operator-verified quiescent receipt and releases an unknown write lock', async () => {
    const test = await mounted(); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const action = { kind: 'click' as const, intent: '打开详情', element: {
      page: { tabId: 12, frameId: 0, documentId: 'document-1', url: 'https://example.test/page' }, snapshotId: 'snapshot-1', elementId: 'element-1',
    } }
    const pending = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId, action }, new AbortController().signal)
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
      { requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId, action }, new AbortController().signal)
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
    expect(await test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId, action: { kind: 'tabs' } }, new AbortController().signal)).toMatchObject({ delivery: 'not-sent', reason: 'unauthorized' })
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

  it('mints a private regionRef, never returns a selector, and compiles presentation only at the extension boundary', async () => {
    const test = await mounted(); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const page = { tabId: 12, frameId: 0, documentId: 'document-ref', url: 'https://example.test/page' }
    const mapping = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'page_map', page } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'page_map'))).toBe(true)
    const request = execute(extension.frames, value => object(value.payload).kind === 'page_map')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: request.protocolVersion, grantEpoch: request.grantEpoch,
      installationId: request.installationId, sessionId: request.sessionId, requestId: request.requestId,
      deadline: request.deadline, fingerprint: request.fingerprint,
      outcome: 'observed', value: { page, selector: '#root-private', blocks: [{ type: 'text', text: 'private' }],
        nested: { regionSelector: '#nested-private' }, regions: [{ selector: '#private-side', disposable: true,
          protected: false, label: 'Side', nested: { selector: '#region-private' } }] } } }))
    const mapped = await mapping
    const region = object(mapped.value).regions as unknown[]
    expect(JSON.stringify(mapped.value)).not.toContain('#private-side')
    expect(JSON.stringify(mapped.value)).not.toMatch(/selector|blocks|private/iu)
    expect(typeof object(mapped.value).evidenceExpiresAt).toBe('number')
    const regionRef = string(object(region[0]).regionRef)
    const retained = await test.ctx.browser.requestStatus({ requestId: request.requestId, sessionId: SessionId('test-session'), installationId: identity.installationId })
    expect(JSON.stringify(retained.value)).not.toContain('#private-side')
    expect(JSON.stringify(retained.value)).toContain(regionRef)
    const render = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'region_render', page, mountId: 'private-panel', regionRef,
        presentation: { title: 'Result', summary: 'No selector leaves the Host.' } } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'region_render'))).toBe(true)
    const compiled = object(execute(extension.frames, value => object(value.payload).kind === 'region_render').payload)
    expect(compiled).toMatchObject({ selector: '#private-side', title: 'Result' })
    expect(compiled.blocks).toEqual(expect.arrayContaining([{ type: 'text', text: 'No selector leaves the Host.' }]))
    expect(compiled).not.toHaveProperty('regionRef')
    const renderRequest = execute(extension.frames, value => object(value.payload).kind === 'region_render')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: renderRequest.protocolVersion, grantEpoch: renderRequest.grantEpoch,
      installationId: renderRequest.installationId, sessionId: renderRequest.sessionId, requestId: renderRequest.requestId,
      deadline: renderRequest.deadline,
      fingerprint: renderRequest.fingerprint, outcome: 'observed', value: { rendered: 1 } } }))
    await expect(render).resolves.toMatchObject({ outcome: 'observed' })
  })

  it('projects observe page maps through the same opaque bounded contract', async () => {
    const test = await mounted(); const identity = await test.pair(['browser:read', 'browser:observe']); const extension = await peer(test.base, identity)
    const instance = (await test.ctx.browser.instances())[0]!
    const page = { tabId: 12, frameId: 0, documentId: 'document-observe-map', url: 'https://example.test/page' }
    const observing = test.ctx.browser.observe({ sessionId: SessionId('observe-session'), installationId: identity.installationId,
      grantEpoch: instance.grantEpoch, action: { kind: 'page_map', page } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => frame.type === 'execute'
      && object(object(frame.request).payload).kind === 'observe')).toBe(true)
    const request = execute(extension.frames, value => object(value.payload).kind === 'observe')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: request.protocolVersion,
      grantEpoch: request.grantEpoch, installationId: request.installationId, sessionId: request.sessionId,
      requestId: request.requestId, deadline: request.deadline, fingerprint: request.fingerprint, outcome: 'observed',
      value: { page, regions: [{ selector: '#observe-private', disposable: true, protected: false }] } } }))
    const result = await observing
    expect(JSON.stringify(result.value)).not.toContain('selector')
    expect(object((object(result.value).regions as unknown[])[0]).regionRef).toEqual(expect.any(String))
  })

  it('deeply redacts selector protocol fields from every other public action result', async () => {
    const test = await mounted(); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const pending = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('redact-session'),
      installationId: identity.installationId, action: { kind: 'tabs' } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'tabs'))).toBe(true)
    const request = execute(extension.frames, value => object(value.payload).kind === 'tabs')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: request.protocolVersion,
      grantEpoch: request.grantEpoch, installationId: request.installationId, sessionId: request.sessionId,
      requestId: request.requestId, deadline: request.deadline, fingerprint: request.fingerprint, outcome: 'observed',
      value: { tabs: [{ tabId: 12, selector: '#nested-private', data: { blocks: [{ text: 'private' }] } }],
        regionSelector: '#root-private' } } }))
    const result = await pending
    expect(JSON.stringify(result.value)).not.toMatch(/selector|blocks|private/iu)
  })

  it('rejects an oversized page map instead of retaining unbounded refs', async () => {
    const test = await mounted(); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const page = { tabId: 12, frameId: 0, documentId: 'document-large-map', url: 'https://example.test/page' }
    const mapping = test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('large-map'),
      installationId: identity.installationId, action: { kind: 'page_map', page } }, new AbortController().signal)
    await expect.poll(() => extension.frames.some(frame => actionKind(frame, 'page_map'))).toBe(true)
    const request = execute(extension.frames, value => object(value.payload).kind === 'page_map')
    extension.socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: request.protocolVersion,
      grantEpoch: request.grantEpoch, installationId: request.installationId, sessionId: request.sessionId,
      requestId: request.requestId, deadline: request.deadline, fingerprint: request.fingerprint, outcome: 'observed',
      value: { page, regions: Array.from({ length: 65 }, (_, index) => ({ selector: `#r-${index}`,
        disposable: true, protected: false })) } } }))
    await expect(mapping).resolves.toMatchObject({ outcome: 'failed', delivery: 'sent', reason: 'invalid_page_map' })
  })

  it('rejects a selector-shaped direct Browser action before it reaches the extension', async () => {
    const test = await mounted(); const identity = await test.pair(); const extension = await peer(test.base, identity)
    const page = { tabId: 12, frameId: 0, documentId: 'document-direct', url: 'https://example.test/page' }
    const result = await test.ctx.browser.execute({ requestId: randomUUID(), sessionId: SessionId('test-session'), installationId: identity.installationId,
      action: { kind: 'region_render', page, mountId: 'bypass', selector: '#forbidden', blocks: [{ type: 'text', text: 'no' }] } as never }, new AbortController().signal)
    expect(result).toMatchObject({ outcome: 'failed', delivery: 'not-sent', reason: 'invalid_action' })
    expect(extension.frames.some(frame => actionKind(frame, 'region_render'))).toBe(false)
  })
})
