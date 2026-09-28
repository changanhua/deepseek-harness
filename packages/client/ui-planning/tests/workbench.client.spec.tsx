// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { act } from 'react'
import { PlanningWorkbench } from '../src/client/PlanningWorkbench.tsx'
import { PlanningExecution } from '../src/client/PlanningExecution.tsx'
import type { PlanningRuntimeState } from '../src/client/runtime-controller.ts'
import type { PlanningCommand } from '@changanhua/dsh-planning/types'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = (key: keyof typeof zh) => zh[key]
const state: PlanningRuntimeState = {
  evidence: undefined,
  evidenceError: null,
  evidencePending: false,
  execution: undefined,
  executionError: null,
  status: 'ready',
  workspaces: [{ id: 'alpha', title: 'Alpha' }],
  workspaceId: 'alpha',
  board: {
    workspaceId: 'alpha',
    version: 2,
    items: [
      {
        id: 'idea',
        headRevisionId: 'r1',
        disposition: 'active',
        createdAt: '2026-09-27T00:00:00.000Z',
        revisions: [
          {
            id: 'r1',
            previousRevisionId: null,
            title: 'Idea',
            intent: 'Ship it',
            scope: [],
            acceptance: [],
            sources: [{ kind: 'manual', text: 'from a note', verification: 'unverified' }],
            estimate: {
              value: 5,
              urgency: 3,
              reuse: null,
              compounding: null,
              timeCost: 2,
              tokenCost: null,
              risk: null,
              cognitiveCost: null,
              rationale: '',
            },
            reviewAt: null,
            actorId: 'human',
            actor: { kind: 'human', id: 'human' },
            createdAt: '2026-09-27T00:00:00.000Z',
          },
        ],
      },
    ],
    lanes: { inbox: ['idea'], now: [], next: [], later: [], parking: [] },
    dependencies: {},
    reviews: [],
    proposals: [],
    handoffs: [],
    events: [],
    executions: [],
  },
  selectedItemId: undefined,
  error: null,
  actionError: null,
  pending: false,
  retry: undefined,
}

