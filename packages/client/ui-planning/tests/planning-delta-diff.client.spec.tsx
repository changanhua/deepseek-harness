// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PlanningDeltaDiff } from '../src/client/PlanningDeltaDiff.tsx'

it('renders immutable entry, focus, and resource relationship differences for one exact generation', () => {
  const rendered = render(
    <PlanningDeltaDiff
      delta={{
        subject: { kind: 'plan', id: 'plan-1' },
        baseRevision: 'revision-7',
        originRef: { kind: 'thinking-result', id: 'result-3', label: 'Thinking result' },
        evidenceRefs: [{ kind: 'session', id: 'session-7', label: 'Session evidence' }],
        operations: [
          { kind: 'remove-state-entry', id: 'old-entry' },
          { kind: 'update-state-entry', entry: { id: 'changed-entry', kind: 'accepted', content: 'New decision', sourceRefs: [{ kind: 'note', id: 'new-note' }] } },
          { kind: 'update-focus', id: 'focus-1', expectedVersion: 4, objective: 'New objective', status: 'active' },
          { kind: 'remove-resource-link', id: 'link-1' },
        ],
      }}
      baseRevision={{
        id: 'revision-7',
        stateEntries: [
          { id: 'old-entry', kind: 'open', content: 'Full deleted question', sourceRefs: [{ kind: 'note', id: 'old-note', label: 'Old note' }] },
          { id: 'changed-entry', kind: 'objective', content: 'Old decision' },
        ],
      }}
      reviewSnapshot={{
        planRevision: 'revision-7',
        focuses: [{ id: 'focus-1', planId: 'plan-1', title: 'Existing focus', objective: 'Old objective', status: 'open', version: 4, createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z' }],
        resourceLinks: [{ id: 'link-1', subject: { kind: 'plan', id: 'plan-1' }, resource: { kind: 'document', id: 'doc-1', label: 'Design brief' }, role: 'evidence', createdAt: '2026-09-30T00:00:00.000Z' }],
      }}
    />,
  )

  expect(screen.getByText('完整 delta 差异')).toBeTruthy()
  expect(rendered.container.textContent).toContain('Full deleted question')
  expect(rendered.container.textContent).toContain('open → 已删除')
  expect(rendered.container.textContent).toContain('objective → accepted')
  expect(rendered.container.textContent).toContain('Old decision')
  expect(rendered.container.textContent).toContain('New decision')
  expect(rendered.container.textContent).toContain('Old objective')
  expect(rendered.container.textContent).toContain('New objective')
  expect(rendered.container.textContent).toContain('expectedVersion: 4')
  expect(rendered.container.textContent).toContain('Design brief')
  expect(rendered.container.textContent).toContain('plan / plan-1')
  expect(rendered.container.textContent).toContain('Thinking result')
  expect(rendered.container.textContent).toContain('Session evidence')
})

it('does not use a stale current board snapshot as an exact base and reports incomplete review', () => {
  render(
    <PlanningDeltaDiff
      delta={{
        subject: { kind: 'focus', id: 'focus-1' },
        baseRevision: 'revision-1',
        originRef: { kind: 'thinking-result', id: 'result-1' },
        operations: [{ kind: 'update-focus', id: 'focus-1', expectedVersion: 1, objective: 'Candidate objective' }],
      }}
      currentReviewSnapshot={{
        planRevision: 'revision-2',
        focuses: [{ id: 'focus-1', planId: 'plan-1', title: 'Current focus', objective: 'Incorrect current objective', status: 'done', version: 9, createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z' }],
        resourceLinks: [],
      }}
      stale
    />,
  )

  expect(screen.getByRole('alert').textContent).toContain('缺少该精确代次的前值')
  expect(screen.queryByText('Incorrect current objective')).toBeNull()
  expect(screen.getByText(/不可采纳/u)).toBeTruthy()
})
