import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QueueRemoteFace } from '../src/client/store.ts'
import { QueueStore } from '../src/client/store.ts'

function remoteFace() {
  const snapshot = vi.fn(async () => ({
    ok: true as const,
    value: {
      stats: {
        paused: false,
        byStatus: {
          queued: 0, starting: 0, running: 0, unknown: 0,
          succeeded: 0, failed: 0, canceled: 0,
        },
        byKind: {},
      },
      rows: [],
      detail: null,
    },
  }))
  const resolveUnknown = vi.fn(async () => ({ ok: true as const, value: undefined }))
  const remote: QueueRemoteFace = {
    snapshot,
    cancel: vi.fn(async () => ({ ok: true as const, value: undefined })),
    retry: vi.fn(async () => ({ ok: true as const, value: undefined })),
    resolveUnknown,
    pause: vi.fn(async () => ({ ok: true as const, value: undefined })),
    resume: vi.fn(async () => ({ ok: true as const, value: undefined })),
  }
  return { remote, snapshot, resolveUnknown }
}

describe('QueueStore', () => {
  afterEach(() => { vi.useRealTimers() })

  it('serializes concurrent refreshes so stale responses cannot overwrite a later read', async () => {
    let releaseFirst!: () => void
    const first = new Promise<void>((resolve) => { releaseFirst = resolve })
    const snapshot = vi
      .fn()
      .mockImplementationOnce(async () => {
        await first
        return {
          ok: true as const,
          value: {
            stats: {
              paused: false,
              byStatus: { queued: 1, starting: 0, running: 0, unknown: 0, succeeded: 0, failed: 0, canceled: 0 },
              byKind: {},
            },
            rows: [], detail: null,
          },
        }
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: {
          stats: {
            paused: false,
            byStatus: { queued: 0, starting: 0, running: 1, unknown: 0, succeeded: 0, failed: 0, canceled: 0 },
            byKind: {},
          },
          rows: [], detail: null,
        },
      })
    const remote: QueueRemoteFace = {
      snapshot,
      cancel: vi.fn(), retry: vi.fn(), resolveUnknown: vi.fn(), pause: vi.fn(), resume: vi.fn(),
    }
    const store = new QueueStore(remote)

    const firstRefresh = store.refresh()
    const secondRefresh = store.refresh()
    await Promise.resolve()
    expect(snapshot).toHaveBeenCalledTimes(1)

    releaseFirst()
    await Promise.all([firstRefresh, secondRefresh])
    expect(snapshot).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot().stats?.byStatus.running).toBe(1)
  })

  it('forwards an unknown retry resolution and refreshes the snapshot', async () => {
    const { remote, snapshot, resolveUnknown } = remoteFace()
    const store = new QueueStore(remote)

    await expect(store.resolveUnknown('work-1', { kind: 'authorize-retry' })).resolves.toEqual({
      ok: true,
      message: 'Unknown attempt retry authorized for work-1.',
    })
    expect(resolveUnknown).toHaveBeenCalledWith('work-1', { kind: 'authorize-retry' })
    expect(snapshot).toHaveBeenCalledWith({})
  })

  it('retains the last successful rows and refresh timestamp when a refresh fails', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-27T10:00:00.000Z')
    const snapshot = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: {
          stats: {
            paused: false,
            byStatus: { queued: 1, starting: 0, running: 0, unknown: 0, succeeded: 0, failed: 0, canceled: 0 },
            byKind: {},
          },
          rows: [{
            id: 'work-1', kind: 'agent.run@1', title: 'Work one', status: 'queued', state: 'queued', outcome: null,
            attemptCount: 0, maxAttempts: 3, batchId: null, ownerSessionId: null,
            createdAt: '2026-08-27T09:00:00.000Z', updatedAt: '2026-08-27T09:00:00.000Z',
          }],
          detail: null,
        },
      })
      .mockRejectedValueOnce(new Error('offline'))
    const remote: QueueRemoteFace = {
      snapshot,
      cancel: vi.fn(), retry: vi.fn(), resolveUnknown: vi.fn(), pause: vi.fn(), resume: vi.fn(),
    }
    const store = new QueueStore(remote)

    await store.refresh()
    await store.refresh()

    expect(store.getSnapshot()).toMatchObject({
      rows: [expect.objectContaining({ id: 'work-1' })],
      lastSuccessfulRefreshAt: '2026-08-27T10:00:00.000Z',
      refreshing: false,
      error: 'offline',
    })
  })
})
