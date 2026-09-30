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
  mode="work" pending={false} execute={vi.fn()} startSession={start} openSession={vi.fn()} t={key => zh[key]} />)
  fireEvent.click(screen.getByText('启动会话'))
  expect(start).toHaveBeenCalledWith({ kind: 'plan', id: 'p' }, 'r12')
})
