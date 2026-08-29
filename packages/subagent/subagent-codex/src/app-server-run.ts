/**
 * Supported parent-free Codex app-server boundary for trusted Host plugins.
 *
 * @module @deepseek-ai/dsh-subagent-codex/app-server-run
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {
  SubagentResult,
  SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import {
  startCodexAppServerRun as startInternalCodexAppServerRun,
} from './run.ts'

/** Native non-interactive permission modes accepted by the app-server boundary. */
export const CODEX_APP_SERVER_PERMISSION_MODES = [
  'never',
  'approve-for-me',
  'dangerously-bypass-approvals-and-sandbox',
] as const

/** Native non-interactive permission policy fixed before a Codex run starts. */
export type CodexAppServerPermissionMode = typeof CODEX_APP_SERVER_PERMISSION_MODES[number]

/** Explicit inputs for one parent-free Codex app-server run. */
export interface CodexAppServerStartRequest {
  /** Exact non-empty, text-only task delivered to the ephemeral Codex turn. */
  readonly prompt: readonly ContentBlock[]
  /** Cancellation authority for startup and the published run. */
  readonly signal: AbortSignal
  /** Caller-selected workspace supplied to both the child and `thread/start`. */
  readonly cwd: string
  /** Optional native model override; omission preserves Codex settings. */
  readonly model?: string
  /** Native unattended approval and sandbox policy. */
  readonly permissionMode: CodexAppServerPermissionMode
  /** Explicit child environment layered after shared credential scrubbing. */
  readonly env: Record<string, string>
  /** Grace in milliseconds for shared process-tree termination tiers. */
  readonly disposeGraceMs: number
  /** Shared subprocess service operation that owns the spawned process tree. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Optional diagnostic sink for a post-publication failure. */
  readonly onError?: (error: Error, stopReason: SubagentStopReason) => void
}

/** Published one-shot result and the only supported resource-release operation. */
export interface CodexAppServerRunHandle {
  /** Terminal child result; child-level failures resolve with a non-completed reason. */
  readonly result: Promise<SubagentResult>
  /** Cancel remaining work, reach process-tree quiescence, and release resources. */
  dispose(): Promise<void>
}

/**
 * Start one real Codex app-server run without constructing a parent Agent or Session.
 * @param request - Explicit task, workspace, permission, process, and cancellation inputs.
 * @returns A deliberately narrow handle after app-server initialization and thread creation.
 */
export async function startCodexAppServerRun(
  request: CodexAppServerStartRequest,
): Promise<CodexAppServerRunHandle> {
  const run = await startInternalCodexAppServerRun(request, request)
  return {
    result: run.result,
    dispose: () => run.dispose(),
  }
}
