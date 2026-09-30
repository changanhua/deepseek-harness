import { expect, it } from 'vitest'
import { createSbcDesignController } from '../src/client/sbc-design-controller.ts'
import type { SbcDesignCaseView } from '@changanhua/dsh-planning-remote/types'

const view = (version = 0, drift = false): SbcDesignCaseView => ({
  case: { workspaceId: 'w', subject: { kind: 'plan', id: 'p' }, planId: 'p',
    baseRevision: { id: 'r1', title: 'SBC' } as never, version,
    local: { positions: { 'plan:p': { x: 40, y: 40 } }, selectedNodeId: null }, history: [] },
  currentRevision: drift ? 'r2' : 'r1', currentFocusVersion: null, drift,
})
it('publishes committed exploration and rereads drift without replacing the saved projection', async () => {
  let saved = view()
  const controller = createSbcDesignController({
    sbcDesignCase: async () => ({ ok: true, value: saved }),
    exploreSbcDesignCase: async (input) => {
      expect(input.expectedVersion).toBe(0)
      expect(input.operation).toEqual({ kind: 'move', nodeId: 'plan:p', x: 80, y: 100 })
      saved = view(1)
      saved.case.local.positions['plan:p'] = { x: 80, y: 100 }
      return { ok: true, value: saved }
    },
  })
  await controller.open({ workspaceId: 'w', subject: { kind: 'plan', id: 'p' } })
  await controller.explore({ kind: 'move', nodeId: 'plan:p', x: 80, y: 100 })
  expect(controller.source.getSnapshot().view?.case.local.positions['plan:p']).toEqual({ x: 80, y: 100 })
  saved = { ...saved, currentRevision: 'r2', drift: true }
  await controller.refresh()
  expect(controller.source.getSnapshot().view?.drift).toBe(true)
  expect(controller.source.getSnapshot().view?.case.baseRevision.id).toBe('r1')
  controller.dispose()
})
it('does not replay an unknown write and clears the view after closing', async () => {
  let writes = 0
  const controller = createSbcDesignController({
    sbcDesignCase: async () => ({ ok: true, value: view() }),
    exploreSbcDesignCase: async () => { writes++; throw new Error('connection lost') },
  })
  await controller.open({ workspaceId: 'w', subject: { kind: 'plan', id: 'p' } })
  await controller.explore({ kind: 'undo' })
  expect(controller.source.getSnapshot().error).toContain('connection lost')
  await controller.refresh()
  expect(writes).toBe(1)
  controller.close()
  expect(controller.source.getSnapshot().view).toBeNull()
  controller.dispose()
})
