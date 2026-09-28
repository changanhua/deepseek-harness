import { describe, expect, it } from 'vitest'
import { contractReadiness } from '@changanhua/dsh-delivery-protocol'
import type { ContractRevision } from '@changanhua/dsh-delivery-protocol'
import { mapPlanningHandoff } from '../src/index.ts'

const handoff: Parameters<typeof mapPlanningHandoff>[0] = {
  itemId: 'plan-1',
  revisionId: 'revision-1',
  repositoryId: 'repository-1',
  operatorId: 'operator-1',

  source: {
    title: 'Keep source',
    intent: 'Preserve the outcome.',
    scope: ['Keep complete scope'],
    acceptance: ['It is visible'],
    sources: [{ kind: 'link', url: 'https://example.test/source', label: 'source', verification: 'unverified' }],
  },
}

describe('Planning Delivery mapper v1', () => {
  it('is deterministic and deliberately leaves Delivery readiness work unresolved', () => {
    const first = mapPlanningHandoff(handoff)
    expect(mapPlanningHandoff(structuredClone(handoff))).toEqual(first)
    expect(first).toMatchObject({
      title: 'Keep source',
      origin: { kind: 'human', actorId: 'operator-1' },
      revision: {
        outcome: 'Preserve the outcome.',
        allowedScope: ['Keep complete scope'],
        forbiddenScope: [],
        baseSelectionRule: null,
        verificationSource: null,
      },
    })
    expect(first.revision.allowedScope).not.toBe(handoff.source.scope)
    expect(first.revision.context).toContain('Keep complete scope')
    const revision = {
      ...first.revision,
      schemaVersion: 2,
      id: 'contract-1',
      caseId: 'case-1',
      title: first.title,
      repositoryId: 'repository-1',
      previousRevisionId: null,
      origin: first.origin,
      createdAt: '2026-01-01T00:00:00.000Z',
    } as unknown as ContractRevision
    expect(contractReadiness(revision)).toMatchObject({ ready: false })
  })
})
