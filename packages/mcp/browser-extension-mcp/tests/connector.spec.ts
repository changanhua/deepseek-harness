import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { WebSocket } from 'ws'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserMcp } from '../src/index.ts'
import { startBrowserRelay } from '../src/relay.ts'
import type { Invocation } from '../src/types.ts'
import { actionSchema, configSchema, rpcSchema } from '../src/schema.ts'
import { connectorVersion } from '../src/runtime.ts'

const cleanup: (() => unknown)[] = []
afterEach(async () => { vi.useRealTimers(); while (cleanup.length) await cleanup.pop()?.() })
const extensionId = 'a'.repeat(32)
const origin = `chrome-extension://${extensionId}`
interface ResultBody {
  result?: { requestId: string; outcome: string; reason?: string; value: { text: string } }
  error?: { message: string }
}
const parse = (value: unknown) => value as ResultBody

async function mcp(configPath: string) {
  const server = createBrowserMcp({ configPath, autostart: false })
  const client = new Client({ name: 'connector-test', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  cleanup.push(() => server.close(), () => client.close())
  await server.connect(b); await client.connect(a)
  return client
}
async function fixture(
  capabilities?: { targetFreeOpen?: boolean; actionKinds?: string[]; restartStatusLookup?: boolean }, runtime?: { version: string },
) {
  const config = { port: 0, secret: randomBytes(32).toString('base64url'), extensionIds: [extensionId] }
  const relay = await startBrowserRelay(config)
  cleanup.push(relay.close)
  const root = await mkdtemp(join(tmpdir(), 'browser-connector-test-'))
  cleanup.push(async () => {
    const child = relative(tmpdir(), root)
    if (!child.startsWith('browser-connector-test-') || /[\\/]/u.test(child)) throw new Error('unsafe_cleanup')
    await rm(root, { recursive: true, force: true })
  })
  const configPath = join(root, 'config.json')
  await writeFile(configPath, JSON.stringify({ ...config, port: relay.port }))
  const base = `http://127.0.0.1:${relay.port}`
  const installationId = randomUUID()
  const pair = await fetch(`${base}/browser-connector/connect`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ installationId, extensionId }),
  })
  expect(pair.status).toBe(200)
  const credentials = await pair.json() as { token: string }
  const socket = new WebSocket(`ws://127.0.0.1:${relay.port}/api/browser-extension/v1/ws`, { origin })
  cleanup.push(() => { socket.terminate() })
  await once(socket, 'open')
  const ready = once(socket, 'message')
  socket.send(JSON.stringify({ type: 'hello', protocolVersion: 1, installationId, token: credentials.token,
    ...(runtime ? { runtime } : {}),
    ...(capabilities ? { capabilities: { protocolVersion: 1, requestRecovery: true, actionKinds: capabilities.actionKinds ?? [],
      ...(capabilities.restartStatusLookup === true ? { restartStatusLookup: true } : {}),
      ...(capabilities.targetFreeOpen === undefined ? {} : { targetFreeOpen: capabilities.targetFreeOpen }) } } : {}) }))
  await ready
  return { configPath, base, installationId, socket, config, credentials }
}

