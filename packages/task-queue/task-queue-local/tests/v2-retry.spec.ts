import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { createVerifiedOperatorAuthority } from '@changanhua/dsh-task-queue'
import type { WorkHandler, WorkKindDefinition } from '@changanhua/dsh-task-queue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LocalTaskQueue from '../src/index.ts'

declare module '@changanhua/dsh-task-queue' {
  interface WorkKindMap {
    'retry-stage-test@1': WorkKindDefinition<{ value: string }, { value: string }, { value: string }, { value: string }>
    'retry-other-test@1': WorkKindDefinition<{ value: string }, { value: string }, { value: string }, { value: string }>
  }
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let n = 0; n < 200; n++) {
    if (predicate()) return
    await sleep(5)
  }
  throw new Error('Queue did not reach the expected state')
}

describe('durable Queue retry eligibility', () => {
  const contexts: Context[] = []
  const roots: string[] = []
  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
    vi.useRealTimers()
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  })

  async function open(root?: string) {
    if (root === undefined) {
      root = await mkdtemp(join(tmpdir(), 'queue-retry-'))
      roots.push(root)
    }
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalTaskQueue, { queueRoot: root, maxConcurrent: 1 })
    const queue = ctx.taskQueue
    return { ctx, root, queue, operator: queue.forOperator(createVerifiedOperatorAuthority()) }
  }

  function handler(prepare: (input: string) => Promise<string>): WorkHandler<'retry-stage-test@1'> {
    return {
      kind: 'retry-stage-test@1', resolveAdmission: async input => input,
      resources: () => [], policy: () => ({ maxAttempts: 8 }),
      prepare: async input => ({ value: await prepare(input.value) }),
      start: input => ({ done: Promise.resolve({ status: 'succeeded', output: input }), async cancel() {} }),
    }
  }

  const request = (key: string) => ({ kind: 'retry-stage-test@1' as const, title: key, input: { value: key }, idempotencyKey: key })

  it('recovers receipts without a handler and rejects another kind under the same key', async () => {
    const first = await open()
    first.queue.registerHandler(handler(async input => input))
    const id = await first.operator.enqueue(request('research'))
    await eventually(() => first.operator.get(id).state.status === 'succeeded')
    const batchRequest = { kind: 'retry-stage-test@1' as const, items: [{ title: 'draft', input: { value: 'draft' } }],
      sharedPayload: {}, idempotencyKey: 'stage-batch', maxParallel: 1 }
    const batchId = await first.operator.enqueueBatch(batchRequest)
    await eventually(() => first.operator.list().every(view => view.state.status === 'succeeded'))
    await first.ctx.fiber.dispose()
    const second = await open(first.root)
    expect(await second.operator.enqueue(request('research'))).toBe(id)
    expect(await second.operator.enqueueBatch(batchRequest)).toBe(batchId)
    expect(second.operator.get(id).result?.output).toEqual({ value: 'research' })
    await expect(second.operator.enqueue({ ...request('research'), kind: 'retry-other-test@1' })).rejects.toThrow(/idempotency conflict/)
    await expect(second.operator.enqueue({ ...request('research'), input: { value: 'changed' } })).rejects.toThrow(/idempotency conflict/)
  })

  it('rejects a concurrent different-kind admission before sharing the pending result', async () => {
    const { queue, operator } = await open()
    operator.pause()
    const gate = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    queue.registerHandler({ ...handler(async input => input), async resolveAdmission(input) {
      entered.resolve(undefined)
      await gate.promise
      return input
    } })
    const first = operator.enqueue(request('research'))
    await entered.promise
    queue.registerHandler({ ...handler(async input => input), kind: 'retry-other-test@1' })
    try {
      await expect(operator.enqueue({ ...request('research'), kind: 'retry-other-test@1' })).rejects.toThrow(/idempotency conflict/)
    } finally { gate.resolve(undefined) }
    await first
    expect(operator.list()).toHaveLength(1)
  })

  it('waits across restart and snapshot recovery without reserving an execution slot', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-09-08T00:00:00Z'))
    const first = await open()
    let prepares = 0
    first.queue.registerHandler(handler(async (input) => {
      prepares++
      if (input === 'draft') throw new Error('source temporarily unavailable')
      return input
    }))
    const id = await first.operator.enqueue(request('draft'))
    await eventually(() => first.operator.get(id).state.status === 'queued' && prepares === 1)
    expect(first.operator.waitReason(id)).toEqual({ kind: 'retry-backoff', eligibleAt: '2026-09-08T00:00:01.000Z' })
    const other = await first.operator.enqueue(request('research'))
    await eventually(() => first.operator.get(other).state.status === 'succeeded')
    // Exercise both persisted forms: the normal log and its projection cache.
    await (first.queue as unknown as { store: { writeSnapshot(): Promise<void> } }).store.writeSnapshot()
    await first.ctx.fiber.dispose()
    await vi.advanceTimersByTimeAsync(400)
    const second = await open(first.root)
    let resumed = 0
    second.queue.registerHandler(handler(async (input) => { resumed++; return input }))
    expect(await second.operator.enqueue(request('draft'))).toBe(id)
    expect(second.operator.waitReason(id)).toEqual({ kind: 'retry-backoff', eligibleAt: '2026-09-08T00:00:01.000Z' })
    await vi.advanceTimersByTimeAsync(599)
    await sleep(20)
    expect(resumed).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    await eventually(() => second.operator.get(id).state.status === 'succeeded')
    expect(resumed).toBe(1)
    expect(second.operator.get(id).attempts).toHaveLength(2)
    expect(second.operator.get(other).result?.output).toEqual({ value: 'research' })
  })

  it('uses capped exponential delays and cancels a waiting retry', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-09-08T00:00:00Z'))
    const { queue, operator } = await open()
    queue.registerHandler(handler(async () => { throw new Error('unavailable') }))
    const id = await operator.enqueue(request('draft'))
    for (const [index, delay] of [1000, 2000, 4000, 8000, 16000, 30000].entries()) {
      await eventually(() => operator.get(id).state.status === 'queued' && operator.get(id).state.attemptCount === index + 1)
      expect(operator.waitReason(id)).toEqual({ kind: 'retry-backoff', eligibleAt: new Date(Date.now() + delay).toISOString() })
      await vi.advanceTimersByTimeAsync(delay)
    }
    await eventually(() => operator.get(id).state.status === 'queued' && operator.get(id).state.attemptCount === 7)
    await operator.cancel(id)
    await vi.advanceTimersByTimeAsync(60000)
    expect(operator.get(id).state.status).toBe('canceled')
    expect(operator.get(id).attempts).toHaveLength(7)
  })

  it('keeps an overdue retry paused until explicit resume', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-09-08T00:00:00Z'))
    const { queue, operator } = await open()
    let tries = 0
    queue.registerHandler(handler(async (input) => { if (++tries === 1) throw new Error('unavailable'); return input }))
    const id = await operator.enqueue(request('draft'))
    await eventually(() => operator.get(id).state.status === 'queued' && tries === 1)
    operator.pause()
    await vi.advanceTimersByTimeAsync(2000)
    expect(tries).toBe(1)
    operator.resume()
    await eventually(() => operator.get(id).state.status === 'succeeded')
    expect(tries).toBe(2)
  })

  it('wakes when eligibility passes between candidate selection and rearming the timer', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-09-08T00:00:00Z'))
    const { queue, operator } = await open()
    let tries = 0
    queue.registerHandler(handler(async (input) => { if (++tries === 1) throw new Error('unavailable'); return input }))
    const id = await operator.enqueue(request('draft'))
    await eventually(() => operator.get(id).state.status === 'queued' && tries === 1)
    const internals = queue as unknown as { claimNext(): Promise<unknown> }
    const original = internals.claimNext.bind(internals)
    vi.spyOn(internals, 'claimNext').mockImplementationOnce(async () => {
      const result = await original()
      vi.setSystemTime(new Date('2026-09-08T00:00:01.001Z'))
      return result
    })
    operator.resume()
    await eventually(() => Date.now() === Date.parse('2026-09-08T00:00:01.001Z'))
    await vi.advanceTimersByTimeAsync(1)
    await eventually(() => operator.get(id).state.status === 'succeeded')
    expect(tries).toBe(2)
  })

  it('dispatches an overdue retry when its handler is registered again', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-09-08T00:00:00Z'))
    const { queue, operator } = await open()
    const unregister = queue.registerHandler(handler(async () => { throw new Error('unavailable') }))
    const id = await operator.enqueue(request('draft'))
    await eventually(() => operator.get(id).state.status === 'queued' && operator.get(id).state.attemptCount === 1)
    unregister()
    await vi.advanceTimersByTimeAsync(2000)
    expect(operator.get(id).attempts).toHaveLength(1)
    expect(operator.waitReason(id)).toEqual({ kind: 'handler-unavailable' })
    queue.registerHandler(handler(async input => input))
    await eventually(() => operator.get(id).state.status === 'succeeded')
    expect(operator.get(id).attempts).toHaveLength(2)
  })
})
