// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReviewPanel } from '../src/client/ReviewPanel.tsx'
import { AssessmentDetail } from '../src/client/AssessmentDetail.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { RirRemote, AssessmentView } from '../src/client/face.ts'
import { input } from './fixtures.ts'
afterEach(cleanup)
const view: AssessmentView = { drift: 'unknown', assessment: { ...structuredClone(input), id: 'a1', workspaceId: 'w', mode: 'quick', createdAt: '2026-10-01T00:00:00.000Z', createdBy: { kind: 'human', id: 'operator' } } }
function remote(): RirRemote { return { list: vi.fn(async () => ({ ok: true as const, value: [] })), get: vi.fn(async () => ({ ok: true as const, value: view })), review: vi.fn(async () => ({ ok: true as const, value: view })) } }
it('creates a manual assessment only on a click and renders the actual result without mutation APIs', async () => {
  const api = remote()
  render(<ReviewPanel workspaceId="w" remote={api} t={k => en[k]} />)
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1))
  expect(api.review).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText(en.subject), { target: { value: 'SBC experiment' } })
  fireEvent.change(screen.getByLabelText(en.text), { target: { value: 'A real user claim' } })
  fireEvent.click(screen.getByText(en.review))
  await waitFor(() => expect(screen.getByText(en.raw)).toBeTruthy())
  expect(api.review).toHaveBeenCalledTimes(1)
  const request = vi.mocked(api.review).mock.calls[0]![0]
  expect(request.workspaceId).toBe('w')
  expect(request.subject).toMatchObject({ kind: 'manual', title: 'SBC experiment' })
  expect(request).not.toHaveProperty('actorId')
  expect(request).not.toHaveProperty('baseline')
})
it('cancels on unmount and ignores a late review result', async () => {
  const api = remote(); let complete!: (v: Awaited<ReturnType<RirRemote['review']>>) => void
  api.review = vi.fn(() => new Promise<Awaited<ReturnType<RirRemote['review']>>>(resolve => { complete = resolve }))
  const result = render(<ReviewPanel workspaceId="w" subject={{ kind: 'plan', id: 'p' }} remote={api} t={k => en[k]} />)
  await waitFor(() => expect(api.list).toHaveBeenCalled())
  fireEvent.click(screen.getByText(en.review)); fireEvent.click(screen.getByText(en.pending))
  expect(api.review).toHaveBeenCalledTimes(1)
  const signal = vi.mocked(api.review).mock.calls[0]![1]!
  result.unmount(); expect(signal.aborted).toBe(true)
  complete({ ok: true as const, value: view })
})
it('never reruns stale history automatically, keeps raw historical input and displays failures', async () => {
  const api = remote(); const stale: AssessmentView = { ...view, drift: 'stale' }
  api.list = vi.fn(async () => ({ ok: true as const, value: [stale] }))
  api.review = vi.fn(async () => ({ ok: false as const, error: { code: 'conflict', message: 'explicit retry required' } }))
  render(<ReviewPanel workspaceId="w" remote={api} t={k => zh[k]} />)
  await waitFor(() => expect(screen.getByText(zh.rerun)).toBeTruthy())
  expect(api.review).not.toHaveBeenCalled()
  expect(screen.getAllByText(new RegExp(zh.stale)).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByText(zh.rerun))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('conflict'))
  expect(api.review).toHaveBeenCalledTimes(1)
  expect(vi.mocked(api.review).mock.calls[0]![0].supersedes).toBe('a1')
})
it.each([en, zh])('shows all dimensions, stress tests and advisory allocation without a total', dictionary => {
  render(<AssessmentDetail view={view} t={k => dictionary[k]} />)
  for (const d of view.assessment.evaluation.dimensions) expect(screen.getByText(dictionary[`dimension.${d.dimension}`])).toBeTruthy()
  for (const s of view.assessment.evaluation.stressTests) expect(screen.getByText(dictionary[`stress.${s.kind}`])).toBeTruthy()
  expect(screen.getByText(dictionary.SYSTEM_OWNED)).toBeTruthy()
  expect(screen.getByText(dictionary.MODEL_OWNED)).toBeTruthy()
  expect(screen.getByText(dictionary.EXPERIMENT)).toBeTruthy()
})
