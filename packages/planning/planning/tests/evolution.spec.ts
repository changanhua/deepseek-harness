import { describe, expect, it } from 'vitest'
import * as planning from '../src/index.ts'
import type { PlanningBoardSnapshot } from '../src/types.ts'

const estimate = {
  value: null,
  urgency: null,
  reuse: null,
  compounding: null,
  timeCost: null,
  tokenCost: null,
  risk: null,
  cognitiveCost: null,
  rationale: '',
}
const human = { kind: 'human' as const, id: 'human' }
const agent = { kind: 'agent' as const, id: 'agent' }
const source = (text: string) => ({ kind: 'manual' as const, text, verification: 'unverified' as const })

const board: PlanningBoardSnapshot = {
  workspaceId: 'workspace',
  version: 8,
  items: [
    {
      id: 'plan',
      headRevisionId: 'r2',
      disposition: 'active',
      createdAt: '2026-09-27T00:00:00.000Z',
      revisions: [
        {
          id: 'r2',
          previousRevisionId: 'r1',
          title: 'Browser automation',
          intent: 'Use verified page state',
          scope: [],
          acceptance: [],
          sources: [source('The page state must be fresh')],
          estimate,
          reviewAt: null,
          actorId: 'human',
          actor: human,
          createdAt: '2026-09-27T02:00:00.000Z',
        },
        {
          id: 'r1',
          previousRevisionId: null,
          title: 'Browser automation',
          intent: 'Operate a browser task',
          scope: [],
          acceptance: [],
          sources: [source('Automate this browser task')],
          estimate,
          reviewAt: null,
          actorId: 'human',
          actor: human,
          createdAt: '2026-09-27T01:00:00.000Z',
        },
      ],
    },
    {
      id: 'dependency',
      headRevisionId: 'dependency-r1',
      disposition: 'active',
      createdAt: '2026-09-27T00:30:00.000Z',
      revisions: [
        {
          id: 'dependency-r1',
          previousRevisionId: null,
          title: 'Browser connection',
          intent: 'Keep one live browser connection',
          scope: [],
          acceptance: [],
          sources: [source('Connection requirement')],
          estimate,
          reviewAt: null,
          actorId: 'human',
          actor: human,
          createdAt: '2026-09-27T00:30:00.000Z',
        },
      ],
    },
  ],
  lanes: { inbox: ['plan'], now: ['dependency'], next: [], later: [], parking: [] },
  dependencies: { plan: ['dependency'] },
  reviews: [
    {
      id: 'review-1',
      itemId: 'plan',
      revisionId: 'r2',
      outcome: 'learned',
      summary: 'Fresh observations matter',
      lessons: ['Do not reuse stale selectors'],
      followUpItemIds: [],
      acceptanceRef: null,
      createdAt: '2026-09-27T04:00:00.000Z',
    },
  ],
  proposals: [
    {
      id: 'origin',
      targetItemId: null,
      status: 'accepted',
      headVersion: 1,
      createdAt: '2026-09-27T00:45:00.000Z',
      generations: [
        {
          version: 1,
          previousVersion: null,
          baseRevisionId: null,
          draft: {
            title: 'Browser automation',
            intent: 'Operate a browser task',
            scope: [],
            acceptance: [],
            sources: [source('Automate this browser task')],
            estimate,
            reviewAt: null,
          },
          suggestedLane: 'inbox',
          assumptions: [],
          actor: agent,
          createdAt: '2026-09-27T00:45:00.000Z',
        },
      ],
      settlement: {
        actor: human,
        at: '2026-09-27T01:00:00.000Z',
        itemId: 'plan',
        revisionId: 'r1',
      },
    },
    {
      id: 'rejected',
      targetItemId: 'plan',
      status: 'dismissed',
      headVersion: 1,
      createdAt: '2026-09-27T03:00:00.000Z',
      generations: [
        {
          version: 1,
          previousVersion: null,
          baseRevisionId: 'r2',
          draft: {
            title: 'Reuse cached selectors',
            intent: 'Skip fresh page reads',
            scope: [],
            acceptance: [],
            sources: [source('Rejected shortcut')],
            estimate,
            reviewAt: null,
          },
          suggestedLane: 'next',
          assumptions: ['Selectors never drift'],
          actor: agent,
          createdAt: '2026-09-27T03:00:00.000Z',
        },
      ],
      settlement: { actor: human, at: '2026-09-27T03:30:00.000Z' },
    },
  ],
  handoffs: [
    {
      itemId: 'plan',
      revisionId: 'r2',
      repositoryId: 'repo',
      key: '0123456789abcdef',
      mapperVersion: 1,
      operatorId: 'human',
      source: {
        title: 'Browser automation',
        intent: 'Use verified page state',
        scope: [],
        acceptance: [],
        sources: [source('The page state must be fresh')],
      },
      sourceDigest: 'a'.repeat(64),
      deliveryRequestDigest: 'b'.repeat(64),
      phase: 'prepared',
      preparedAt: '2026-09-27T05:00:00.000Z',
    },
  ],
  events: [],
}

