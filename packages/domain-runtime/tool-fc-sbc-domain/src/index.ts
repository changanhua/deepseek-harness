/** Three typed read-only FC tools; no Browser, Planning or Safety dependency exists. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as schema, type ZodType } from 'zod'
import type {} from '@deepseek-ai/dsh-tools'
import { captureRealitySchema, buildPlanSchema } from '@changanhua/dsh-fc-sbc-domain'
import { domainArtifactRefSchema } from '@changanhua/dsh-domain-runtime'
import type { DomainArtifactRef } from '@changanhua/dsh-domain-runtime'
export const name = 'tool-fc-sbc-domain'
export const inject = ['tools', 'fcSbcDomain']
/** Complete rendered result cap, including the artifact reference and summary wrapper. */
export interface Config {
  /** Maximum UTF-8 bytes in the complete model result; oversized detail is replaced by counts. */
  maxOutputBytes?: number
}
export const Config: z<Config, Required<Config>> = z.object({ maxOutputBytes: z.number().step(1).min(1024).max(32768).default(8192) })

/** Project only the tools registry's supported schema vocabulary; zod enforces bounds in execution. */
function modelSchema(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of ['type', 'required', 'enum', 'const', 'description',
    'additionalProperties']) if (value[key] !== undefined) out[key] = value[key]
  if (value.properties) out.properties = Object.fromEntries(Object.entries(value.properties as Record<string, Record<string,
    unknown>>).map(([key, child]) => [key, modelSchema(child)]))
  if (value.items) out.items = modelSchema(value.items as Record<string, unknown>)
  if (value.anyOf) out.oneOf = (value.anyOf as Record<string, unknown>[]).map(modelSchema)
  return out
}

/** Register only inspect, plan and status. Large owner payloads remain behind artifact reads. */
export function apply(ctx: Context, config: Config = {}): void {
  const maxBytes = Config(config).maxOutputBytes
  const render = async (ref: DomainArtifactRef, signal: AbortSignal) => {
    const status = await ctx.fcSbcDomain.getStatus(ref, signal)
    if (!status) throw new Error('artifact-not-found')
    let result = JSON.stringify(status)
    if (Buffer.byteLength(result) > maxBytes) {
      result = JSON.stringify({ ref: status.ref, freshness: status.freshness, coverage: status.coverage?.status,
        issueCount: status.issueCodes.length, candidateCount: status.candidateCount,
        readiness: status.readiness?.status, blockerCount: status.readiness?.blockers.length,
        quoteStatus: status.quoteStatus?.status, truncated: true })
    }
    if (Buffer.byteLength(result) > maxBytes) throw new Error('summary-byte-capacity')
    return result
  }
  const register = <T>(toolName: string, description: string, input: ZodType<T>, execute: (args: T,
    signal: AbortSignal) => Promise<DomainArtifactRef>) => {
    ctx.tools.register({ name: toolName, description,
      parameters: modelSchema(schema.toJSONSchema(input, { io: 'input' })),
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      async execute(args, exec) { return render(await execute(input.parse(args), exec.signal), exec.signal) },
    })
  }
  register('fc_sbc_inspect', 'Compile supplied FC read observations into an immutable Reality reference. This does not contact or change FC.', captureRealitySchema,
    (args, signal) => ctx.fcSbcDomain.captureReality(args, signal))
  register('fc_sbc_plan', 'Build provisional candidates from an exact Reality reference. Missing evidence and quotes remain blockers; this never approves or executes.', buildPlanSchema,
    (args, signal) => ctx.fcSbcDomain.buildPlan(args, signal))
  register('fc_sbc_status', 'Read a bounded artifact summary and current freshness by reference. No observation is refreshed.',
    schema.strictObject({ ref: domainArtifactRefSchema }),
    async args => args.ref)
}
