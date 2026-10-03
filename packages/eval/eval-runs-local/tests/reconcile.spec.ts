import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { createVerifiedOperatorAuthority } from '@changanhua/dsh-task-queue'
import LocalQueue from '../../../task-queue/task-queue-local/src/index.ts'
import { fixture } from '../../eval-plans-local/tests/helpers/fixture.ts'
import LocalEvalRuns from '../src/index.ts'
import { runConfig } from './helpers/config.ts'

test.skipIf(process.platform !== 'win32').each(['plan-before', 'plan-after', 'batch-after'])(
  'reconciles admission after interruption at %s without duplicating Works', async (point) => {
    const f = await fixture(), first = await f.boot(), config = runConfig(f)
    const access = { ...f.access, actorId: 'operator' }
    const input = { requestId: 'interrupted', plan: { id: 'plan', version: '1' }, policyId: 'fixture' }
    const install = async (ctx: typeof first.ctx) => {
      await ctx.plugin(LocalQueue, { queueRoot: join(f.root, 'queue'), resourceCapacity: { 'eval-cell': 1 } })
      const queue = ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
      queue.pause()
      vi.spyOn(ctx.taskQueue, 'forOperator').mockReturnValue(queue)
      await ctx.plugin(LocalEvalRuns, config)
      return queue
    }
    try {
      const queue = await install(first.ctx)
      if (point === 'batch-after') {
        const enqueue = queue.enqueueBatch.bind(queue)
        vi.spyOn(queue, 'enqueueBatch').mockImplementationOnce(async (input) => {
          await enqueue(input); throw new Error('lost Batch acknowledgement')
        })
      } else {
        const admit = first.ctx.evalPlans.admit.bind(first.ctx.evalPlans)
        vi.spyOn(first.ctx.evalPlans, 'admit').mockImplementationOnce(async (...args) => {
          if (point === 'plan-after') await admit(...args)
          throw new Error('interrupted Plan admission')
        })
      }
      await expect(first.ctx.evalRuns.start(access, input)).rejects.toMatchObject({ code: 'unavailable' })
      const oldIds = queue.list().map(row => row.work.id)
      await first.close()
      const second = await f.boot(point === 'plan-before')
      try {
        const reopened = await install(second.ctx)
        const run = await second.ctx.evalRuns.start(access, input)
        expect(run.phase).toBe('queued')
        expect(reopened.list()).toHaveLength(2)
        expect(reopened.list().every(row => row.attempts.length === 0)).toBe(true)
        if (oldIds.length) expect(reopened.list().map(row => row.work.id)).toEqual(oldIds)
        expect(await second.ctx.evalRuns.start(access, input)).toEqual(run)
      } finally { await second.close() }
    } finally { await first.close(); await f.clean() }
  })

test.skipIf(process.platform !== 'win32')('reconciles Queue mutation after its durable control acknowledgement fails', async () => {
  const f = await fixture(), first = await f.boot(), config = runConfig(f)
  const access = { ...f.access, actorId: 'operator' }
  try {
    await first.ctx.plugin(LocalQueue, { queueRoot: join(f.root, 'queue'), resourceCapacity: { 'eval-cell': 1 } })
    const queue = first.ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
    queue.pause()
    vi.spyOn(first.ctx.taskQueue, 'forOperator').mockReturnValue(queue)
    await first.ctx.plugin(LocalEvalRuns, config)
    const run = await first.ctx.evalRuns.start(access, { requestId: 'control-interrupted', plan: { id: 'plan', version: '1' }, policyId: 'fixture' })
    const cancel = queue.cancel.bind(queue)
    vi.spyOn(queue, 'cancel').mockImplementationOnce(async (...args) => { await cancel(...args); f.pool.failNextWrites = 1 })
    const control = { runId: run.id!, operationId: 'cancel', expectedRevision: run.revision, action: 'cancel' as const }
    await expect(first.ctx.evalRuns.control(access, control)).rejects.toMatchObject({ code: 'unavailable' })
    expect(queue.list().filter(row => row.state.status === 'canceled')).toHaveLength(1)
    await first.close()
    const second = await f.boot(false)
    try {
      await second.ctx.plugin(LocalQueue, { queueRoot: join(f.root, 'queue'), resourceCapacity: { 'eval-cell': 1 } })
      second.ctx.taskQueue.forOperator(createVerifiedOperatorAuthority()).pause()
      await second.ctx.plugin(LocalEvalRuns, config)
      const recovered = await second.ctx.evalRuns.control(access, control)
      expect(recovered.phase).toBe('canceled')
      expect(recovered.controls[0]?.phase).toBe('applied')
      expect(recovered.cells.every(cell => cell.attempts.length === 0)).toBe(true)
    } finally { await second.close() }
  } finally { await first.close(); await f.clean() }
})
