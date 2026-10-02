import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import Schema from '@deepseek-ai/schemastery'
import { budgetLimitsSchema, budgetUsageSchema, BudgetError } from '@changanhua/dsh-budget'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-goal'

/** Direct Human budget entry; no model-facing resource mutation tool is registered. */
export const name = 'command-budget'
/** Commands supplies audited human invocation; Agent registry proves the exact live root. */
export const inject = ['commands', 'agents', 'budget']
/** Complete Human response limit. */
export interface Config {
  /** Maximum UTF-8 bytes in the complete serialized Human response. */
  maxOutputBytes?: number
}
/** Validated deployment response bound. */
export const Config: Schema<Config> = Schema.object({ maxOutputBytes: Schema.number().step(1).min(512).default(64 * 1024) })
const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set'), scope: z.enum(['session', 'goal']), limits: budgetLimitsSchema, onExhausted: z.enum(['deny', 'pause', 'ask']) }).strict(),
  z.object({ action: z.enum(['read', 'revoke']), scope: z.enum(['session', 'goal']) }).strict(),
  z.object({ action: z.enum(['receipt', 'reconcile']), requestId: z.string().min(1).max(256), attemptId: z.string().min(1).max(256), usage: budgetUsageSchema.optional() }).strict(),
])

/** Register human set/read/revoke and explicit unknown-usage reconciliation. */
export function apply(ctx: Context, config: Config = {}): void {
  const bounds = Config(config) as Required<Config>
  ctx.commands.register({ name: 'budget', description: '设置和查询当前 Session/Goal 的资源预算，核对未知用量',
    input: { hint: '{"action":"read","scope":"session"}' },
    handler: async (invocation) => {
      try {
        const input = commandSchema.parse(JSON.parse(invocation.rawInput) as unknown)
        const agent = invocation.agent
        const authorize = () => {
          invocation.signal.throwIfAborted()
          if (ctx.agents.get(agent.id) !== agent || !ctx.agents.roots().includes(agent)) throw new BudgetError('BUDGET_AUTHORITY_REQUIRED', 'Budget changes require the exact live Human root command')
          const events = agent.session.events
          const run = events.find(event => event.type === 'command/run' && event.data.commandId === invocation.commandId)
          if (run?.type !== 'command/run' || run.data.name !== 'budget' || run.data.args !== invocation.rawInput
            || events.some(event => event.type === 'command/done' && event.data.commandId === invocation.commandId)) {
            throw new BudgetError('BUDGET_AUTHORITY_REQUIRED', 'Budget command authorization changed')
          }
        }
        authorize()
        let result: unknown
        if ('requestId' in input) {
          const receipt = ctx.budget.reservation(input.requestId, input.attemptId)
          const root = ctx.budget.scopeFor({ kind: 'session', id: agent.id })
          let owned = false
          let cursor = receipt ? ctx.budget.inspect(receipt.scopeId) : undefined
          while (cursor) {
            if (cursor.scope.id === root?.scope.id) { owned = true; break }
            cursor = cursor.scope.parentId === null ? undefined : ctx.budget.inspect(cursor.scope.parentId)
          }
          if (!owned) throw new BudgetError('BUDGET_AUTHORITY_REQUIRED', 'Receipt does not belong to this Session budget')
          if (input.action === 'reconcile') {
            if (!input.usage) throw new BudgetError('BUDGET_USAGE_REQUIRED', 'Reconciliation requires operator-verified actual usage')
            await ctx.budget.reconcile(input.requestId, input.attemptId, input.usage, authorize)
          }
          result = { reservation: ctx.budget.reservation(input.requestId, input.attemptId),
            decision: ctx.budget.decision(input.requestId, input.attemptId) }
        } else {
          const goal = input.scope === 'goal' ? ctx.get('goals')?.get(agent) : undefined
          if (input.scope === 'goal' && !goal) throw new BudgetError('BUDGET_SCOPE_MISSING', 'This Session has no current Goal')
          const subjectId = input.scope === 'session' ? agent.id : goal?.id
          if (!subjectId) throw new BudgetError('BUDGET_SCOPE_MISSING', 'Budget subject is unavailable')
          const subject = { kind: input.scope, id: subjectId }
          const current = ctx.budget.scopeFor(subject)
          if (input.action === 'set') {
            const session = ctx.budget.scopeFor({ kind: 'session', id: agent.id })
            if (input.scope === 'goal' && !session) throw new BudgetError('BUDGET_SCOPE_MISSING', 'Set the Session budget before its Goal budget')
            result = await ctx.budget.createScope({ id: `${subject.kind}:${subject.id}`, kind: subject.kind, subjectId: subject.id,
              parentId: input.scope === 'goal' ? session?.scope.id ?? null : null,
              limits: input.limits, onExhausted: input.onExhausted }, authorize)
          } else if (input.action === 'revoke') {
            if (!current) throw new BudgetError('BUDGET_SCOPE_MISSING', 'Budget scope is not configured')
            await ctx.budget.revoke(current.scope.id, authorize)
            result = ctx.budget.inspect(current.scope.id)
          } else result = current ?? null
        }
        const text = JSON.stringify(result)
        if (Buffer.byteLength(text) > bounds.maxOutputBytes) return { kind: 'error', text: '预算结果超出响应限制。' }
        return { kind: 'success', text }
      } catch (error) {
        if (error instanceof BudgetError) return { kind: 'error', text: `${error.code}: ${error.message}` }
        if (error instanceof z.ZodError || error instanceof SyntaxError) return { kind: 'error', text: '预算命令参数无效；使用 set/read/revoke/receipt/reconcile。' }
        throw error
      }
    },
  })
}
