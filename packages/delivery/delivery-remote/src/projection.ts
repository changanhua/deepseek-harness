/** Browser-safe Personal Delivery projection over one Delivery and Queue read. */

import type { DeliverySnapshot } from '@deepseek-ai/dsh-delivery'
import {
  QueueAttemptIdRef,
  QueueWorkIdRef,
  canonicalDigest,
  contractReadiness,
  codeChangeIntentSchema,
  codeChangeOutputSchema,
  codeVerifyIntentSchema,
  codeVerifyOutputSchema,
  resolvedCodeChangeSchema,
  resolvedCodeVerifySchema,
  type AcceptanceDecision,
  type CompletionClaim,
  type DispatchBinding,
  type GitHubIssueRef,
  type IssuePublication,
  type RequirementDecision,
  type VerificationVerdict,
  type WorkPacket,
} from '@deepseek-ai/dsh-delivery-protocol'
import type { Attention, WorkView } from '@deepseek-ai/dsh-task-queue'
import type {
  DeliveryAcceptanceDecisionView,
  DeliveryAttentionReason,
  DeliveryCaseCard,
  DeliveryDispatchBindingView,
  DeliveryLane,
  DeliveryIssuePublicationView,
  DeliveryQueueWorkView,
  DeliverySnapshotView,
  DeliveryWorkbenchCard,
  DeliveryWorkbenchDispatch,
} from './types.ts'

const ACTIVE = new Set(['queued', 'starting', 'running'])
const BLOCKED = new Set(['unknown', 'failed', 'canceled'])

/** Fail-closed classification for inconsistent Delivery/Queue snapshots. */
export class DeliveryProjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeliveryProjectionError'
  }
}

function byCreatedDesc<Subject extends { readonly createdAt: string; readonly id: string }>(
  left: Subject,
  right: Subject,
): number {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
}

/** Remove the trusted actor id from human-origin revisions. */
export function projectContractRevision(
  revision: import('@deepseek-ai/dsh-delivery-protocol').ContractRevision,
): import('./types.ts').DeliveryContractRevisionView {
  return {
    ...revision,
    origin: revision.origin.kind === 'human' ? { kind: 'human' } : revision.origin,
  }
}

/**
 * Remove host-only binding digests and idempotency before crossing the browser edge.
 * @param binding - Host-owned Delivery dispatch binding.
 * @returns the browser-safe identity and lifecycle view.
 */
export function projectDispatchBinding(binding: DispatchBinding): DeliveryDispatchBindingView {
  return {
    id: binding.id,
    packetId: binding.packetId,
    kind: binding.kind,
    phase: binding.phase,
    queueWorkId: binding.queueWorkId,
    executorId: binding.executorId,
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
  }
}

/**
 * Remove the trusted Host actor and decision nonce before browser transport.
 * @param decision - Durable Delivery acceptance decision.
 * @returns the browser-safe decision facts required by the workbench.
 */
export function projectAcceptanceDecision(
  decision: AcceptanceDecision,
): DeliveryAcceptanceDecisionView {
  return {
    schemaVersion: decision.schemaVersion,
    id: decision.id,
    packetId: decision.packetId,
    targetCommit: decision.targetCommit,
    verdictId: decision.verdictId,
    decision: decision.decision,
    reason: decision.reason,
    decidedAt: decision.decidedAt,
  }
}

/** Remove the trusted Host actor from one requirement authority decision. */
export function projectRequirementDecision(
  decision: RequirementDecision,
): import('./types.ts').DeliveryRequirementDecisionView {
  return {
    id: decision.id,
    caseId: decision.caseId,
    revisionId: decision.revisionId,
    decision: decision.decision,
    reason: decision.reason,
    decidedAt: decision.decidedAt,
  }
}

/** Remove Host marker, digest, and failure detail from one publication record. */
export function projectIssuePublication(
  publication: IssuePublication,
): DeliveryIssuePublicationView {
  return {
    id: publication.id,
    caseId: publication.caseId,
    revisionId: publication.revisionId,
    phase: publication.phase,
    failureCategory: publication.failure?.category ?? null,
    issue: publication.issue,
    updatedAt: publication.updatedAt,
  }
}

