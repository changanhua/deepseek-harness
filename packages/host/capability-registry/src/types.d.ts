/** Read-only payload types for the capability registry Remote projection. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session/types'
/** Opaque identifier for one MCP server entry within a snapshot. */
export type McpServerEntryId = Branded<'McpServerEntryId'>
/** Opaque skill entry identifier stable within one registry observation. */
export type SkillEntryId = Branded<'SkillEntryId'>
/** Opaque skill root identifier used only to group provider diagnostics. */
export type SkillRootId = Branded<'SkillRootId'>
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
/** Skill metadata projected for the read-only management views. */
export interface SkillManagementSummary {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: CapabilitySkillInvocation
  readonly source: string
  readonly provider: string
  readonly resourceKind?: string
}
/** Direct shadow edge from one candidate to the selected candidate. */
export interface SkillShadow {
  readonly by: SkillEntryId
  readonly reason: 'within-layer' | 'cross-layer'
}
/** Provider-declared origin for one discovered skill candidate. */
export interface SkillManagementOrigin {
  readonly kind: string
  readonly provider: string
  readonly layerLabel: string
  readonly details?: Readonly<Record<string, JsonValue>>
}
/** Read-only operation flags; this Remote exposes no mutation methods. */
export interface SkillManagementActions {
  readonly edit: false
  readonly remove: false
  readonly setInvocation: false
}
/** One candidate in the management projection. */
export interface SkillManagementEntry {
  readonly id: SkillEntryId
  readonly summary: SkillManagementSummary
  readonly selected: boolean
  readonly shadow?: SkillShadow
  readonly origin: SkillManagementOrigin
  readonly actions: SkillManagementActions
}
/** One provider-discovery or registry-validation diagnostic. */
export interface SkillDiagnostic {
  readonly code: string
  readonly severity: 'warning' | 'error'
  readonly stage: 'provider-discovery' | 'registry-validation'
  readonly message: string
  readonly provider?: string
  readonly rootId?: SkillRootId
  readonly location?: string
  readonly details?: Readonly<Record<string, JsonValue>>
}
/** Complete read-only management snapshot for one viewing session. */
export interface SkillManagementSnapshot {
  readonly sessionId: SessionId
  readonly fidelity: 'live' | 'standing'
  readonly complete: boolean
  readonly entries: readonly SkillManagementEntry[]
  readonly diagnostics: readonly SkillDiagnostic[]
}
//# sourceMappingURL=types.d.ts.map
