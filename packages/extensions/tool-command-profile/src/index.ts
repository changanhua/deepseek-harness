/**
 * Model-facing command-knowledge lookup over `ctx.commandProfiles`. The tool
 * returns candidate executable names with provenance; it never asserts
 * installation or availability, so the candidate → `runtime_inspect` chain
 * stays type-safe.
 *
 * @module @deepseek-ai/dsh-tool-command-profile
 */

import type { Context } from '@deepseek-ai/cordis'
import { ToolArgsError, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { JsonSchemaNode, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-command-profile'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-command-profile'
/** Services required to expose command-knowledge lookup. */
export const inject = ['tools', 'systemPrompt', 'commandProfiles']

/**
 * Stable guidance pinning candidate ≠ existence: a profile names executables;
 * only authoritative runtime inspection proves presence.
 */
export const COMMAND_PROFILE_SYSTEM_PROMPT =
  'A command profile supplies candidate executable names only. It does not prove installation or runtime availability. '
  + 'Before concluding that a candidate command is available or unavailable, use authoritative runtime command inspection '
  + '(runtime_inspect kind=command) unless current execution already established that fact.'

interface CommandProfileArgs {
  readonly query: string
  readonly limit?: number
}

/**
 * Model-facing parameter schema: object-root flat with `query` required.
 */
const COMMAND_PROFILE_PARAMETERS: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: {
      type: 'string',
      description: 'Lookup text matched against command profile ids, aliases, display names, tags, and descriptions.',
    },
    limit: {
      type: 'number',
      description: 'Maximum number of matching profiles to return; an integer from 1 to 10, defaulting to 5.',
    },
  },
  required: ['query'],
}

function createCommandProfileTool(ctx: Context): ToolDefinition {
  return {
    name: 'command_profile',
    description:
      'Look up command profiles: stable knowledge about which executables a capability maps to. '
      + 'Profiles name candidate executables only — they do not prove installation or availability; '
      + 'use runtime_inspect to confirm a candidate in the current execution world.',
    parameters: COMMAND_PROFILE_PARAMETERS as Record<string, unknown>,
    output: {
      // Annotation-only raw JSON Schema means any lossless JSON value; the
      // registry still materializes and validates the returned value.
      schema: {},
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute(args): Promise<{ matches: Array<{
      id: string
      displayName: string
      description: string
      candidates: Array<{ command: string; provenance: Array<{ source: string; contributorId: string }> }>
    }> }> {
      const violations = validateJsonSchemaValue(COMMAND_PROFILE_PARAMETERS, args, '')
      if (violations.length > 0) throw new ToolArgsError(violations)
      const request = args as CommandProfileArgs
      if (request.limit !== undefined
        && (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 10)) {
        throw new ToolArgsError(['"limit" must be an integer between 1 and 10'])
      }
      const matches = ctx.commandProfiles.query({
        query: request.query,
        ...request.limit === undefined ? {} : { limit: request.limit },
      })
      return Promise.resolve({
        matches: matches.map(profile => ({
          id: profile.id,
          displayName: profile.displayName,
          description: profile.description,
          candidates: profile.candidates.map(candidate => ({
            command: candidate.command,
            provenance: candidate.provenance.map(item => ({ source: item.source, contributorId: item.contributorId })),
          })),
        })),
      })
    },
  }
}

/**
 * Register the stable guidance and the `command_profile` tool.
 * @param ctx - Cordis context carrying tools, prompt, and profile seams.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:command-profile',
    order: 117,
    text: COMMAND_PROFILE_SYSTEM_PROMPT,
  })
  ctx.tools.register(createCommandProfileTool(ctx))
}
