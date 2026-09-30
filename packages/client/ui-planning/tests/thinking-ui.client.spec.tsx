// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ThinkingLauncher } from '../src/client/ThinkingLauncher.tsx'
import { ThinkingResultPanel } from '../src/client/ThinkingResultPanel.tsx'
import { DesignContextList } from '../src/client/DesignContextList.tsx'
import type { PlanningKey } from '../src/client/locales.ts'
import type { ThinkingRunRecord } from '@changanhua/dsh-planning-remote/types'

afterEach(cleanup)
const t = (key: PlanningKey): string => ({
  'thinking.question': '你想推进什么？', 'thinking.start': '开始思考', 'thinking.applyNotes': '应用到思考桌面',
  'thinking.saveContext': '保存设计上下文', 'thinking.submitProposal': '提交 Planning 提议',
  'thinking.acknowledgeStale': '我已查看过期提示，仍应用该候选', 'thinking.savedNotes': '探索建议已保存',
  'thinking.savedContext': '设计上下文已保存', 'thinking.submittedProposal': 'Planning 提议已提交',
} as Record<string, string>)[key] ?? key

const run: ThinkingRunRecord = {
  id: 'run-1', version: 2, sessionId: 'session-1', presetId: 'thinking-desk', question: 'Where should the first slice stop?',
  createdAt: '2026-09-30T00:00:00.000Z', subject: { kind: 'plan' as const, id: 'plan-1' }, planningRevisionAtStart: 'r1',
  caseResource: { kind: 'sbc-case', id: 'case-1' }, caseVersionAtStart: 1, caseBaseRevision: 'r1',
  context: {} as never, reviewSnapshot: { planRevision: 'r1', focuses: [], resourceLinks: [] }, proposalSubmissions: [],
  startup: { phase: 'prompt-accepted', bindRequestId: 'bind-1', promptRequestId: 'prompt-1', promptText: 'Where should the first slice stop?', bindCommand: {} as never },
  results: [{
    id: 'result-1', version: 1, createdAt: '2026-09-30T00:01:00.000Z',
    draft: { summary: 'Keep the first slice bounded.', findings: ['Verify inventory before a solver.'], openQuestions: ['Which proof is sufficient?'], explorationNotes: [{ title: 'Inventory proof', body: 'Manual confirmation boundary.' }], designContext: { title: 'Boundary', body: 'Do not automate purchase.' }, planningDelta: { operations: [{ kind: 'add-state-entry', entry: { id: 'entry-1', kind: 'accepted', content: 'Keep manual confirmation.' } }], rationale: 'The first slice proves inventory before automation.' } },
    applied: { explorationNoteIds: [] },
  }],
}

it('starts one explicitly asked Thinking run from a non-empty question', async () => {
  const prepare = vi.fn().mockResolvedValue(true)
  render(<ThinkingLauncher pending={false} error={null} prepare={prepare} t={t} />)
  const question = screen.getByLabelText('你想推进什么？')
  fireEvent.change(question, { target: { value: '  Define the first slice  ' } })
  fireEvent.click(screen.getByRole('button', { name: '开始思考' }))
  await vi.waitFor(() => expect(prepare).toHaveBeenCalledWith('Define the first slice'))
})

it('allows notes, context, and proposal in order after acknowledging a case-only stale result', async () => {
  const apply = vi.fn().mockResolvedValue(true)
  const submit = vi.fn().mockResolvedValue(true)
  const mounted = render(<ThinkingResultPanel runs={[run]} currentCaseVersion={2} currentPlanningRevision="r1" pending={false} error={null}
    apply={apply} submitProposal={submit} openSession={vi.fn()} resume={vi.fn()} t={t} />)

  expect(screen.getByText('Keep the first slice bounded.')).toBeTruthy()
  expect(screen.getByText('Inventory proof')).toBeTruthy()
  expect(screen.getByText('Manual confirmation boundary.')).toBeTruthy()
  expect(screen.getByText('Boundary')).toBeTruthy()
  expect(screen.getByText('Do not automate purchase.')).toBeTruthy()
  expect(screen.getByText(/Keep manual confirmation\./u)).toBeTruthy()
  expect(screen.getByText('The first slice proves inventory before automation.')).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toContain('thinking.staleCase')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '应用到思考桌面' }).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText('我已查看过期提示，仍应用该候选'))
  fireEvent.click(screen.getByRole('button', { name: '应用到思考桌面' }))
  await vi.waitFor(() => expect(apply).toHaveBeenCalledWith('run-1', 'result-1', 1, 'notes', true))
  fireEvent.click(screen.getByRole('button', { name: '保存设计上下文' }))
  await vi.waitFor(() => expect(apply).toHaveBeenCalledWith('run-1', 'result-1', 1, 'context', true))
  const result = run.results[0]!
  mounted.rerender(<ThinkingResultPanel runs={[{ ...run, version: 3, results: [{ ...result, applied: { explorationNoteIds: ['note-1'], designContextId: 'context-1' } }] }]} currentCaseVersion={3} currentPlanningRevision="r1" pending={false} error={null}
    apply={apply} submitProposal={submit} openSession={vi.fn()} resume={vi.fn()} t={t} />)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '提交 Planning 提议' }).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText('我已查看过期提示，仍应用该候选'))
  fireEvent.click(screen.getByRole('button', { name: '提交 Planning 提议' }))
  await vi.waitFor(() => expect(submit).toHaveBeenCalledWith('run-1', 'result-1', 1))
})

it('marks already applied candidates as settled and disables their actions', () => {
  const applied: ThinkingRunRecord = { ...run, results: [{ ...run.results[0]!, applied: { explorationNoteIds: ['note-1'], designContextId: 'context-1', planningProposalId: 'proposal-1' } }] }
  render(<ThinkingResultPanel runs={[applied]} currentCaseVersion={1} currentPlanningRevision="r1" pending={false} error={null}
    apply={vi.fn()} submitProposal={vi.fn()} openSession={vi.fn()} resume={vi.fn()} t={t} />)
  expect(screen.getByText('探索建议已保存')).toBeTruthy()
  expect(screen.getByText('设计上下文已保存')).toBeTruthy()
  expect(screen.getByText('Planning 提议已提交')).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '应用到思考桌面' }).disabled).toBe(true)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存设计上下文' }).disabled).toBe(true)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '提交 Planning 提议' }).disabled).toBe(true)
})

it('shows durable design context separately from the transient result', () => {
  render(<DesignContextList t={t} contexts={[{ id: 'context-1', title: 'Boundary', body: 'Do not automate purchase.', sourceRunId: 'run-1', sourceSessionId: 'session-1', sourceResultId: 'result-1', sourceResultVersion: 1, caseVersionAtCreation: 1, planningRevisionAtCreation: 'r1', createdAt: '2026-09-30T00:00:00.000Z' }]} />)
  expect(screen.getByText('Boundary')).toBeTruthy()
  expect(screen.getByText('Do not automate purchase.')).toBeTruthy()
  expect(screen.getByText(/r1/)).toBeTruthy()
})
