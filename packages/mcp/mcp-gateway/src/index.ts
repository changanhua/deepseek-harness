/** Authenticated Streamable HTTP MCP projection of one Planning Workspace. */
import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { planningOperations } from './planning.ts'

export const name = 'dsh-mcp-gateway'
export const inject = ['webServer', 'planning', 'workspaceRegistry']
const defaults = { path: '/mcp/planning', requestMaxBytes: 64 * 1024, resultMaxBytes: 256 * 1024, callTimeoutMs: 12_000, maxPendingCalls: 8 } as const

/** The Host chooses Workspace and credential; MCP callers cannot supply either. */
export interface Config {
  readonly planningWorkspaceId: string
  readonly tokenEnv: string
  readonly path?: string
  readonly requestMaxBytes?: number
  readonly resultMaxBytes?: number
  readonly callTimeoutMs?: number
  readonly maxPendingCalls?: number
}

export const Config: z<Config> = z.object({
  planningWorkspaceId: z.string().required(), tokenEnv: z.string().required(), path: z.string().default(defaults.path),
  requestMaxBytes: z.number().step(1).min(1).default(defaults.requestMaxBytes),
  resultMaxBytes: z.number().step(1).min(512).default(defaults.resultMaxBytes),
  callTimeoutMs: z.number().step(1).min(1).max(2147483647).default(defaults.callTimeoutMs),
  maxPendingCalls: z.number().step(1).min(1).default(defaults.maxPendingCalls),
})

interface ResolvedConfig {
  readonly planningWorkspaceId: string
  readonly path: string
  readonly token: Buffer
  readonly requestMaxBytes: number
  readonly resultMaxBytes: number
  readonly callTimeoutMs: number
  readonly maxPendingCalls: number
}

function resolveConfig(config: Config): ResolvedConfig {
  const planningWorkspaceId = config.planningWorkspaceId.trim()
  if (!planningWorkspaceId) throw new Error('dsh-mcp-gateway planningWorkspaceId is required')
  const tokenEnv = config.tokenEnv.trim()
  if (!tokenEnv) throw new Error('dsh-mcp-gateway tokenEnv is required')
  const token = process.env[tokenEnv]
  if (!token) throw new Error(`dsh-mcp-gateway credential is missing: ${tokenEnv}`)
  const path = (config.path ?? defaults.path).trim()
  if (!/^\/[A-Za-z0-9_/-]+$/u.test(path) || path.endsWith('/')) throw new Error('dsh-mcp-gateway path must be an absolute route without a trailing slash')
  return { planningWorkspaceId, path, token: Buffer.from(`Bearer ${token}`), requestMaxBytes: config.requestMaxBytes ?? defaults.requestMaxBytes, resultMaxBytes: config.resultMaxBytes ?? defaults.resultMaxBytes, callTimeoutMs: config.callTimeoutMs ?? defaults.callTimeoutMs, maxPendingCalls: config.maxPendingCalls ?? defaults.maxPendingCalls }
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array)
    size += chunk.length
    if (size > maxBytes) throw new GatewayError('REQUEST_TOO_LARGE', 'The MCP request exceeds its byte limit', 413)
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

class GatewayError extends Error { constructor(readonly code: string, message: string, readonly status = 400) { super(message) } }
function errorResult(error: unknown, maxBytes: number) {
  const code = error instanceof GatewayError ? error.code : error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'PLANNING_CALL_FAILED'
  let text = `${code}: ${error instanceof Error ? error.message : 'The Planning operation failed'}`
  const make = () => ({ isError: true as const, content: [{ type: 'text' as const, text }] })
  while (Buffer.byteLength(JSON.stringify(make()), 'utf8') > maxBytes && text) text = text.slice(0, Math.floor(text.length / 2))
  return make()
}
function bounded<T>(value: T, maxBytes: number): T {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes) throw new GatewayError('RESULT_TOO_LARGE', 'The complete MCP result exceeds its byte limit')
  return value
}
function authenticated(request: IncomingMessage, token: Buffer): boolean {
  const received = Buffer.from(request.headers.authorization ?? '')
  return received.length === token.length && timingSafeEqual(received, token)
}

