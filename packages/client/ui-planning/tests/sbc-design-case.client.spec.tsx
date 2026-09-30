// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SbcDesignCase } from '../src/client/SbcDesignCase.tsx'
import { zh, type PlanningKey } from '../src/client/locales.ts'
import type { ThinkingRunRecord } from '@changanhua/dsh-planning-remote/types'
const t = (key: PlanningKey): string => ({
  'thinking.agent': '与 Agent 思考', 'thinking.deleteNote': '删除探索建议',
} as Record<string, string>)[key] ?? zh[key]
afterEach(cleanup)
it('shows frozen revision and drift and rearranges without Planning commands', () => {
  const operations: unknown[] = []
  render(<SbcDesignCase state={{ opened: true, pending: false, error: null, view: {
    case: { workspaceId: 'w', subject: { kind: 'plan', id: 'p' }, planId: 'p',
      baseRevision: { id: 'r1', title: 'FC27 SBC', intent: 'Reliable slice', stateEntries: [] } as never,
      version: 2, history: [{ nodeId: 'plan:p', x: 0, y: 0 }],
      local: { positions: { 'plan:p': { x: 40, y: 40 } }, selectedNodeId: 'plan:p' } },
    currentRevision: 'r2', currentFocusVersion: null, drift: true,
  } }} explore={async (operation) => { operations.push(operation) }} refresh={async () => {}} close={() => {}} t={t} />)
  expect(screen.getByText(/r1/)).toBeTruthy()
  expect(screen.getByText(/r2/)).toBeTruthy()
  expect(screen.getByRole('status').textContent).toContain('漂移')
  fireEvent.keyDown(screen.getByRole('button', { name: /FC27 SBC/ }), { key: 'ArrowRight' })
  expect(operations).toEqual([{ kind: 'move', nodeId: 'plan:p', x: 60, y: 40 }])
  fireEvent.click(screen.getByText('撤销移动'))
  expect(operations[1]).toEqual({ kind: 'undo' })
})

it('keeps agent output as an optional case-side candidate panel', () => {
  render(<SbcDesignCase state={{ opened: true, pending: false, error: null, view: {
    case: { workspaceId: 'w', subject: { kind: 'plan', id: 'p' }, planId: 'p',
      baseRevision: { id: 'r1', title: 'FC27 SBC', intent: 'Reliable slice', stateEntries: [] } as never,
      version: 1, history: [], local: { positions: { 'plan:p': { x: 40, y: 40 } }, selectedNodeId: null } },
    currentRevision: 'r1', currentFocusVersion: null, drift: false,
  } }} explore={async () => {}} refresh={async () => {}} close={() => {}} t={t}
  thinking={{
    state: { pending: false, error: null, view: { design: {} as never, designContexts: [], runs: [{
      id: 'run-1', version: 1, sessionId: 'session-1', presetId: 'thinking-desk', question: 'Where should the slice stop?', createdAt: '2026-09-30T00:00:00.000Z',
      subject: { kind: 'plan', id: 'p' }, planningRevisionAtStart: 'r1', caseResource: { kind: 'sbc-case', id: 'case-1' }, caseVersionAtStart: 1, caseBaseRevision: 'r1',
      context: {} as never, reviewSnapshot: { planRevision: 'r1', focuses: [], resourceLinks: [] }, proposalSubmissions: [],
      startup: { phase: 'prompt-accepted', bindRequestId: 'bind-1', promptRequestId: 'prompt-1', promptText: 'Where should the slice stop?', bindCommand: {} as never },
      results: [{ id: 'result-1', version: 1, createdAt: '2026-09-30T00:01:00.000Z', draft: { summary: 'Keep it bounded.', findings: [], openQuestions: [] }, applied: { explorationNoteIds: [] } }],
    } as ThinkingRunRecord] } },
    prepare: async () => true, resume: async () => true, apply: async () => true, submitProposal: async () => true, openSession: () => {},
  }} />)
  expect(screen.getByText('Keep it bounded.')).toBeTruthy()
  expect(screen.getByLabelText('与 Agent 思考')).toBeTruthy()
})

it('renders an applied exploration note on the canvas and removes only that note', () => {
  const operations: unknown[] = []
  render(<SbcDesignCase state={{ opened: true, pending: false, error: null, view: {
    case: { workspaceId: 'w', subject: { kind: 'plan', id: 'p' }, planId: 'p',
      baseRevision: { id: 'r1', title: 'FC27 SBC', intent: 'Reliable slice', stateEntries: [] } as never,
      version: 2, history: [], notes: [{ id: 'note-1', title: 'Inventory proof', body: 'Keep manual confirmation.', sourceResultId: 'result-1', sourceResultVersion: 1, createdAt: '2026-09-30T00:00:00.000Z', position: { x: 80, y: 500 } }],
      local: { positions: { 'plan:p': { x: 40, y: 40 }, 'note-1': { x: 80, y: 500 } }, selectedNodeId: null } },
    currentRevision: 'r1', currentFocusVersion: null, drift: false,
  } }} explore={async (operation) => { operations.push(operation) }} refresh={async () => {}} close={() => {}} t={t} />)
  expect(screen.getByText('Inventory proof')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '删除探索建议：Inventory proof' }))
  expect(operations).toEqual([{ kind: 'delete-note', nodeId: 'note-1' }])
})
