import { join } from 'node:path'
import { expect, test } from 'vitest'
import { createVerifiedOperatorAuthority } from '@changanhua/dsh-task-queue'
import LocalQueue from '../../../task-queue/task-queue-local/src/index.ts'
import { fixture } from '../../eval-plans-local/tests/helpers/fixture.ts'
import LocalEvalRuns, { createEvalGateSnapshotReader } from '../src/index.ts'
import { runConfig } from './helpers/config.ts'

test.skipIf(process.platform !== 'win32')('recovers the same admitted Batch and canceled run without a current model Provider', async () => {
  const f = await fixture()
  const h = await f.boot()
  const config = runConfig(f)
  const input = { requestId: 'request', plan: { id: 'plan', version: '1' }, policyId: 'fixture' }
  const access = { ...f.access, actorId: 'operator' }
  try {
    await h.ctx.plugin(LocalQueue, { queueRoot: join(f.root, 'queue'), resourceCapacity: { 'eval-cell': 1 } })
    const queue = h.ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
    queue.pause()
    await h.ctx.plugin(LocalEvalRuns, config)
    const [first, repeated] = await Promise.all([h.ctx.evalRuns.start(access, input), h.ctx.evalRuns.start(access, input)])
    expect(first.id).toBeTruthy()
    expect(first.id).toBe(repeated.id)
    expect(first.phase).toBe('queued')
    expect(queue.list()).toHaveLength(2)
    expect(JSON.stringify(first)).not.toContain(f.root)
    await expect(h.ctx.evalRuns.start(access, { ...input, policyId: 'changed' })).rejects.toMatchObject({ code: 'conflict' })
    await expect(h.ctx.evalRuns.get({ ...access, workspace: { ...access.workspace } }, first.id!)).rejects.toMatchObject({ code: 'unauthorized' })
    const control = { runId: first.id!, operationId: 'stop', expectedRevision: first.revision, action: 'cancel' as const }
    const stopped = await h.ctx.evalRuns.control(access, control)
    expect(stopped.phase).toBe('canceled')
    expect(stopped.cells.every(cell => cell.status === 'canceled')).toBe(true)
    expect(await h.ctx.evalRuns.control(access, control)).toEqual(stopped)
    const privateRead = createEvalGateSnapshotReader(h.ctx)
    const facts = await privateRead(access, first.id!)
    expect(facts?.run.expectedCells).toHaveLength(2)
    expect(facts?.cells.every(cell => cell.work.status === 'canceled' && cell.evidence.status === 'missing')).toBe(true)
    expect(facts?.expiresAt).toBe(0)
    expect((await privateRead(access, first.id!))?.revision).toBe(facts?.revision)
    await expect(privateRead({ ...access, authorize: () => { throw new Error('revoked') } }, first.id!))
      .rejects.toMatchObject({ code: 'unauthorized' })
    await h.close()
    await expect(privateRead(access, first.id!)).rejects.toMatchObject({ code: 'unavailable' })
    const reopened = await f.boot(false)
    try {
      await reopened.ctx.plugin(LocalQueue, { queueRoot: join(f.root, 'queue'), resourceCapacity: { 'eval-cell': 1 } })
      await reopened.ctx.plugin(LocalEvalRuns, config)
      expect(await reopened.ctx.evalRuns.get(access, first.id!)).toEqual(stopped)
      expect(await reopened.ctx.evalRuns.start(access, input)).toEqual(stopped)
      expect(reopened.ctx.taskQueue.forOperator(createVerifiedOperatorAuthority()).list()).toHaveLength(2)
      await expect(reopened.ctx.evalRuns.control(access, { ...control, operationId: 'stale' })).rejects.toMatchObject({ code: 'conflict' })
    } finally { await reopened.close() }
  } finally { await h.close(); await f.clean() }
})