/** Register the local-only Planning MCP endpoint in the already-running Host. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  if (ctx.webServer.host !== '127.0.0.1') throw new Error('dsh-mcp-gateway requires a loopback HTTP listener')
  const operations = planningOperations(ctx, resolved.planningWorkspaceId)
  const exchanges = new Set<Server>()
  const routeCalls = new Set<Promise<void>>()
  const closers = new Set<() => void>()
  let accepting = true
  const unregister = ctx.webServer.register({ kind: 'exact', path: resolved.path, handler: (request, response) => {
    const pending = serve(request, response).finally(() => routeCalls.delete(pending))
    routeCalls.add(pending)
    return pending
  } })
  ctx.effect(() => async () => {
    accepting = false
    unregister()
    for (const close of closers) close()
    await Promise.allSettled([...exchanges].map(server => server.close()))
    await Promise.allSettled([...routeCalls])
  }, `dsh-mcp-gateway: ${resolved.path}`)

  async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!accepting) { response.writeHead(503).end(); return }
    if (!authenticated(request, resolved.token)) { response.writeHead(401).end(); return }
    if (request.headers.origin !== undefined) { response.writeHead(403).end(); return }
    if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }).end(); return }
    if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') { response.writeHead(415).end(); return }
    if (exchanges.size >= resolved.maxPendingCalls) { response.writeHead(503).end(); return }
    const disconnected = new AbortController()
    const terminate = () => { disconnected.abort(); request.destroy(); response.destroy() }
    const timeout = setTimeout(terminate, resolved.callTimeoutMs)
    closers.add(terminate)
    const closed = Promise.withResolvers<void>()
    const onClose = () => { if (!response.writableEnded) disconnected.abort(); closed.resolve() }
    response.once('close', onClose)
    const server = new Server({ name: 'dsh-planning', version: '0.1.0' }, { capabilities: { tools: {} }, instructions: 'Read or propose one Planning object. Proposals remain pending for human review.' })
    exchanges.add(server)
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true })
    const result = (value: unknown) => bounded({
      content: [{ type: 'text' as const, text: JSON.stringify(value) }],
      structuredContent: value as Record<string, unknown>,
    }, resolved.resultMaxBytes)
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [
      { name: 'dsh_planning_list', description: 'List Planning Items and pending Proposals in the configured Workspace.', inputSchema: { type: 'object', additionalProperties: false } },
      { name: 'dsh_planning_read', description: 'Read one Planning Item or Proposal in the configured Workspace.', inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 256 } }, required: ['id'], additionalProperties: false } },
      { name: 'dsh_planning_propose', description: 'Create one pending Proposal from a raw idea. It does not accept, revise, dispatch, or activate a plan.', inputSchema: { type: 'object', properties: { requestId: { type: 'string', minLength: 1, maxLength: 256 }, expectedBoardVersion: { type: 'integer', minimum: 0 }, idea: { type: 'string', minLength: 1, maxLength: 4000 }, suggestedLane: { enum: ['inbox', 'now', 'next', 'later', 'parking'] } }, required: ['requestId', 'expectedBoardVersion', 'idea'], additionalProperties: false } },
    ] }))
    server.setRequestHandler(CallToolRequestSchema, async (call, extra) => {
      try {
        const signal = AbortSignal.any([extra.signal, disconnected.signal])
        const args = call.params.arguments ?? {}
        if (call.params.name === 'dsh_planning_list') return result(await operations.list(signal))
        if (call.params.name === 'dsh_planning_read') {
          const id = typeof args.id === 'string' && args.id.length <= 256 ? args.id : undefined
          if (!id) throw new GatewayError('DSH_GATEWAY_INVALID_INPUT', 'id must be a non-empty string no longer than 256 characters')
          return result(await operations.read(id, signal))
        }
        if (call.params.name === 'dsh_planning_propose') {
          const requestId = typeof args.requestId === 'string' && args.requestId.length <= 256 ? args.requestId : undefined
          const idea = typeof args.idea === 'string' && args.idea.length <= 4000 ? args.idea : undefined
          const expectedBoardVersion = args.expectedBoardVersion
          const suggestedLane = args.suggestedLane
          if (!requestId || !idea || !Number.isSafeInteger(expectedBoardVersion) || (expectedBoardVersion as number) < 0 || (suggestedLane !== undefined && typeof suggestedLane !== 'string')) throw new GatewayError('DSH_GATEWAY_INVALID_INPUT', 'proposal input is invalid')
          return result(await operations.propose({ requestId, idea, expectedBoardVersion: expectedBoardVersion as number, ...(suggestedLane === undefined ? {} : { suggestedLane: suggestedLane as 'inbox' | 'now' | 'next' | 'later' | 'parking' }) }, signal))
        }
        throw new GatewayError('TOOL_NOT_FOUND', `Unknown tool '${call.params.name}'`)
      } catch (error) { return errorResult(error, resolved.resultMaxBytes) }
    })
    try {
      const body = await readBody(request, resolved.requestMaxBytes)
      await server.connect(transport as Transport)
      await transport.handleRequest(request, response, body)
      await closed.promise
    } catch (error) {
      if (!response.headersSent) response.writeHead(error instanceof GatewayError ? error.status : 400).end()
      else if (!response.writableEnded) response.end()
    } finally {
      clearTimeout(timeout)
      closers.delete(terminate)
      response.off('close', onClose)
      exchanges.delete(server)
      await server.close()
    }
  }
}
