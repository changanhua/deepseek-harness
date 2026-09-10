import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAssistantActivity } from '../src/assistant-activity.js'
import type { ActivityBatch, ActivityEvent, ActivityPolicy, ActivitySettings, ActivityState, ConfigureActivity } from '../../../packages/browser/browser-activity/src/types.ts'

const KEY = 'dsh.assistant.activity-buffer.v1'
let serial = 0
const id = () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`
const installationId = id()
const connection = () => ({ baseUrl: 'https://dsh.test', phase: 'connected',
  grant: { installationId, grantEpoch: 1, scopes: ['session:interact', 'browser:read', 'browser:observe'] } })
const settings = (enabled = true): ActivitySettings => ({ enabled, sessionId: 'session', origins: ['https://page.test'], kinds: ['visit'],
  minIntervalMs: 1000, retentionDays: 1, maxEvents: 100, maxTextChars: 100 })
const event = (): ActivityEvent => ({ id: id(), kind: 'visit', at: 1000, tabId: 1, title: 'Article', url: 'https://page.test/article' })
interface ActivityApi {
  read(): { phase: string; buffered: number; discarded: number; pendingConfiguration: boolean; results: unknown[] }
  restore(): Promise<void>
  connectionChanged(state: ReturnType<typeof connection>): Promise<void>
  policy(): ActivityPolicy | null
  configure(input: ActivitySettings): Promise<void>
  enqueue(events: ActivityEvent[]): void
  flush(): Promise<void>
  sync(): Promise<void>
  retry(): Promise<void>
  query(input: object): Promise<void>
  stop(): void
}
const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).forEach((close) =>{  close() }); vi.useRealTimers() })

function harness(initial: Record<string, unknown> = {}, hostState?: ActivityState) {
  const values = structuredClone(initial)
  const storage = {
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(values[key]) })),
    set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(values, structuredClone(patch)) }),
  }
  let current = connection()
  let state: ActivityState = hostState ?? { revision: null, policy: null, sequence: 0, authorizationChanged: false }
  let configurationId: string | null = null
  const received = new Map<string, ActivityEvent[]>()
  const call = vi.fn(async (method: string, params: unknown): Promise<unknown> => {
    if (method === 'activity.state') return structuredClone(state)
    if (method === 'activity.configure') {
      const request = params as ConfigureActivity
      if (configurationId !== request.requestId) {
        const revision = id(); configurationId = request.requestId
        state = { revision, policy: { ...request.settings, revision, grantEpoch: current.grant.grantEpoch },
          sequence: 0, authorizationChanged: false }
      }
      return structuredClone(state)
    }
    if (method === 'activity.append') {
      const batch = params as ActivityBatch
      received.set(batch.id, batch.events); state = { ...state, sequence: batch.sequence }
      return { sequence: batch.sequence, accepted: batch.events.length }
    }
    if (method === 'activity.query') return { events: [...received.values()].flat() }
    throw new Error('unknown method')
  })
  const hasOrigins = vi.fn(async () => true)
  const raw: unknown = createAssistantActivity({ storage, call, getConnection: () => current, hasOrigins })
  const activity = raw as ActivityApi; cleanup.push(() => { activity.stop() })
  const start = async () => { await activity.restore(); await activity.connectionChanged(current) }
  return { activity, storage, values, call, received, hasOrigins, start, get state() { return state },
    changeConnection: (next: typeof current) => { current = next; return activity.connectionChanged(current) } }
}

describe('bounded activity transport', () => {
  it('refuses enabled configuration without persistent Chrome permission but still permits an explicit pause', async () => {
    const h = harness(); await h.start(); h.hasOrigins.mockResolvedValue(false)
    await expect(h.activity.configure(settings())).rejects.toThrow('page_permission_required')
    expect(h.call.mock.calls.some(([method]) => method === 'activity.configure')).toBe(false)
    expect(h.storage.set).not.toHaveBeenCalled()
    h.hasOrigins.mockResolvedValue(true); await h.activity.configure(settings())
    h.hasOrigins.mockResolvedValue(false); await h.activity.configure(settings(false))
    expect(h.activity.read().phase).toBe('paused')
  })
  it('rechecks durable Chrome permission before uploading an already buffered event', async () => {
    const h = harness(); await h.start(); await h.activity.configure(settings())
    h.activity.enqueue([event()]); h.hasOrigins.mockResolvedValue(false)
    await expect(h.activity.flush()).rejects.toThrow('page_permission_required')
    expect(h.call.mock.calls.some(([method]) => method === 'activity.append')).toBe(false)
    expect(h.activity.policy()).toBeNull()
  })
  it('collects only after explicit configuration and persists a batch before sending it', async () => {
    const h = harness(); await h.start()
    expect(h.activity.policy()).toBeNull()
    h.activity.enqueue([event()]); expect(h.activity.read().buffered).toBe(0)
    await h.activity.configure(settings()); expect(h.activity.policy()?.enabled).toBe(true)
    const fact = event(); h.activity.enqueue([fact])
    const original = h.call.getMockImplementation()!
    h.call.mockImplementationOnce(async (method, params) => {
      expect(method).toBe('activity.append'); expect(h.values[KEY]).toMatchObject({ batch: params })
      return original(method, params)
    })
    await h.activity.flush()
    expect([...h.received.values()]).toEqual([[fact]])
    expect(h.activity.read().buffered).toBe(0)
    expect(h.values[KEY]).toMatchObject({ batch: null, configuration: null })
  })

  it('replays one identical persisted batch after a lost receipt and worker restart', async () => {
    const h = harness(); await h.start(); await h.activity.configure(settings())
    h.activity.enqueue([event()])
    const original = h.call.getMockImplementation()!
    h.call.mockImplementationOnce(async (method, params) => { await original(method, params); throw new Error('lost response') })
    await expect(h.activity.flush()).rejects.toThrow('lost response')
    const input = h.call.mock.calls.find(([method]) => method === 'activity.append')?.[1]
    h.activity.stop()
    const reopened = harness(h.values, h.state); await reopened.start()
    expect(reopened.call.mock.calls.find(([method]) => method === 'activity.append')?.[1]).toEqual(input)
    expect(reopened.activity.read().buffered).toBe(0)
  })

  it('bounds a blocked upload plus new memory events and reports overflow', async () => {
    const h = harness(); await h.start(); await h.activity.configure(settings())
    h.activity.enqueue(Array.from({ length: 32 }, event))
    h.call.mockRejectedValueOnce(new Error('offline'))
    await expect(h.activity.flush()).rejects.toThrow('offline')
    h.activity.enqueue(Array.from({ length: 32 }, event)); h.activity.enqueue([event()])
    expect(h.activity.read()).toMatchObject({ buffered: 64, discarded: 1 })
  })

  it('pauses locally before remote confirmation and does not replay an unconfirmed configuration automatically', async () => {
    const h = harness(); await h.start(); await h.activity.configure(settings())
    let release!: () => void
    h.call.mockImplementationOnce(() => new Promise((_resolve, reject) => { release = () => { reject(new Error('lost pause')) } }))
    const paused = h.activity.configure(settings(false))
    expect(h.activity.policy()).toBeNull()
    await vi.waitFor(() => { expect(release).toBeTypeOf('function') })
    release(); await expect(paused).rejects.toThrow('lost pause')
    const pending = h.values[KEY]
    h.activity.stop()
    const reopened = harness(h.values, h.state); await reopened.start()
    expect(reopened.activity.policy()).toBeNull()
    expect(reopened.call.mock.calls.some(([method]) => method === 'activity.configure')).toBe(false)
    expect(reopened.values[KEY]).toEqual(pending)
    await reopened.activity.retry()
    expect(reopened.activity.read().phase).toBe('paused')
  })

  it('does not upload old data to another Host or accept delayed search results after disconnect', async () => {
    const h = harness(); await h.start(); await h.activity.configure(settings())
    h.activity.enqueue([event()]); h.call.mockRejectedValueOnce(new Error('lost'))
    await expect(h.activity.flush()).rejects.toThrow()
    await expect(h.changeConnection({ ...connection(), baseUrl: 'https://other.test' })).rejects.toThrow('activity_target_changed')
    expect(h.activity.policy()).toBeNull()
    expect(h.call.mock.calls.filter(([method]) => method === 'activity.append')).toHaveLength(1)
    await h.changeConnection(connection())
    let release!: (value: unknown) => void
    h.call.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const query = h.activity.query({})
    await vi.waitFor(() => { expect(release).toBeTypeOf('function') })
    await h.changeConnection({ ...connection(), phase: 'offline' })
    release({ events: [event()] }); await query
    expect(h.activity.read().results).toEqual([])
  })

  it('fails closed on uncertain local storage and rejects out-of-policy event payloads', async () => {
    const h = harness(); await h.start(); await h.activity.configure(settings())
    expect(() =>{  h.activity.enqueue([event(), { ...event(), url: 'https://elsewhere.test' }]) }).toThrow('activity_outside_policy')
    expect(h.activity.read().buffered).toBe(0)
    h.activity.enqueue([event()]); h.storage.set.mockRejectedValueOnce(new Error('uncertain storage'))
    await expect(h.activity.flush()).rejects.toThrow('activity_storage_unavailable')
    expect(h.activity.policy()).toBeNull()
    expect(h.call.mock.calls.some(([method]) => method === 'activity.append')).toBe(false)
  })

  it('requires current-connection policy sync and follows a reconnect that overtakes the first refresh', async () => {
    const h = harness(); await h.activity.restore()
    let release!: (value: unknown) => void
    h.call.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const initial = h.changeConnection(connection())
    await vi.waitFor(() => { expect(release).toBeTypeOf('function') })
    expect(() => h.activity.configure(settings())).toThrow('activity_sync_required')
    const changed = h.changeConnection({ ...connection(), baseUrl: 'https://second.test' })
    release(h.state); await initial; await changed
    expect(h.call.mock.calls.filter(([method]) => method === 'activity.state')).toHaveLength(2)
    await h.activity.configure(settings())
    expect(h.values[KEY]).toMatchObject({ owner: { baseUrl: 'https://second.test' }, configuration: null })
  })

  it('releases a definitely rejected stale configuration but persists a local hold until a fresh explicit save', async () => {
    const h = harness(); await h.start(); await h.activity.configure(settings())
    h.call.mockRejectedValueOnce(Object.assign(new Error('stale revision'), { code: 'activity_configuration_changed' }))
    await expect(h.activity.configure(settings(false))).rejects.toThrow('stale revision')
    expect(h.activity.read()).toMatchObject({ phase: 'paused-local', pendingConfiguration: false })
    expect(h.values[KEY]).toMatchObject({ configuration: null, hold: true })
    h.activity.stop()
    const reopened = harness(h.values, h.state); await reopened.start()
    expect(reopened.activity.policy()).toBeNull()
    expect(reopened.activity.read().phase).toBe('paused-local')
    await reopened.activity.configure(settings(false))
    expect(reopened.activity.read().phase).toBe('paused')
    expect(reopened.values[KEY]).toMatchObject({ hold: false })
  })
})
