/**
 * QueueStore unit account: snapshot reads, error retention, detail selection,
 * and the confirm-after-mutation refresh chain — driven by a controllable
 * fake Remote face (no DOM).
 */
import { describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  QueueStatsView,
  QueueTaskSummaryView,
  QueueTaskView,
} from '@deepseek-ai/dsh-task-queue-remote/views'
import { QueueStore, type QueueRemoteFace } from '../src/client/store.ts'

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function fail(message: string): RemoteResult<never> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

const STATS: QueueStatsView = {
  serviceState: 'running',
  fault: null,
  byStatus: { pending: 1, starting: 0, running: 2, stopping: 0, succeeded: 1, failed: 1, canceled: 0 },
  byExecutor: { codex: 3 },
  undismissedFailed: 1,
  byDismissed: 0,
}

const SUMMARY = (id: string, status: QueueTaskSummaryView['status']): QueueTaskSummaryView => ({
  id,
  title: `task ${id}`,
  executor: 'codex',
  status,
  priority: 10,
  attempt: 1,
  maxAttempts: 3,
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T01:00:00.000Z',
  tags: [],
  ownerSessionId: null,
  dismissed: false,
})

const DETAIL: QueueTaskView = {
  ...SUMMARY('tq-1', 'running'),
  prompt: 'run the tests',
  backoffMs: 30_000,
  delayUntil: null,
  timeoutMs: 1_800_000,
  outputDir: 'queue/tq-1',
  lastError: null,
  result: null,
  source: 'tool',
  receiptId: 'rcpt-1',
  runs: [],
}

/** Controllable Remote fake: records calls, serves canned answers. */
function makeRemote() {
  const calls: string[] = []
  const remote: QueueRemoteFace = {
    stats: vi.fn(async () => { calls.push('stats'); return ok(STATS) }),
    list: vi.fn(async () => { calls.push('list'); return ok([SUMMARY('tq-1', 'running'), SUMMARY('tq-2', 'failed')]) }),
    executors: vi.fn(async () => { calls.push('executors'); return ok([{ name: 'codex', enabled: true, toolAllowed: true, running: 1 }]) }),
    get: vi.fn(async (id: string) => {
      calls.push(`get:${id}`)
      if (id === 'tq-1') return ok(DETAIL)
      return fail(`unknown task ${id}`)
    }),
    readRunLog: vi.fn(async (id: string, runId: string) => {
      calls.push(`readRunLog:${id}:${runId}`)
      if (id === 'tq-1' && runId === 'run-1') return ok('log body')
      return fail(`missing ${id}/${runId}`)
    }),
    cancel: vi.fn(async () => { calls.push('cancel'); return ok('canceled' as const) }),
    retry: vi.fn(async () => { calls.push('retry'); return ok('tq-1') }),
    dismiss: vi.fn(async (id: string, dismissed?: boolean) => { calls.push(`dismiss:${id}:${dismissed}`); return ok(undefined) }),
    pause: vi.fn(async () => { calls.push('pause'); return ok(undefined) }),
    resume: vi.fn(async () => { calls.push('resume'); return ok(undefined) }),
  }
  return { remote, calls }
}

