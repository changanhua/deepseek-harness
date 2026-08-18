/** Read-only projection of current Skills, Tools, and MCP server capability state. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import { scopeOf, type ScopeKey } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from 'zod'
import type {
  CapabilityMcpServer,
  CapabilitySkill,
  CapabilitySnapshot,
  CapabilityTool,
  McpServerEntryId,
} from './types.ts'

export type * from './types.ts'

/** Brand an MCP server entry id at the owning boundary. */
function mcpServerEntryId(value: string): McpServerEntryId {
  return value as McpServerEntryId
}

/** The Loader module specifier for the MCP client bridge. */
const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** Namespace prefix MCP-bridged tools carry in the tool registry. */
const MCP_TOOL_PREFIX = 'mcp__'

/** Maximum MCP server entries projected per snapshot to bound the payload. */
const MAX_MCP_SERVERS = 64

/**
 * Remote-only service exposing a read-only capability projection. The
 * projection reads the live Loader entries, the skill registry's management
 * snapshot, and the tool registry's schemas directly on every call — no
 * second cache, no history, no mutation path.
 */
export class CapabilityRegistryGateway extends TypertRemoteService {
  static inject = ['loader', 'skills', 'tools', 'agents']

  constructor(ctx: Context) {
    super(ctx, 'capabilityRegistry')
  }

  /**
   * Read the Loader, skill, and tool registries directly. MCP server facts
   * are limited to what the runtime can prove: the configured transport and
   * server name from the Loader entry, plus the count of tools registered
   * under that server's namespace. Connection lifecycle (connected,
   * reconnecting, last sync) is internal to the MCP client supervisor and
   * is not exposed. MCP env, headers, command, and args are never returned.
   *
   * Skills and tools are scope-aware: the viewing agent's scope key selects
   * the session's preset-merged layer chain. Without a resolvable live agent
   * the projection reads the global layer alone — the honest floor for a
   * session that has not yet mounted its preset.
   * @param request - the viewing session id used to resolve the skill scope.
   * @returns the point-in-time capability snapshot.
   */
  @Remote('list')
  async list(request: { sessionId: SessionId }): Promise<CapabilitySnapshot> {
    const sessionId = request.sessionId
    const scope = this.resolveSessionScope(sessionId)
    const skills = await this.projectSkills(scope)
    const mcpServers = this.projectMcpServers(scope)
    const tools = this.projectTools(mcpServers, scope)
    return { sessionId, skills, tools, mcpServers }
  }

  /** Project skills through the registry's management snapshot for the session scope. */
  private async projectSkills(scope: ScopeKey | undefined): Promise<CapabilitySkill[]> {
    const result = await this.ctx.skills.managementSnapshot(
      scope === undefined ? {} : { scope },
    )
    return result.entries.map((entry) => {
      const summary = entry.candidate
      const skill: CapabilitySkill = {
        name: summary.name,
        description: summary.description,
        ...summary.whenToUse !== undefined ? { whenToUse: summary.whenToUse } : {},
        invocation: {
          modelInvocable: summary.invocation.modelInvocable,
          userInvocable: summary.invocation.userInvocable,
        },
        source: summary.source,
        provider: summary.provider,
        ...summary.path !== undefined ? { path: summary.path } : {},
        ...summary.origin !== undefined ? {
          originKind: summary.origin.kind,
          originLayerLabel: summary.origin.layerLabel,
        } : {},
        selected: entry.selected,
      }
      return skill
    })
  }

  /** Project MCP server entries from the Loader, counting registered tools per namespace. */
  private projectMcpServers(scope: ScopeKey | undefined): CapabilityMcpServer[] {
    const servers: CapabilityMcpServer[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      if (entry.disabled) continue
      const moduleName = entry.options.name
      if (moduleName !== MCP_CLIENT_MODULE) continue
      const config = entry.options.config as
        | { serverName?: unknown; transport?: unknown }
        | undefined
      if (config === undefined) continue
      const serverName = typeof config.serverName === 'string' ? config.serverName : undefined
      if (serverName === undefined) continue
      const transport = config.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
      const registeredTools = this.countMcpTools(serverName, scope)
      servers.push({
        id: mcpServerEntryId(entry.id),
        serverName,
        transport,
        registeredTools,
      })
      if (servers.length >= MAX_MCP_SERVERS) break
    }
    return servers
  }

  /** Project tools from the registry schemas, tagging MCP-bridged tools with their server. */
  private projectTools(
    mcpServers: readonly CapabilityMcpServer[],
    scope: ScopeKey | undefined,
  ): CapabilityTool[] {
    const serverNames = new Set(mcpServers.map(server => server.serverName))
    const schemas = this.ctx.tools.schemas(scope)
    return schemas.map((schema): CapabilityTool => {
      const name = schema.name
      const mcp = this.parseMcpToolName(name, serverNames)
      if (mcp === undefined) {
        return { name, description: schema.description }
      }
      return { name, description: schema.description, mcpServer: mcp.serverName, mcpRawName: mcp.rawName }
    })
  }

  /** Count tools registered under one MCP server's namespace. */
  private countMcpTools(serverName: string, scope: ScopeKey | undefined): number {
    const prefix = `${MCP_TOOL_PREFIX}${serverName}__`
    let count = 0
    for (const schema of this.ctx.tools.schemas(scope)) {
      if (schema.name.startsWith(prefix)) count += 1
    }
    return count
  }

  /**
   * Parse an MCP-qualified public tool name when its server is known.
   * Returns the raw MCP name only for servers present in the snapshot.
   */
  private parseMcpToolName(
    name: string,
    serverNames: ReadonlySet<string>,
  ): { serverName: string; rawName: string } | undefined {
    if (!name.startsWith(MCP_TOOL_PREFIX)) return undefined
    const rest = name.slice(MCP_TOOL_PREFIX.length)
    const sep = rest.indexOf('__')
    if (sep <= 0) return undefined
    const serverName = rest.slice(0, sep)
    if (!serverNames.has(serverName)) return undefined
    const rawName = rest.slice(sep + 2)
    if (rawName.length === 0) return undefined
    return { serverName, rawName }
  }

  /** Resolve a session id to its agent scope key for skill/tool registry viewing. */
  private resolveSessionScope(sessionId: SessionId): ScopeKey | undefined {
    const agent = this.ctx.agents.get(sessionId)
    if (agent === undefined) return undefined
    return scopeOf(agent.ctx)
  }
}

export default CapabilityRegistryGateway
