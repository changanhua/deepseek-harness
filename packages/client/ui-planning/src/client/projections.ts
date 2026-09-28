import type { PlanningEstimate } from '@changanhua/dsh-planning/types'

/** Calculate the personal relative priority only when all eight estimate factors are known. */
export function planningPriorityScore(estimate: PlanningEstimate): number | null {
  const factors = [
    estimate.value,
    estimate.urgency,
    estimate.reuse,
    estimate.compounding,
    estimate.timeCost,
    estimate.tokenCost,
    estimate.risk,
    estimate.cognitiveCost,
  ]
  if (factors.some(value => value === null)) return null
  return (
    (estimate.value as number) +
    (estimate.urgency as number) +
    (estimate.reuse as number) +
    (estimate.compounding as number) -
    (estimate.timeCost as number) -
    (estimate.tokenCost as number) -
    (estimate.risk as number) -
    (estimate.cognitiveCost as number)
  )
}

/** Derive schedule state from a persisted review date without changing any manual lane or order. */
export function planningReviewState(reviewAt: string | null, now: Date = new Date()): 'none' | 'scheduled' | 'due' {
  if (reviewAt === null) return 'none'
  return now.getTime() < Date.parse(reviewAt) ? 'scheduled' : 'due'
}