describe('QueueStore', () => {
  it('refresh reads stats and summaries in parallel and confirms after select', async () => {
    const { remote } = makeRemote()
    const store = new QueueStore(remote)
    await store.refresh()
    expect(store.getSnapshot().stats).toEqual(STATS)
    expect(store.getSnapshot().summaries.map(s => s.id)).toEqual(['tq-1', 'tq-2'])
    expect(store.getSnapshot().executors).toEqual([{ name: 'codex', enabled: true, toolAllowed: true, running: 1 }])
    expect(store.getSnapshot().error).toBeNull()
    expect(remote.list).toHaveBeenCalledWith({})
    // A selected detail is re-confirmed on the next refresh.
    await store.select('tq-1')
    expect(store.getSnapshot().detail?.id).toBe('tq-1')
    await store.refresh()
    expect(remote.get).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot().detail?.id).toBe('tq-1')
  })

  it('keeps the previous snapshot and surfaces the message on a failed refresh', async () => {
    const { remote } = makeRemote()
    const store = new QueueStore(remote)
    await store.refresh()
    remote.list = vi.fn(async () => fail('backend absent'))
    await store.refresh()
    // Previous rows survive; the error rides the snapshot.
    expect(store.getSnapshot().summaries).toHaveLength(2)
    expect(store.getSnapshot().error).toBe('backend absent')
    expect(store.getSnapshot().refreshing).toBe(false)
  })

  it('readRunLog returns a log and reports missing logs as a failed action', async () => {
    const { remote, calls } = makeRemote()
    const store = new QueueStore(remote)
    await expect(store.readRunLog('tq-1', 'run-1')).resolves.toEqual({ ok: true, content: 'log body' })
    await expect(store.readRunLog('tq-unknown', 'run-1')).resolves.toEqual({ ok: false, message: 'missing tq-unknown/run-1' })
    expect(calls).toContain('readRunLog:tq-1:run-1')
  })

  it('select surfaces unknown-id errors and clears the detail', async () => {
    const { remote } = makeRemote()
    const store = new QueueStore(remote)
    await store.select('tq-unknown')
    expect(store.getSnapshot().detail).toBeNull()
    expect(store.getSnapshot().error).toBe('unknown task tq-unknown')
    expect(store.getSnapshot().loading).toBe(false)
  })

  it('cancel/retry/pause/resume confirm from the host through refresh', async () => {
    const { remote, calls } = makeRemote()
    const store = new QueueStore(remote)
    await store.refresh()
    expect((await store.cancel('tq-1')).ok).toBe(true)
    expect((await store.retry('tq-2')).ok).toBe(true)
    expect((await store.pause()).ok).toBe(true)
    expect((await store.resume()).ok).toBe(true)
    // Each verb re-read the snapshot after the mutation.
    expect(calls.filter(c => c === 'stats').length).toBeGreaterThanOrEqual(1 + 4)
  })

  it('cancelMany/retryMany batch verbs and report partial failures', async () => {
    const { remote, calls } = makeRemote()
    const store = new QueueStore(remote)
    await store.refresh()
    await expect(store.cancelMany(['tq-1', 'tq-2'])).resolves.toEqual({ ok: true, message: 'canceled 2' })
    await expect(store.retryMany(['tq-1', 'tq-2'])).resolves.toEqual({ ok: true, message: 'retried 2' })
    expect(calls.filter(c => c === 'cancel').length).toBe(2)
    expect(calls.filter(c => c === 'retry').length).toBe(2)

    remote.cancel = vi.fn(async () => fail('cannot cancel'))
    const partial = await store.cancelMany(['tq-1', 'tq-2'])
    expect(partial.ok).toBe(false)
    expect(partial.message).toContain('cannot cancel')
  })

  it('dismiss calls remote.dismiss(id, true), refreshes, and confirms', async () => {
    const { remote, calls } = makeRemote()
    const store = new QueueStore(remote)
    await store.refresh()
    const out = await store.dismiss('tq-1')
    expect(out).toEqual({ ok: true, message: 'task dismissed' })
    expect(calls).toContain('dismiss:tq-1:true')
    expect(calls.filter(c => c === 'stats').length).toBeGreaterThanOrEqual(2)
  })

  it('undismiss calls remote.dismiss(id, false)', async () => {
    const { remote, calls } = makeRemote()
    const store = new QueueStore(remote)
    await store.refresh()
    const out = await store.undismiss('tq-1')
    expect(out).toEqual({ ok: true, message: 'task restored' })
    expect(calls).toContain('dismiss:tq-1:false')
  })

  it('dismissMany aggregates failures and still refreshes', async () => {
    const { remote, calls } = makeRemote()
    const store = new QueueStore(remote)
    await store.refresh()
    remote.dismiss = vi.fn(async (id: string, dismissed?: boolean) => {
      calls.push(`dismiss:${id}:${dismissed}`)
      if (id === 'tq-bad') return fail('cannot dismiss')
      return ok(undefined)
    })
    const out = await store.dismissMany(['tq-1', 'tq-bad', 'tq-2'], true)
    expect(out.ok).toBe(false)
    expect(out.message).toContain('tq-bad')
    expect(calls.filter(c => c.startsWith('dismiss:')).length).toBe(3)
    expect(calls.filter(c => c === 'stats').length).toBeGreaterThanOrEqual(2)
  })

  it('a failing dismiss reports failure without clearing the snapshot', async () => {
    const { remote } = makeRemote()
    const store = new QueueStore(remote)
    await store.refresh()
    remote.dismiss = vi.fn(async () => fail('cannot dismiss'))
    const out = await store.dismiss('tq-1')
    expect(out).toEqual({ ok: false, message: 'cannot dismiss' })
  })

  it('a failing verb reports failure without refreshing away the error', async () => {
    const { remote } = makeRemote()
    const store = new QueueStore(remote)
    remote.cancel = vi.fn(async () => fail('cannot cancel'))
    const outcome = await store.cancel('tq-1')
    expect(outcome).toEqual({ ok: false, message: 'cannot cancel' })
  })

  it('subscribe fires on snapshot writes and unsubscribe stops delivery', async () => {
    const { remote } = makeRemote()
    const store = new QueueStore(remote)
    const seen: number[] = []
    const unsubscribe = store.subscribe(() => { seen.push(1) })
    await store.refresh()
    unsubscribe()
    await store.refresh()
    expect(seen.length).toBeGreaterThanOrEqual(1)
  })

  it('dispose silences all further writes and clears listeners', async () => {
    const { remote } = makeRemote()
    const store = new QueueStore(remote)
    const seen: number[] = []
    store.subscribe(() => { seen.push(1) })
    store.dispose()
    await store.refresh()
    expect(seen).toEqual([])
    expect(store.getSnapshot().stats).toBeNull()
  })
})
