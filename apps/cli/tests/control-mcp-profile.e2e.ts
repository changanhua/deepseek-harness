/** Built-profile smoke for the stdio MCP connector and authenticated Host hop. */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('control-mcp profile', () => {
  it('boots through dsh, lists the bounded tools, and forwards one authenticated call', { timeout: 20_000 }, async () => {
    const token = 'test-launch-token'
    const runId = 'test-control-run'
    let observedPayload: unknown
    const host = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/' && url.searchParams.get('token') === token) {
        response.writeHead(303, {
          location: '/',
          'set-cookie': 'dsh_session=signed-test; Path=/; HttpOnly; SameSite=Strict',
        })
        response.end()
        return
      }
      if (request.method !== 'POST' || url.pathname !== '/dsh-control/invoke'
        || request.headers.cookie !== 'dsh_session=signed-test') {
        response.writeHead(401)
        response.end('unauthorized')
        return
      }
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(chunk as Buffer))
      request.on('end', () => {
        const message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          rpcId: string
          payload: unknown
        }
        observedPayload = message.payload
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          type: 'server-response', rpcId: message.rpcId,
          result: { ok: true, value: { sessionId: 'session-1', runId } },
        }))
      })
    })
    await new Promise<void>(resolveListen => host.listen(0, '127.0.0.1', resolveListen))
    const address = host.address()
    if (address === null || typeof address === 'string') throw new Error('fixture Host did not listen')
    const home = await mkdtemp(join(tmpdir(), 'dsh-control-mcp-profile-'))
    roots.push(home)
    const repository = resolve(import.meta.dirname, '../../..')
    const child = spawn(process.execPath, [resolve(repository, 'apps/cli/lib/bin.js'), '--profile', 'control-mcp'], {
      cwd: repository,
      env: {
        ...process.env,
        DSH_HOME: home,
        DSH_CONTROL_ORIGIN: `http://127.0.0.1:${String(address.port)}`,
        DSH_CONTROL_TOKEN: token,
        DSH_CONTROL_RUN_ID: runId,
        DSH_CONTROL_AUTOSTART: 'false',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
    const send = (value: unknown): void => { child.stdin.write(`${JSON.stringify(value)}\n`) }
    const read = async (): Promise<Record<string, unknown>> => {
      const next = await lines.next()
      if (next.done) throw new Error(`control-mcp closed before replying: ${stderr}`)
      return JSON.parse(next.value) as Record<string, unknown>
    }
    try {
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'profile-test', version: '1.0.0' },
      } })
      await expect(read()).resolves.toMatchObject({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'dsh-control' } } })
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
      const listed = await read()
      const tools = (listed.result as { tools: Array<{ name: string }> }).tools
      expect(tools.map(tool => tool.name)).toContain('dsh_browser_entry_inspect')
      expect(tools).toHaveLength(14)
      send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
        name: 'dsh_session_open',
        arguments: { requestId: 'open-1', cwd: 'C:/task', sessionId: 'session-1' },
      } })
      await expect(read()).resolves.toMatchObject({
        jsonrpc: '2.0', id: 3,
        result: { isError: false, structuredContent: { result: { sessionId: 'session-1', runId } } },
      })
      expect(observedPayload).toEqual({
        runId, requestId: 'open-1', method: 'session_open',
        params: { cwd: 'C:/task', sessionId: 'session-1' },
      })
      send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: {
        name: 'dsh_session_observe', arguments: { sessionId: 'session-1' },
      } })
      await expect(read()).resolves.toMatchObject({
        jsonrpc: '2.0', id: 4,
        result: { isError: false, structuredContent: { result: { sessionId: 'session-1', runId } } },
      })
      expect(observedPayload).toEqual({
        runId, requestId: expect.any(String), method: 'session_observe',
        params: { sessionId: 'session-1' },
      })
      send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: {
        name: 'dsh_session_attention_answer',
        arguments: {
          requestId: 'answer-1', sessionId: 'session-1', attentionId: '00000000-0000-4000-8000-000000000001',
          answers: [{ id: 'next', selected: ['继续'] }],
        },
      } })
      await expect(read()).resolves.toMatchObject({
        jsonrpc: '2.0', id: 5,
        result: { isError: false, structuredContent: { result: { sessionId: 'session-1', runId } } },
      })
      expect(observedPayload).toEqual({
        runId, requestId: 'answer-1', method: 'session_attention_answer',
        params: {
          sessionId: 'session-1', attentionId: '00000000-0000-4000-8000-000000000001',
          answers: [{ id: 'next', selected: ['继续'] }],
        },
      })
      child.stdin.end()
      await expect(new Promise<number | null>(resolveExit => child.once('exit', resolveExit))).resolves.toBe(0)
    } finally {
      if (child.exitCode === null) child.kill()
      await new Promise<void>(resolveClose => host.close(() => resolveClose()))
    }
  })
})
