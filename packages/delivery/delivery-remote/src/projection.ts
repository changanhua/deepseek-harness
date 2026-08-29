/** Browser-safe Personal Delivery projection over one Delivery and Queue read. */

import type { DeliverySnapshot } from '@deepseek-ai/dsh-delivery'
import {
  QueueAttemptIdRef,
  QueueWorkIdRef,
  codeChangeOutputSchema,
  codeVerifyOutputSchema,
  type CompletionClaim,
  type DispatchBinding,
  type VerificationVerdict,
  type WorkPacket,
} from '@deepseek-ai/dsh-delivery-protocol'
import type { Attention, WorkView } from '@deepseek-ai/dsh-task-queue'
import type {
  DeliveryAcceptanceDecisionView,
  DeliveryDispatchBindingView,
  DeliveryLane,
  DeliveryQueueWorkView,
  DeliverySnapshotView,
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
      message: view.state.failure.message,
    },
    cancelRequestedAt: view.state.cancelRequestedAt,
    updatedAt: view.state.updatedAt,
  }
}

function latestDecision(
  decisions: readonly DeliveryAcceptanceDecisionView[],
  packet: WorkPacket,
): DeliveryAcceptanceDecisionView | null {
  return decisions
    .filter(decision => decision.packetId === packet.id)
    .toSorted((left, right) =>
      right.decidedAt.localeCompare(left.decidedAt) || right.id.localeCompare(left.id),
    )[0] ?? null
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
    const reasons = new Set<string>()
    const dispatches = packetBindings.map((binding): DeliveryWorkbenchDispatch => {
      const work = binding.phase === 'bound' ? works.get(String(binding.queueWorkId)) : undefined
      if (binding.phase === 'bound' && work === undefined) {
        reasons.add(`Bound ${binding.kind} work is unavailable`)
      }
      if (work?.state.failure !== null && work?.state.failure !== undefined) {
        reasons.add(work.state.failure.message)
      }
      for (const attention of binding.phase === 'bound'
        ? attentionWorkIds.get(String(binding.queueWorkId)) ?? []
        : []) {
        reasons.add(`Queue requires operator attention: ${attention.kind}`)
      }
      if (work?.state.status === 'succeeded' && work.result !== null) {
        if (binding.kind === 'code.change@1') {
          const parsed = codeChangeOutputSchema.safeParse(work.result.output)
          if (parsed.success) completionClaims.push(parsed.data.completionClaim)
          else reasons.add('Code change result is invalid')
        } else {
          const parsed = codeVerifyOutputSchema.safeParse(work.result.output)
          if (parsed.success) verificationVerdicts.push(parsed.data.verificationVerdict)
          else reasons.add('Verification result is invalid')
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
      reasons.add(`Change reported ${completionClaim.disposition}`)
    }
    if (verificationVerdict !== null && verificationVerdict.status !== 'passed') {
      reasons.add(`Verification reported ${verificationVerdict.status}`)
    }
    const acceptanceDecision = latestDecision(delivery.acceptanceDecisions, packet)
    if (acceptanceDecision?.decision === 'rejected') reasons.add('Human decision rejected the Packet')
    const lane = laneFor({
      decision: acceptanceDecision,
      claim: completionClaim,
      verdict: verificationVerdict,
      dispatches,
    })
    return {
      contractRevision,
      packet,
      lane,
      dispatches,
      completionClaim,
      verificationVerdict,
      acceptanceDecision,
      attentionReasons: [...reasons].sort((left, right) => left.localeCompare(right)),
    }
  }).sort((left, right) => byCreatedDesc(left.packet, right.packet))

  return {
    contractsWithoutPacket: delivery.contractRevisions
      .filter(contract => !packetsWithContract.has(contract.id))
      .toSorted(byCreatedDesc),
    cards,
  }
}
