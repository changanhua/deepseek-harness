import { PlanningError } from './errors.ts'
import type { PlanningBoardSnapshot, PlanningContextPack, PlanningSubjectRef } from './types.ts'

/** Resolve a subject only within the supplied authorized Board. */
export function planningSubjectPlan(board: PlanningBoardSnapshot, subject: PlanningSubjectRef) {
  const focus = subject.kind === 'focus' ? board.focuses?.find(value => value.id === subject.id) : undefined
  const planId = subject.kind === 'plan' ? subject.id : focus?.planId
  const plan = board.items.find(value => value.id === planId)
  if (!plan) throw new PlanningError('invalid-reference', 'subject is not in this Board')
  return { plan, focus }
}

/** Current canonical context; opaque resource references never expand Session transcripts. */
export function buildPlanningContext(board: PlanningBoardSnapshot, subject: PlanningSubjectRef): PlanningContextPack {
  const { plan, focus } = planningSubjectPlan(board, subject)
  const revision = plan.revisions.find(value => value.id === plan.headRevisionId)
  if (!revision) throw new PlanningError('invalid-reference', 'current revision is unavailable')
  const entries = revision.stateEntries ?? []
  return structuredClone({
    subject, plan: { id: plan.id, title: revision.title, revision: revision.id },
    objective: entries.filter(value => value.kind === 'objective'),
    accepted: entries.filter(value => value.kind === 'accepted'), open: entries.filter(value => value.kind === 'open'),
    legacy: { intent: revision.intent, scope: revision.scope, acceptance: revision.acceptance },
    ...(focus ? { selectedFocus: focus } : {}),
    resourceRefs: (board.resourceLinks ?? []).filter(link =>
      (link.subject.kind === 'plan' && link.subject.id === plan.id) ||
      (link.subject.kind === subject.kind && link.subject.id === subject.id)),
  })
}
