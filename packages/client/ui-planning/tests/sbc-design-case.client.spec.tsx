// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SbcDesignCase } from '../src/client/SbcDesignCase.tsx'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
it('shows frozen revision and drift and rearranges without Planning commands', () => {
  const operations: unknown[] = []
  render(<SbcDesignCase state={{ opened: true, pending: false, error: null, view: {
    case: { workspaceId: 'w', subject: { kind: 'plan', id: 'p' }, planId: 'p',
      baseRevision: { id: 'r1', title: 'FC27 SBC', intent: 'Reliable slice', stateEntries: [] } as never,
      version: 2, history: [{ nodeId: 'plan:p', x: 0, y: 0 }],
      local: { positions: { 'plan:p': { x: 40, y: 40 } }, selectedNodeId: 'plan:p' } },
    currentRevision: 'r2', currentFocusVersion: null, drift: true,
  } }} explore={async (operation) => { operations.push(operation) }} refresh={async () => {}} close={() => {}} t={key => zh[key]} />)
  expect(screen.getByText(/r1/)).toBeTruthy()
  expect(screen.getByText(/r2/)).toBeTruthy()
  expect(screen.getByRole('status').textContent).toContain('漂移')
  fireEvent.keyDown(screen.getByRole('button', { name: /FC27 SBC/ }), { key: 'ArrowRight' })
  expect(operations).toEqual([{ kind: 'move', nodeId: 'plan:p', x: 60, y: 40 }])
  fireEvent.click(screen.getByText('撤销移动'))
  expect(operations[1]).toEqual({ kind: 'undo' })
})
