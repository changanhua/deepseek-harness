import { describe, expect, it } from 'vitest'
import type { PlanningBoardSnapshot } from '@changanhua/dsh-planning'
import { renderPlanningList, renderPlanningProposal, renderPlanningProposals } from '../src/presentation.ts'
import { parseList } from '../src/input.ts'

const limit = 16 * 1024
const large = (prefix: string) => `${prefix}-${'🐕'.repeat(900)}`
const estimate = {
  value: 1,
  urgency: 1,
  reuse: 1,
  compounding: 1,
  timeCost: 1,
  tokenCost: 1,
  risk: 1,
  cognitiveCost: 1,
  rationale: large('rationale'),
}
const proposal = (index: number) => ({
  id: `proposal-${index}`,
  targetItemId: null,
  status: 'pending',
  headVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',

  generations: [
    {
      version: 1,
      previousVersion: null,
      baseRevisionId: null,
      suggestedLane: 'inbox',
      assumptions: Array.from({ length: 100 }, (_, value) => large(`assumption-${index}-${value}`)),
      actor: { kind: 'agent', id: 'agent' },
      createdAt: '2026-01-01T00:00:00.000Z',
      draft: {
        title: large(`title-${index}`),
        intent: large(`intent-${index}`),
        scope: Array.from({ length: 100 }, (_, value) => large(`scope-${index}-${value}`)),
        acceptance: Array.from({ length: 100 }, (_, value) => large(`acceptance-${index}-${value}`)),
        sources: [{ kind: 'manual', text: large(`source-${index}`), verification: 'unverified' }],
        estimate,
        reviewAt: null,
      },
    },
  ],
})
const snapshot = (): PlanningBoardSnapshot =>
  ({
    workspaceId: 'workspace',
    version: 1,
    items: [],
    lanes: { inbox: [], now: [], next: [], later: [], parking: [] },
    dependencies: {},
    reviews: [],
    proposals: Array.from({ length: 100 }, (_, index) => proposal(index)),
    handoffs: [],
    events: [],
  }) as PlanningBoardSnapshot
const bytes = (text: string) => Buffer.byteLength(JSON.stringify([{ type: 'text', text }]), 'utf8')

