/**
 * Model-facing authoritative runtime inspection over `ctx.runtimeFacts` and
 * `ctx.subprocess`.
 * @module @deepseek-ai/dsh-tool-runtime-inspect
 */

import type { Context } from '@deepseek-ai/cordis'
import { factKey } from '@deepseek-ai/dsh-runtime-facts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-subprocess'
import { inspectCommand } from './command.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-runtime-inspect'
/** Services required to expose authoritative runtime inspection. */
export const inject = ['tools', 'systemPrompt', 'runtimeFacts', 'subprocess']

/** Stable guidance; dynamic runtime values never enter this section. */
export const RUNTIME_INSPECT_SYSTEM_PROMPT =
  'Runtime and host facts are available through DSH runtime context and runtime_inspect. '
  + 'Use runtime_inspect instead of inferring command resolution, network routing, process ownership, or host configuration when authoritative runtime facts are available.'

type RuntimeInspectArgs =
  | { readonly kind: 'facts'; readonly keys?: readonly string[] }
  | { readonly kind: 'command'; readonly command: string }

function createRuntimeInspectTool(ctx: Context): ToolDefinition {
  return {
    name: 'runtime_inspect',
    description:
      'Inspect authoritative DSH runtime state without guessing. kind="facts" returns selected registered runtime facts; '
      + 'omit keys to inspect every registered fact, including async inspect-only facts. kind="command" resolves one '
      + 'executable through the active subprocess provider and reports its execution world. This tool never probes '
      + 'commands independently and does not expose credential values.',
    parameters: {
      type: 'object',
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', const: 'facts' },
            keys: {
              type: 'array',
              items: { type: 'string' },
              description: 'Runtime fact keys to inspect. Omit to inspect every currently registered fact.',
            },
          },
          required: ['kind'],
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', const: 'command' },
            command: {
              type: 'string',
              description: 'Absolute executable path or bare command name to resolve in the active execution world.',
            },
          },
          required: ['kind', 'command'],
        },
      ],
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const request = args as RuntimeInspectArgs
      if (request.kind === 'facts') {
        const keys = request.keys === undefined
          ? ctx.runtimeFacts.list().map(info => info.key)
          : request.keys.map(factKey)
        return await ctx.runtimeFacts.inspect(keys, { signal: exec.signal })
      }
      return await inspectCommand(ctx, request.command, exec.signal)
    },
  }
}

/**
 * Register the stable guidance and the `runtime_inspect` tool.
 * @param ctx - Cordis context carrying tools, prompt, facts, and subprocess seams.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:runtime-inspect',
    order: 116,
    text: RUNTIME_INSPECT_SYSTEM_PROMPT,
  })
  ctx.tools.register(createRuntimeInspectTool(ctx))
}
