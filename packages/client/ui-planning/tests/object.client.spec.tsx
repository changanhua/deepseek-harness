// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PlanningObject } from '../src/client/PlanningObject.tsx'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
it('starts work on the whole plan without requiring a focus and displays its exact revision', () => {
  const start = vi.fn()
  render(<PlanningObject board={{ workspaceId: 'w', version: 0, items: [], proposals: [], reviews: [], handoffs: [], events: [],
    lanes: { inbox: [], now: [], next: [], later: [], parking: [] }, dependencies: {} }} planId="p"
  revision={{ id: 'r12', title: 'SBC', stateEntries: [{ id: 's', kind: 'accepted', content: 'Manual Submit approval' }] } as never}
  mode="work" pending={false} execute={vi.fn()} startSession={start} openSession={vi.fn()} t={key => zh[key]} />)
  fireEvent.click(screen.getByText('启动会话'))
  expect(start).toHaveBeenCalledWith({ kind: 'plan', id: 'p' }, 'r12')
})

it('delegates the selected plan while preserving the ordinary discussion entry', async () => {
  const start = vi.fn().mockResolvedValue(undefined)
  render(<PlanningObject board={{ workspaceId: 'w', version: 0, items: [], proposals: [], reviews: [], handoffs: [], events: [],
    lanes: { inbox: [], now: [], next: [], later: [], parking: [] }, dependencies: {} }} planId="p"
  revision={{ id: 'r12', title: 'Reduce project coordination effort', stateEntries: [] } as never}
  mode="work" pending={false} execute={vi.fn()} startSession={start} t={key => zh[key]} />)
  expect(screen.getByRole('button', { name: '启动会话' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '委托主理' }))
  await waitFor(() =>{  expect(start).toHaveBeenCalledWith({ kind: 'plan', id: 'p' }, 'r12', 'steward') })
})

it('exposes only the selected subject to optional actions without writing Planning', () => {
  const execute = vi.fn()
  const renderActions = vi.fn((subject: { kind: string; id: string }) => <button>{subject.id}</button>)
  render(<PlanningObject board={{ workspaceId: 'w', version: 1, items: [], proposals: [], reviews: [], handoffs: [], events: [],
    lanes: { inbox: [], now: [], next: [], later: [], parking: [] }, dependencies: {},
    focuses: [{ id: 'focus', planId: 'p', title: 'Focus', status: 'open', version: 1, createdAt: '', updatedAt: '' }] }} planId="p"
  revision={{ id: 'r12', title: 'SBC' } as never} pending={false} execute={execute} focusId="focus" renderSubjectActions={renderActions} t={key => zh[key]} />)
  expect(renderActions).toHaveBeenLastCalledWith({ kind: 'focus', id: 'focus' })
  expect(execute).not.toHaveBeenCalled()
})