function queueView(view: WorkView): DeliveryQueueWorkView {
  return {
    id: QueueWorkIdRef(String(view.work.id)),
    status: view.state.status,
    attemptCount: view.state.attemptCount,
    activeAttemptId: view.state.activeAttemptId === null
      ? null
      : QueueAttemptIdRef(String(view.state.activeAttemptId)),
    failure: view.state.failure === null ? null : {
      category: view.state.failure.category,
      sideEffect: view.state.failure.sideEffect,
      retriable: view.state.failure.retriable,
    },
    cancelRequestedAt: view.state.cancelRequestedAt,
    updatedAt: view.state.updatedAt,
  }
}

function matchesBoundWork(binding: DispatchBinding, view: WorkView): boolean {
  return binding.phase === 'bound'
    && String(view.work.id) === binding.queueWorkId
    && view.work.kind === binding.kind
    && String(view.state.workId) === binding.queueWorkId
}

function exactSuccessfulResult(
  binding: DispatchBinding,
  view: WorkView,
): NonNullable<WorkView['result']> | null {
  const result = view.result
  if (
    view.state.status !== 'succeeded'
    || result === null
    || view.state.resultId !== result.id
    || result.workId !== view.work.id
    || result.kind !== binding.kind
    || !view.attempts.some(attempt =>
      attempt.id === result.attemptId
        && attempt.workId === view.work.id
        && attempt.status === 'succeeded',
    )
  ) return null
  return result
}

function latestDecision(
  decisions: readonly AcceptanceDecision[],
  packet: WorkPacket,
): DeliveryAcceptanceDecisionView | null {
  const decision = decisions
    .filter(decision => decision.packetId === packet.id)
    .toSorted((left, right) =>
      right.decidedAt.localeCompare(left.decidedAt) || right.id.localeCompare(left.id),
    )[0] ?? null
  return decision === null ? null : projectAcceptanceDecision(decision)
}

function laneFor(input: {
  readonly decision: DeliveryAcceptanceDecisionView | null
  readonly claim: CompletionClaim | null
  readonly verdict: VerificationVerdict | null
  readonly dispatches: readonly DeliveryWorkbenchDispatch[]
}): DeliveryLane {
  if (input.decision?.decision === 'accepted' || input.decision?.decision === 'waived') {
    return 'accepted'
  }
  if (input.decision?.decision === 'rejected') return 'blocked'
  if (input.claim !== null && input.claim.disposition !== 'completed') return 'blocked'
  if (input.verdict !== null && input.verdict.status !== 'passed') return 'blocked'
  if (input.dispatches.some(dispatch =>
    dispatch.binding.phase === 'bound' && dispatch.queue === null,
  )) return 'blocked'
  if (input.dispatches.some(dispatch => dispatch.queue !== null && BLOCKED.has(dispatch.queue.status))) {
    return 'blocked'
  }
  if (input.dispatches.some(dispatch =>
    dispatch.binding.phase === 'submitting'
      || (dispatch.queue !== null && ACTIVE.has(dispatch.queue.status)),
  )) return 'running'
  if (input.claim?.disposition === 'completed') return 'review'
  return 'ready'
}

/**
 * Derive the complete workbench without retaining Queue intent, resolved input,
 * result payloads, idempotency keys, or host paths.
 * @param delivery - One point-in-time Delivery domain snapshot.
 * @param queue - One point-in-time trusted operator Queue list.
 * @param attentions - Pending operator attentions from the same Queue facade.
 * @returns the deterministic five-lane browser projection.
 */
