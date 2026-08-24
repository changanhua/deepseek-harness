/** Command inspection through the authoritative subprocess execution world. */

import type { Context } from '@deepseek-ai/cordis'
import type { ExecutionWorldKind } from '@deepseek-ai/dsh-subprocess'

/** Safe model-facing outcome of executable resolution. */
export type CommandInspectionResult =
  | { readonly resolved: string; readonly world: ExecutionWorldKind }
  | { readonly status: 'unavailable'; readonly reason: string }

const UNAVAILABLE_REASON = 'executable could not be resolved in the active execution world'

/**
 * Resolve one executable only through `ctx.subprocess`; never inspect PATH,
 * the host filesystem, or shell state independently.
 * @param ctx - Cordis context carrying the authoritative subprocess seam.
 * @param command - absolute executable path or bare command name.
 * @param signal - caller cancellation forwarded to the provider.
 * @returns the resolved path plus execution world, or a secret-free unavailable result.
 */
export async function inspectCommand(
  ctx: Context,
  command: string,
  signal?: AbortSignal,
): Promise<CommandInspectionResult> {
  try {
    const resolved = await ctx.subprocess.resolveExecutable(command, undefined, signal)
    return { resolved, world: ctx.subprocess.executionWorld }
  } catch (error: unknown) {
    // Cancellation is not a runtime fact. Preserve the tool pipeline's normal
    // cancellation semantics instead of converting an aborted call into a
    // misleading availability answer.
    if (signal?.aborted) throw error
    // Provider diagnostics can contain deployment details. The model needs the
    // state transition, not an arbitrary exception string, so keep this reason
    // deliberately stable and secret-free.
    return { status: 'unavailable', reason: UNAVAILABLE_REASON }
  }
}
