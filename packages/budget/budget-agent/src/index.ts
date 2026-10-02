import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { BudgetError } from '@changanhua/dsh-budget'
import type { BudgetSubject, BudgetSnapshot } from '@changanhua/dsh-budget'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-user-approval'

/** Bind real Agent/Session ancestry and Goal identity to the shared budget owner. */
export const name = 'budget-agent'
/** This bridge derives live identities; it never trusts GenerateOptions.sessionId. */
export const inject = ['agents', 'budget']

/**
 * Resolve one exact live Agent and its runtime owners, including their current Goals.
 * @param ctx Host registries.
 * @param agent Exact active or idle Agent whose ownership is being checked.
 * @returns Durable subject identities; a missing runtime parent is never inferred from caller metadata.
 */
export function agentBudgetSubjects(ctx: Context, agent: Agent): BudgetSubject[] {
  if (ctx.agents.get(agent.id) !== agent) throw new BudgetError('BUDGET_CONTEXT_CHANGED', 'Agent identity is no longer live')
  const subjects: BudgetSubject[] = []
  const visited = new Set<Agent>()
  let current: Agent | undefined = agent
  while (current) {
    if (visited.has(current)) throw new BudgetError('BUDGET_CONTEXT_CONFLICT', 'Agent ownership contains a cycle')
    visited.add(current)
    subjects.push({ kind: 'session', id: current.session.id })
    const goal = ctx.get('goals')?.get(current)
    if (goal && goal.phase !== 'complete') subjects.push({ kind: 'goal', id: goal.id })
    const child: Agent = current
    current = ctx.agents.list().find(candidate => ctx.agents.isOwnedBy(child.id, candidate))
  }
  return subjects
}

/** Whether a completed budget snapshot can admit any further autonomous model request. */
function exhausted(snapshot: BudgetSnapshot): boolean {
  if (snapshot.scope.revoked || snapshot.unknownRequests > 0 || snapshot.remainingMs === 0) return true
  return (['requests', 'inputTokens', 'outputTokens', 'totalTokens'] as const).some((key) => {
    const ceiling = snapshot.scope.limits[key]
    return ceiling !== null && snapshot.consumed[key] + snapshot.reserved[key] >= ceiling
  })
}

/** Install disposable identity resolution, interactive approval and autonomous Goal refusal. */
export function apply(ctx: Context): void {
  ctx.budget.registerSubjectResolver(name, () => {
    const agent = ctx.agents.currentInitiator()
    if (!agent) return []
    if (agent.status !== 'running') throw new BudgetError('BUDGET_CONTEXT_CHANGED', 'Agent request has no active driver')
    return agentBudgetSubjects(ctx, agent)
  })
  ctx.budget.registerApprover(async (question, signal) => {
    const agent = ctx.agents.currentInitiator()
    const approval = ctx.get('approval')
    if (!agent || !approval || ctx.agents.get(agent.id) !== agent || agent.status !== 'running' || !ctx.agents.roots().includes(agent)) return 'unavailable'
    let human = false
    let open = false
    for (const event of agent.session.events.toReversed()) {
      if (event.type === 'turn/end') break
      if (event.type === 'turn/start') { open = true; break }
      if (event.type === 'user/message' && event.data.source.kind === 'user') human = true
    }
    if (!open || !human) return 'unavailable'
    return approval.request({ agent, toolName: 'budget:model-request', signal,
      reason: `Allow only model request ${question.request.requestId}, attempt ${question.request.attemptId}, beyond exhausted budget scopes ${question.scopes.map(value => value.scope.id).join(', ')}? Reservation: ${question.request.inputTokens} input tokens (${question.request.inputMeasurement ?? 'estimated'}), ${question.request.outputTokens} output tokens. Future limits stay unchanged.` })
  })
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter' || !decision.messages.some(message => message.source.kind === 'goal')) return decision
    const goals = ctx.get('goals')
    if (!goals) return decision
    const goal = goals.get(agent)
    if (!goal || goal.phase !== 'active') return decision
    let blocked = false
    try {
      const scopes = agentBudgetSubjects(ctx, agent).flatMap((subject) => {
        const scope = ctx.budget.scopeFor(subject)
        return scope ? [scope] : []
      })
      blocked = scopes.length === 0
      const seen = new Set<string>()
      for (const initial of scopes) {
        let current: BudgetSnapshot | undefined = initial
        while (current && !seen.has(current.scope.id)) {
          seen.add(current.scope.id)
          if (exhausted(current)) blocked = true
          current = current.scope.parentId === null ? undefined : ctx.budget.inspect(current.scope.parentId)
        }
      }
    } catch { blocked = true }
    if (!blocked) return decision
    goals.block(agent, { id: goal.id, revision: goal.revision }, { code: 'budget-exhausted', message: 'The authorized resource budget cannot admit another autonomous request.' })
    return { kind: 'reject' }
  })
}