describe('bounded proposal presentation', () => {
  it('finds stable item candidates by their saved source and advances only through matches', () => {
    const board: PlanningBoardSnapshot = {
      ...snapshot(),
      items: ['first', 'second'].map((id, index) => ({
        id,
        headRevisionId: `revision-${id}`,
        disposition: 'active' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        revisions: [
          {
            id: `revision-${id}`,
            previousRevisionId: null,
            title: 'Similar plan',
            intent: 'Keep the discussion',
            scope: [],
            acceptance: [],
            estimate,
            reviewAt: null,
            actorId: 'agent',
            actor: { kind: 'agent' as const, id: 'agent' },
            createdAt: '2026-01-01T00:00:00.000Z',
            sources: [
              {
                kind: 'manual' as const,
                text: index === 0 ? '原始会话的上下文' : '另一个项目讨论',
                verification: 'unverified' as const,
              },
            ],
          },
        ],
      })),
      lanes: { ...snapshot().lanes, next: ['first', 'second'] },
    }
    const result = JSON.parse(renderPlanningList(board, 0, 1, limit, {}, '上下文')) as {
      item_count: number
      match_count: number
      items: { item_id: string; match: { field: string; excerpt: string } }[]
      next_cursor?: number
    }
    expect(result.item_count).toBe(2)
    expect(result.match_count).toBe(1)
    expect(result.items).toMatchObject([{ item_id: 'first', match: { field: 'source', excerpt: '原始会话的上下文' } }])
    expect(result.next_cursor).toBeUndefined()
  })

  it('pages every similar proposal candidate without title-based deduplication', () => {
    const board: PlanningBoardSnapshot = {
      ...snapshot(),
      proposals: [proposal(0), proposal(1)].map(value => ({
        ...value,
        generations: [
          {
            ...value.generations[0]!,
            draft: { ...value.generations[0]!.draft, title: '自动保存想法', intent: '后续继续补充' },
          },
        ],
      })) as PlanningBoardSnapshot['proposals'],
    }
    const first = JSON.parse(renderPlanningProposals(board, 0, 1, limit, {}, '自动')) as {
      match_count: number
      proposals: { proposal_id: string }[]
      next_cursor: number
    }
    const second = JSON.parse(renderPlanningProposals(board, first.next_cursor, 1, limit, {}, '自动')) as {
      proposals: { proposal_id: string }[]
      next_cursor?: number
    }
    expect(first.match_count).toBe(2)
    expect(first.proposals[0]?.proposal_id).toBe('proposal-0')
    expect(second.proposals[0]?.proposal_id).toBe('proposal-1')
    expect(second.next_cursor).toBeUndefined()
  })

  it('includes bounded source markers when similar proposals need disambiguation', () => {
    const board: PlanningBoardSnapshot = {
      ...snapshot(),
      proposals: [proposal(0), proposal(1)].map((value, index) => ({
        ...value,
        generations: [
          {
            ...value.generations[0]!,
            draft: {
              ...value.generations[0]!.draft,
              title: '离线缓存计划',
              intent: '保留相同的离线能力',
              sources: [
                {
                  kind: 'manual' as const,
                  text: index === 0 ? '来自桌面端缓存讨论' : '来自跨会话缓存讨论',
                  verification: 'unverified' as const,
                },
              ],
            },
          },
        ],
      })) as PlanningBoardSnapshot['proposals'],
    }
    const text = renderPlanningProposals(board, 0, 2, limit, {}, '缓存')
    const result = JSON.parse(text) as {
      proposals: {
        proposal_id: string
        source_kinds: string[]
        sources: { kind: string; text: string }[]
        match: { field: string; excerpt: string }
      }[]
    }
    expect(result.proposals).toMatchObject([
      {
        proposal_id: 'proposal-0',
        source_kinds: ['manual'],
        sources: [{ kind: 'manual', text: '来自桌面端缓存讨论' }],
        match: { field: 'title', excerpt: '离线缓存计划' },
      },
      {
        proposal_id: 'proposal-1',
        source_kinds: ['manual'],
        sources: [{ kind: 'manual', text: '来自跨会话缓存讨论' }],
      },
    ])
    expect(bytes(text)).toBeLessThanOrEqual(limit)
  })

  it('rejects a blank or oversized query before inspecting the Board', () => {
    expect(() => parseList({ query: '  ' })).toThrow()
    expect(() => parseList({ query: 'x'.repeat(257) })).toThrow()
    expect(parseList({ query: ' 上下文 ' })).toMatchObject({ query: '上下文' })
  })
  it('returns an identifiable proposal page with a strictly advancing cursor under the complete byte limit', () => {
    const text = renderPlanningProposals(snapshot(), 0, 100, limit)
    const value = JSON.parse(text) as { proposals: { proposal_id: string; truncated: boolean }[]; next_cursor?: number }
    expect(bytes(text)).toBeLessThanOrEqual(limit)
    expect(value.proposals.length).toBeGreaterThan(0)
    expect(value.proposals[0]).toMatchObject({ proposal_id: 'proposal-0', truncated: true })
    expect(value.next_cursor).toBeGreaterThan(0)
  })

  it('marks an oversized overview incomplete and pages every scope entry without a repeated cursor', () => {
    const board = snapshot()
    const overview = JSON.parse(
      renderPlanningProposal(board, 'proposal-0', undefined, 'overview', 0, 20, limit),
    ) as unknown as {
      proposal: { truncated: boolean; available_sections: string[] }
    }
    expect(overview.proposal.truncated).toBe(true)
    expect(overview.proposal.available_sections).toContain('scope')
    expect(overview.proposal.available_sections).toContain('acceptance')
    expect(overview.proposal.available_sections).toContain('sources')
    expect(overview.proposal.available_sections).toContain('assumptions')
    const values: string[] = []
    let cursor = 0
    do {
      const page = JSON.parse(
        renderPlanningProposal(board, 'proposal-0', undefined, 'scope', cursor, 50, limit),
      ) as unknown as {
        values: string[]
        next_cursor?: number
      }
      values.push(...page.values)
      expect(page.next_cursor === undefined || page.next_cursor > cursor).toBe(true)
      cursor = page.next_cursor ?? -1
    } while (cursor >= 0)
    expect(values).toEqual(board.proposals[0]!.generations[0]!.draft.scope)
  })

  it('fits current-user metadata in the complete empty-list wrapper at the minimum budget', () => {
    const metadata = { current_user_source: { kind: 'session-event' as const, sessionId: '会话-1', seq: 1 } }
    const text = renderPlanningList(snapshot(), 0, 1, 256, metadata)
    expect(bytes(text)).toBeLessThanOrEqual(256)
    expect(JSON.parse(text)).toMatchObject(metadata)
  })

  it('accounts for escaped CJK session metadata in the complete wrapper budget', () => {
    const metadata = {
      current_user_source: { kind: 'session-event' as const, sessionId: '会话\\"'.repeat(12), seq: 1 },
    }
    const text = renderPlanningList(snapshot(), 0, 1, 1024, metadata)
    expect(bytes(text)).toBeLessThanOrEqual(1024)
  })

  it('never returns an empty nonterminal item page with its original cursor', () => {
    const board: PlanningBoardSnapshot = {
      ...snapshot(),
      items: [
        {
          id: 'item-1',
          headRevisionId: 'revision-1',
          disposition: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          revisions: [
            {
              id: 'revision-1',
              previousRevisionId: null,
              title: 'x'.repeat(2000),
              intent: 'y'.repeat(2000),
              scope: [],
              acceptance: [],
              sources: [],
              estimate,
              reviewAt: null,
              actorId: 'agent',
              actor: { kind: 'agent', id: 'agent' },
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      ],
      lanes: { inbox: ['item-1'], now: [], next: [], later: [], parking: [] },
    }
    try {
      renderPlanningList(board, 0, 1, 256, {
        current_user_source: { kind: 'session-event', sessionId: '中文\\"'.repeat(10), seq: 1 },
      })
      throw new Error('expected output limit')
    } catch (error) {
      expect(error).toMatchObject({ code: 'PLANNING_OUTPUT_LIMIT' })
    }
  })
})
