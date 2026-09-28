import { describe, expect, it } from 'vitest'
import { planningHandoffSchema } from '../src/schema.ts'

const handoff = {
  itemId: 'item',
  revisionId: 'revision',
  repositoryId: 'repository',
  key: 'a'.repeat(16),
  mapperVersion: 1,
  operatorId: 'operator',
  source: {
    title: 'Title',
    intent: 'Intent',
    scope: [],
    acceptance: [],
    sources: [{ kind: 'manual', text: 'source', verification: 'unverified' }],
  },
  sourceDigest: 'b'.repeat(64),
  deliveryRequestDigest: 'c'.repeat(64),
  phase: 'prepared' as const,
  preparedAt: '2026-09-27T00:00:00.000Z',
}

describe('planning handoff schema', () => {
  it('requires all delivery references only for linked handoffs', () => {
    expect(planningHandoffSchema.safeParse(handoff).success).toBe(true)
    expect(planningHandoffSchema.safeParse({ ...handoff, caseId: 'case' }).success).toBe(false)
    expect(planningHandoffSchema.safeParse({ ...handoff, phase: 'linked' }).success).toBe(false)
    expect(
      planningHandoffSchema.safeParse({
        ...handoff,
        phase: 'linked',
        caseId: 'case',
        contractRevisionId: 'contract',
        linkedAt: '2026-09-27T00:00:01.000Z',
      }).success,
    ).toBe(true)
  })
})
