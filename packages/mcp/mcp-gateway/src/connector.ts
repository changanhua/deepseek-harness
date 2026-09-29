/** Extend an existing MCP connector without replacing its other tools or its transport. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { planningTools } from './protocol.ts'

export interface PlanningConnectorOptions {
  /** Trusted local Host URL; no caller controls the destination or credential. */
  readonly url: string
  readonly token: () => Promise<string>
  /** Trusted connection context, resolved per call. Explicit project selection takes precedence. */
  readonly currentWorkspace?: () => string | undefined | Promise<string | undefined>
}

/** Registration makes no network calls, so Host outages never prevent tool discovery. */
export function registerPlanningTools(server: McpServer, options: PlanningConnectorOptions): () => void {
  const url = new URL(options.url)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) {
    throw new Error('Planning connector requires a loopback HTTP endpoint')
  }
  const registrations = planningTools.map(tool => server.registerTool(tool.name, {
    description: tool.description, inputSchema: tool.schema, annotations: tool.annotations,
  }, async (args: Record<string, unknown>, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
    const client = new Client({ name: 'dsh-planning-connector', version: '1' })
    const signal = AbortSignal.any([extra.signal, AbortSignal.timeout(15000)])
    let submitted = false
    try {
      const token = await options.token()
      if (!token.trim()) throw new Error('Planning credential is not configured')
      const workspace = tool.name !== 'dsh_planning_workspaces' && args.workspace === undefined
        ? await options.currentWorkspace?.() : undefined
      const argumentsWithContext = workspace === undefined ? args : { ...args, workspace }
      signal.throwIfAborted()
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { authorization: `Bearer ${token}` }, signal },
      })
      await client.connect(transport as Transport)
      signal.throwIfAborted()
      submitted = true
      return CallToolResultSchema.parse(await client.callTool(
        { name: tool.name, arguments: argumentsWithContext }, CallToolResultSchema, { signal },
      ))
    } catch {
      const uncertain = submitted && tool.name === 'dsh_planning_propose'
      return {
        isError: true,
        content: [{ type: 'text' as const, text: uncertain
          ? 'PLANNING_RESULT_UNKNOWN: Read the proposal list or retry the identical requestId and arguments. Do not create a new request.'
          : 'PLANNING_UNAVAILABLE: The local Planning endpoint could not be reached. Check the Host configuration and credential.' }],
      }
    } finally { await client.close().catch(() => undefined) }
  }))
  return () => { for (const registration of registrations) registration.remove() }
}
