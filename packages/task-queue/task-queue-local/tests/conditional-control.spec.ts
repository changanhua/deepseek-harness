import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { expect, test, vi } from 'vitest'
import { createVerifiedOperatorAuthority } from '@changanhua/dsh-task-queue'
import LocalTaskQueue from '../src/index.ts'

test.each(['cancel', 'retry', 'resolve'] as const)('refuses a stale %s precondition without touching the current attempt', async (action) => {
  const root = await mkdtemp(join(tmpdir(), 'queue-control-'))
  const ctx = new Context()
  try {
    await ctx.plugin(LocalTaskQueue, { queueRoot: root, maxConcurrent: 1 })
    ctx.taskQueue.registerHandler({ kind: 'test@1', resolveAdmission: async () => ({ prompt: 'test', model: 'fixture' }),
      resources: () => [], policy: () => ({ maxAttempts: 1 }), prepare: async () => ({ argv: [] }),
      start: () => ({ done: Promise.resolve({ status: action === 'retry' ? 'failed' as const : 'unknown' as const,
        failure: { category: 'fixture', sideEffect: 'unknown' as const, retriable: false, message: 'fixture' } }), cancel: async () => {} }) })
    const queue = ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
    if (action === 'cancel') queue.pause()
    const id = await queue.enqueue({ kind: 'test@1', title: 'test', input: { prompt: 'test' }, idempotencyKey: action })
    if (action !== 'cancel') await vi.waitFor(() => { expect(queue.get(id).state.status).toBe(action === 'retry' ? 'failed' : 'unknown') })
    queue.pause()
    const before = queue.get(id).state
    const stale = { status: before.status, attemptCount: before.attemptCount + 1, activeAttemptId: before.activeAttemptId }
    const denied = action === 'cancel' ? queue.cancel(id, stale) : action === 'retry' ? queue.retry(id, stale)
      : queue.resolveUnknown(id, { kind: 'authorize-retry' }, stale)
    await expect(denied).rejects.toMatchObject({ code: 'TASK_QUEUE_CONTROL_CONFLICT' })
    expect(queue.get(id).state).toEqual(before)
    const exact = { status: before.status, attemptCount: before.attemptCount, activeAttemptId: before.activeAttemptId }
    const apply = () => action === 'cancel' ? queue.cancel(id, exact) : action === 'retry' ? queue.retry(id, exact)
      : queue.resolveUnknown(id, { kind: 'authorize-retry' }, exact)
    const raced = await Promise.allSettled([apply(), apply()])
    expect(raced.filter(value => value.status === 'fulfilled')).toHaveLength(1)
    expect(raced.filter(value => value.status === 'rejected')).toHaveLength(1)
    expect(queue.get(id).state.status).toBe(action === 'cancel' ? 'canceled' : 'queued')
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})
