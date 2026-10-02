import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { z } from 'zod'
import Schema from '@deepseek-ai/schemastery'
import { BudgetError, budgetLimitsSchema } from '@changanhua/dsh-budget'
import type { BudgetReference, BudgetSnapshot } from '@changanhua/dsh-budget'
import { agentBudgetSubjects } from '@changanhua/dsh-budget-agent'
import type {} from '@deepseek-ai/dsh-workflow'

/** Give foreground Workflow children one shared durable parent scope. */
export const name = 'budget-workflow'
/** Child dispatch and Agent publication must both be composed before installing this bridge. */
export const inject = ['workflowEngine', 'agents', 'budget']
const configSchema = z.object({ workflows: z.array(z.object({ name: z.string().min(1), limits: budgetLimitsSchema,
  onExhausted: z.enum(['deny', 'pause', 'ask']) }).strict()).min(1) }).strict()
/** Host-owned ceilings by workflow name; scripts can select neither a larger policy nor an exemption. */
export type Config = z.infer<typeof configSchema>
const limit = Schema.union([Schema.number().step(1).min(0), Schema.const(null)]).default(null)
/** Validated Host policy; every ceiling is explicit, including inherited nulls. */
export const Config: Schema<Config> = Schema.object({ workflows: Schema.array(Schema.object({
  name: Schema.string().required(), onExhausted: Schema.union(['deny', 'pause', 'ask']).required(),
  limits: Schema.object({ requests: limit, inputTokens: limit, outputTokens: limit, totalTokens: limit, wallTimeMs: limit }).required(),
})).required() })

/** Install shared-run admission and bind child identities before their first model call. */
export function apply(ctx: Context, input: Config): void {
  const config = configSchema.parse(input)
  if (new Set(config.workflows.map(row => row.name)).size !== config.workflows.length) throw new Error('duplicate Workflow budget policy')
  const publishing = new AsyncLocalStorage<BudgetReference>()
  const bindings = new Map<Agent, BudgetReference>()
  ctx.on('agent/created', ({ agent }) => {
    const ref = publishing.getStore()
    if (ref) bindings.set(agent, ref)
  })
  ctx.on('agent/disposed', ({ agent }) => { bindings.delete(agent) })
  ctx.effect(() => () => {
    for (const agent of bindings.keys()) if (ctx.agents.get(agent.id) === agent) agent.cancel({ kind: 'parent' })
    bindings.clear()
    publishing.disable()
  }, 'budgetWorkflow.bindings()')
  ctx.budget.registerSubjectResolver(name, async () => {
    const agent = ctx.agents.currentInitiator()
    if (!agent) return []
    const ref = bindings.get(agent)
    if (!ref) return []
    const parent = ctx.budget.inspect(ref)
    let scope = ctx.budget.scopeFor({ kind: 'session', id: agent.id })
    if (!scope) scope = await ctx.budget.createScope({ id: `session:${agent.id}`, kind: 'session', subjectId: agent.id,
      parentId: parent.scope.id, limits: { requests: null, inputTokens: null, outputTokens: null, totalTokens: null, wallTimeMs: null }, onExhausted: 'deny' }, () => {
      if (ctx.agents.get(agent.id) !== agent || bindings.get(agent) !== ref) throw new BudgetError('BUDGET_CONTEXT_CHANGED', 'Workflow child identity changed')
    })
    if (scope.scope.parentId !== parent.scope.id) throw new BudgetError('BUDGET_CONTEXT_CONFLICT', 'Workflow child has another budget parent')
    return [{ kind: 'session', id: agent.id }, { kind: 'workflow', id: parent.scope.subjectId }]
  })
  ctx.workflowEngine.registerChildGuard(async (context, dispatch) => {
    context.signal.throwIfAborted()
    const policy = config.workflows.find(row => row.name === context.run.meta.name)
    if (!policy) throw new BudgetError('BUDGET_SCOPE_MISSING', 'Workflow has no Host-configured resource policy')
    const candidates = agentBudgetSubjects(ctx, context.parent).flatMap((subject) => {
      const found = ctx.budget.scopeFor(subject)
      return found ? [found] : []
    })
    const inherited = bindings.get(context.parent)
    if (inherited) candidates.push(ctx.budget.inspect(inherited))
    const ancestry = (initial: BudgetSnapshot) => {
      const ids = [initial.scope.id]
      let row = initial
      while (row.scope.parentId !== null) { row = ctx.budget.inspect(row.scope.parentId); ids.push(row.scope.id) }
      return ids
    }
    const ranked = candidates.map(scope => ({ scope, chain: ancestry(scope) })).sort((a, b) => b.chain.length - a.chain.length)
    const parent = ranked[0]
    if (!parent || candidates.some(scope => !parent.chain.includes(scope.scope.id))) throw new BudgetError('BUDGET_CONTEXT_CONFLICT', 'Workflow requires one authorized parent budget chain')
    const scope = await ctx.budget.createScope({ id: `workflow:${context.run.id}`, kind: 'workflow', subjectId: context.run.id,
      parentId: parent.scope.scope.id, limits: policy.limits, onExhausted: policy.onExhausted }, () => {
      context.signal.throwIfAborted()
      if (ctx.agents.get(context.parent.id) !== context.parent) throw new BudgetError('BUDGET_CONTEXT_CHANGED', 'Workflow parent is no longer live')
    })
    for (const id of [scope.scope.id, ...parent.chain]) {
      const view = ctx.budget.inspect(id)
      if (view.scope.revoked || view.unknownRequests > 0 || view.remainingMs === 0
        || view.scope.limits.requests !== null && view.consumed.requests + view.reserved.requests >= view.scope.limits.requests) {
        throw new BudgetError('BUDGET_EXHAUSTED', 'Workflow cannot dispatch another child under the current budget')
      }
    }
    return publishing.run(scope.reference, () => ctx.budget.withScope(scope.reference, dispatch))
  })
}
