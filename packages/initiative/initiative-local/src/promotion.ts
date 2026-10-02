import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { InitiativeError } from '@changanhua/dsh-initiative'
import type { InitiativeCandidate, InitiativeCommand } from '@changanhua/dsh-initiative'
import { PlanningError } from '@changanhua/dsh-planning'
import type { PlanningAccess, PlanningCommand } from '@changanhua/dsh-planning'
import type { initiativeScope } from './scope.ts'
import { assessmentAccess, selectedAssessment } from './assessment.ts'

/**
 * Freeze and recover a pending Proposal; never use canonical Planning or Delivery operations.
 * @param ctx - Host context supplying the optional Planning provider.
 * @param scope - Live Human scope rechecked by both owners at commit.
 * @param command - Exact Human promotion request.
 * @param digest - Actor-bound Candidate payload digest reserved before Planning writes.
 * @param candidate - Detached Candidate record updated only through save.
 * @param save - Atomic Candidate owner commit, including future settlement capacity.
 * @param signal - Caller lifetime; cancellation preserves recoverable prepared state.
 */
export async function promoteCandidate(
  ctx: Context, scope: Awaited<ReturnType<typeof initiativeScope>>, command: Extract<InitiativeCommand, { action: 'promote' }>,
  digest: string, candidate: InitiativeCandidate, save: () => Promise<void>, signal?: AbortSignal,
): Promise<void> {
  if (scope.actor.kind !== 'human') throw new InitiativeError('unauthorized', 'Human promotion required')
  const planning = ctx.get('planning')
  if (planning === undefined) throw new InitiativeError('unavailable', 'Planning provider is unavailable; Candidate remains unchanged')
  const access: PlanningAccess = { workspaceId: scope.workspaceId, actorId: scope.actor.id, kind: 'human', authorize: scope.authorize }
  if (candidate.promotion === undefined) {
    if (candidate.status !== 'ASSESSABLE') throw new InitiativeError('invalid-transition', 'Only an assessable Candidate can be promoted')
    const assessment = command.assessmentId === undefined ? undefined
      : await selectedAssessment(ctx, assessmentAccess(scope), candidate, command.assessmentId, signal)
    const board = await planning.snapshot(access, signal)
    const identity = createHash('sha256').update(`${scope.workspaceId}:${candidate.id}:${command.key}`).digest('hex')
    candidate.promotion = { phase: 'prepared', key: command.key, digest, candidateVersion: candidate.headVersion,
      rationale: command.rationale, actor: scope.actor, proposalId: `initiative-${identity}`, requestId: `initiative-${identity}`,
      expectedBoardVersion: board.version, preparedAt: new Date().toISOString(),
      ...(assessment === undefined ? {} : { assessment: { id: assessment.id, baseline: assessment.baseline } }) }
    candidate.recordVersion++
    await save()
  }
  const promotion = candidate.promotion
  if (promotion.phase === 'linked') return
  const revision = candidate.revisions.find(value => value.version === promotion.candidateVersion)
  if (revision === undefined) throw new InitiativeError('unavailable', 'Prepared Candidate revision is missing')
  const input: Extract<PlanningCommand, { kind: 'propose' }> = {
    kind: 'propose', requestId: promotion.requestId, expectedBoardVersion: promotion.expectedBoardVersion,
    proposalId: promotion.proposalId, expectedProposalVersion: null, targetItemId: null, baseRevisionId: null,
    draft: {
      title: revision.facts.claim, intent: promotion.rationale, scope: [], acceptance: [], reviewAt: null,
      stateEntries: [{ id: `candidate-${candidate.id}`, kind: 'objective', content: revision.facts.claim,
        sourceRefs: [{ kind: 'initiative-candidate', id: candidate.id, provider: 'initiative', revision: String(revision.version) },
          ...(promotion.assessment === undefined ? [] : [{ kind: 'requirement-assessment', id: promotion.assessment.id,
            provider: 'requirementAssessment', revision: promotion.assessment.baseline.assessedAt },
          { kind: 'requirement-assessment-baseline', id: promotion.assessment.id, provider: 'requirementAssessment',
            revision: createHash('sha256').update(JSON.stringify(promotion.assessment.baseline)).digest('hex') }])] }],
      sources: [{ kind: 'manual', text: `initiative:${candidate.id}@${revision.version}\n${revision.facts.claim}`.slice(0, 4000) },
        ...(promotion.assessment === undefined ? [] : [{ kind: 'manual' as const,
          text: `Selected Assessment ${promotion.assessment.id}; fixed baseline sha256:${createHash('sha256').update(JSON.stringify(promotion.assessment.baseline)).digest('hex')}. Evaluation conveys no acceptance or execution authority.` }])],
      estimate: { value: null, urgency: null, reuse: null, compounding: null, timeCost: null, tokenCost: null, risk: null, cognitiveCost: null, rationale: 'Not assessed. Candidate promotion conveys no investment or execution approval.' },
    }, suggestedLane: 'inbox', assumptions: revision.facts.assumptions,
  }
  try { await planning.execute(access, input, signal) }
  catch (error) {
    if (!(error instanceof PlanningError) || error.code !== 'conflict') throw error
    const board = await planning.snapshot(access, signal)
    if (board.proposals.some(value => value.id === promotion.proposalId)) throw error
    // A definite CAS rejection committed nothing. Persist a new attempt identity before the next explicit retry.
    promotion.expectedBoardVersion = board.version
    promotion.requestId = `initiative-${createHash('sha256').update(`${promotion.requestId}:${board.version}`).digest('hex')}`
    await save()
    throw new InitiativeError('conflict', 'Planning changed before promotion; retry the same Candidate key to recover')
  }
  promotion.phase = 'linked'
  promotion.linkedAt = new Date().toISOString()
  candidate.status = 'PROMOTED'
  candidate.recordVersion++
}
