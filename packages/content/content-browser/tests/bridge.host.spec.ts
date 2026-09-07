import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Content } from '@changanhua/dsh-content'
import type { ContentCommand, ContentReceipt } from '@changanhua/dsh-content'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import ContentBrowser from '../src/index.ts'
import { credentialKey } from '@deepseek-ai/dsh-credentials'

const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
const origin = `chrome-extension://${extensionId}`
const installationId = randomUUID()
const headers = { host: '127.0.0.1:3080', origin, 'content-type': 'application/json' }

class TestContent extends Content {
  calls: ContentCommand[] = []
  beforeCommit: (() => Promise<void>) | undefined
  status() { return { phase: 'ready' as const, reason: null, limits: { bodyBytes: 1024, entryBytes: 4096, libraryBytes: 16384 } } }
  get() { return undefined }
  snapshot() { return { formatVersion: 1 as const, entries: [] } }
  receipt() { return undefined }
  async execute(command: ContentCommand, authorize: () => void): Promise<ContentReceipt> { authorize(); await this.beforeCommit?.(); authorize(); this.calls.push(command); return { operationId: command.operationId, entryId: command.entryId, entryRevision: 1, draftRevision: null, versionId: 'v' } }
  async capture(): Promise<ContentReceipt> { throw new Error('unused') }
}

async function mounted(): Promise<{
  ctx: Context
  bridge: ContentBrowser
  content: TestContent
  routes: unknown[]
  dispose: () => Promise<void>
}> {
  const ctx = new Context()
  const routes: unknown[] = []
  ctx.provide('webServer', { register: (route: unknown) => { routes.push(route); return () => { routes.splice(routes.indexOf(route), 1); return Promise.resolve() } } } as never)
  ctx.provide('connection', { requestAuthorityRejection: () => undefined, assertAuthorized: () => {} } as never)
  const content = new TestContent(ctx)
  await ctx.plugin(MemoryCredentials)
  const fiber = ctx.plugin(ContentBrowser)
  await fiber.await()
  return { ctx, bridge: ctx.get('contentBrowser') as ContentBrowser, content, routes, dispose: () => fiber.dispose() }
}

function verifier(): { value: string; challenge: string } {
  const value = randomBytes(32).toString('base64url')
  return { value, challenge: createHash('sha256').update(Buffer.from(value, 'base64url')).digest('base64url') }
}

describe('content browser Host bridge', () => {
  it('connects, approves, exchanges a byte-hashed verifier, and imports one web original', async () => {
    const { bridge, content, dispose } = await mounted()
    try {
      const proof = verifier()
      const connected = await bridge.fetch(new Request('http://dsh.test/api/content-browser/v1/connect', { method: 'POST', headers, body: JSON.stringify({ challenge: proof.challenge, installationId, extensionId }) }))
      const request = await connected.json() as { requestId: string }
      await bridge.approve(request.requestId, new AbortController().signal)
      const tokenResponse = await bridge.fetch(new Request(`http://dsh.test/api/content-browser/v1/connect/${request.requestId}/token`, { method: 'POST', headers, body: JSON.stringify({ installationId, verifier: proof.value }) }))
      const { token } = await tokenResponse.json() as { token: string }
      const imported = await bridge.fetch(new Request('http://dsh.test/api/content-browser/v1/import', { method: 'POST', headers: { ...headers, authorization: `Bearer ${token}` }, body: JSON.stringify({ captureId: randomUUID(), title: 'title', markdown: 'body', source: { url: 'https://example.test/a', pageTitle: 'page', site: 'example', kind: 'selection', capturedAt: '2026-09-07T00:00:00.000Z' } }) }))
      expect(imported.status).toBe(200)
      expect(content.calls).toHaveLength(1)
      expect(content.calls[0]).toMatchObject({ type: 'save-text', source: { type: 'web-page', scope: 'selection' } })
    } finally { await dispose() }
  })

  it('does not expose pending verifier material through the owner Remote', async () => {
    const { bridge, dispose } = await mounted()
    try {
      const proof = verifier()
      const response = await bridge.fetch(new Request('http://dsh.test/api/content-browser/v1/connect', { method: 'POST', headers, body: JSON.stringify({ challenge: proof.challenge, installationId: randomUUID(), extensionId }) }))
      const request = await response.json() as { requestId: string }
      const view = bridge.request(request.requestId, new AbortController().signal)
      expect(Object.keys(view).sort()).toEqual(['expiresAt', 'extensionId', 'installationId', 'requestId', 'status'])
    } finally { await dispose() }
  })

  it('removes its raw route when the Host fiber disposes', async () => {
    const { routes, dispose } = await mounted()
    expect(routes).toHaveLength(1)
    await dispose()
    expect(routes).toHaveLength(0)
  })
})

