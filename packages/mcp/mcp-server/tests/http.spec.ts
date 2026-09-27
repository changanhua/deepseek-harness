import { request as httpRequest } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import McpServer from '../src/index.ts'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import type { Config } from '../src/types.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const TOKEN_ENV = 'DSH_MCP_SERVER_HTTP_TEST_TOKEN'
const TOKEN = 'test-only-token'
const originalToken = process.env[TOKEN_ENV]

interface Harness {
  readonly ctx: Context
  readonly durable: Map<string, readonly SessionEvent[]>
  readonly url: URL
}

const harnesses: Harness[] = []
afterEach(async () => {
  for (const harness of harnesses.splice(0).reverse()) await harness.ctx.fiber.dispose()
  if (originalToken === undefined) Reflect.deleteProperty(process.env, TOKEN_ENV)
  else process.env[TOKEN_ENV] = originalToken
})

async function createHarness(catalog: Config['catalog'], resultMaxBytes = 8 * 1024): Promise<Harness> {
  process.env[TOKEN_ENV] = TOKEN
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, {
    default: 'alpha', roots: [{ path: join(FIXTURES, 'presets'), trust: 'system' }],
    includeShippedRoot: false, includeUserRoot: false,
  })
  const durable = new Map<string, readonly SessionEvent[]>()
  ctx.on('session/flush', (session) => { durable.set(session.id, session.snapshotEvents()) })
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(McpServer, {
    path: '/mcp', tokenEnv: TOKEN_ENV, workspace: process.cwd(), catalog,
    requestMaxBytes: 8 * 1024, resultMaxBytes, callTimeoutMs: 5_000, maxPendingCalls: 8,
  })
  const harness = { ctx, durable, url: new URL(`http://127.0.0.1:${String(ctx.webServer.port)}/mcp`) }
  harnesses.push(harness)
  return harness
}

function clientFor(url: URL): { client: Client; transport: StreamableHTTPClientTransport } {
  const client = new Client({ name: 'lazy-mcp-http-test', version: '1' })
  const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } })
  return { client, transport }
}

describe('lazy MCP HTTP endpoint', () => {
  it('serves discovery and execution to a real Streamable HTTP SDK client', async () => {
    const { url } = await createHarness([{
      preset: 'alpha', declaration: './declarations/capability.js',
      options: { name: 'alpha_lookup', description: 'Alpha lookup.' },
    }])
    const { client, transport } = clientFor(url)
    await client.connect(transport as Transport)
    try {
      const listed = await client.listTools()
      expect(listed.tools.map(tool => tool.name).sort()).toEqual(['alpha_lookup', 'dsh_capabilities'])
      const called = await client.callTool({ name: 'alpha_lookup', arguments: { text: 'SDK' } })
      expect(called.structuredContent).toEqual({ value: 'alpha_lookup:SDK' })
      expect(called.isError).not.toBe(true)
    } finally {
      await client.close()
    }
  })

  it('rejects unauthenticated and browser-originated requests before MCP handling', async () => {
    const { url } = await createHarness([{
      preset: 'alpha', declaration: './declarations/capability.js',
      options: { name: 'alpha_lookup', description: 'Alpha lookup.' },
    }])
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    const unauthenticated = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    const browserOrigin = await fetch(url, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, origin: 'https://example.test',
    }, body })

    expect(unauthenticated.status).toBe(401)
    expect(browserOrigin.status).toBe(403)
  })

  it('records an oversized tool result as terminal failure without writing its value durably', async () => {
    const { durable, url } = await createHarness([{
      preset: 'large', declaration: './declarations/capability.js',
      options: { name: 'large_lookup', description: 'Large lookup.' },
    }], 512)
    const { client, transport } = clientFor(url)
    await client.connect(transport as Transport)
    try {
      const result = await client.callTool({ name: 'large_lookup', arguments: { text: 'large' } })
      const receipt = result._meta?.dsh as { sessionId?: string } | undefined
      const events = receipt?.sessionId === undefined ? [] : durable.get(receipt.sessionId) ?? []
      const terminal = events.find(event => event.type === 'mcp/invocation-end')

      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).toContain('RESULT_TOO_LARGE')
      expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(512)
      expect(terminal).toMatchObject({ data: { state: 'failed', value: null, code: 'RESULT_TOO_LARGE' } })
    } finally {
      await client.close()
    }
  })

  it('drains an unfinished POST when its Host tears down', async () => {
    const { ctx, url } = await createHarness([{
      preset: 'alpha', declaration: './declarations/capability.js',
      options: { name: 'alpha_lookup', description: 'Alpha lookup.' },
    }])
    const port = Number(url.port)
    const open = httpRequest({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: {
      authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'transfer-encoding': 'chunked',
    } })
    open.on('error', () => { /* Host teardown intentionally resets this incomplete request. */ })
    open.write('{"jsonrpc":"2.0"')
    await new Promise(resolve => setTimeout(resolve, 20))

    await expect(Promise.race([
      ctx.fiber.dispose(),
      new Promise<never>((_resolve, reject) => setTimeout(() =>{  reject(new Error('Host teardown did not drain the POST')) }, 1_000)),
    ])).resolves.toBeUndefined()
    open.destroy()
  })
})