describe('PlanningWorkbench', () => {
  it('shows a newly due review without requiring a manual refresh', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-27T00:00:00.000Z'))
      const current = structuredClone(state)
      Object.assign(current.board!.items[0]!.revisions[0]!, { reviewAt: '2026-09-27T00:00:00.020Z' })
      const mounted = render(
        <PlanningWorkbench
          t={t}
          usePlanning={selector => selector(current)}
          selectWorkspace={vi.fn()}
          selectItem={vi.fn()}
          create={vi.fn()}
          execute={vi.fn()}
          retry={vi.fn()}
          readEvidence={vi.fn()}
        />,
      )
      expect(screen.queryByText(/需要复查/u)).toBeNull()
      act(() => {
        vi.advanceTimersByTime(25)
      })
      expect(screen.getByText(/需要复查/u)).toBeTruthy()
      mounted.unmount()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })
  it('preserves the exact review instant and all existing evidence when adding a note', () => {
    const current = structuredClone(state)
    current.selectedItemId = 'idea'
    const revision = current.board!.items[0]!.revisions[0]!
    const sources = [
      { kind: 'manual' as const, text: 'first note', verification: 'unverified' as const },
      { kind: 'manual' as const, text: 'second note', verification: 'unverified' as const },
      {
        kind: 'link' as const,
        url: 'https://example.com/source',
        label: 'source',
        verification: 'unverified' as const,
      },
    ]
    Object.assign(revision, { reviewAt: '2026-09-27T03:15:26.456Z', sources })
    const execute = vi.fn<(command: PlanningCommand) => Promise<boolean>>().mockResolvedValue(true)
    render(
      <PlanningWorkbench
        t={t}
        usePlanning={selector => selector(current)}
        selectWorkspace={vi.fn()}
        selectItem={vi.fn()}
        create={vi.fn()}
        execute={execute}
        retry={vi.fn()}
        readEvidence={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('记录'), { target: { value: 'additional note' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修订' }))
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewAt: '2026-09-27T03:15:26.456Z',
        sources: [
          { kind: 'manual', text: 'first note' },
          { kind: 'manual', text: 'second note' },
          { kind: 'link', url: 'https://example.com/source', label: 'source' },
          { kind: 'manual', text: 'additional note' },
        ],
      }),
    )
  })

  it('adds one short note as a new revision of the selected plan', async () => {
    const current = structuredClone(state)
    current.selectedItemId = 'idea'
    const execute = vi.fn<(command: PlanningCommand) => Promise<boolean>>().mockResolvedValue(true)
    render(
      <PlanningWorkbench
        t={t}
        usePlanning={selector => selector(current)}
        selectWorkspace={vi.fn()}
        selectItem={vi.fn()}
        create={vi.fn()}
        execute={execute}
        retry={vi.fn()}
        readEvidence={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: '继续补充这条想法' }), { target: { value: '补充一句' } })
    fireEvent.click(screen.getByRole('button', { name: '保存补充' }))
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'revise', itemId: 'idea', expectedRevisionId: 'r1', title: 'Idea', intent: 'Ship it',
      sources: [
        { kind: 'manual', text: 'from a note' },
        { kind: 'manual', text: '补充一句' },
      ],
    }))
    await waitFor(() => { expect(screen.getByRole('status', { name: '' }).textContent).toContain('已保存') })
    expect(screen.getByRole('textbox', { name: '继续补充这条想法' })).toHaveProperty('value', '')
  })

  it('shows captured sources and opens the original session and fixed content version', async () => {
    const current = structuredClone(state)
    current.selectedItemId = 'idea'
    current.board!.items[0]!.revisions[0]!.sources = [
      {
        kind: 'session-event',
        sessionId: 'session-1',
        seq: 3,
        eventType: 'user/message',
        sha256: 'a'.repeat(64),
        excerpt: '原始会话的一句话',
        verification: 'verified',
      },
      {
        kind: 'content',
        entryId: 'entry-1',
        version: 'version-1',
        sha256: 'b'.repeat(64),
        verification: 'captured',
      },
      { kind: 'link', url: 'https://example.com/context', label: '外部讨论', verification: 'unverified' },
    ]
    const openSessionSource = vi.fn()
    const readContentSource = vi.fn().mockResolvedValue({ title: '固定版本标题', body: '冻结版本正文' })
    render(
      <PlanningWorkbench
        t={t}
        usePlanning={selector => selector(current)}
        selectWorkspace={vi.fn()}
        selectItem={vi.fn()}
        create={vi.fn()}
        execute={vi.fn()}
        retry={vi.fn()}
        readEvidence={vi.fn()}
        openSessionSource={openSessionSource}
        readContentSource={readContentSource}
      />,
    )
    expect(screen.getByText('原始会话的一句话')).toBeTruthy()
    expect(screen.getByRole('link', { name: '外部讨论' }).getAttribute('href')).toBe('https://example.com/context')
    fireEvent.click(screen.getByRole('button', { name: '打开原会话' }))
    expect(openSessionSource).toHaveBeenCalledWith('session-1')
    fireEvent.click(screen.getByRole('button', { name: '查看固定版本' }))
    expect(readContentSource).toHaveBeenCalledWith('entry-1', 'version-1', 'alpha', 'b'.repeat(64))
    expect(await screen.findByText('冻结版本正文')).toBeTruthy()
  })

  it('separates similar plans by their source text and selects the stable identity', () => {
    const current = structuredClone(state)
    const second = structuredClone(current.board!.items[0]!)
    second.id = 'other-idea'
    second.headRevisionId = 'r2'
    second.revisions[0]!.id = 'r2'
    second.revisions[0]!.sources = [{ kind: 'manual', text: '另一条相似想法', verification: 'unverified' }]
    current.board!.items[0]!.revisions[0]!.sources = [
      { kind: 'manual', text: '原始会话的补充', verification: 'unverified' },
    ]
    current.board!.items.push(second)
    current.board!.lanes.inbox.push(second.id)
    const selectItem = vi.fn()
    render(
      <PlanningWorkbench
        t={t}
        usePlanning={selector => selector(current)}
        selectWorkspace={vi.fn()}
        selectItem={selectItem}
        create={vi.fn()}
        execute={vi.fn()}
        retry={vi.fn()}
        readEvidence={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByRole('searchbox', { name: '查找计划与想法' }), { target: { value: '原始会话' } })
    expect(screen.getByText('匹配条目: 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Idea' }))
    expect(selectItem).toHaveBeenLastCalledWith('idea')
  })

  it('retries an initial project-list error without requiring a selected project', () => {
    const current = { ...state, status: 'error' as const, workspaceId: undefined, error: 'disconnected' }
    const refresh = vi.fn()
    render(
      <PlanningWorkbench
        t={t}
        usePlanning={selector => selector(current)}
        selectWorkspace={vi.fn()}
        selectItem={vi.fn()}
        create={vi.fn()}
        execute={vi.fn()}
        retry={vi.fn()}
        refresh={refresh}
        readEvidence={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('keeps execution actions hidden when the optional execution composition is absent', () => {
    const current = { ...state, selectedItemId: 'idea', execution: { available: false, handoffs: [] } }
    render(
      <PlanningWorkbench
        t={t}
        usePlanning={selector => selector(current)}
        selectWorkspace={vi.fn()}
        selectItem={vi.fn()}
        create={vi.fn()}
        execute={vi.fn()}
        retry={vi.fn()}
        handoff={vi.fn()}
        readEvidence={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: '准备执行' })).toBeNull()
  })

  it('offers execution preparation when the selected plan has an execution composition', () => {
    const current = { ...state, selectedItemId: 'idea', execution: { available: true, handoffs: [] } }
    const handoff = vi.fn()
    render(
      <PlanningWorkbench
        t={t}
        usePlanning={selector => selector(current)}
        selectWorkspace={vi.fn()}
        selectItem={vi.fn()}
        create={vi.fn()}
        execute={vi.fn()}
        retry={vi.fn()}
        handoff={handoff}
        readEvidence={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '准备执行' }))
    expect(handoff).toHaveBeenCalledOnce()
  })
  it('shows five planning lanes and submits a manual-source idea', async () => {
    const store = createSnapshotStore(state)
    const create = vi.fn().mockResolvedValue(true)
    render(
      <PlanningWorkbench
        t={t}
        usePlanning={selector => selector(store.getSnapshot())}
        selectWorkspace={vi.fn()}
        selectItem={vi.fn()}
        create={create}
        execute={vi.fn()}
        retry={vi.fn()}
        readEvidence={vi.fn()}
      />,
    )
    for (const label of ['收集箱', '现在', '接下来', '稍后', '停放'])
      expect(screen.getByRole('heading', { name: label })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('想法'), { target: { value: 'New idea\nUseful outcome' } })
    fireEvent.click(screen.getByRole('button', { name: '收集想法' }))
    expect(create).toHaveBeenCalledWith({ idea: 'New idea\nUseful outcome', lane: 'inbox' })
  })

  it('keeps conflict visible and exposes explicit retry', () => {
    const store = createSnapshotStore({ ...state, actionError: 'conflict: stale board', retry: async () => true })
    const retry = vi.fn()
    render(
      <PlanningWorkbench
        t={t}
        usePlanning={selector => selector(store.getSnapshot())}
        selectWorkspace={vi.fn()}
        selectItem={vi.fn()}
        create={vi.fn()}
        execute={vi.fn()}
        retry={retry}
        readEvidence={vi.fn()}
      />,
    )
    expect(screen.getByText('conflict: stale board')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('shows due reviews while excluding future reviews, keeps unknown estimates explicit, and leaves manual lanes untouched', () => {
    const current = structuredClone(state)
    current.selectedItemId = 'idea'
    const due = current.board!.items[0]!
    due.revisions[0]!.reviewAt = '2000-01-01T00:00:00.000Z'
    const future = structuredClone(due)
    future.id = 'future'
    future.headRevisionId = 'r2'
    future.revisions = [
      { ...due.revisions[0]!, id: 'r2', title: 'Future review', reviewAt: '2999-01-01T00:00:00.000Z' },
    ]
    const complete = structuredClone(due)
    complete.id = 'complete'
    complete.headRevisionId = 'r3'
    complete.revisions = [
      {
        ...due.revisions[0]!,
        id: 'r3',
        title: 'High priority',
        reviewAt: null,
        estimate: {
          value: 5,
          urgency: 5,
          reuse: 5,
          compounding: 5,
          timeCost: 0,
          tokenCost: 0,
          risk: 0,
          cognitiveCost: 0,
          rationale: 'clear',
        },
      },
    ]
    current.board!.items.push(future, complete)
    current.board!.lanes.inbox.push('future', 'complete')
    const originalOrder = [...current.board!.lanes.inbox]
    render(
      <PlanningWorkbench
        t={t}
        usePlanning={selector => selector(current)}
        selectWorkspace={vi.fn()}
        selectItem={vi.fn()}
        create={vi.fn()}
        execute={vi.fn()}
        retry={vi.fn()}
        readEvidence={vi.fn()}
      />,
    )
    expect(screen.getByText('需要复查：')).toBeTruthy()
    const dueNotice = screen.getByText('需要复查：').parentElement!
    expect(dueNotice.textContent).toContain('Idea')
    expect(dueNotice.textContent).not.toContain('Future review')
    expect(screen.getByText(/复用：待评估/)).toBeTruthy()
    expect(screen.getByText('建议排序')).toBeTruthy()
    expect(current.board!.lanes.inbox).toEqual(originalOrder)
  })

  it('links a review only to another existing plan and never to itself', () => {
    const other = {
      ...structuredClone(state.board!.items[0]!),
      id: 'other',
      headRevisionId: 'r2',
      revisions: [{ ...structuredClone(state.board!.items[0]!.revisions[0]!), id: 'r2', title: 'Follow-up target' }],
    }
    const store = createSnapshotStore({
      ...state,
      selectedItemId: 'idea',
      board: {
        ...state.board!,
        items: [state.board!.items[0]!, other],
        lanes: { ...state.board!.lanes, next: ['other'] },
        reviews: [
          {
            id: 'review-1',
            itemId: 'idea',
            revisionId: 'r1',
            outcome: 'learned' as const,
            summary: 'lesson',
            lessons: ['keep the evidence'],
            followUpItemIds: ['other'],
            acceptanceRef: null,
            createdAt: '2026-09-27T00:00:00.000Z',
          },
        ],
      },
    })
    const submitted: PlanningCommand[] = []
    const execute = vi.fn((command: PlanningCommand) => {
      submitted.push(command)
      return Promise.resolve(true)
    })
    render(
      <PlanningWorkbench
        t={t}
        usePlanning={selector => selector(store.getSnapshot())}
        selectWorkspace={vi.fn()}
        selectItem={vi.fn()}
        create={vi.fn()}
        execute={execute}
        retry={vi.fn()}
        readEvidence={vi.fn()}
      />,
    )
    expect(screen.getByText('lesson')).toBeTruthy()
    expect(screen.getByText('keep the evidence')).toBeTruthy()
    expect(screen.getAllByText('Follow-up target').length).toBeGreaterThan(1)
    const picker = screen.getByLabelText('关联到已有计划') as HTMLSelectElement
    expect(Array.from(picker.options).map(option => option.value)).not.toContain('idea')
    fireEvent.change(picker, { target: { value: 'other' } })
    fireEvent.click(screen.getByRole('button', { name: '关联后续项' }))
    expect(submitted[0]).toMatchObject({
      kind: 'follow-up',
      reviewId: 'review-1',
      itemId: 'other',
      expectedBoardVersion: 2,
    })
    expect(typeof submitted[0]?.requestId).toBe('string')
  })

  it('moves the selected plan to every declared lane through the lane picker', () => {
    const store = createSnapshotStore({ ...state, selectedItemId: 'idea' })
    const execute = vi.fn().mockResolvedValue(true)
    render(
      <PlanningWorkbench
        t={t}
        usePlanning={selector => selector(store.getSnapshot())}
        selectWorkspace={vi.fn()}
        selectItem={vi.fn()}
        create={vi.fn()}
        execute={execute}
        retry={vi.fn()}
        readEvidence={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('移动到'), { target: { value: 'parking' } })
    fireEvent.click(screen.getByRole('button', { name: '移动计划' }))
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ kind: 'move', lane: 'parking', beforeItemId: null }))
  })

  it('shows identifiable proposal sources and opens their original records', async () => {
    const proposal = {
      id: 'proposal-1',
      targetItemId: 'idea',
      status: 'pending' as const,
      headVersion: 2,
      createdAt: '2026-09-27T00:00:00.000Z',
      generations: [
        {
          version: 2,
          previousVersion: 1,
          baseRevisionId: 'r1',
          suggestedLane: 'next' as const,
          assumptions: ['needs review'],
          actor: { kind: 'agent' as const, id: 'agent-1' },
          createdAt: '2026-09-27T00:00:00.000Z',
          draft: {
            title: 'Suggested idea',
            intent: 'Improve it',
            scope: [],
            acceptance: [],
            sources: [
              { kind: 'manual' as const, text: 'draft from the planning discussion', verification: 'unverified' as const },
              {
                kind: 'session-event' as const,
                sessionId: 'session-proposal',
                seq: 7,
                excerpt: '原会话中的可识别摘录',
                verification: 'verified' as const,
              },
              {
                kind: 'content' as const,
                entryId: 'content-proposal',
                version: 'version-proposal',
                sha256: 'a'.repeat(64),
                verification: 'verified' as const,
              },
            ],
            estimate: state.board!.items[0]!.revisions[0]!.estimate,
            reviewAt: null,
          },
        },
      ],
    }
    const execute = vi.fn().mockResolvedValue(true)
    const openSessionSource = vi.fn()
    const readContentSource = vi.fn().mockResolvedValue({ title: '冻结草稿原文', body: '不可变版本正文' })
    const store = createSnapshotStore({ ...state, board: { ...state.board!, proposals: [proposal] } })
    render(
      <PlanningWorkbench
        t={t}
        usePlanning={selector => selector(store.getSnapshot())}
        selectWorkspace={vi.fn()}
        selectItem={vi.fn()}
        create={vi.fn()}
        execute={execute}
        retry={vi.fn()}
        readEvidence={vi.fn()}
        openSessionSource={openSessionSource}
        readContentSource={readContentSource}
      />,
    )
    expect(screen.getByText(/Idea → 建议: Suggested idea/)).toBeTruthy()
    expect(screen.getByText('draft from the planning discussion')).toBeTruthy()
    expect(screen.getByText('原会话中的可识别摘录')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '打开原会话' }))
    expect(openSessionSource).toHaveBeenCalledWith('session-proposal')
    fireEvent.click(screen.getByRole('button', { name: '查看固定版本' }))
    await waitFor(() => {
      expect(readContentSource).toHaveBeenCalledWith(
        'content-proposal',
        'version-proposal',
        'alpha',
        'a'.repeat(64),
      )
    })
    expect(await screen.findByText('不可变版本正文')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '采纳草稿' }))
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'accept-proposal', proposalId: 'proposal-1', expectedProposalVersion: 2 }),
    )
  })

  it('keeps a stale proposal visible, disables acceptance, and permits dismissal', () => {
    const proposal = {
      id: 'proposal-stale',
      targetItemId: 'idea',
      status: 'pending' as const,
      headVersion: 1,
      createdAt: '2026-09-27T00:00:00.000Z',
      generations: [
        {
          version: 1,
          previousVersion: null,
          baseRevisionId: 'r1',
          suggestedLane: 'next' as const,
          assumptions: [],
          actor: { kind: 'agent' as const, id: 'agent-1' },
          createdAt: '2026-09-27T00:00:00.000Z',
          draft: {
            title: 'Stale suggestion',
            intent: 'Improve it',
            scope: [],
            acceptance: [],
            sources: [{ kind: 'manual' as const, text: 'note', verification: 'unverified' as const }],
            estimate: state.board!.items[0]!.revisions[0]!.estimate,
            reviewAt: null,
          },
        },
      ],
    }
    const execute = vi.fn().mockResolvedValue(true)
    const old = state.board!.items[0]!.revisions[0]!
    const store = createSnapshotStore({
      ...state,
      board: {
        ...state.board!,
        items: [
          {
            ...state.board!.items[0]!,
            headRevisionId: 'r2',
            revisions: [old, { ...old, id: 'r2', previousRevisionId: 'r1', title: 'New head' }],
          },
        ],
        proposals: [proposal],
      },
    })
    render(
      <PlanningWorkbench
        t={t}
        usePlanning={selector => selector(store.getSnapshot())}
        selectWorkspace={vi.fn()}
        selectItem={vi.fn()}
        create={vi.fn()}
        execute={execute}
        retry={vi.fn()}
        readEvidence={vi.fn()}
      />,
    )
    expect(screen.getByText('草稿基于旧版本；请重新检查后再提交新的建议。')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '采纳草稿' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '忽略草稿' }))
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'dismiss-proposal', proposalId: 'proposal-stale', expectedProposalVersion: 1 }),
    )
  })

  it('does not suggest a review for a linked Delivery Case that is still shaping', () => {
    const current = structuredClone(state)
    current.board = {
      ...current.board!,
      executions: [{ itemId: 'idea', revisionId: 'r1', caseId: 'case-1', stage: 'shaping', reviewSuggested: false }],
    }
    render(
      <PlanningWorkbench
        t={t}
        usePlanning={selector => selector(current)}
        selectWorkspace={vi.fn()}
        selectItem={vi.fn()}
        create={vi.fn()}
        execute={vi.fn()}
        retry={vi.fn()}
        readEvidence={vi.fn()}
      />,
    )
    expect(screen.queryByText('已有执行结果待复盘对应计划版本')).toBeNull()
  })

  it('keeps an accepted older revision in the review reminder until that exact revision is reviewed', () => {
    const current = structuredClone(state)
    const first = current.board!.items[0]!.revisions[0]!
    current.board!.items[0]!.headRevisionId = 'r2'
    current.board!.items[0]!.revisions.push({ ...first, id: 'r2', previousRevisionId: 'r1', title: 'Current revision' })
    current.board = {
      ...current.board!,
      executions: [{ itemId: 'idea', revisionId: 'r1', caseId: 'case-1', stage: 'accepted', reviewSuggested: true }],
    }
    render(
      <PlanningWorkbench
        t={t}
        usePlanning={selector => selector(current)}
        selectWorkspace={vi.fn()}
        selectItem={vi.fn()}
        create={vi.fn()}
        execute={vi.fn()}
        retry={vi.fn()}
        readEvidence={vi.fn()}
      />,
    )
    expect(screen.getByText(/已有执行结果待复盘对应计划版本/).parentElement?.textContent).toContain('Idea')
  })

  it('does not treat a forged acceptance reference as Delivery acceptance and records completed review separately', () => {
    const current = structuredClone(state)
    const dependency = {
      ...structuredClone(current.board!.items[0]!),
      id: 'dependency',
      headRevisionId: 'd1',
      revisions: [{ ...structuredClone(current.board!.items[0]!.revisions[0]!), id: 'd1', title: 'Dependency' }],
    }
    current.board!.items.push(dependency)
    current.board!.lanes.next.push('dependency')
    current.board!.dependencies.idea = ['dependency']
    current.board!.reviews.push({
      id: 'forged',
      itemId: 'dependency',
      revisionId: 'd1',
      outcome: 'completed',
      summary: 'done',
      lessons: [],
      followUpItemIds: [],
      acceptanceRef: 'not-delivery-evidence',
      createdAt: '2026-09-27T00:00:00.000Z',
    })
    render(
      <PlanningWorkbench
        t={t}
        usePlanning={selector => selector({ ...current, selectedItemId: 'idea' })}
        selectWorkspace={vi.fn()}
        selectItem={vi.fn()}
        create={vi.fn()}
        execute={vi.fn()}
        retry={vi.fn()}
        readEvidence={vi.fn()}
      />,
    )
    expect(screen.getByText(/Dependency：已记录完成复盘/)).toBeTruthy()
    expect(screen.queryByText(/人工验收通过/)).toBeNull()
  })

  it('submits a review for a selected immutable older revision instead of the current head', () => {
    const current = structuredClone(state)
    const first = current.board!.items[0]!.revisions[0]!
    current.board!.items[0]!.headRevisionId = 'r2'
    current.board!.items[0]!.revisions.push({ ...first, id: 'r2', previousRevisionId: 'r1', title: 'Current revision' })
    const execute = vi.fn().mockResolvedValue(true)
    render(
      <PlanningWorkbench
        t={t}
        usePlanning={selector => selector({ ...current, selectedItemId: 'idea' })}
        selectWorkspace={vi.fn()}
        selectItem={vi.fn()}
        create={vi.fn()}
        execute={execute}
        retry={vi.fn()}
        readEvidence={vi.fn()}
      />,
    )
    fireEvent.click(screen.getAllByText('保存复盘')[0]!)
    fireEvent.change(screen.getByLabelText('复盘目标版本'), { target: { value: 'r1' } })
    fireEvent.change(screen.getByLabelText('复盘摘要'), { target: { value: 'review the original execution' } })
    fireEvent.click(screen.getByRole('button', { name: '保存复盘' }))
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'review', itemId: 'idea', expectedRevisionId: 'r1' }),
    )
  })

  it('clears review text when its target revision or selected plan changes', () => {
    const current = structuredClone(state)
    const first = current.board!.items[0]!.revisions[0]!
    current.board!.items[0]!.headRevisionId = 'r2'
    current.board!.items[0]!.revisions.push({ ...first, id: 'r2', previousRevisionId: 'r1', title: 'Current revision' })
    const other = {
      ...structuredClone(current.board!.items[0]!),
      id: 'other',
      headRevisionId: 'r3',
      revisions: [{ ...first, id: 'r3', title: 'Other plan' }],
    }
    current.board!.items.push(other)
    current.board!.lanes.next.push('other')
    const props = {
      t,
      selectWorkspace: vi.fn(),
      selectItem: vi.fn(),
      create: vi.fn(),
      execute: vi.fn(),
      retry: vi.fn(),
      readEvidence: vi.fn(),
    }
    const mounted = render(
      <PlanningWorkbench {...props} usePlanning={selector => selector({ ...current, selectedItemId: 'idea' })} />,
    )
    fireEvent.click(screen.getAllByText('保存复盘')[0]!)
    fireEvent.change(screen.getByLabelText('复盘摘要'), { target: { value: 'old revision notes' } })
    fireEvent.change(screen.getByLabelText('复盘目标版本'), { target: { value: 'r1' } })
    expect(screen.getByLabelText<HTMLTextAreaElement>('复盘摘要').value).toBe('')
    fireEvent.change(screen.getByLabelText('复盘摘要'), { target: { value: 'other plan notes' } })
    mounted.rerender(
      <PlanningWorkbench {...props} usePlanning={selector => selector({ ...current, selectedItemId: 'other' })} />,
    )
    expect(screen.getByLabelText<HTMLTextAreaElement>('复盘摘要').value).toBe('')
  })

  it('renders text evidence as inert text instead of HTML', () => {
    const body = '<img src=x onerror=alert(1)>'
    render(
      <PlanningExecution
        t={t}
        revisionId="r1"
        evidence={
          {
            id: 'e1',
            digest: 'sha256:test',
            mediaType: 'text/plain',
            provenance: { kind: 'test' },
            contentBase64: btoa(body),
          } as never
        }
        evidenceError={null}
        evidencePending={false}
        onReadEvidence={vi.fn()}
        view={
          {
            available: true,
            handoffs: [
              {
                handoff: { key: 'h', phase: 'linked', revisionId: 'r1' },
                case: { headRevision: { title: 'Case' }, lane: 'accepted', readiness: { reasons: [] }, packets: [] },
              },
            ],
          } as never
        }
      />,
    )
    expect(screen.getByText(body)).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })
})