const signal = () => new AbortController().signal
function post(path: string, body: unknown, extraHeaders = {}, abort?: AbortSignal): Request {
  return new Request(`http://dsh.test/api/content-browser/v1${path}`, {
    method: 'POST', headers: { ...headers, ...extraHeaders }, body: JSON.stringify(body), ...(abort === undefined ? {} : { signal: abort }),
  })
}
async function connect(bridge: ContentBrowser) {
  const proof = verifier()
  const response = await bridge.fetch(post('/connect', { challenge: proof.challenge, installationId, extensionId }))
  const { requestId } = await response.json() as { requestId: string }
  const exchange = () => bridge.fetch(post(`/connect/${requestId}/token`, { installationId, verifier: proof.value }))
  return { requestId, exchange }
}
function capture(token: string, abort?: AbortSignal): Request {
  return post('/import', {
    captureId: randomUUID(), title: 'title', markdown: 'body',
    source: { url: 'https://example.test/a', pageTitle: 'page', site: 'example', kind: 'selection', capturedAt: '2026-09-07T00:00:00.000Z' },
  }, { authorization: `Bearer ${token}` }, abort)
}
async function authorized(bridge: ContentBrowser) {
  const connection = await connect(bridge)
  const approved = await bridge.approve(connection.requestId, signal())
  expect(Object.keys(approved).sort()).toEqual(['expiresAt', 'extensionId', 'installationId', 'requestId', 'status'])
  const { token } = await (await connection.exchange()).json() as { token: string }
  return { ...connection, token }
}

it('keeps a rejected request rejected when approval was already queued', async () => {
  const test = await mounted()
  try {
    const { requestId } = await connect(test.bridge)
    await Promise.allSettled([test.bridge.reject(requestId, signal()), test.bridge.approve(requestId, signal())])
    expect(test.bridge.request(requestId, signal()).status).toBe('rejected')
    expect(await test.bridge.grants(signal())).toEqual([])
  } finally { await test.dispose() }
})

it('does not report a successful rejection after approval has committed', async () => {
  const test = await mounted()
  try {
    const { requestId } = await connect(test.bridge)
    const results = await Promise.allSettled([test.bridge.approve(requestId, signal()), test.bridge.reject(requestId, signal())])
    expect(results[0]?.status).toBe('fulfilled')
    expect(results[1]?.status).toBe('rejected')
    expect(await test.bridge.grants(signal())).toHaveLength(1)
  } finally { await test.dispose() }
})

it('revocation blocks both token re-delivery and subsequent imports', async () => {
  const test = await mounted()
  try {
    const connected = await authorized(test.bridge)
    await test.bridge.revoke(installationId, signal())
    expect((await connected.exchange()).status).toBe(410)
    expect((await test.bridge.fetch(capture(connected.token))).status).toBe(401)
    expect(test.content.calls).toEqual([])
  } finally { await test.dispose() }
})

it.each(['dispose', 'abort', 'revoke'] as const)('rejects an admitted import when %s happens before its commit', async (action) => {
  const test = await mounted()
  const abort = new AbortController()
  let release!: () => void
  let entered!: () => void
  const waiting = new Promise<void>((done) => { entered = done })
  test.content.beforeCommit = () => { entered(); return new Promise((done) => { release = done }) }
  try {
    const connected = await authorized(test.bridge)
    const importing = test.bridge.fetch(capture(connected.token, abort.signal))
    await waiting
    if (action === 'dispose') await test.dispose()
    else if (action === 'abort') abort.abort()
    else await test.bridge.revoke(installationId, signal())
    release()
    expect((await importing).status).toBe(403)
    expect(test.content.calls).toEqual([])
  } finally { await test.dispose() }
})

it('checks grant changes that happen while the first credentials read is pending', async () => {
  const test = await mounted()
  try {
    const connected = await authorized(test.bridge)
    const previous = await test.ctx.credentials.readRecord(credentialKey('content-browser', 'grant'))
    let resume!: () => void
    let entered!: () => void
    const reading = new Promise<void>((done) => { entered = done })
    vi.spyOn(test.ctx.credentials, 'readRecord').mockImplementationOnce(async () => {
      entered(); await new Promise<void>((done) => { resume = done }); return previous
    })
    const importing = test.bridge.fetch(capture(connected.token))
    await reading
    await test.ctx.credentials.deleteRecord(credentialKey('content-browser', 'grant'))
    resume()
    expect((await importing).status).toBe(403)
    expect(test.content.calls).toEqual([])
  } finally { await test.dispose() }
})

it.each([{ version: 0, grants: [] }, { version: 1, grants: [], token: 'must-never-escape' }])('fails closed on an invalid owner record without replacing it', async (payload) => {
  const test = await mounted()
  try {
    const key = credentialKey('content-browser', 'grant')
    await test.ctx.credentials.modifyRecord(key, async () => ({ kind: 'grant', payload }))
    await expect(test.bridge.grants(signal())).rejects.toBeDefined()
    await expect(test.bridge.revoke(installationId, signal())).rejects.toBeDefined()
    expect((await test.ctx.credentials.readRecord(key))?.kind).toBe('grant')
    expect(await test.ctx.credentials.readRecord(key)).toEqual({ kind: 'grant', payload })
  } finally { await test.dispose() }
})
