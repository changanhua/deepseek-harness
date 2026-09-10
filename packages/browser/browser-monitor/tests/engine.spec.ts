import { createHash, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { Browser, BrowserInstance } from '@changanhua/dsh-browser'
import { AttemptId, WorkId, type OperatorWorkQueue, type WorkHandler, type WorkView } from '@changanhua/dsh-task-queue'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { MonitorEngine } from '../src/engine.ts'
import { monitorDomainSpec } from '../src/spec.ts'
import type { CreateMonitor } from '../src/types.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

function queueHarness() {
  const views = new Map<WorkId, WorkView>()
  const receipts = new Map<string, WorkId>()
  let handler: WorkHandler<'browser.monitor.check@1'>
  const cancel = vi.fn(async (id: WorkId) => {
    const view = views.get(id)!
    views.set(id, { ...view, state: { ...view.state, status: 'canceled' } })
  })
  const resolveUnknown = vi.fn<OperatorWorkQueue['resolveUnknown']>(async (id, resolution) => {
    const view = views.get(id)!
    views.set(id, { ...view, state: { ...view.state, status: resolution.kind === 'authorize-retry' ? 'queued' : 'failed' } })
  })
  const operator: OperatorWorkQueue = {
    enqueue: async (request) => {
      const known = receipts.get(request.idempotencyKey)
      if (known) return known
      const { MonitorCheckSchema } = await import('../src/schemas.ts')
      const input = MonitorCheckSchema.parse(request.input)
      const resolved = await handler.resolveAdmission(input, { signal: new AbortController().signal })
      const id = WorkId(randomUUID()); const now = new Date().toISOString()
      views.set(id, { work: { id, kind: 'browser.monitor.check@1', intent: input, resolved,
        title: request.title, intentDigest: '', policy: handler.policy(resolved), resources: [], tags: [],
        batchId: null, ownerSessionId: null, createdAt: now }, state: { workId: id, status: 'queued', attemptCount: 0,
        activeAttemptId: null, resultId: null, failure: null, cancelRequestedAt: null, updatedAt: now }, attempts: [], result: null })
      receipts.set(request.idempotencyKey, id)
      return id
    },
    enqueueBatch: async () => { throw new Error('unused') }, list: () => [...views.values()],
    dispatchState: () => 'running', waitReason: () => null,
    get: (id) => { const view = views.get(id); if (!view) throw new Error('missing'); return view },
    cancel, retry: async () => { throw new Error('unused') }, pause: () => {}, resume: () => {},
    resolveUnknown, pendingAttentions: () => [],
  }
  const run = async (id = [...views.keys()].at(-1)!) => {
    const view = views.get(id)!
    const { MonitorCheckSchema } = await import('../src/schemas.ts')
    const check = MonitorCheckSchema.parse(view.work.intent)
    const context = { attemptId: AttemptId(randomUUID()), signal: new AbortController().signal }
    const prepared = await handler.prepare({ ...check, installationId }, context)
    views.set(id, { ...view, state: { ...view.state, status: 'running' } })
    const result = await handler.start(prepared, context).done
    views.set(id, { ...view, state: { ...view.state, status: result.status } })
    return result
  }
  return { operator, run, views, receipts, cancel, resolveUnknown,
    bind: (value: typeof handler) => { handler = value } }
}

const installationId = randomUUID()
const url = 'https://example.test/article'
const instance: BrowserInstance = { installationId, extensionId: 'extension', grantEpoch: 1, online: true,
  origins: ['https://example.test'], scopes: ['browser:read', 'browser:observe'] }
const create = (extra: Partial<CreateMonitor> = {}): CreateMonitor => ({
  requestId: randomUUID(), sessionId: 'session', installationId, url, title: '网页检查',
  intervalMs: 1000, missedPolicy: 'latest', match: { kind: 'changed' }, ...extra,
})

async function harness(pool = new MemoryMediaPool(), queue = queueHarness()) {
  const ctx = new Context()
  const storage = await ctx.plugin(Storage)
  const backend = new MemoryStorageBackend(pool)
  ctx.storage.backend.register('memory', { guarantees: ['single-writer', 'commit-sync', 'private-root'],
    kv: backend.kv, close: () => backend.close() })
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  const domain = await facility.open(monitorDomainSpec)
  const state = { now: 1000, text: 'before', instance: structuredClone(instance), truncated: false }
  const observe = vi.fn<Browser['observe']>(async operation => ({
    requestId: randomUUID(), sessionId: operation.sessionId, installationId, outcome: 'observed', delivery: 'sent',
    value: operation.action.kind === 'tabs' ? { tabs: [{ tabId: 1, url }] } : {
      text: state.text, textTruncated: state.truncated, page: { tabId: 1, frameId: 0, documentId: 'doc', url },
    },
  }))
  const browser = { instances: vi.fn<Browser['instances']>(async () => [state.instance]), observe }
  const engine = new MonitorEngine(domain.table('monitors'), browser, queue.operator,
    { maxMonitors: 4, checkTimeoutMs: 10000, now: () => state.now })
  queue.bind(engine.handler)
  const close = async () => { await engine.close(); await domain.close(); await storage.dispose() }
  cleanup.push(close)
  return { engine, domain, queue, state, browser, pool, close }
}

describe('Host browser monitor coordination', () => {
  test.each([null, 1000])('reconciles a committed sample after Queue reopens unknown (interval %s)', async (intervalMs) => {
    const first = await harness(); const input = create({ intervalMs })
    await first.engine.create(input); await first.engine.tick(); await first.queue.run()
    const saved = first.engine.list(installationId)[0]!
    const workId = [...first.queue.views.keys()][0]!
    expect(saved.settlement).toMatchObject({ workId, slot: 1000, revision: saved.revision, failure: null })
    const view = first.queue.views.get(workId)!
    first.queue.views.set(workId, { ...view, state: { ...view.state, status: 'unknown' } })
    await first.close()
    const restarted = await harness(first.pool, first.queue)
    await restarted.engine.tick()
    expect(restarted.queue.resolveUnknown).toHaveBeenCalledWith(workId, { kind: 'authorize-retry' })
    expect(restarted.browser.observe).not.toHaveBeenCalled()
    expect(await restarted.queue.run(workId)).toMatchObject({ status: 'succeeded', output: { outcome: 'already-recorded' } })
    await restarted.engine.tick()
    expect(restarted.engine.list(installationId)[0]).toMatchObject({ settlement: null, lastSample: saved.lastSample, outbox: saved.outbox })
    expect(restarted.browser.observe).not.toHaveBeenCalled()
    expect(restarted.queue.views.size).toBe(1)
  })

  test('cached failure settlement works after an explicit pause without reading the browser again', async () => {
    const first = await harness(); const input = create()
    await first.engine.create(input); await first.engine.tick(); first.state.instance = { ...first.state.instance, online: false }
    expect(await first.queue.run()).toMatchObject({ status: 'failed' })
    const workId = [...first.queue.views.keys()][0]!, view = first.queue.views.get(workId)!
    await first.engine.pause(input.requestId, installationId)
    first.queue.views.set(workId, { ...view, state: { ...view.state, status: 'unknown' } })
    const saved = first.engine.list(installationId)[0]!
    await first.engine.tick()
    expect(await first.queue.run(workId)).toMatchObject({ status: 'failed', failure: { category: 'browser_unavailable' } })
    await first.engine.tick()
    expect(first.engine.list(installationId)[0]).toMatchObject({ enabled: false, settlement: null, outbox: saved.outbox })
    expect(first.browser.observe).not.toHaveBeenCalled()
  })

  test('revocation before an enqueued acknowledgement commits preserves its notification', async () => {
    const h = await harness(); const input = create({ intervalMs: null })
    await h.engine.create(input); await h.engine.tick(); await h.queue.run()
    const notice = h.engine.list(installationId)[0]!.outbox[0]!
    const table = h.domain.table('monitors'); const original = table.put.bind(table)
    const barrier = Promise.withResolvers<undefined>()
    const write = vi.spyOn(table, 'put').mockImplementationOnce(async (key, value) => {
      await barrier.promise; await original(key, value)
    })
    const creating = h.engine.create(create())
    await vi.waitFor(() => { expect(write).toHaveBeenCalledOnce() })
    let allowed = true
    const ack = h.engine.acknowledge(input.requestId, installationId, notice.id, () => {
      if (!allowed) throw new Error('revoked')
    })
    const rejected = expect(ack).rejects.toThrow('revoked')
    allowed = false; barrier.resolve(undefined)
    await creating; await rejected
    expect(h.engine.list(installationId)[0]!.outbox).toEqual([notice])
  })

  test('creation reuses the durable receipt after scope withdrawal without admitting a new plan', async () => {
    const h = await harness(); const input = create({ match: { kind: 'appears', text: 'available' } })
    const first = await h.engine.create(input)
    h.state.instance = { ...h.state.instance, scopes: ['browser:read'] }
    expect(await h.engine.create(input)).toEqual(first)
    await expect(h.engine.create({ ...input, match: { kind: 'appears', text: 'different' } })).rejects.toThrow('request_conflict')
    await expect(h.engine.create({ ...input, requestId: randomUUID() })).rejects.toThrow('observation_not_authorized')
  })

  test('reserves both change and recovery notices before admission and resumes after acknowledgement', async () => {
    const h = await harness(); const input = create()
    await h.engine.create(input); await h.engine.tick(); await h.queue.run()
    const record = h.engine.list(installationId)[0]!
    const notices = Array.from({ length: 31 }, () => ({ id: randomUUID(), monitorId: record.id, sessionId: record.sessionId,
      installationId, kind: 'changed' as const, title: record.title, message: 'prior', slot: 1000, createdAt: 1000 }))
    await h.domain.table('monitors').update(record.id, previous => ({ ...previous, outbox: notices,
      lastFailure: { code: 'browser_unavailable', message: 'offline', at: 1500 } }))
    h.state.now = 2100; h.state.text = 'changed'
    await h.engine.tick()
    expect(h.queue.views.size).toBe(1)
    expect(h.engine.list(installationId)[0]!.lastFailure?.code).toBe('browser_unavailable')
    await h.engine.acknowledge(record.id, installationId, notices[0]!.id)
    await h.engine.tick(); expect(await h.queue.run()).toMatchObject({ status: 'succeeded' })
    const after = h.engine.list(installationId)[0]!
    expect(after.outbox).toHaveLength(32)
    expect(after.outbox.slice(-2).map(notice => notice.kind)).toEqual(['changed', 'recovered'])
    expect(after.lastFailure).toBeNull()
  })

  test('persisted due slot survives reopen without a second Queue admission; notices retain identity until acknowledged', async () => {
    const first = await harness()
    const request = create()
    await first.engine.create(request)
    await Promise.all([first.engine.tick(), first.engine.tick()])
    expect(first.queue.views.size).toBe(1)
    await first.close()
    const second = await harness(first.pool, first.queue)
    await second.engine.tick()
    expect(first.queue.views.size).toBe(1)
    expect(await second.queue.run()).toMatchObject({ status: 'succeeded' })
    expect(second.engine.list(installationId)[0]!.outbox).toEqual([])
    second.state.now = 2100; second.state.text = 'after'
    await second.engine.tick(); await second.queue.run()
    const changed = second.engine.list(installationId)[0]!
    expect(changed.outbox).toHaveLength(1)
    expect(changed.lastSample?.digest).toBe(createHash('sha256').update('after').digest('hex'))
    await second.close()
    const third = await harness(first.pool, first.queue)
    expect(third.engine.list(installationId)[0]!.outbox).toEqual(changed.outbox)
    await third.engine.acknowledge(request.requestId, installationId, changed.outbox[0]!.id)
    await third.engine.acknowledge(request.requestId, installationId, changed.outbox[0]!.id)
    expect(third.engine.list(installationId)[0]!.outbox).toEqual([])
  })

  test('offline and truncated observations retain baseline; reauthorization pauses before another browser read', async () => {
    const h = await harness(); const request = create()
    h.state.text = 'SECRET_MONITOR_BODY_967257'
    await h.engine.create(request); await h.engine.tick(); await h.queue.run()
    const baseline = h.engine.list(installationId)[0]!.lastSample
    expect(JSON.stringify([...h.domain.table('monitors').entries()])).not.toContain(h.state.text)
    h.state.now = 2100; h.state.instance = { ...h.state.instance, online: false }
    await h.engine.tick(); expect(await h.queue.run()).toMatchObject({ status: 'failed' })
    expect(h.engine.list(installationId)[0]!.lastSample).toEqual(baseline)
    expect(h.engine.list(installationId)[0]!.lastFailure?.code).toBe('browser_unavailable')
    h.state.now = 3100; h.state.instance = { ...h.state.instance, online: true }; h.state.truncated = true
    await h.engine.tick(); await h.queue.run()
    expect(h.engine.list(installationId)[0]!.lastFailure?.code).toBe('observation_truncated')
    h.state.now = 4100; h.state.instance = { ...h.state.instance, grantEpoch: 2 }
    const reads = h.browser.observe.mock.calls.length
    await h.engine.tick(); await h.queue.run()
    expect(h.browser.observe).toHaveBeenCalledTimes(reads)
    expect(h.engine.list(installationId)[0]).toMatchObject({ enabled: false, lastFailure: { code: 'authorization_changed' } })
    await h.engine.resume(request.requestId, installationId)
    expect(h.engine.list(installationId)[0]).toMatchObject({ enabled: true, grantEpoch: 2 })
  })

  test('pause fences a read whose provider returns late; later pause wins over a pending resume', async () => {
    const h = await harness(); const request = create()
    await h.engine.create(request); await h.engine.tick()
    const reply = Promise.withResolvers<Awaited<ReturnType<Browser['observe']>>>()
    h.browser.observe.mockImplementationOnce(() => reply.promise)
    const running = h.queue.run()
    await vi.waitFor(() => { expect(h.browser.observe).toHaveBeenCalledOnce() })
    await h.engine.pause(request.requestId, installationId)
    const operation = h.browser.observe.mock.calls[0]![0]
    reply.resolve({ requestId: randomUUID(), sessionId: operation.sessionId, installationId, outcome: 'observed', delivery: 'sent',
      value: { tabs: [{ tabId: 1, url }] } })
    expect(await running).toMatchObject({ status: 'canceled' })
    expect(h.engine.list(installationId)[0]).toMatchObject({ enabled: false, lastSample: null, outbox: [] })
    const grant = Promise.withResolvers<readonly BrowserInstance[]>()
    h.browser.instances.mockImplementationOnce(() => grant.promise)
    const resume = h.engine.resume(request.requestId, installationId)
    const rejected = expect(resume).rejects.toThrow('control_superseded')
    await h.engine.pause(request.requestId, installationId)
    grant.resolve([instance]); await rejected
    expect(h.engine.list(installationId)[0]!.enabled).toBe(false)
  })

  test('unknown recovery is bounded and cannot resolve unrelated Queue work', async () => {
    const h = await harness(); const request = create()
    await h.engine.create(request); await h.engine.tick()
    const workId = [...h.queue.views.keys()][0]!
    for (let index = 0; index < 3; index++) {
      const view = h.queue.views.get(workId)!
      h.queue.views.set(workId, { ...view, state: { ...view.state, status: 'unknown' } })
      await h.engine.tick()
    }
    expect(h.queue.resolveUnknown.mock.calls.map(([, resolution]) => resolution.kind))
      .toEqual(['authorize-retry', 'authorize-retry', 'confirm-failed'])
    expect(h.engine.list(installationId)[0]).toMatchObject({ enabled: false, lastFailure: { code: 'recovery_exhausted' } })
    await h.engine.resume(request.requestId, installationId); await h.engine.tick()
    const newId = [...h.queue.views.keys()].at(-1)!; const view = h.queue.views.get(newId)!
    h.queue.views.set(newId, { ...view, work: { ...view.work, intent: { monitorId: randomUUID(), revision: randomUUID(), slot: 1 } },
      state: { ...view.state, status: 'unknown' } })
    await h.engine.tick()
    expect(h.queue.resolveUnknown).toHaveBeenCalledTimes(3)
    expect(h.engine.list(installationId)[0]!.lastFailure?.code).toBe('queue_record_mismatch')
  })

  test('a result persistence failure becomes unknown and stops further reads until reopen', async () => {
    const h = await harness(); const request = create({ intervalMs: null })
    await h.engine.create(request); await h.engine.tick()
    h.pool.failNextWrites = 1
    expect(await h.queue.run()).toMatchObject({ status: 'unknown', failure: { category: 'monitor_storage_failed' } })
    expect(() => h.engine.list(installationId)).toThrow('monitor_storage_failed')
    const reads = h.browser.observe.mock.calls.length
    expect(() => h.engine.tick()).toThrow('monitor_storage_failed')
    expect(h.browser.observe).toHaveBeenCalledTimes(reads)
  })
})
