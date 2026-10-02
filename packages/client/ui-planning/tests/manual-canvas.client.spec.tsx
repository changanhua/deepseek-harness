// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SbcDesignCase } from '../src/client/SbcDesignCase.tsx'
import { zh, type PlanningKey } from '../src/client/locales.ts'
import type { SbcDesignState } from '../src/client/sbc-design-controller.ts'
afterEach(cleanup)
const state: SbcDesignState = { opened: true, pending: false, error: null, view: {
  case: { workspaceId: 'w', subject: { kind: 'plan', id: 'p' }, planId: 'p',
    baseRevision: { id: 'r', title: 'Plan', intent: '', stateEntries: [] } as never,
    version: 0, history: [], local: { positions: { 'plan:p': { x: 40, y: 40 } }, selectedNodeId: null } },
  currentRevision: 'r', currentFocusVersion: null, drift: false,
} }
const t = (key: PlanningKey) => zh[key]
it('offers visible and blank-canvas context-menu creation with editable fields', async () => {
  const explore = vi.fn(async () => {})
  render(<SbcDesignCase state={state} explore={explore} refresh={async () => {}} close={() => {}} t={t} />)
  expect(screen.getByRole('button', { name: '新建卡片' })).toBeTruthy()
  fireEvent.contextMenu(screen.getByLabelText('探索画布'), { clientX: 140, clientY: 180 })
  fireEvent.click(screen.getByRole('menuitem', { name: '新建卡片' }))
  fireEvent.change(screen.getByLabelText('标题'), { target: { value: '手写想法' } })
  fireEvent.change(screen.getByLabelText('内容'), { target: { value: '先记录再思考' } })
  fireEvent.click(screen.getByRole('button', { name: '保存卡片' }))
  await waitFor(() =>{  expect(explore).toHaveBeenCalledWith({ kind: 'create-note', title: '手写想法', body: '先记录再思考', x: 140, y: 180 }) })
})

it('opens populated cards for editing and cancels without a write', () => {
  const explore = vi.fn(async () => {})
  if (!state.view) throw new Error('Missing case fixture')
  const view = { ...state.view, case: { ...state.view.case, notes: [{ id: 'manual', source: 'manual' as const,
    title: 'Existing', body: 'Existing body', position: { x: 80, y: 200 }, createdAt: '2026-10-01T00:00:00.000Z' }],
  local: { positions: { manual: { x: 80, y: 200 } }, selectedNodeId: 'manual' } } }
  render(<SbcDesignCase state={{ ...state, view }} explore={explore} refresh={async () => {}} close={() => {}} t={t} />)
  fireEvent.click(screen.getByRole('button', { name: '编辑卡片' }))
  expect(screen.getByLabelText('内容')).toHaveProperty('value', 'Existing body')
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(explore).not.toHaveBeenCalled()
})
