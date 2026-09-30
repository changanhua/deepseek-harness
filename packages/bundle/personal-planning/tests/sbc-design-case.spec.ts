import { afterEach, expect, it } from 'vitest'
import { bootPlanningBundle } from './harness.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanups.splice(0)) await dispose() })

it('distinguishes an unavailable case owner from a verified empty case list', async () => {
  const app = await bootPlanningBundle(false, false); cleanups.push(() => app.dispose())
  const signal = new AbortController().signal
  const created = await app.remote.execute({ workspaceId: app.workspaceId, command: app.create('disabled-owner') }, signal)
  const remote = app.remote as unknown as import('../../../planning/planning-remote/src/index.ts').PlanningRemoteService
  const before = await app.remote.snapshot(app.workspaceId, signal)
  await expect(remote.designCases({ workspaceId: app.workspaceId, itemId: created.itemId! }, signal))
    .rejects.toMatchObject({ failure: { code: 'unavailable' } })
  expect(await app.remote.snapshot(app.workspaceId, signal)).toEqual(before)
})

it('lists existing cases without creating exploration or changing canonical Planning', async () => {
  const app = await bootPlanningBundle(); cleanups.push(() => app.dispose())
  const signal = new AbortController().signal
  const created = await app.remote.execute({ workspaceId: app.workspaceId, command: app.create('summary-plan') }, signal)
  const remote = app.remote as unknown as import('../../../planning/planning-remote/src/index.ts').PlanningRemoteService
  const input = { workspaceId: app.workspaceId, itemId: created.itemId! }
  const board = await app.remote.snapshot(app.workspaceId, signal)
  expect(await remote.designCases(input, signal)).toEqual([])
  expect(await remote.designCases(input, signal)).toEqual([])
  const opened = await remote.sbcDesignCase({ workspaceId: app.workspaceId, subject: { kind: 'plan', id: created.itemId! } }, signal)
  const summaries = await remote.designCases(input, signal)
  expect(summaries).toHaveLength(1)
  expect(summaries[0]).toMatchObject({ subjectRef: { kind: 'plan', id: created.itemId }, baseRevision: opened.case.baseRevision.id,
    resource: { kind: 'design-case', provider: 'sbc' } })
  expect(await app.remote.snapshot(app.workspaceId, signal)).toEqual(board)
  const reopened = await remote.sbcDesignCase({ workspaceId: app.workspaceId, subject: summaries[0]!.subjectRef }, signal)
  expect(reopened.case).toEqual(opened.case)
})

it('keeps SBC exploration separate through Loader restart and real Planning revision drift', async () => {
  let app = await bootPlanningBundle()
  cleanups.push(() => app.dispose())
  const signal = new AbortController().signal
  const created = await app.remote.execute({ workspaceId: app.workspaceId, command: app.create('sbc-plan') }, signal)
  await app.remote.execute({ workspaceId: app.workspaceId, command: {
    kind: 'workspace-change', requestId: 'sbc-focus', expectedBoardVersion: 1,
    subject: { kind: 'plan', id: created.itemId! }, baseRevision: created.revisionId!,
    operations: [{ kind: 'create-focus', id: 'reliable-slice', title: '首个可靠纵切设计' }],
  } }, signal)
  const input = { workspaceId: app.workspaceId, subject: { kind: 'focus' as const, id: 'reliable-slice' } }
  const remote = () => app.remote as unknown as import('../../../planning/planning-remote/src/index.ts').PlanningRemoteService
  const board = await app.remote.snapshot(app.workspaceId, signal)
  const initial = await remote().sbcDesignCase(input, signal)
  expect(initial.case.baseFocus?.title).toBe('首个可靠纵切设计')
  expect(initial.drift).toBe(false)
  const selected = await remote().exploreSbcDesignCase({ ...input, expectedVersion: 0, requestId: 'select',
    operation: { kind: 'select', nodeId: 'focus:reliable-slice' } }, signal)
  const moved = await remote().exploreSbcDesignCase({ ...input, expectedVersion: selected.case.version, requestId: 'move',
    operation: { kind: 'move', nodeId: 'focus:reliable-slice', x: 410, y: 180 } }, signal)
  expect(moved.case.local.positions['focus:reliable-slice']).toEqual({ x: 410, y: 180 })
  expect(await app.remote.snapshot(app.workspaceId, signal)).toEqual(board)
  await expect(remote().exploreSbcDesignCase({ ...input, expectedVersion: 0, requestId: 'stale',
    operation: { kind: 'move', nodeId: 'focus:reliable-slice', x: 1, y: 1 } }, signal)).rejects.toMatchObject({ failure: { code: 'conflict' } })
  await app.close()
  app = await app.reopen()
  expect((await remote().sbcDesignCase(input, signal)).case).toEqual(moved.case)
  const revision = board.items[0]!.headRevisionId
  await app.remote.execute({ workspaceId: app.workspaceId, command: {
    kind: 'workspace-change', requestId: 'canonical-change', expectedBoardVersion: board.version,
    subject: input.subject, baseRevision: revision,
    operations: [{ kind: 'update-focus', id: 'reliable-slice', expectedVersion: 1, title: '修订后的纵切' }],
  } }, signal)
  const drifted = await remote().sbcDesignCase(input, signal)
  expect(drifted.drift).toBe(true)
  expect(drifted.currentRevision).not.toBe(revision)
  expect(drifted.case).toEqual(moved.case)
  expect(drifted.case.baseFocus?.title).toBe('首个可靠纵切设计')
  const undone = await remote().exploreSbcDesignCase({ ...input, expectedVersion: moved.case.version,
    requestId: 'undo', operation: { kind: 'undo' } }, signal)
  expect(undone.case.local.positions['focus:reliable-slice']).toEqual({ x: 360, y: 40 })
  expect(undone.case.local.selectedNodeId).toBe('focus:reliable-slice')
  expect(undone.drift).toBe(true)
})
