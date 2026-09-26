/** Standard MCP exposure of predeclared tools backed by lazy DSH presets. */
import { timingSafeEqual } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { loadCatalog } from './catalog.ts'
import { InvocationError, InvocationRuntime } from './runtime.ts'
import type { Config } from './types.ts'
import { failureResult } from './result.ts'

export type { Config, CapabilityBinding, CapabilityDeclaration } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { mcpServer: McpServer }
}

/** Bound a complete incoming JSON message before passing it to the SDK. */
async function readBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array)
    size += chunk.length
    if (size > maxBytes) throw new InvocationError('REQUEST_TOO_LARGE', 'The MCP request exceeds its byte limit')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** One Host-owned MCP endpoint; each stateless HTTP exchange owns its SDK transport. */
export default class McpServer extends Service {
  static inject = ['webServer', 'tools', 'agents', 'agentPresets', 'sessions', 'loader']
  static Config: z<Config> = z.object({
    path: z.string().required(),
    tokenEnv: z.string().required(),
    workspace: z.string().required(),
    catalog: z.array(z.object({ preset: z.string().required(), declaration: z.string().required(), options: z.dict(z.any()) })).required(),
    requestMaxBytes: z.number().step(1).min(1).required(),
    resultMaxBytes: z.number().step(1).min(512).required(),
    callTimeoutMs: z.number().step(1).min(1).max(2147483647).required(),
    maxPendingCalls: z.number().step(1).min(1).required(),
  })

  private runtime!: InvocationRuntime
  // Low-level SDK Server is required for declaration-only schemas and explicit result envelopes.
  // oxlint-disable-next-line typescript/no-deprecated
  private readonly exchanges = new Set<Server>()
  private readonly routeCalls = new Set<Promise<void>>()
  private readonly sockets = new Set<() => void>()
  private accepting = true
  private token!: Buffer

  constructor(ctx: Context, private readonly config: Config) { super(ctx, 'mcpServer') }

  async [Service.init](): Promise<void> {
    if (this.ctx.webServer.host !== '127.0.0.1') throw new Error('mcp-server first release requires a loopback HTTP listener')
    if (!/^\/[A-Za-z0-9_/-]+$/u.test(this.config.path) || this.config.path.endsWith('/')) throw new Error('mcp-server path must be an absolute route without trailing slash')
    if (!isAbsolute(this.config.workspace)) throw new Error('mcp-server workspace must be absolute')
    const secret = process.env[this.config.tokenEnv]
    if (secret === undefined || secret.length === 0) throw new Error(`mcp-server credential is missing: ${this.config.tokenEnv}`)
    this.token = Buffer.from(`Bearer ${secret}`)
    this.runtime = new InvocationRuntime(this.ctx, this.config, await loadCatalog(this.ctx, this.config.catalog))
    const unregister = this.ctx.webServer.register({ kind: 'exact', path: this.config.path, handler: (request, response) => {
      const pending = this.serve(request, response).finally(() => { this.routeCalls.delete(pending) })
      this.routeCalls.add(pending)
      return pending
    } })
    this.ctx.effect(() => async () => {
      this.accepting = false
      unregister()
      for (const close of this.sockets) close()
      await this.runtime.dispose()
      await Promise.allSettled([...this.exchanges].map(server => server.close()))
      await Promise.allSettled([...this.routeCalls])
    }, 'mcpServer.endpoint')
  }

  private authenticated(request: IncomingMessage): boolean {
    const received = Buffer.from(request.headers.authorization ?? '')
    return received.length === this.token.length && timingSafeEqual(received, this.token)
  }

  private async serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.accepting) { response.writeHead(503).end(); return }
    if (!this.authenticated(request)) { response.writeHead(401).end(); return }
    // This local machine endpoint has no browser-origin caller in its supported surface.
    if (request.headers.origin !== undefined) { response.writeHead(403).end(); return }
    if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }).end(); return }
    if (this.exchanges.size >= this.config.maxPendingCalls) { response.writeHead(503).end(); return }
    const disconnected = new AbortController()
    const terminate = () => { disconnected.abort(new InvocationError('CONNECTION_CLOSED', 'The MCP connection closed')); request.destroy(); response.destroy() }
    const timeout = setTimeout(terminate, this.config.callTimeoutMs)
    this.sockets.add(terminate)
    const closed = Promise.withResolvers<void>()
    const onClose = () => {
      if (!response.writableEnded) disconnected.abort(new InvocationError('CALLER_DISCONNECTED', 'The MCP caller disconnected'))
      closed.resolve()
    }
    response.once('close', onClose)
    // oxlint-disable-next-line typescript/no-deprecated -- handler-owned schemas avoid eager capability registration
    const server = new Server({ name: 'dsh-capabilities', version: '0.1.0' }, {
      capabilities: { tools: {} },
      instructions: 'Call the named tools with their declared arguments. DSH loads only the needed capability. dsh_capabilities reports readiness. Failed or uncertain calls are not automatically replayed.',
    })
    this.exchanges.add(server)
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true })
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [
      { name: 'dsh_capabilities', description: 'List configured DSH tools and their activation status without activating them.', inputSchema: { type: 'object', additionalProperties: false } },
      ...this.runtime.catalog.map(entry => ({ name: entry.name, description: entry.description,
        inputSchema: { ...entry.parameters, type: 'object' as const },
        outputSchema: { type: 'object' as const, properties: { value: entry.outputSchema }, required: ['value'], additionalProperties: false },
      })),
    ] }))
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      try {
        if (request.params.name === 'dsh_capabilities') {
          const status = this.runtime.status()
          return this.bounded({ content: [{ type: 'text' as const, text: JSON.stringify(status) }], structuredContent: { capabilities: status } })
        }
        const signal = AbortSignal.any([extra.signal, disconnected.signal])
        const result = await this.runtime.invoke(request.params.name, request.params.arguments ?? {}, signal)
        return result.result
      } catch (error: unknown) {
        const code = error instanceof InvocationError ? error.code : disconnected.signal.aborted ? 'CALLER_DISCONNECTED' : 'CAPABILITY_CALL_FAILED'
        const message = error instanceof Error ? error.message : 'The DSH capability call failed'
        return failureResult(code, message, this.config.resultMaxBytes)
      }
    })
    try {
      const body = await readBody(request, this.config.requestMaxBytes)
      // SDK callback optionality differs under exactOptionalPropertyTypes; no runtime conversion is needed.
      await server.connect(transport as Transport)
      await transport.handleRequest(request, response, body)
      await closed.promise
    } catch (error: unknown) {
      if (!response.headersSent) response.writeHead(error instanceof InvocationError && error.code === 'REQUEST_TOO_LARGE' ? 413 : 400).end()
      else if (!response.writableEnded) response.end()
    } finally {
      clearTimeout(timeout)
      this.sockets.delete(terminate)
      response.off('close', onClose)
      this.exchanges.delete(server)
      await server.close()
    }
  }

  private bounded<T>(result: T): T {
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > this.config.resultMaxBytes) {
      throw new InvocationError('RESULT_TOO_LARGE', 'The complete MCP result exceeds its byte limit')
    }
    return result
  }
}