describe('independent browser connector', () => {
  it('distinguishes lost grants from revocation, bad credentials and protocol errors', async () => {
    const revoked = randomUUID(), installationId = randomUUID()
    const secret = randomBytes(32).toString('base64url')
    const relay = await startBrowserRelay({ port: 0, secret, extensionIds: [extensionId], revokedInstallationIds: [revoked] })
    cleanup.push(relay.close)
    const token = (id: string) => createHmac('sha256', secret).update(id).digest('base64url')
    const hello = { type: 'hello', protocolVersion: 1, installationId, token: token(installationId) }
    const closed = async (frame: object) => {
      const socket = new WebSocket(`ws://127.0.0.1:${relay.port}/api/browser-extension/v1/ws`, { origin })
      cleanup.push(() => socket.terminate())
      await once(socket, 'open')
      const done = once(socket, 'close')
      socket.send(JSON.stringify(frame))
      const [code, reason] = await done
      return { code, reason: String(reason) }
    }
    expect(await closed(hello)).toEqual({ code: 4409, reason: 'credentials_expired' })
    expect(await closed({ ...hello, token: 'wrong' })).toEqual({ code: 4401, reason: 'invalid_credentials' })
    expect(await closed({ ...hello, type: 'invalid' })).toMatchObject({ code: 1008 })
    expect(await closed({ ...hello, installationId: revoked, token: token(revoked) })).toEqual({ code: 4401, reason: 'authorization_revoked' })
    const untrusted = new WebSocket(`ws://127.0.0.1:${relay.port}/api/browser-extension/v1/ws`, { origin: 'chrome-extension://' + 'b'.repeat(32) })
    cleanup.push(() => untrusted.terminate())
    const [untrustedCode, untrustedReason] = await once(untrusted, 'close')
    expect(untrustedCode).toBe(4403)
    expect(String(untrustedReason)).toBe('extension_not_trusted')
    for (const [requestOrigin, id, code] of [[origin, revoked, 'authorization_revoked'], ['chrome-extension://' + 'b'.repeat(32), installationId, 'extension_not_trusted']] as const) {
      const response = await fetch(`http://127.0.0.1:${relay.port}/browser-connector/connect`, { method: 'POST',
        headers: { origin: requestOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ installationId: id, extensionId }) })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ error: { code } })
    }
  })

  it('discovers tools without configuration or DSH and contains unavailable calls', async () => {
    const client = await mcp(join(tmpdir(), `absent-${randomUUID()}.json`))
    expect((await client.listTools()).tools).toHaveLength(7)
    const status = await client.callTool({ name: 'browser_status', arguments: {} })
    expect(status.isError).toBe(true)
    expect(status.structuredContent).toMatchObject({
      connector: { mcp: { version: connectorVersion, processId: process.pid }, relay: null },
    })
    expect((await client.listTools()).tools).toHaveLength(7)
  })

  it('reports the running MCP, relay and extension separately without returning credentials', async () => {
    const { configPath, installationId, config, credentials, base } = await fixture({ targetFreeOpen: true, actionKinds: ['tab_open'] }, { version: '0.4.0' })
    const client = await mcp(configPath)
    const response = await client.callTool({ name: 'browser_status', arguments: {} })
    expect(response.isError).toBe(false)
    expect(response.structuredContent).toMatchObject({ result: {
      connector: { mcp: { version: connectorVersion, protocolVersion: 1, processId: process.pid },
        relay: { version: connectorVersion, processId: process.pid } },
      instances: [{ installationId, online: true, runtime: { version: '0.4.0' } }], issues: [],
    } })
    const text = JSON.stringify(response)
    expect(text).not.toContain(config.secret)
    expect(text).not.toContain(credentials.token)
    const health = await fetch(`${base}/health`, { headers: { authorization: `Bearer ${config.secret}` } })
    expect(await health.json()).toMatchObject({ service: 'browser-extension-connector', runtime: { version: connectorVersion } })
    expect((await fetch(`${base}/health`)).status).not.toBe(200)
  })

  it('keeps an extension without runtime metadata readable and identifies the missing information', async () => {
    const { configPath, installationId } = await fixture()
    const client = await mcp(configPath)
    const response = await client.callTool({ name: 'browser_status', arguments: {} })
    expect(response.isError).toBe(false)
    expect(response.structuredContent).toMatchObject({ result: {
      instances: [{ installationId, online: true, runtime: null }],
      issues: [{ component: 'extension', installationId, code: 'runtime_unknown' },
        { component: 'extension', installationId, code: 'target_free_open_unavailable' }],
    } })
  })

  it('isolates two MCP callers and preserves raw page data through the relay', async () => {
    const { configPath, socket, installationId } = await fixture()
    const requests: Invocation[] = []
    socket.on('message', (data: Buffer) => {
      const frame = JSON.parse(data.toString('utf8')) as { type: string; request: Invocation }
      if (frame.type !== 'execute') return
      const request = frame.request
      requests.push(request)
      if (request.payload.kind !== 'snapshot') return
      const page = { tabId: request.payload.tabId, frameId: 0, documentId: `doc-${request.payload.tabId}`, url: `https://example.test/${request.payload.tabId}` }
      const receipt = { ...request, outcome: 'observed', quiescent: true, value: { text: `original-${page.tabId}`, page } }
      socket.send(JSON.stringify({ type: 'result', receipt: { ...receipt, sessionId: randomUUID(), value: { text: 'WRONG OWNER' } } }))
      socket.send(JSON.stringify({ type: 'result', receipt }))
    })
    const a = await mcp(configPath), b = await mcp(configPath)
    const read = (client: Client, tabId: number, url = `https://example.test/${tabId}`) => client.callTool({ name: 'browser_read_page', arguments: { installationId, tabId, url } })
    const results = await Promise.all([read(a, 1), read(b, 2)])
    expect(results.map(result => parse(result.structuredContent).result?.value.text)).toEqual(['original-1', 'original-2'])
    expect(new Set(requests.map(request => request.sessionId)).size).toBe(2)
    const id = parse(results[0]?.structuredContent).result?.requestId
    expect((await b.callTool({ name: 'browser_request_status', arguments: { installationId, requestId: id } })).isError).toBe(true)
    expect((await read(a, 1, 'https://example.test/changed')).isError).toBe(true)
    await a.close()
    expect((await read(b, 2)).isError).toBe(false)
  })

  it('carries explicit form-value and compact-read options across MCP and relay', async () => {
    const { configPath, socket, installationId } = await fixture()
    const requests: Invocation[] = []
    socket.on('message', (data: Buffer) => {
      const frame = JSON.parse(data.toString('utf8')) as { type: string; request: Invocation }
      if (frame.type !== 'execute') return
      requests.push(frame.request)
      socket.send(JSON.stringify({ type: 'result', receipt: { ...frame.request, outcome: 'observed', quiescent: true,
        value: { text: 'Title', page: { tabId: 7, frameId: 0, documentId: 'form-doc', url: 'https://example.test/form' } } } }))
    })
    const client = await mcp(configPath)
    const target = { installationId, tabId: 7, url: 'https://example.test/form' }
    const response = await client.callTool({ name: 'browser_read_page', arguments: { ...target,
      query: 'Title', includeValues: true, structure: false } })
    expect(response.isError).toBe(false)
    expect(requests[0].payload).toMatchObject({ kind: 'snapshot', query: 'Title', includeValues: true, structure: false })
    await client.callTool({ name: 'browser_read_page', arguments: target })
    expect(requests[1].payload).toMatchObject({ includeValues: false, structure: true })
  })

  it('rejects foreign web origins and unauthenticated local callers', async () => {
    const { base, installationId } = await fixture()
    const response = await fetch(`${base}/browser-connector/connect`, {
      method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' },
      body: JSON.stringify({ installationId, extensionId }),
    })
    expect(response.status).toBe(403)
    expect((await fetch(`${base}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(403)
  })

  it('replaces an authenticated stale connection without stranding the installation', async () => {
    const { base, installationId, socket, credentials, configPath } = await fixture()
    const replacement = new WebSocket(base.replace('http:', 'ws:') + '/api/browser-extension/v1/ws', { origin })
    cleanup.push(() => { replacement.terminate() })
    await once(replacement, 'open')
    const oldClosed = once(socket, 'close')
    const ready = once(replacement, 'message')
    replacement.send(JSON.stringify({ type: 'hello', protocolVersion: 1, installationId, token: credentials.token }))
    await ready; await oldClosed
    replacement.on('message', (data: Buffer) => {
      const frame = JSON.parse(data.toString('utf8')) as { type: string; request: Invocation }
      if (frame.type === 'execute') replacement.send(JSON.stringify({ type: 'result', receipt: { ...frame.request,
        outcome: 'observed', quiescent: true, value: { tabs: [] } } }))
    })
    const client = await mcp(configPath)
    expect((await client.callTool({ name: 'browser_tabs', arguments: { installationId } })).isError).toBe(false)
  })

  it('expires retained source data while the relay is idle', async () => {
    const { configPath, socket, installationId } = await fixture()
    socket.on('message', (data: Buffer) => {
      const frame = JSON.parse(data.toString('utf8')) as { type: string; request: Invocation }
      if (frame.type === 'execute') socket.send(JSON.stringify({ type: 'result', receipt: { ...frame.request,
        outcome: 'observed', quiescent: true, value: { tabs: [] } } }))
    })
    const client = await mcp(configPath)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const result = await client.callTool({ name: 'browser_tabs', arguments: { installationId } })
    const requestId = parse(result.structuredContent).result?.requestId
    await vi.advanceTimersByTimeAsync(61000)
    vi.useRealTimers()
    const expired = await client.callTool({ name: 'browser_request_status', arguments: { installationId, requestId } })
    expect(parse(expired.structuredContent).result).toMatchObject({ outcome: 'unknown', reason: 'receipt_unavailable' })
  })

  it('rejects an undiscoverable ephemeral port in persisted client configuration', () => {
    expect(configSchema.safeParse({ port: 0, secret: randomBytes(32).toString('base64url'), extensionIds: [extensionId] }).success).toBe(false)
  })

  it('accepts only UUID v4 request identifiers for extension-journal actions', () => {
    const input = { sessionId: randomUUID(), method: 'execute' as const, installationId: randomUUID(),
      action: { kind: 'tab_open' as const, url: 'https://example.test/open' } }
    expect(rpcSchema.safeParse({ ...input, requestId: randomUUID() }).success).toBe(true)
    expect(rpcSchema.safeParse({ ...input, requestId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' }).success).toBe(false)
    expect(rpcSchema.safeParse({ ...input, requestId: '01890f0e-7c3a-7cc0-8a23-2f5d402a0c6a' }).success).toBe(false)
  })

  it('requires a complete UUID v4 browser session reference when a snapshot supplies expectedTab', () => {
    const reference = { tabId: 9, windowId: 2, browserSessionId: randomUUID() }
    expect(actionSchema.safeParse({ kind: 'snapshot', tabId: 9, frameId: 0, expectedTab: reference }).success).toBe(true)
    expect(actionSchema.safeParse({ kind: 'snapshot', tabId: 9, frameId: 0, expectedTab: { ...reference, browserSessionId: '01890f0e-7c3a-7cc0-8a23-2f5d402a0c6a' } }).success).toBe(false)
  })

  it('returns unknown on a sent action disconnect and never replays it', async () => {
    const { configPath, socket, installationId } = await fixture()
    let count = 0
    socket.on('message', (data: Buffer) => {
      const frame = JSON.parse(data.toString('utf8')) as { type: string }
      if (frame.type === 'execute') { count++; socket.close() }
    })
    const client = await mcp(configPath)
    const result = await client.callTool({ name: 'browser_act', arguments: { installationId,
      action: { kind: 'scroll', page: { tabId: 1, frameId: 0, documentId: 'doc-1', url: 'https://example.test/1' }, x: 0, y: 300 } } })
    expect(parse(result.structuredContent).result).toMatchObject({ outcome: 'unknown', reason: 'connection_lost' })
    const requestId = parse(result.structuredContent).result?.requestId
    await client.callTool({ name: 'browser_request_status', arguments: { installationId, requestId } })
    expect(count).toBe(1)
    expect((await client.listTools()).tools).toHaveLength(7)
  })

  it('retains the original action identity when the HTTP reply is lost after execution', async () => {
    const { configPath, base, config, socket, installationId } = await fixture()
    let executed = 0, forwardedRequestId: string | undefined, executedRequestId: string | undefined
    socket.on('message', (data: Buffer) => {
      const frame = JSON.parse(data.toString('utf8')) as { type: string; request: Invocation }
      if (frame.type !== 'execute') return
      executed++
      executedRequestId = frame.request.requestId
      socket.send(JSON.stringify({ type: 'result', receipt: { ...frame.request, outcome: 'observed', quiescent: true, value: { acknowledged: true } } }))
    })
    const proxy = createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const body = Buffer.concat(chunks).toString()
        const rpc = body ? JSON.parse(body) as { method?: string; requestId?: string } : undefined
        const result = await fetch(base + request.url, { method: request.method,
          headers: { authorization: request.headers.authorization ?? '', 'content-type': 'application/json' },
          ...(body ? { body } : {}), redirect: 'error' })
        const text = await result.text()
        if (rpc?.method === 'execute') {
          forwardedRequestId = rpc.requestId
          response.destroy()
          return
        }
        response.writeHead(result.status, { 'content-type': 'application/json' }); response.end(text)
      })().catch(() => { response.destroy() })
    })
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
    cleanup.push(async () => new Promise<void>((resolve) => { proxy.close(() => resolve()); proxy.closeAllConnections() }))
    const address = proxy.address()
    if (!address || typeof address === 'string') throw new Error('proxy listener missing')
    await writeFile(configPath, JSON.stringify({ ...config, port: address.port }))
    const client = await mcp(configPath)
    const failed = await client.callTool({ name: 'browser_act', arguments: { installationId,
      action: { kind: 'scroll', page: { tabId: 1, frameId: 0, documentId: 'doc-1', url: 'https://example.test/1' }, x: 0, y: 300 } } })
    expect(executed).toBe(1)
    expect(failed.isError).toBe(true)
    expect(parse(failed.structuredContent).result).toMatchObject({
      outcome: 'unknown', requestId: executedRequestId, reason: 'connector_result_unavailable',
    })
    expect(forwardedRequestId).toBe(executedRequestId)
    const recovered = await client.callTool({ name: 'browser_request_status', arguments: { installationId, requestId: executedRequestId } })
    expect(parse(recovered.structuredContent).result).toMatchObject({ outcome: 'observed', requestId: executedRequestId })
    expect(executed).toBe(1)
  })

  it('opens a target-free tab only when the installed executor declares that capability, and reuses its caller requestId', async () => {
    const unavailable = await fixture()
    const unavailableClient = await mcp(unavailable.configPath)
    const missing = await unavailableClient.callTool({ name: 'browser_open_tab', arguments: {
      installationId: unavailable.installationId, requestId: randomUUID(), url: 'https://example.test/open',
    } })
    expect(missing.isError).toBe(true)
    expect(parse(missing.structuredContent).error?.message).toBe('capability_unavailable')
    const bypass = await unavailableClient.callTool({ name: 'browser_act', arguments: {
      installationId: unavailable.installationId, action: { kind: 'tab_open', url: 'https://example.test/open' },
    } })
    expect(bypass.isError).toBe(true)
    expect(parse(bypass.structuredContent).error?.message).toBe('request_id_required')

    const { configPath, socket, installationId } = await fixture({ targetFreeOpen: true, actionKinds: ['tabs', 'snapshot', 'tab_open'] })
    const client = await mcp(configPath)
    const requestId = randomUUID()
    const requests: Invocation[] = []
    socket.on('message', (data: Buffer) => {
      const frame = JSON.parse(data.toString('utf8')) as { type: string; request: Invocation }
      if (frame.type !== 'execute') return
      requests.push(frame.request)
      socket.send(JSON.stringify({ type: 'result', receipt: { ...frame.request, outcome: 'observed', quiescent: true,
        value: { opened: true, tab: { tabId: 17, windowId: 4 } } } }))
    })
    const input = { installationId, requestId, url: 'https://example.test/open' }
    const first = await client.callTool({ name: 'browser_open_tab', arguments: input })
    const second = await client.callTool({ name: 'browser_open_tab', arguments: input })
    expect(parse(first.structuredContent).result).toMatchObject({ requestId, outcome: 'observed', value: { opened: true, tab: { tabId: 17, windowId: 4 } } })
    expect(parse(second.structuredContent).result).toMatchObject({ requestId, outcome: 'observed' })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ requestId, mutates: true, payload: { kind: 'tab_open', url: input.url } })
    expect(requests[0]?.target).toBeUndefined()
    const conflict = await client.callTool({ name: 'browser_open_tab', arguments: { ...input, url: 'https://example.test/other' } })
    expect(conflict.isError).toBe(true)
    expect(parse(conflict.structuredContent).error?.message).toBe('request_conflict')
    const status = await client.callTool({ name: 'browser_status', arguments: {} })
    expect(parse(status.structuredContent).result?.instances).toContainEqual(expect.objectContaining({ installationId,
      capabilities: { targetFreeOpen: true, actionKinds: ['tabs', 'snapshot', 'tab_open'] } }))
  })

  it('uses extension journal status-query only after relay receipt retention is absent', async () => {
    const { configPath, socket, installationId } = await fixture({ actionKinds: ['tabs'], restartStatusLookup: true })
    const client = await mcp(configPath)
    const requestId = randomUUID()
    let queries = 0
    let executions = 0
    socket.on('message', (data: Buffer) => {
      const frame = JSON.parse(data.toString('utf8')) as { type: string; locator?: { transportRequestId: string }; sessionId?: string }
      if (frame.type === 'execute') { executions++; return }
      if (frame.type !== 'status-query' || !frame.locator || !frame.sessionId) return
      queries++
      socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: 1, grantEpoch: 1, requestId: frame.locator.transportRequestId,
        sessionId: frame.sessionId, installationId, deadline: Date.now() + 1_000, fingerprint: 'a'.repeat(64), outcome: 'observed', quiescent: true,
        value: { opened: true, tab: { tabId: 22, windowId: 3 } } } }))
    })
    const result = await client.callTool({ name: 'browser_request_status', arguments: { installationId, requestId } })
    expect(parse(result.structuredContent).result).toMatchObject({ requestId, outcome: 'observed', value: { opened: true } })
    expect(queries).toBe(1)
    expect(executions).toBe(0)
  })

  it('returns an explicit in-flight status and shares a concurrent journal status lookup', async () => {
    const opening = await fixture({ targetFreeOpen: true, actionKinds: ['tab_open'], restartStatusLookup: true })
    const openingClient = await mcp(opening.configPath)
    const openingId = randomUUID()
    let received: Invocation | undefined
    let releaseExecute: (() => void) | undefined
    const executeReceived = new Promise<void>((resolve) => { releaseExecute = resolve })
    opening.socket.on('message', (data: Buffer) => {
      const frame = JSON.parse(data.toString('utf8')) as { type: string; request: Invocation }
      if (frame.type === 'execute') { received = frame.request; releaseExecute?.() }
    })
    const open = openingClient.callTool({ name: 'browser_open_tab', arguments: { installationId: opening.installationId, requestId: openingId, url: 'https://example.test/open' } })
    await executeReceived
    const inFlight = await openingClient.callTool({ name: 'browser_request_status', arguments: { installationId: opening.installationId, requestId: openingId } })
    expect(parse(inFlight.structuredContent).result).toMatchObject({ requestId: openingId, outcome: 'unknown', reason: 'in_flight' })
    opening.socket.send(JSON.stringify({ type: 'result', receipt: { ...received, outcome: 'observed', quiescent: true,
      value: { opened: true, tab: { tabId: 31, windowId: 2 } } } }))
    await open
    const recovered = await openingClient.callTool({ name: 'browser_open_tab', arguments: { installationId: opening.installationId, requestId: openingId, url: 'https://example.test/open' } })
    expect(parse(recovered.structuredContent).result).toMatchObject({ requestId: openingId, outcome: 'observed', value: { opened: true } })

    const { configPath, socket, installationId } = await fixture({ actionKinds: ['tabs'], restartStatusLookup: true })
    const client = await mcp(configPath)
    const requestId = randomUUID()
    let queries = 0
    socket.on('message', (data: Buffer) => {
      const frame = JSON.parse(data.toString('utf8')) as { type: string; locator?: { transportRequestId: string }; sessionId?: string }
      if (frame.type !== 'status-query' || !frame.locator || !frame.sessionId) return
      queries++
      setTimeout(() => socket.send(JSON.stringify({ type: 'result', receipt: { protocolVersion: 1, grantEpoch: 1,
        requestId: frame.locator?.transportRequestId, sessionId: frame.sessionId, installationId, deadline: Date.now() + 1_000,
        fingerprint: 'a'.repeat(64), outcome: 'observed', quiescent: true, value: { opened: true } } })), 10)
    })
    const [a, b] = await Promise.all([
      client.callTool({ name: 'browser_request_status', arguments: { installationId, requestId } }),
      client.callTool({ name: 'browser_request_status', arguments: { installationId, requestId } }),
    ])
    expect(parse(a.structuredContent).result).toMatchObject({ requestId, outcome: 'observed' })
    expect(parse(b.structuredContent).result).toMatchObject({ requestId, outcome: 'observed' })
    expect(queries).toBe(1)
  })
})
