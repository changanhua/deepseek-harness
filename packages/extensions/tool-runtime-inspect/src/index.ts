/**
 * Model-facing authoritative runtime inspection over `ctx.runtimeFacts` and
 * `ctx.subprocess`.
 * @module @changanhua/dsh-tool-runtime-inspect
 */

import type { Context } from '@deepseek-ai/cordis'
import { factKey } from '@changanhua/dsh-runtime-facts'
import { ToolArgsError, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { JsonSchemaNode, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-subprocess'
import { inspectCommand } from './command.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-runtime-inspect'
/** Services required to expose authoritative runtime inspection. */
export const inject = ['tools', 'runtimeFacts', 'subprocess']

type RuntimeInspectArgs =
  | { readonly kind: 'facts'; readonly keys?: readonly string[] }
  | { readonly kind: 'command'; readonly command: string }

/**
 * Model-facing parameter schema. The root is a flat `type: "object"` because
 * strict OpenAI-compatible gateways reject a parameter schema whose root is a
 * bare `oneOf` (no `type`); the cross-variant constraints a tagged union would
 * express are enforced at execution by {@link validateInspectVariant}.
 */
const RUNTIME_INSPECT_PARAMETERS: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: {
      type: 'string',
      enum: ['facts', 'command'],
      description: 'Inspect registered runtime facts, or resolve one executable through the active subprocess provider.',
    },
    keys: {
      type: 'array',
      items: { type: 'string' },
      description: 'Runtime fact keys to inspect. Omit to inspect every currently registered fact.',
    },
    command: {
      type: 'string',
      description: 'Absolute executable path or bare command name to resolve in the active execution world.',
    },
  },
  required: ['kind'],
}

/**
 * Reject cross-variant argument combinations the flat parameter schema cannot
 * express: a `facts` request never carries `command`, and a `command` request
 * always carries one.
 * @param args - schema-validated candidate arguments.
 * @returns Path-qualified violations; empty means valid.
 */
function validateInspectVariant(args: Record<string, unknown>): string[] {
  const violations: string[] = []
  if (args.kind === 'command') {
    if (typeof args.command !== 'string' || args.command.length === 0) {
      violations.push('"command" is required when kind is "command"')
    }
    if (Object.hasOwn(args, 'keys')) {
      violations.push('"keys" is not supported when kind is "command"')
    }
  } else if (args.kind === 'facts' && Object.hasOwn(args, 'command')) {
    violations.push('"command" is not supported when kind is "facts"')
  }
  return violations
}

function createRuntimeInspectTool(ctx: Context): ToolDefinition {
  return {
    name: 'runtime_inspect',
    description:
      'Inspect authoritative DSH runtime state when a task depends on an unproven fact or executable. '
      + 'kind="facts" returns selected registered runtime facts; '
      + 'omit keys to inspect every registered fact, including async inspect-only facts. kind="command" resolves one '
      + 'executable through the active subprocess provider and reports its execution world. Resolution proves only '
      + 'that the command is discoverable, not that it starts, is authenticated, or succeeds. This tool never probes '
      + 'commands independently and does not expose credential values.',
    parameters: RUNTIME_INSPECT_PARAMETERS as Record<string, unknown>,
    output: {
      // Annotation-only raw JSON Schema means any lossless JSON value; the
      // registry still materializes and validates the returned value.
      schema: {},
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const violations = validateJsonSchemaValue(RUNTIME_INSPECT_PARAMETERS, args, '')
      violations.push(...validateInspectVariant(args as Record<string, unknown>))
      if (violations.length > 0) throw new ToolArgsError(violations)
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

/** Register the `runtime_inspect` tool. @param ctx - Context carrying tools, facts, and subprocess services. */
export function apply(ctx: Context): void {
  ctx.tools.register(createRuntimeInspectTool(ctx))
}
