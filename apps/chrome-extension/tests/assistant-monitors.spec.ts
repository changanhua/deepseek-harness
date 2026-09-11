import { afterEach, describe, expect, test, vi } from 'vitest'
import { createAssistantMonitors } from '../src/assistant-monitors.js'

const KEY = 'dsh.assistant.monitor-create.v1'
let serial = 0
const id = () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`
const installationId = id()
const connection = () => ({ baseUrl: 'https://dsh.test', phase: 'connected',
  grant: { installationId, grantEpoch: 1, scopes: ['session:interact', 'browser:read', 'browser:observe'] } })
const input = () => ({ requestId: id(), sessionId: 'original-session', title: '检查', url: 'https://page.test/article',
  intervalMs: 1000, missedPolicy: 'latest', match: { kind: 'changed' } })
const notice = (monitorId: string) => ({ id: id(), monitorId, sessionId: 'original-session', kind: 'changed',
  title: '检查', message: '指定内容已变化', slot: 1000, createdAt: 1000 })
const plan = () => {
  const monitorId = id()
  return { id: monitorId, revision: id(), sessionId: 'original-session', title: '检查', url: 'https://page.test/article',
    enabled: true, outbox: [notice(monitorId)] }
}
const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach((stop) => { stop() }); vi.useRealTimers() })

interface MonitorApi {
  read(): {
    monitors: ReturnType<typeof plan>[]
    pendingCreate: null | { baseUrl: string; installationId: string; input: ReturnType<typeof input> }
  }
  restore(): Promise<void>
  connectionChanged(state: ReturnType<typeof connection>): Promise<void>
  sync(): Promise<void>
  create(value: ReturnType<typeof input>): Promise<void>
  retry(): Promise<void>
  control(method: string, params: { id: string; revision?: string; noticeId?: string }): Promise<void>
  stop(): void
}
function deferred<T>() {
  let settle: (value: T) => void = () => { throw new Error('resolver not initialized') }
  const promise = new Promise<T>((resolve) => { settle = resolve })
  return { promise, resolve: settle }
}

function harness(initial: Record<string, unknown> = {}) {
  const values = structuredClone(initial)
  const storage = {
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(values[key]) })),
    set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(values, structuredClone(patch)) }),
  }
  let current = connection()
  let plans = [plan()]
  const call = vi.fn(async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    if (method === 'monitor.list') return { monitors: structuredClone(plans) }
    if (method === 'monitor.create') return { id: params.requestId, sessionId: params.sessionId, url: params.url }
    return { acknowledged: true }
  })
  const changed = vi.fn()
  const api: unknown = createAssistantMonitors({ storage, call, getConnection: () => current, changed, pollMs: 15000 })
  const monitors = api as MonitorApi
  cleanups.push(() => { monitors.stop() })
  const start = async () => { await monitors.restore(); await monitors.connectionChanged(current) }
  return { monitors, start, call, storage, values, changed, get plans() { return plans },
    setPlans: (next: typeof plans) => { plans = next },
    setConnection: (next: typeof current) => { current = next; return monitors.connectionChanged(current) } }
}

describe('browser monitor presentation and pending creation', () => {
  test('persists intent before sending and reuses its original id and session after restart', async () => {
    const h = harness(); await h.start()
    const original = input()
    h.call.mockImplementationOnce(async (method, params) => {
      expect(method).toBe('monitor.create')
      expect(h.values[KEY]).toMatchObject({ version: 1, pending: { input: params } })
      throw Object.assign(new Error('lost'), { code: 'result_unknown' })
    })
    await expect(h.monitors.create(original)).rejects.toThrow('result_unknown')
    expect(h.monitors.read().pendingCreate?.input).toEqual(original)
    h.monitors.stop()
    const restarted = harness(h.values); await restarted.start()
    expect(restarted.call.mock.calls.filter(([method]) => method === 'monitor.create')).toHaveLength(0)
    await restarted.monitors.retry()
    expect(restarted.call.mock.calls.find(([method]) => method === 'monitor.create')?.[1]).toEqual(original)
    expect(restarted.monitors.read().pendingCreate).toBeNull()
    expect(restarted.values[KEY]).toEqual({ version: 1, pending: null })
  })

  test('an uncertain local write cannot issue a request or allow replacement with a new intent', async () => {
    const h = harness(); await h.start()
    h.storage.set.mockImplementationOnce(async (patch) => { Object.assign(h.values, patch); throw new Error('write reply lost') })
    await expect(h.monitors.create(input())).rejects.toThrow('monitor_storage_failed')
    expect(h.call.mock.calls.filter(([method]) => method === 'monitor.create')).toHaveLength(0)
    await expect(h.monitors.create(input())).rejects.toThrow('monitor_storage_failed')
    const restarted = harness(h.values); await restarted.start()
    expect(restarted.monitors.read().pendingCreate).not.toBeNull()
  })

  test('background refresh retains one notification id and never writes a second local notification database', async () => {
    vi.useFakeTimers()
    const h = harness(); await h.start()
    const firstId = h.monitors.read().monitors[0]?.outbox[0]?.id
    expect(firstId).toBe(h.plans[0]?.outbox[0]?.id)
    await vi.advanceTimersByTimeAsync(30001)
    expect(h.call.mock.calls.filter(([method]) => method === 'monitor.list')).toHaveLength(3)
    expect(h.monitors.read().monitors[0]?.outbox).toHaveLength(1)
    expect(h.monitors.read().monitors[0]?.outbox[0]?.id).toBe(firstId)
    expect(h.storage.set).not.toHaveBeenCalled()
    h.monitors.stop(); await vi.advanceTimersByTimeAsync(30001)
    expect(h.call).toHaveBeenCalledTimes(3)
  })

  test('a response from the previous connection cannot restore its plan list after switching hosts', async () => {
    const h = harness(); await h.start()
    const old = structuredClone(h.plans)
    const reply = deferred<unknown>()
    h.call.mockImplementationOnce(() => reply.promise)
    const syncing = h.monitors.sync()
    const nextPlans = [plan()]; h.setPlans(nextPlans)
    const switched = h.setConnection({ ...connection(), baseUrl: 'https://other-dsh.test' })
    reply.resolve({ monitors: old }); await syncing; await switched
    expect(h.monitors.read().monitors).toEqual(nextPlans)
    const revoked = h.setConnection({ ...connection(), phase: 'offline' }); await revoked
    expect(h.monitors.read().monitors).toEqual([])
  })

  test('pending creation cannot be replayed against another installation or without observation permission', async () => {
    const h = harness(); await h.start()
    h.call.mockRejectedValueOnce(Object.assign(new Error('lost'), { code: 'result_unknown' }))
    await h.monitors.create(input()).catch(() => {})
    await h.setConnection({ ...connection(), grant: { ...connection().grant, installationId: id() } })
    await expect(h.monitors.retry()).rejects.toThrow('target_changed')
    expect(h.call.mock.calls.filter(([method]) => method === 'monitor.create')).toHaveLength(1)
    await h.setConnection({ ...connection(), grant: { ...connection().grant, scopes: ['session:interact', 'browser:read'] } })
    expect(() => h.monitors.create(input())).toThrow('observation_not_authorized')
  })

  test('controls use the viewed revision and acknowledgements remain visible until Host confirms removal', async () => {
    const h = harness(); await h.start()
    const selected = h.plans[0]
    if (!selected) throw new Error('missing plan')
    await h.monitors.control('monitor.pause', { id: selected.id, revision: selected.revision })
    expect(h.call.mock.calls.find(([method]) => method === 'monitor.pause')?.[1])
      .toEqual({ id: selected.id, revision: selected.revision })
    await expect(h.monitors.control('monitor.resume', { id: selected.id, revision: id() })).rejects.toThrow('control_superseded')
    const noticeId = selected.outbox[0]?.id
    if (!noticeId) throw new Error('missing notice')
    h.call.mockRejectedValueOnce(Object.assign(new Error('lost'), { code: 'result_unknown' }))
    await expect(h.monitors.control('monitor.acknowledge', { id: selected.id, noticeId })).rejects.toThrow('lost')
    expect(h.monitors.read().monitors[0]?.outbox[0]?.id).toBe(noticeId)
    h.setPlans([{ ...selected, outbox: [] }]); await h.monitors.sync()
    expect(h.monitors.read().monitors[0]?.outbox).toEqual([])
  })

  test('an unrelated successful receipt does not clear the original pending creation', async () => {
    const h = harness(); await h.start()
    const original = input()
    h.call.mockResolvedValueOnce({ id: id(), sessionId: original.sessionId, url: original.url })
    await expect(h.monitors.create(original)).rejects.toThrow('invalid_monitor_receipt')
    expect(h.monitors.read().pendingCreate?.input.requestId).toBe(original.requestId)
    await h.monitors.retry()
    expect(h.monitors.read().pendingCreate).toBeNull()
  })
})
