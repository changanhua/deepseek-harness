import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@changanhua/dsh-eval-gates'
import type {} from '@changanhua/dsh-task-queue'
import type {} from '@changanhua/dsh-budget'
import { evalContractDigest } from '@changanhua/dsh-eval'
import type { EvalRunAccess } from '@changanhua/dsh-eval-runs'
import { createVerifiedOperatorAuthority, WorkId } from '@changanhua/dsh-task-queue'
import { SessionId } from '@deepseek-ai/dsh-session'
import { realpath } from 'node:fs/promises'
import type { ActivationRequestFactory, EvalActivationAccess, EvalActivationGrant, EvalActivationRequest } from '@changanhua/dsh-eval-activation'

/** Explicit capacity and private Host verification for a dedicated continuation Profile. */
export interface Config {
  /** Maximum retained Grant claims, including uncertain and consumed records. */
  readonly maxRecords: number
  /** Maximum complete encoded ledger bytes. */
  readonly maxLedgerBytes: number
  /** This bridge owns the one round only in a Profile that omits goal-round-driver. */
  readonly exclusiveGoalDriver: true
  /** Private capabilities installed by the trusted Profile composition. */
  readonly host: {
    /** Reauthorize the exact target and current Gate, Queue and Budget facts immediately before delivery. */
    verify(access: EvalActivationAccess, grant: EvalActivationGrant,
      request: EvalActivationRequest, signal?: AbortSignal): Promise<'approved' | 'blocked' | 'unknown'> }
}
const positive = () => Schema.number().step(1).min(1).required()
export const Config = Schema.object({ maxRecords: positive(), maxLedgerBytes: positive(),
  exclusiveGoalDriver: Schema.boolean().required(), host: Schema.any().required() }) as unknown as Schema<Config>

function evalBinding(value: unknown): { readonly runId: string } | undefined {
  if (!value || typeof value !== 'object' || !('eval' in value)) return undefined
  const evalValue = value.eval
  return evalValue && typeof evalValue === 'object' && 'runId' in evalValue && typeof evalValue.runId === 'string' ? { runId: evalValue.runId } : undefined
}

/**
 * Build the Host-only verifier.  `gateAccess` is deliberately a closure supplied
 * by Profile composition: a JSON request cannot mint the Workspace capability
 * required by EvalGates.
 * @param ctx Host services that own Gate, Queue, Budget and Session observations.
 * @param gateAccess Trusted mapping from activation authority to an exact Workspace capability.
 * @returns A verifier that rejects mismatched targets and unresolved or exhausted budgets.
 */
export function createActivationHost(ctx: Context, gateAccess: (access: EvalActivationAccess) => EvalRunAccess): Config['host'] {
  return { async verify(access, grant, request, signal) {
    signal?.throwIfAborted()
    try {
      await access.authorize()
      const source = gateAccess(access), gates = ctx.get('evalGates'), tasks = ctx.get('taskQueue'), budgets = ctx.get('budget')
      if (!gates || !tasks || !budgets || source.workspace.id !== access.workspaceId) return 'unknown'
      const header = ctx.get('agents')?.get(SessionId(grant.sessionId))?.session.header
        ?? (await ctx.get('sessionPersistence')?.stat(SessionId(grant.sessionId), signal ? { signal } : {}))?.header
      if (!header?.cwd || await realpath(header.cwd) !== await realpath(source.workspace.path)) return 'blocked'
      const gate = await gates.get(source, grant.gateId)
      const queue = tasks.forOperator(createVerifiedOperatorAuthority())
      const view = queue.get(WorkId(request.work.id))
      const attempt = view.attempts.at(-1)
      if (view.work.kind !== 'eval.cell@1' || evalBinding(view.work.resolved)?.runId !== gate.runId) return 'blocked'
      if (!attempt || String(attempt.id) !== request.work.attemptId || !['succeeded', 'failed', 'canceled'].includes(view.state.status)
        || attempt.status !== view.state.status || view.state.activeAttemptId !== null) return 'blocked'
      const terminalDigest = evalContractDigest({ work: view.work, state: view.state, attempt })
      if (terminalDigest !== request.work.terminalDigest) return 'blocked'
      if (gate.runId.length === 0 || gate.validity !== 'current' || gate.decision.decision !== 'pass'
        || evalContractDigest(gate.decision) !== grant.decisionDigest
        || gate.decision.budget.status !== 'within-limit'
        || !gate.decision.budget.authorizationRef
        || evalContractDigest(gate.decision.budget.authorizationRef) !== evalContractDigest(grant.budgetRef)) return 'blocked'
      let budget = budgets.inspect(grant.budgetRef)
      if (budget.scope.kind !== 'session' || budget.scope.subjectId !== grant.sessionId) return 'blocked'
      const seen = new Set<string>()
      for (;;) {
        if (seen.has(budget.scope.id)) return 'blocked'
        seen.add(budget.scope.id)
        if (budget.scope.revoked || budget.unknownRequests !== 0 || budget.remainingMs === 0
          || (['requests', 'inputTokens', 'outputTokens', 'totalTokens'] as const).some((key) => {
            const limit = budget.scope.limits[key]
            return limit !== null && budget.consumed[key] + budget.reserved[key] >= limit
          })) return 'blocked'
        if (budget.scope.parentId === null) break
        budget = budgets.inspect(budget.scope.parentId)
      }
      signal?.throwIfAborted()
      await access.authorize()
      return 'approved'
    } catch { return 'unknown' }
  } }
}

/**
 * Construct requests from real owners without accepting terminal facts through the CLI wire.
 * @param ctx Host Gate and Queue owners.
 * @param input Trusted Workspace capability mapping supplied by Profile composition.
 * @returns A factory binding one fixed continuation policy to the current approved Gate and terminal Attempt.
 */
export function createActivationRequestFactory(ctx: Context,
  input: { readonly gateAccess: (access: EvalActivationAccess) => EvalRunAccess }): ActivationRequestFactory {
  return async (access, policy, gateId, operationId, signal) => {
    signal?.throwIfAborted()
    await access.authorize()
    const gates = ctx.get('evalGates'), tasks = ctx.get('taskQueue')
    if (!gates || !tasks) throw new Error('eval-activation-host-unavailable')
    const gate = await gates.get(input.gateAccess(access), gateId)
    if (gate.validity !== 'current' || gate.decision.decision !== 'pass') throw new Error('eval-activation-gate-not-approved')
    const queue = tasks.forOperator(createVerifiedOperatorAuthority())
    const view = queue.list().find(candidate => candidate.work.kind === 'eval.cell@1'
      && evalBinding(candidate.work.resolved)?.runId === gate.runId
      && ['succeeded', 'failed', 'canceled'].includes(candidate.state.status)
      && candidate.state.activeAttemptId === null)
    const attempt = view?.attempts.at(-1)
    if (!view || !attempt) throw new Error('eval-activation-terminal-work-missing')
    const terminalDigest = evalContractDigest({ work: view.work, state: view.state, attempt })
    return { idempotencyKey: operationId, grant: { id: policy.grantId, actorId: access.actorId, workspaceId: access.workspaceId,
      sessionId: policy.sessionId, goal: policy.goal, decisionDigest: evalContractDigest(gate.decision), gateId,
      budgetRef: policy.budgetRef, expiresAt: policy.expiresAt, maxActivations: 1 },
    work: { id: String(view.work.id), attemptId: String(attempt.id), terminalDigest }, followup: policy.followup }
  }
}