export function projectDeliverySnapshot(
  delivery: DeliverySnapshot,
  queue: readonly WorkView[],
  attentions: readonly Attention[],
  publicationTargets: ReadonlyMap<string, GitHubIssueRef['repository']> = new Map(),
): DeliverySnapshotView {
  const contracts = new Map(delivery.contractRevisions.map(contract => [contract.id, contract]))
  const packetsWithContract = new Set(delivery.workPackets.map(packet => packet.contractRevisionId))
  const works = new Map(queue.map(view => [String(view.work.id), view]))
  const attentionWorkIds = new Map<string, Attention[]>()
  for (const attention of attentions) {
    const entries = attentionWorkIds.get(String(attention.workId)) ?? []
    entries.push(attention)
    attentionWorkIds.set(String(attention.workId), entries)
  }

  const cards = delivery.workPackets.map((packet) => {
    const contractRevision = contracts.get(packet.contractRevisionId)
    if (contractRevision === undefined) {
      throw new DeliveryProjectionError(
        `Packet references an unavailable Contract revision: ${packet.id}`,
      )
    }
    const packetBindings = delivery.dispatchBindings
      .filter(binding => binding.packetId === packet.id)
      .toSorted((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
    const completionClaims: CompletionClaim[] = []
    const verificationVerdicts: VerificationVerdict[] = []
    const reasons = new Set<DeliveryAttentionReason>()
    const dispatches = packetBindings.map((binding): DeliveryWorkbenchDispatch => {
      const work = binding.phase === 'bound' ? works.get(String(binding.queueWorkId)) : undefined
      if (binding.phase === 'bound' && work === undefined) {
        reasons.add('bound-work-unavailable')
      }
      if (work !== undefined && !matchesBoundWork(binding, work)) {
        reasons.add('projection-inconsistent')
        return { binding: projectDispatchBinding(binding), queue: null }
      }
      if (work?.state.failure !== null && work?.state.failure !== undefined) {
        reasons.add('queue-work-failed')
      }
      if (binding.phase === 'bound'
        && (attentionWorkIds.get(String(binding.queueWorkId))?.length ?? 0) > 0) {
        reasons.add('queue-attention')
      }
      if (work?.state.status === 'succeeded') {
        const result = exactSuccessfulResult(binding, work)
        if (result === null) {
          reasons.add('projection-inconsistent')
          return { binding: projectDispatchBinding(binding), queue: queueView(work) }
        }
        if (binding.kind === 'code.change@1') {
          const intent = codeChangeIntentSchema.safeParse(work.work.intent)
          const resolved = resolvedCodeChangeSchema.safeParse(work.work.resolved)
          const output = codeChangeOutputSchema.safeParse(result.output)
          if (!intent.success || !resolved.success || !output.success) {
            reasons.add('change-result-invalid')
          } else {
            const claim = output.data.completionClaim
            if (
              intent.data.packetId !== packet.id
              || work.work.intentDigest !== canonicalDigest(intent.data)
              || binding.inputDigest !== canonicalDigest(intent.data)
              || resolved.data.packetId !== packet.id
              || resolved.data.contractRevisionId !== packet.contractRevisionId
              || resolved.data.repositoryId !== packet.repositoryId
              || resolved.data.baseCommit !== packet.baseCommit
              || resolved.data.executorId !== binding.executorId
              || claim.packetId !== packet.id
              || claim.queueWorkId !== binding.queueWorkId
              || claim.queueAttemptId !== QueueAttemptIdRef(String(result.attemptId))
            ) {
              reasons.add('projection-inconsistent')
            } else {
              completionClaims.push(claim)
            }
          }
        } else {
          const intent = codeVerifyIntentSchema.safeParse(work.work.intent)
          const resolved = resolvedCodeVerifySchema.safeParse(work.work.resolved)
          const output = codeVerifyOutputSchema.safeParse(result.output)
          if (!intent.success || !resolved.success || !output.success) {
            reasons.add('verification-result-invalid')
          } else {
            const verdict = output.data.verificationVerdict
            if (
              intent.data.packetId !== packet.id
              || intent.data.verificationPlanDigest !== packet.verificationPlan.digest
              || work.work.intentDigest !== canonicalDigest(intent.data)
              || binding.inputDigest !== canonicalDigest(intent.data)
              || resolved.data.packetId !== packet.id
              || resolved.data.contractRevisionId !== packet.contractRevisionId
              || resolved.data.repositoryId !== packet.repositoryId
              || resolved.data.baseCommit !== packet.baseCommit
              || resolved.data.targetCommit !== intent.data.targetCommit
              || resolved.data.trustedPlan.digest !== packet.verificationPlan.digest
              || verdict.packetId !== packet.id
              || verdict.baseCommit !== packet.baseCommit
              || verdict.targetCommit !== intent.data.targetCommit
              || verdict.verificationPlanDigest !== packet.verificationPlan.digest
            ) {
              reasons.add('projection-inconsistent')
            } else {
              verificationVerdicts.push(verdict)
            }
          }
        }
      }
      return {
        binding: projectDispatchBinding(binding),
        queue: work === undefined ? null : queueView(work),
      }
    })
    const completionClaim = completionClaims.at(-1) ?? null
    const verificationVerdict = verificationVerdicts.at(-1) ?? null
    if (completionClaim !== null && completionClaim.disposition !== 'completed') {
      reasons.add(completionClaim.disposition === 'blocked' ? 'change-blocked' : 'change-interrupted')
    }
    if (verificationVerdict !== null && verificationVerdict.status !== 'passed') {
      reasons.add(verificationVerdict.status === 'failed'
        ? 'verification-failed'
        : 'verification-needs-human-review')
    }
    const acceptanceDecision = latestDecision(delivery.acceptanceDecisions, packet)
    if (acceptanceDecision?.decision === 'rejected') reasons.add('decision-rejected')
    const projectionBlocked = reasons.has('projection-inconsistent')
      || reasons.has('change-result-invalid')
      || reasons.has('verification-result-invalid')
    const lane = projectionBlocked
      ? 'blocked'
      : laneFor({
        decision: acceptanceDecision,
        claim: completionClaim,
        verdict: verificationVerdict,
        dispatches,
      })
    return {
      contractRevision: projectContractRevision(contractRevision),
      packet,
      lane,
      dispatches,
      completionClaim,
      verificationVerdict,
      acceptanceDecision,
      attentionReasons: [...reasons].sort((left, right) => left.localeCompare(right)),
    }
  }).sort((left, right) => byCreatedDesc(left.packet, right.packet))

  const packetCardsByRevision = new Map<string, DeliveryWorkbenchCard[]>()
  for (const card of cards) {
    const entries = packetCardsByRevision.get(card.contractRevision.id) ?? []
    entries.push(card)
    packetCardsByRevision.set(card.contractRevision.id, entries)
  }
  const decisionsByRevision = new Map(delivery.requirementDecisions.map(decision => [decision.revisionId, decision]))
  const publicationsByRevision = new Map(delivery.issuePublications.map(publication => [publication.revisionId, publication]))
  const cases = delivery.deliveryCases.map((deliveryCase): DeliveryCaseCard => {
    const headRevision = contracts.get(deliveryCase.headRevisionId)
    if (headRevision === undefined) {
      throw new DeliveryProjectionError(`Case references an unavailable head revision: ${deliveryCase.id}`)
    }
    const decision = decisionsByRevision.get(headRevision.id)
    const publication = publicationsByRevision.get(headRevision.id)
    const packets = packetCardsByRevision.get(headRevision.id) ?? []
    const downstreamLane = packets.find(card => card.lane === 'blocked')?.lane
      ?? packets.find(card => card.lane === 'running')?.lane
      ?? packets.find(card => card.lane === 'review')?.lane
      ?? packets.find(card => card.lane === 'accepted')?.lane
    const lane = publication?.phase === 'unknown' || publication?.phase === 'publishing'
      ? 'blocked'
      : downstreamLane ?? (decision?.decision === 'approved' ? 'ready' : 'shaping')
    return {
      case: deliveryCase,
      headRevision: projectContractRevision(headRevision),
      readiness: contractReadiness(headRevision),
      requirementDecision: decision === undefined ? null : projectRequirementDecision(decision),
      publication: publication === undefined ? null : projectIssuePublication(publication),
      publicationTarget: publicationTargets.get(String(deliveryCase.repositoryId)) ?? null,
      lane,
      packets,
    }
  }).sort((left, right) =>
    right.case.updatedAt.localeCompare(left.case.updatedAt) || right.case.id.localeCompare(left.case.id),
  )

  return {
    cases,
    contractsWithoutPacket: delivery.contractRevisions
      .filter(contract => !packetsWithContract.has(contract.id))
      .toSorted(byCreatedDesc)
      .map(projectContractRevision),
    cards,
    publications: delivery.issuePublications
      .toSorted(byCreatedDesc)
      .map(projectIssuePublication),
  }
}
