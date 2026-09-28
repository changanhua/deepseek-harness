import { describe, expect, it } from 'vitest'
import { bootPlanningBundle } from './harness.ts'

describe('personal planning bundle', () => {
  it('loads the patch through Loader and persists a capture, move, and idempotent retry across restart', async () => {
    const world = await bootPlanningBundle()
    try {
      const first = await world.remote.execute({ workspaceId: world.workspaceId, command: world.create('capture-1') }, new AbortController().signal)
      await world.remote.execute({ workspaceId: world.workspaceId, command: { kind: 'move', requestId: 'move-1', expectedBoardVersion: first.boardVersion, itemId: first.itemId!, lane: 'next', beforeItemId: null } }, new AbortController().signal)
      await world.close()
      const reopened = await world.reopen()
      const snapshot = await reopened.remote.snapshot(reopened.workspaceId, new AbortController().signal)
      expect(snapshot.lanes.next).toEqual([first.itemId])
      await expect(reopened.remote.execute({ workspaceId: reopened.workspaceId, command: world.create('capture-1') }, new AbortController().signal)).resolves.toEqual(first)
      await reopened.close()
    } finally { await world.dispose() }
  })
})
