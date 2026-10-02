import { afterEach, expect, it, vi } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { PlanningRemoteService } from '../src/index.ts'
import { createPlanningHarness } from '../../planning-local/tests/harness.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const dispose of cleanups.splice(0)) await dispose() })
const signal = () => new AbortController().signal
async function setup(config = {}) {
  const h = await createPlanningHarness()
  cleanups.push(h.dispose)
  const created = await h.ctx.planning.execute(h.access(), h.create('seed'))
  const remote = new PlanningRemoteService(h.ctx, { enableSbcDesignCase: true, ...config })
  return { ...h, remote, input: { workspaceId: h.workspace.id, subject: { kind: 'plan' as const, id: created.itemId! } } }
}

it('keeps the original Remote active without exploratory storage', async () => {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  ctx.provide('planning', {} as never)
  ctx.provide('workspaceRegistry', { list: () => [] } as never)
  const fiber = ctx.plugin(PlanningRemoteService)
  await fiber
  expect(ctx.get('planningRemote')).toBeDefined()
  expect(await (ctx.get('planningRemote') as PlanningRemoteService).workspaces(signal())).toEqual([])
})

it('opens a legal 200-entry Plan with maximum-length ids', async () => {
  const h = await createPlanningHarness()
  cleanups.push(h.dispose)
  const id = 'p'.repeat(256)
  await h.ctx.planning.execute(h.access(), { ...h.create('large'), itemId: id,
    stateEntries: Array.from({ length: 200 }, (_, i) => ({ id: String(i).padStart(256, 's'), kind: 'open', content: `Entry ${i}` })) })
  const remote = new PlanningRemoteService(h.ctx, { enableSbcDesignCase: true })
  const opened = await remote.sbcDesignCase({ workspaceId: h.workspace.id, subject: { kind: 'plan', id } }, signal())
  expect(Object.keys(opened.case.local.positions)).toHaveLength(201)
  expect(opened.case.local.positions[`entry:${String(199).padStart(256, 's')}`]).toEqual({ x: 360, y: 12140 })
})

it('allows an explicit retry after storage initialization fails', async () => {
  const h = await setup()
  vi.spyOn(h.ctx.storageDomain, 'open').mockRejectedValueOnce(new Error('temporary storage failure'))
  await expect(h.remote.sbcDesignCase(h.input, signal())).rejects.toBeDefined()
  const recovered = await h.remote.sbcDesignCase(h.input, signal())
  expect(recovered.case.planId).toBe(h.input.subject.id)
})

it('closes the exploratory domain when the Remote unloads and reopens the saved case', async () => {
  const h = await createPlanningHarness()
  cleanups.push(h.dispose)
  await h.ctx.planning.execute(h.access(), h.create('lifecycle'))
  const input = { workspaceId: h.workspace.id, subject: { kind: 'plan' as const, id: 'provider-plan' } }
  const first = await h.ctx.plugin(PlanningRemoteService, { enableSbcDesignCase: true })
  const before = await (h.ctx.get('planningRemote') as PlanningRemoteService).sbcDesignCase(input, signal())
  await first.dispose()
  expect(h.ctx.get('planningRemote')).toBeUndefined()
  await h.ctx.plugin(PlanningRemoteService, { enableSbcDesignCase: true })
  const reopened = h.ctx.get('planningRemote') as PlanningRemoteService
  expect(await reopened.sbcDesignCase(input, signal())).toEqual(before)
})

it('admits one concurrent write and replays it without another undo step', async () => {
  const h = await setup()
  await h.remote.sbcDesignCase(h.input, signal())
  const first = { ...h.input, expectedVersion: 0, requestId: 'first',
    operation: { kind: 'move' as const, nodeId: 'plan:provider-plan', x: 100, y: 120 } }
  const second = { ...first, requestId: 'second', operation: { ...first.operation, x: 200 } }
  const results = await Promise.allSettled([
    h.remote.exploreSbcDesignCase(first, signal()), h.remote.exploreSbcDesignCase(second, signal()),
  ])
  expect(results.map(value => value.status)).toEqual(['fulfilled', 'rejected'])
  const saved = await h.remote.sbcDesignCase(h.input, signal())
  expect(saved.case.version).toBe(1)
  expect(await h.remote.exploreSbcDesignCase(first, signal())).toEqual(saved)
  expect(saved.case.history).toHaveLength(1)
  const controller = new AbortController()
  controller.abort()
  await expect(h.remote.exploreSbcDesignCase({ ...second, expectedVersion: 1 }, controller.signal))
    .rejects.toMatchObject({ failure: { code: 'cancelled' } })
  expect(await h.remote.sbcDesignCase(h.input, signal())).toEqual(saved)
})

it('requires explicit feature enablement and leaves no exploration on disk', async () => {
  const h = await setup({ enableSbcDesignCase: false })
  await expect(h.remote.sbcDesignCase(h.input, signal())).rejects.toMatchObject({ failure: { code: 'unavailable' } })
  expect((await readdir(join(h.root, 'storage'))).some(name => name.startsWith('sbc_design_cases'))).toBe(false)
})

it('bounds serialized bytes before writing', async () => {
  const h = await setup({ maxSbcCases: 1, maxSbcCaseBytes: 1024 })
  await expect(h.remote.sbcDesignCase(h.input, signal())).rejects.toMatchObject({ failure: { code: 'capacity-exceeded' } })
  expect((await h.ctx.planning.snapshot(h.access())).version).toBe(1)
})

it('refuses an additional case at capacity without touching the first case', async () => {
  const h = await setup({ maxSbcCases: 1 })
  const original = await h.remote.sbcDesignCase(h.input, signal())
  await h.ctx.planning.execute(h.access(), { ...h.create('second', 1), itemId: 'other-plan' })
  await expect(h.remote.sbcDesignCase({ workspaceId: h.workspace.id, subject: { kind: 'plan', id: 'other-plan' } }, signal()))
    .rejects.toMatchObject({ failure: { code: 'capacity-exceeded' } })
  expect((await h.remote.sbcDesignCase(h.input, signal())).case).toEqual(original.case)
  expect(await readdir(join(h.root, 'storage', 'sbc_design_cases', 'cases'))).toHaveLength(1)
})

it('persists compact move undo; selection does not displace spatial undo', async () => {
  const h = await setup()
  await h.remote.sbcDesignCase(h.input, signal())
  const nodeId = `plan:${h.input.subject.id}`
  const moved = await h.remote.exploreSbcDesignCase({ ...h.input, expectedVersion: 0, requestId: 'move', operation: { kind: 'move', nodeId, x: 500, y: 250 } }, signal())
  expect(moved.case.history).toEqual([{ nodeId, x: 40, y: 40 }])
  await h.remote.exploreSbcDesignCase({ ...h.input, expectedVersion: 1, requestId: 'select', operation: { kind: 'select', nodeId } }, signal())
  const undone = await h.remote.exploreSbcDesignCase({ ...h.input, expectedVersion: 2, requestId: 'undo', operation: { kind: 'undo' } }, signal())
  expect(undone.case.local.positions[nodeId]).toEqual({ x: 40, y: 40 })
  expect(undone.case.local.selectedNodeId).toBe(nodeId)
  const files = await readdir(join(h.root, 'storage', 'sbc_design_cases', 'cases'))
  expect(files).toHaveLength(1)
  const persisted: unknown = JSON.parse(await readFile(join(h.root, 'storage', 'sbc_design_cases', 'cases', files[0]!), 'utf8'))
  expect(JSON.stringify(persisted)).toContain('selectedNodeId')
})
