import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { TaskQueueRemoteService } from '../src/index.ts'

describe('Queue v2 Remote', () => {
  it('returns an empty snapshot without requiring a positive limit', () => {
    const queue = { forOperator: () => ({
      list: () => [], get: vi.fn(), cancel: vi.fn(), retry: vi.fn(),
      pause: vi.fn(), resume: vi.fn(), resolveUnknown: vi.fn(), acknowledgeAttention: vi.fn(),
    }) }
    const ctx = new Context()
    ctx.provide('taskQueue', queue as never)
    const service = new TaskQueueRemoteService(ctx) as unknown as {
      snapshot(input: Record<string, never>): {
        rows: unknown[]
        stats: { byStatus: { queued: number } }
      }
    }

    expect(service.snapshot({})).toMatchObject({ rows: [], stats: { byStatus: { queued: 0 } } })
  })

  it('returns rows and optional detail from one operator snapshot read', () => {
    const list = vi.fn(() => [{
      work: {
        id: 'work-1', kind: 'agent.run@1', title: 'inspect', policy: { maxAttempts: 3 },
        batchId: null, ownerSessionId: 'session-1', createdAt: '2026-08-26T00:00:00.000Z',
        intent: { prompt: 'inspect' }, intentDigest: 'digest', resolved: {}, tags: [],
      },
      state: {
        workId: 'work-1', status: 'running', attemptCount: 1, activeAttemptId: 'attempt-1',
        resultId: null, failure: null, cancelRequestedAt: null, updatedAt: '2026-08-26T00:00:01.000Z',
      },
      attempts: [],
      result: null,
    }])
    const queue = { forOperator: () => ({
      list, get: vi.fn(), cancel: vi.fn(), retry: vi.fn(),
      pause: vi.fn(), resume: vi.fn(), resolveUnknown: vi.fn(), acknowledgeAttention: vi.fn(),
    }) }
    const ctx = new Context()
    ctx.provide('taskQueue', queue as never)
    const service = new TaskQueueRemoteService(ctx) as unknown as {
      snapshot(input: { detailId?: string }): {
        rows: { id: string }[]
        detail: { id: string } | null
      }
    }

    expect(service.snapshot({ detailId: 'work-1' })).toMatchObject({
      rows: [{ id: 'work-1', state: 'running', outcome: null }],
      detail: { id: 'work-1', state: 'running', outcome: null },
    })
    expect(list).toHaveBeenCalledOnce()
  })

  it('forwards an operator-authorized unknown retry resolution', async () => {
    const resolveUnknown = vi.fn(async () => {})
    const queue = { forOperator: () => ({
      list: () => [], get: vi.fn(), cancel: vi.fn(), retry: vi.fn(),
      pause: vi.fn(), resume: vi.fn(), resolveUnknown, acknowledgeAttention: vi.fn(),
    }) }
    const ctx = new Context()
    ctx.provide('taskQueue', queue as never)
    const service = new TaskQueueRemoteService(ctx) as unknown as {
      resolveUnknown(id: string, resolution: { kind: 'authorize-retry' }): Promise<void>
    }

    await expect(service.resolveUnknown('work-1', { kind: 'authorize-retry' })).resolves.toBeUndefined()
    expect(resolveUnknown).toHaveBeenCalledWith('work-1', { kind: 'authorize-retry' })
  })

  it('rejects legacy reconcile and unverified success inputs at the Remote boundary', async () => {
    const resolveUnknown = vi.fn(async () => {})
    const queue = { forOperator: () => ({
      list: () => [], get: vi.fn(() => ({
        work: { id: 'work-1', kind: 'agent.run@1' },
        state: { status: 'unknown', activeAttemptId: 'attempt-1' },
      })), cancel: vi.fn(), retry: vi.fn(), pause: vi.fn(), resume: vi.fn(),
      resolveUnknown, acknowledgeAttention: vi.fn(),
    }) }
    const ctx = new Context()
    ctx.provide('taskQueue', queue as never)
    const service = new TaskQueueRemoteService(ctx)

    await expect(service.resolveUnknown('work-1', { kind: 'reconcile' } as never))
      .rejects.toThrow('does not accept reconcile or unverified success')
    await expect(service.resolveUnknown('work-1', { kind: 'confirm-succeeded', output: {} } as never))
      .rejects.toThrow('does not accept reconcile or unverified success')
    expect(resolveUnknown).not.toHaveBeenCalled()
  })
})
