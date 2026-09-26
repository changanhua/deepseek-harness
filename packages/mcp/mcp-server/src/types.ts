/** Deployment bindings and wire-safe declaration types for the lazy MCP server. */
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** A lightweight projection shared with the owning native tool definition. */
export interface CapabilityDeclaration {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly outputSchema: JsonSchemaNode
}

/** An operator-authored binding; callers cannot choose modules or presets. */
export interface CapabilityBinding {
  /** Installed preset ID whose standing composition owns this tool. */
  readonly preset: string
  /** Lightweight module exporting describe(options), resolved by the Host loader. */
  readonly declaration: string
  /** Metadata-affecting configuration shared with the native tool's preset. */
  readonly options?: Record<string, JsonValue>
}

/** Local HTTP deployment policy. Limits apply across all authenticated calls. */
export interface Config {
  /** Exact POST route registered on the loopback web server. */
  readonly path: string
  /** Environment variable holding the local bearer token. */
  readonly tokenEnv: string
  /** Absolute working directory fixed for every external invocation. */
  readonly workspace: string
  /** Installed declarations and their deployment-owned lazy preset bindings. */
  readonly catalog: CapabilityBinding[]
  /** Maximum incoming request body bytes. */
  readonly requestMaxBytes: number
  /** Maximum serialized tool result bytes, including its receipt. */
  readonly resultMaxBytes: number
  /** Cooperative deadline for one admitted call in milliseconds. */
  readonly callTimeoutMs: number
  /** Maximum simultaneous admitted exchanges and queued invocations. */
  readonly maxPendingCalls: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** An external call, distinct from the agent loop's model-step events. */
    'mcp/invocation-start': {
      callId: string
      tool: string
      preset: string
      declarationDigest: string
      arguments: JsonValue
    }
    /** Settled external execution; canonical data stays available after disconnect. */
    'mcp/invocation-end': {
      callId: string
      isError: boolean
      code: string | null
      value: JsonValue
      elapsedMs: number
      state: 'observed' | 'failed' | 'unknown'
    }
  }
}
