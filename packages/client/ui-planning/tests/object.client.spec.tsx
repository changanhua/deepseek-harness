// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PlanningObject } from '../src/client/PlanningObject.tsx'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
it('starts work on the whole plan without requiring a focus and displays its exact revision', () => {
  const start = vi.fn()
  render(<PlanningObject board={{ workspaceId: 'w', version: 0, items: [], proposals: [], reviews: [], handoffs: [], events: [],
    lanes: { inbox: [], now: [], next: [], later: [], parking: [] }, dependencies: {} }} planId="p"
  revision={{ id: 'r12', title: 'SBC', stateEntries: [{ id: 's', kind: 'accepted', content: 'Manual Submit approval' }] } as never}
  pending={false} execute={vi.fn()} startSession={start} openSession={vi.fn()} t={key => zh[key]} />)
  expect(screen.getByText('Manual Submit approval')).toBeTruthy()
  expect(screen.getByText(/r12/)).toBeTruthy()
  fireEvent.click(screen.getByText('启动会话'))
  expect(start).toHaveBeenCalledWith({ kind: 'plan', id: 'p' }, 'r12')
})
