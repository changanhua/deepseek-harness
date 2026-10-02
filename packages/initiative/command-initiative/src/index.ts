import type {} from '@deepseek-ai/dsh-commands'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { InitiativeError, initiativeCommandSchema, initiativeQuerySchema } from '@changanhua/dsh-initiative'

/** Trusted Human Candidate entry. */
export const name = 'command-initiative'
/** Human Commands and Candidate owner, without a model turn. */
export const inject = ['commands', 'initiative']
/** Complete Human response bound. */
export interface Config {
  /** Complete rendered Human response byte limit. */
  maxOutputBytes?: number
}
/** Deployment-owned output size. */
export const Config: z<Config> = z.object({ maxOutputBytes: z.number().step(1).min(512).max(1024 * 1024).default(64 * 1024) })
/** Register the direct Human JSON command; the provider verifies its exact active event. */
export function apply(ctx: Context, config: Config = {}): void {
  const bounds = Config(config) as Required<Config>
  ctx.commands.register({
    name: 'initiative', description: '提出、读取、调查、延后、放弃或明确晋升 Candidate',
    input: { hint: '{"action":"propose","key":"idea-1","kind":"simplify","trigger":"重复手工操作","facts":{"claim":"可以简化此流程"}}' },
    handler: async (invocation) => {
      let raw: unknown
      try { raw = JSON.parse(invocation.rawInput) } catch { return { kind: 'error', text: '请输入 Candidate 命令 JSON；action 为 propose/read/investigate/disposition/promote。' } }
      const command = initiativeCommandSchema.safeParse(raw)
      const query = initiativeQuerySchema.safeParse(raw)
      if (!command.success && !query.success) return { kind: 'error', text: 'Candidate 参数无效；身份与权限由当前人工命令确定。' }
      try {
        const access = { commandId: invocation.commandId }
        const result = command.success
          ? await ctx.initiative.execute(invocation.agent, command.data, access, invocation.signal)
          : query.success ? await ctx.initiative.read(invocation.agent, query.data, access, invocation.signal) : undefined
        const text = JSON.stringify(result)
        if (Buffer.byteLength(text, 'utf8') > bounds.maxOutputBytes) return { kind: 'error', text: '结果超过限制；请读取单个 Candidate 或缩小分页。' }
        return { kind: 'success', text }
      } catch (error) {
        if (error instanceof InitiativeError) return { kind: 'error', text: `${error.code}: ${error.message}` }
        throw error
      }
    },
  })
}
