import { describe, expect, it } from 'vitest'
import { planningPriorityScore, planningReviewState } from '../src/client/projections.ts'

describe('Planning UI projections', () => {
  it('projects review boundaries without changing priority arithmetic', () => {
    expect(planningReviewState(null, new Date('2026-09-27T00:00:00.000Z'))).toBe('none')
    expect(planningReviewState('2026-09-27T00:00:00.001Z', new Date('2026-09-27T00:00:00.000Z'))).toBe('scheduled')
    expect(planningReviewState('2026-09-27T00:00:00.000Z', new Date('2026-09-27T00:00:00.000Z'))).toBe('due')
    expect(planningReviewState('2026-09-26T23:59:59.999Z', new Date('2026-09-27T00:00:00.000Z'))).toBe('due')
    expect(
      planningPriorityScore({
        value: 5,
        urgency: 4,
        reuse: 3,
        compounding: 2,
        timeCost: 1,
        tokenCost: 1,
        risk: 1,
        cognitiveCost: 1,
        rationale: 'fixture',
      }),
    ).toBe(10)
  })
})
