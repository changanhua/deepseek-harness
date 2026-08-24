/** Centralized tool-visibility filtering for runtime-fact projection. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type { RuntimeFactContext, RuntimeFactRelevance } from './types.ts'

/**
 * Determine whether one declaration applies to the assembly scope.
 * @param ctx - registry owner used to read the authoritative tool service.
 * @param context - current assembly scope.
 * @param relevance - required visible tools; omission is unconditional.
 * @returns whether every declared tool is visible to the scope.
 */
export function isVisibleRuntimeFact(
  ctx: Context,
  context: RuntimeFactContext,
  relevance?: RuntimeFactRelevance,
): boolean {
  if (relevance === undefined) return true
  if (context.scope === undefined) return false
  const tools = ctx.get('tools')
  return tools !== undefined
    && relevance.tools.every(tool => tools.get(tool, context.scope) !== undefined)
}