describe('Planning evolution projection', () => {
  it('projects a stable traceable graph while keeping a dismissed proposal off the accepted spine', () => {
    const projector = (planning as unknown as {
      projectPlanningEvolution?: (snapshot: PlanningBoardSnapshot, itemId: string) => unknown
    }).projectPlanningEvolution
    expect(typeof projector).toBe('function')
    if (projector === undefined) return

    const projected = projector(board, 'plan') as {
      nodes: { id: string; state?: string; label: string }[]
      edges: { kind: string; from: string; to: string }[]
      spineNodeIds: string[]
    }
    expect(projected.nodes.map(node => node.id)).toEqual([
      'item:plan',
      'related-item:dependency',
      'proposal:origin:1',
      'source:proposal:origin:1:0',
      'revision:r1',
      'source:revision:r1:0',
      'revision:r2',
      'source:revision:r2:0',
      'proposal:rejected:1',
      'source:proposal:rejected:1:0',
      'review:review-1',
      'handoff:0123456789abcdef',
    ])
    expect(projected.edges).toEqual(expect.arrayContaining([
      { kind: 'accepted-as', from: 'proposal:origin:1', to: 'revision:r1' },
      { kind: 'supersedes', from: 'revision:r1', to: 'revision:r2' },
      { kind: 'proposes-change', from: 'revision:r2', to: 'proposal:rejected:1' },
      { kind: 'reviewed-by', from: 'revision:r2', to: 'review:review-1' },
      { kind: 'handed-off-as', from: 'revision:r2', to: 'handoff:0123456789abcdef' },
      { kind: 'depends-on', from: 'item:plan', to: 'related-item:dependency' },
    ]))
    expect(projected.nodes.find(node => node.id === 'revision:r2')?.state).toBe('current')
    expect(projected.nodes.find(node => node.id === 'proposal:rejected:1')?.state).toBe('dismissed')
    expect(projected.spineNodeIds).toEqual(['item:plan', 'proposal:origin:1', 'revision:r1', 'revision:r2'])
    expect(projected.nodes.find(node => node.id === 'revision:r2')?.label).toBe('Browser automation')
  })

  it('does not depend on proposal, revision, review, handoff, or item array order', () => {
    const projector = (planning as unknown as {
      projectPlanningEvolution?: (snapshot: PlanningBoardSnapshot, itemId: string) => unknown
    }).projectPlanningEvolution
    expect(typeof projector).toBe('function')
    if (projector === undefined) return
    const reordered = structuredClone(board)
    reordered.items.reverse()
    reordered.items.find(item => item.id === 'plan')!.revisions.reverse()
    reordered.proposals.reverse()
    reordered.reviews.reverse()
    reordered.handoffs.reverse()
    expect(projector(reordered, 'plan')).toEqual(projector(board, 'plan'))
  })

  it('uses revision ancestry rather than timestamps for the accepted spine', () => {
    const projector = (planning as unknown as {
      projectPlanningEvolution?: (snapshot: PlanningBoardSnapshot, itemId: string) => unknown
    }).projectPlanningEvolution
    expect(typeof projector).toBe('function')
    if (projector === undefined) return
    const skewed = structuredClone(board)
    const revisions = skewed.items.find(item => item.id === 'plan')!.revisions
    revisions.find(revision => revision.id === 'r1')!.createdAt = '2026-09-27T06:00:00.000Z'
    revisions.find(revision => revision.id === 'r2')!.createdAt = '2026-09-27T01:00:00.000Z'
    const view = projector(skewed, 'plan') as { spineNodeIds: string[] }
    expect(view.spineNodeIds).toEqual(['item:plan', 'proposal:origin:1', 'revision:r1', 'revision:r2'])
  })

  it('returns undefined for an object that is not in the Board snapshot', () => {
    const projector = (planning as unknown as {
      projectPlanningEvolution?: (snapshot: PlanningBoardSnapshot, itemId: string) => unknown
    }).projectPlanningEvolution
    expect(typeof projector).toBe('function')
    if (projector === undefined) return
    expect(projector(board, 'missing')).toBeUndefined()
  })
})
