/** Read-only payload types for the capability registry Remote projection. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Opaque identifier for one MCP server entry within a snapshot. */
export type McpServerEntryId = Branded<'McpServerEntryId'>

/** Invocation policy mirrored from the skill registry for display. */
export interface CapabilitySkillInvocation {
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
}

/** One skill in the capability projection. */
export interface CapabilitySkill {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: CapabilitySkillInvocation
  readonly source: string
  readonly provider: string
  readonly path?: string
  readonly originKind?: string
  readonly originLayerLabel?: string
  readonly selected: boolean
}

/** One tool in the capability projection. */
export interface CapabilityTool {
  readonly name: string
  readonly description: string
  /** Whether the tool name is qualified under an MCP server namespace. */
  readonly mcpServer?: string
  /** The raw MCP tool name when this tool was bridged from an MCP server. */
  readonly mcpRawName?: string
}

/** One MCP server in the capability projection. */
export interface CapabilityMcpServer {
  readonly id: McpServerEntryId
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
  /** Count of tools currently registered under this server's namespace. */
  readonly registeredTools: number
}

/** Point-in-time capability snapshot for one viewing session. */
export interface CapabilitySnapshot {
  readonly sessionId: SessionId
  readonly skills: readonly CapabilitySkill[]
  readonly tools: readonly CapabilityTool[]
  readonly mcpServers: readonly CapabilityMcpServer[]
}
