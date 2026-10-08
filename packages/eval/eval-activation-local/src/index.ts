import { randomUUID } from 'node:crypto'
import { renderGoalRoundPrompt } from '@deepseek-ai/dsh-goal-round-driver'
import { Service } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import { evalContractDigest } from '@changanhua/dsh-eval'
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import EvalActivation, { EvalActivationError, type EvalActivationAccess, type EvalActivationRequest, type EvalActivationView } from '@changanhua/dsh-eval-activation'
import { ActivationLedger, type ActivationRecord } from './ledger.ts'
import type { Config } from './config.ts'

/** Durable single-use Grant owner; continuations serialize by target Session and stop with this provider. */
export class LocalEvalActivation extends EvalActivation {
  static inject = ['storageDomain', 'agents', 'goals', 'sessions']
  private ledger?: ActivationLedger
  private readonly pending = new Map<string, Promise<EvalActivationView>>()
  private readonly stop = new AbortController()
  private closing = false
  constructor(ctx: ConstructorParameters<typeof EvalActivation>[0], private readonly config: Config) {
    super(ctx)
    if (!z.literal(true).safeParse(config.exclusiveGoalDriver).success) throw new EvalActivationError('blocked')
  }
  protected async [Service.init](): Promise<void> {
    this.ledger = await ActivationLedger.open(this.ctx, this.config)
    this.ctx.effect(() => async () => {
      this.closing = true
      this.stop.abort(new EvalActivationError('unavailable'))
      await Promise.allSettled(this.pending.values())
      await this.ledger?.close()
    }, 'evalActivation.close')
  }
  private store(): ActivationLedger { if (!this.ledger) throw new EvalActivationError('unavailable'); return this.ledger }
  private assertOpen(): void { if (this.closing) throw new EvalActivationError('unavailable') }
  private assertIdle(agent: Agent): void {
    if (agent.status !== 'idle' || agent.inbox.hasPending) throw new EvalActivationError('conflict')
  }
  private view(row: ActivationRecord): EvalActivationView { return { id: row.id, grantId: row.grantId, workId: row.workId,
    sessionId: row.sessionId, goal: { id: row.goalId, revision: row.goalRevision }, phase: row.phase, messageId: row.messageId,
    reason: row.reason } }
  private row(access: EvalActivationAccess, id: string): ActivationRecord {
    const row = this.store().read().records.find(value => value.id === id && value.workspaceId === access.workspaceId)
    if (!row) throw new EvalActivationError('not-found')
    return row
  }
  private exclusive(id: string, operation: () => Promise<EvalActivationView>): Promise<EvalActivationView> {
    const before = this.pending.get(id) ?? Promise.resolve(undefined)
    const next = before.catch(() => undefined).then(operation)
    this.pending.set(id, next)
    void next.then(() => { if (this.pending.get(id) === next) this.pending.delete(id) },
      () => { if (this.pending.get(id) === next) this.pending.delete(id) })
    return next
  }
  async get(access: EvalActivationAccess, id: string): Promise<EvalActivationView> { await access.authorize()
    return this.view(this.row(access, id)) }
  async activate(access: EvalActivationAccess, request: EvalActivationRequest, signal?: AbortSignal): Promise<EvalActivationView> {
    if (this.closing) throw new EvalActivationError('unavailable')
    await access.authorize(); signal?.throwIfAborted()
    const grant = request.grant
    if (grant.actorId !== access.actorId || grant.workspaceId !== access.workspaceId || !z.literal(1).safeParse(grant.maxActivations).success || grant.expiresAt <= Date.now()) throw new EvalActivationError('expired')
    const id = evalContractDigest({ workspaceId: grant.workspaceId, grantId: grant.id })
    await this.store().change((draft) => {
      const existing = draft.records.find(row => row.id === id)
      if (existing) {
        if (existing.key !== evalContractDigest({ grant, work: request.work }) || existing.followup !== request.followup) throw new EvalActivationError('conflict')
        return
      }
      draft.records.push({ id, key: evalContractDigest({ grant, work: request.work }), grantId: grant.id,
        actorId: grant.actorId, workspaceId: grant.workspaceId, sessionId: grant.sessionId, goalId: grant.goal.id,
        goalRevision: grant.goal.revision,
        decisionDigest: grant.decisionDigest, gateId: grant.gateId, budgetRef: grant.budgetRef, expiresAt: grant.expiresAt,
        workId: request.work.id,
        attemptId: request.work.attemptId, terminalDigest: request.work.terminalDigest, followup: request.followup, messageId: null,
        phase: 'pending', reason: null, round: null, createdAt: Date.now() })
    })
    return this.reconcile(access, id, signal)
  }
  async reconcile(access: EvalActivationAccess, id: string, signal?: AbortSignal): Promise<EvalActivationView> {
    if (this.closing) throw new EvalActivationError('unavailable')
    await access.authorize(); signal?.throwIfAborted()
    const target = this.row(access, id).sessionId
    const lifetime = AbortSignal.any([this.stop.signal, ...(signal ? [signal] : [])])
    return this.exclusive(target, () => this.reconcileExclusive(access, id, lifetime))
  }
  private async reconcileExclusive(access: EvalActivationAccess, id: string, signal?: AbortSignal): Promise<EvalActivationView> {
    signal?.throwIfAborted()
    const row = this.row(access, id)
    if (row.actorId !== access.actorId) throw new EvalActivationError('unauthorized')
    if (['consumed', 'blocked', 'needs-attention'].includes(row.phase)) return this.view(row)
    if (row.phase === 'resuming') {
      await this.store().change((draft) => { const found = draft.records.find(value => value.id === id); if (found) {
        found.phase = 'needs-attention'; found.reason = 'resume-boundary-unproven-after-restart'
      } })
      return await this.get(access, id)
    }
    const grant = { id: row.grantId, actorId: row.actorId, workspaceId: row.workspaceId, sessionId: row.sessionId,
      goal: { id: row.goalId, revision: row.goalRevision }, decisionDigest: row.decisionDigest, gateId: row.gateId,
      budgetRef: row.budgetRef,
      expiresAt: row.expiresAt, maxActivations: 1 as const }
    const request = { idempotencyKey: row.key, grant, work: { id: row.workId, attemptId: row.attemptId,
      terminalDigest: row.terminalDigest }, followup: row.followup }
    // A persisted receipt is the only restart-safe evidence of a sent round.
    if (row.phase === 'followup-pending') {
      const handle = this.ctx.agents.get(brandString<SessionId>(row.sessionId)) ? null
        : await this.ctx.agents.resume({ resumeSessionId: brandString<SessionId>(row.sessionId), ...signal ? { signal } : {} })
      try {
        const agent = handle?.agent ?? this.ctx.agents.get(brandString<SessionId>(row.sessionId))
        const delivered = agent?.session.events.some(event => event.type === 'user/message' && event.data.id === row.messageId
        && event.data.source.kind === 'goal' && event.data.source.goalId === row.goalId
        && event.data.source.revision === row.goalRevision && event.data.source.round === row.round)
        await this.store().change((draft) => { const found = draft.records.find(value => value.id === id); if (found) {
          found.phase = delivered ? 'consumed' : 'needs-attention'; found.reason = delivered ? null : 'delivery-unproven-after-restart'
        } })
        return await this.get(access, id)
      } finally { await handle?.dispose() }
    }
    const verified = await this.config.host.verify(access, grant, request, signal)
    if (verified !== 'approved' || row.expiresAt <= Date.now()) {
      await this.store().change((draft) => { const found = draft.records.find(value => value.id === id); if (found) { found.phase = verified === 'blocked' ? 'blocked' : 'needs-attention'; found.reason = verified === 'blocked' ? 'activation-blocked' : 'activation-unverified' } })
      return await this.get(access, id)
    }
    await access.authorize()
    if (this.closing) throw new EvalActivationError('unavailable')
    await this.store().change((draft) => { const found = draft.records.find(value => value.id === id); if (found) found.phase = 'resuming' })
    const handle = this.ctx.agents.get(brandString<SessionId>(row.sessionId)) ? null
      : await this.ctx.agents.resume({ resumeSessionId: brandString<SessionId>(row.sessionId), ...signal ? { signal } : {} })
    try {
      const agent = handle?.agent ?? this.ctx.agents.get(brandString<SessionId>(row.sessionId))
      if (!agent) throw new EvalActivationError('unavailable')
      this.assertIdle(agent)
      const goal = this.ctx.goals.get(agent)
      if (!goal || goal.id !== row.goalId || goal.revision !== row.goalRevision || goal.roundsStarted >= goal.maxGoalRounds) throw new EvalActivationError('blocked')
      const resumed = goal.activation === 'armed' ? goal : this.ctx.goals.resume(agent, { id: goal.id, revision: goal.revision })
      this.ctx.goals.disarm(agent)
      const current = this.ctx.goals.get(agent)
      if (!current || current.id !== row.goalId || current.revision !== resumed.revision || current.phase !== 'active'
      || current.activation !== 'disarmed') throw new EvalActivationError('conflict')
      await this.store().change((draft) => { const found = draft.records.find(value => value.id === id)
        if (found) found.goalRevision = current.revision })
      const round = current.roundsStarted + 1
      const messageId = brandString<MessageId>(randomUUID())
      await access.authorize()
      signal?.throwIfAborted()
      this.assertOpen()
      if (row.expiresAt <= Date.now()
      || await this.config.host.verify(access, grant, request, signal) !== 'approved') throw new EvalActivationError('blocked')
      await this.store().change((draft) => { const found = draft.records.find(value => value.id === id); if (found) { found.phase = 'followup-pending'; found.messageId = messageId; found.round = round } })
      await access.authorize()
      signal?.throwIfAborted()
      this.assertOpen()
      if (row.expiresAt <= Date.now()) throw new EvalActivationError('expired')
      const latest = this.ctx.goals.get(agent)
      if (!latest || latest.id !== current.id || latest.revision !== current.revision || latest.phase !== 'active'
        || latest.activation !== 'disarmed' || latest.roundsStarted + 1 !== round) throw new EvalActivationError('conflict')
      this.assertIdle(agent)
      const cancel = () => { agent.cancel({ kind: 'hook', reason: 'Eval continuation canceled' }) }
      signal?.addEventListener('abort', cancel, { once: true })
      try {
        agent.followup(freezeMessage({ id: messageId, role: 'user', content: [...renderGoalRoundPrompt(current, round), { type: 'text', text: row.followup }],
          source: { kind: 'goal', goalId: current.id, revision: current.revision, round } }))
        await agent.whenIdle()
        const delivered = agent.session.events.some(event => event.type === 'user/message' && event.data.id === messageId
      && event.data.source.kind === 'goal' && event.data.source.round === round)
        this.ctx.goals.disarm(agent)
        const durable = await this.ctx.sessions.flush(agent.session)
        await this.store().change((draft) => { const found = draft.records.find(value => value.id === id); if (found) { found.phase = delivered && durable ? 'consumed' : 'needs-attention'; found.reason = delivered && durable ? null : 'delivery-unproven' } })
        return await this.get(access, id)
      } finally { signal?.removeEventListener('abort', cancel) }
    } finally { await handle?.dispose() }
  }
}
export default LocalEvalActivation
export { createActivationHost, createActivationRequestFactory } from './config.ts'
export type { Config } from './config.ts'
