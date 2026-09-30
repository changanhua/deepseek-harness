import { randomUUID } from 'node:crypto'
import { PlanningError, planningSubjectPlan } from '@changanhua/dsh-planning'
import type { PlanningActor, PlanningBoardRecord, PlanningDeltaOperation, PlanningSubjectRef } from '@changanhua/dsh-planning'

/** Mutate only a detached Board candidate. The caller commits it with audit and receipt atomically. */
export function applyWorkspaceOperations(
  board: PlanningBoardRecord, subject: PlanningSubjectRef, baseRevision: string,
  operations: readonly PlanningDeltaOperation[], actor: PlanningActor, at: string, maxRevisions: number,
) {
  const { plan } = planningSubjectPlan(board, subject)
  if (plan.headRevisionId !== baseRevision) throw new PlanningError('conflict', 'base revision mismatch')
  if (plan.revisions.length >= maxRevisions) throw new PlanningError('capacity-exceeded', 'planning revision limit reached')
  const head = plan.revisions.find(value => value.id === baseRevision)
  if (head === undefined) throw new PlanningError('invalid-reference', 'base revision is unavailable')
  const revision = { ...structuredClone(head), id: `plan-revision-${randomUUID()}`,
    previousRevisionId: baseRevision, actorId: actor.id, actor, createdAt: at }
  const invalid = (message: string): never => { throw new PlanningError('invalid-reference', message) }
  for (const operation of operations) {
    if (operation.kind === 'add-state-entry' || operation.kind === 'update-state-entry') {
      const entries = revision.stateEntries ??= []
      const index = entries.findIndex(value => value.id === operation.entry.id)
      if (operation.kind === 'add-state-entry') {
        if (index >= 0) invalid('state entry already exists')
        // A retired identity cannot be silently repurposed in a later revision.
        if (plan.revisions.some(value => value.stateEntries?.some(entry => entry.id === operation.entry.id)))
          invalid('state entry identity already used')
        entries.push(structuredClone(operation.entry))
      } else {
        if (index < 0) invalid('state entry is unavailable')
        entries[index] = structuredClone(operation.entry)
      }
    } else if (operation.kind === 'remove-state-entry') {
      const entries = revision.stateEntries ?? []
      const index = entries.findIndex(value => value.id === operation.id)
      if (index < 0) invalid('state entry is unavailable')
      entries.splice(index, 1)
    } else if (operation.kind === 'create-focus') {
      if (subject.kind !== 'plan') invalid('create focus requires a plan subject')
      const focuses = board.focuses ??= []
      if (focuses.some(value => value.id === operation.id)) invalid('focus already exists')
      focuses.push({ id: operation.id, planId: plan.id, title: operation.title,
        ...(operation.objective === undefined ? {} : { objective: operation.objective }),
        status: 'open', version: 1, createdAt: at, updatedAt: at })
    } else if (operation.kind === 'update-focus') {
      const focus = board.focuses?.find(value => value.id === operation.id && value.planId === plan.id)
      if (!focus || (subject.kind === 'focus' && subject.id !== focus.id)) throw new PlanningError('invalid-reference', 'focus is outside subject')
      if (focus.version !== operation.expectedVersion) throw new PlanningError('conflict', 'focus version mismatch')
      if (operation.title !== undefined) focus.title = operation.title
      if (operation.objective !== undefined) focus.objective = operation.objective
      if (operation.status !== undefined) focus.status = operation.status
      focus.version++
      focus.updatedAt = at
    } else if (operation.kind === 'add-resource-link') {
      const links = board.resourceLinks ??= []
      if (links.some(value => value.id === operation.id)) invalid('resource link already exists')
      links.push({ id: operation.id, subject, resource: operation.resource,
        ...(operation.role === undefined ? {} : { role: operation.role }), createdAt: at })
    } else {
      const links = board.resourceLinks ?? []
      const index = links.findIndex(value => value.id === operation.id &&
        value.subject.kind === subject.kind && value.subject.id === subject.id)
      if (index < 0) invalid('resource link is outside subject')
      links.splice(index, 1)
    }
  }
  plan.revisions.push(revision)
  plan.headRevisionId = revision.id
  return { itemId: plan.id, revisionId: revision.id }
}
