// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PlanningWorkbench } from '../src/client/PlanningWorkbench.tsx'
import { zh } from '../src/client/locales.ts'
import type { PlanningRuntimeState } from '../src/client/runtime-controller.ts'

afterEach(cleanup)
const initial = (): PlanningRuntimeState => ({
  status: 'ready', workspaces: [{ id: 'w', title: 'Project' }], workspaceId: 'w', selectedItemId: undefined,
  error: null, actionError: null, pending: false, retry: undefined, execution: undefined, executionError: null,
  evidence: undefined, evidenceError: null, evidencePending: false,
  board: { workspaceId: 'w', version: 1, lanes: { inbox: [], now: ['p'], next: [], later: [], parking: [] },
    dependencies: {}, reviews: [], proposals: [], handoffs: [], events: [], executions: [],
    items: [{ id: 'p', disposition: 'active', headRevisionId: 'r1', createdAt: '2026-09-30T00:00:00Z', revisions: [{
      id: 'r1', previousRevisionId: null, title: 'Architecture design', intent: 'Keep decisions traceable',
      stateEntries: [{ id: 'a', kind: 'accepted', content: 'Canonical decision' }], scope: [], acceptance: [],
      sources: [{ kind: 'manual', text: 'Source note', verification: 'unverified' }], reviewAt: null,
      actorId: 'human', actor: { kind: 'human', id: 'human' }, createdAt: '2026-09-30T00:00:00Z',
      estimate: { value: null, urgency: null, reuse: null, compounding: null, timeCost: null, tokenCost: null,
        risk: null, cognitiveCost: null, rationale: '' },
    }] }],
  },
})
function mount(state: PlanningRuntimeState, extra: Record<string, unknown> = {}) {
  return render(<PlanningWorkbench usePlanning={select => select(state)} t={key => zh[key]}
    selectWorkspace={vi.fn()} selectItem={vi.fn()} create={vi.fn()} execute={vi.fn()} retry={vi.fn()}
    readEvidence={vi.fn()} {...extra} />)
}
it('shows Overview instead of canonical editing until a Plan is opened', () => {
  mount(initial())
  expect(screen.getByRole('tab', { name: '当前计划' })).toBeTruthy()
  expect(screen.getByRole('tab', { name: '想法收集箱' })).toBeTruthy()
  expect(screen.getByRole('tab', { name: /待我确认/u })).toBeTruthy()
  expect(screen.getByRole('tab', { name: '已归档' })).toBeTruthy()
  expect(screen.queryByText('Canonical decision')).toBeNull()
  expect(screen.queryByRole('textbox', { name: '状态内容' })).toBeNull()
})
it('separates canonical state, native work, exploration entry and history on one Plan', () => {
  const state = initial(); state.selectedItemId = 'p'
  mount(state)
  expect(screen.getByRole('tab', { name: '当前状态' })).toBeTruthy()
  expect(screen.getByRole('tab', { name: '工作与讨论' })).toBeTruthy()
  expect(screen.getByRole('tab', { name: '思考桌面' })).toBeTruthy()
  expect(screen.getByRole('tab', { name: '历史与来源' })).toBeTruthy()
  expect(screen.getByText('Canonical decision')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: '思考桌面' }))
  expect(screen.getByText('Canonical decision')).toBeTruthy()
  expect(screen.getByText('暂无设计案例')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /SBC/u })).toBeNull()
})
it('continues the exact subject Session without creating or rebinding one', () => {
  const state = initial(); state.selectedItemId = 'p'
  state.board!.sessionBindings = [{ sessionId: 's1', subject: { kind: 'plan', id: 'p' }, baseRevision: 'r0', createdAt: '2026-09-29T00:00:00Z' }]
  const openSessionSource = vi.fn(); const startPlanningSession = vi.fn()
  mount(state, { openSessionSource, startPlanningSession })
  fireEvent.click(screen.getByRole('button', { name: '继续推进' }))
  expect(openSessionSource).toHaveBeenCalledWith('s1')
  expect(startPlanningSession).not.toHaveBeenCalled()
  expect(state.board!.sessionBindings[0]!.baseRevision).toBe('r0')
})

it('retains a selected Focus across tabs and continues only its bound Session', () => {
  const state = initial(); state.selectedItemId = 'p'
  state.board!.focuses = [{ id: 'f', planId: 'p', title: 'Boundary review', status: 'active', version: 1,
    createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-09-30T00:00:00Z' }]
  state.board!.sessionBindings = [
    { sessionId: 'plan-session', subject: { kind: 'plan', id: 'p' }, baseRevision: 'r1', createdAt: '2026-09-30T01:00:00Z' },
    { sessionId: 'focus-session', subject: { kind: 'focus', id: 'f' }, baseRevision: 'r0', createdAt: '2026-09-29T00:00:00Z' },
  ]
  const openSessionSource = vi.fn(); const startPlanningSession = vi.fn()
  mount(state, { openSessionSource, startPlanningSession })
  fireEvent.change(screen.getByRole('combobox', { name: 'Focus' }), { target: { value: 'f' } })
  fireEvent.click(screen.getByRole('tab', { name: '工作与讨论' }))
  expect(screen.getByRole('button', { name: 'focus-session' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'plan-session' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '继续推进' }))
  expect(openSessionSource).toHaveBeenCalledWith('focus-session')
  expect(startPlanningSession).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('tab', { name: '当前状态' }))
  expect(screen.getByRole('combobox', { name: 'Focus' })).toHaveProperty('value', 'f')
})

it('opens a non-FC27 summary through its generic owner reference and shows drift', () => {
  const state = initial(); state.selectedItemId = 'p'
  const summary = { resource: { kind: 'design-case', id: 'architecture-case', provider: 'architecture' },
    title: 'Transport alternatives', preview: 'Compare two routes', subjectRef: { kind: 'plan' as const, id: 'p' },
    baseRevision: 'r0', currentRevision: 'r1', drift: true, status: 'exploration' as const }
  state.designCases = { status: 'ready', summaries: [summary], error: null }
  const openDesignCase = vi.fn(); mount(state, { openDesignCase })
  fireEvent.click(screen.getByRole('tab', { name: '思考桌面' }))
  expect(screen.getByRole('heading', { name: 'Transport alternatives' })).toBeTruthy()
  expect(screen.getByText(/存在版本漂移/u)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '打开设计' }))
  expect(openDesignCase).toHaveBeenCalledWith(summary)
})
