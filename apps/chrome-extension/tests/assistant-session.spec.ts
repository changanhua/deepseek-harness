import { describe, expect, test, vi } from 'vitest'
import { createAssistantSession } from '../src/assistant-session.js'

const KEY = 'dsh.assistant.session.v1'
const installationId = '123e4567-e89b-42d3-a456-426614174000'
type InputPart = { type: 'text'
  text: string }
type SessionBinding = { baseUrl: string
  installationId: string
  sessionId: string }
type PendingInput = SessionBinding & { requestId: string
  content: InputPart[]
  mode: 'queue' | 'steer'
  status: string }
type PendingCreate = SessionBinding & { cwd?: string }
type SessionEvent = { type: string
  seq: number
  time: number
  data: Record<string, unknown> }
type SessionRecord = { type: 'event'
  event: SessionEvent }
type SnapshotEvent = { type: 'snapshot'
  header: { id: string
    version: number
    createdAt: number }
  records: SessionRecord[]
  cursor: number
  hasMore: boolean
  projections: Record<string, never> }
type SessionFrame = { type: 'event'
  streamId: string | null
  event?: SessionRecord | SnapshotEvent
  error?: { code: string
    message: string } }
type SessionState = { binding: SessionBinding | null
  pending: PendingInput | null
  pendingCreate: PendingCreate | null
  records: SessionRecord[]
  streamId: string | null
  error: { code: string } | null }
type SessionCall = [method: string, params: Record<string, unknown>]
type SessionConnection = { baseUrl: string
  phase: 'connected' | 'offline'
  grant?: { installationId: string
    scopes: string[] } }
type AssistantSession = {
  read: () => SessionState
  restore: () => Promise<SessionState>
  bind: (sessionId: string) => Promise<SessionState>
  create: (options?: { cwd?: string }) => Promise<SessionState>
  submit: (input: { content: InputPart[]
    mode?: 'queue' | 'steer' }) => Promise<unknown>
  retry: () => Promise<unknown>
  discardDraft: () => Promise<void>
  stop: () => Promise<unknown>
  onEvent: (frame: SessionFrame) => Promise<void>
  connectionChanged: (connection: SessionConnection) => Promise<void>
}
type Deferred<T> = { promise: Promise<T>
  resolve: (value: T) => void }

const connection = (): SessionConnection => ({ baseUrl: 'https://dsh.test', phase: 'connected', grant: { installationId, scopes: ['session:interact'] } })
const input = (): InputPart[] => [{ type: 'text', text: 'Original input' }]
const sessionState = (value: unknown): SessionState => value as SessionState
const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function harness(initial: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = structuredClone(initial)
  const set = async (patch: Record<string, unknown>) => { Object.assign(values, structuredClone(patch)) }
  const storage = {
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(values[key]) })),
    set: vi.fn(set),
  }
  let current = connection()
  const call = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === 'session.follow' || method === 'session.unfollow') return { streamId: params.streamId }
    if (method === 'session.create') return { sessionId: params.sessionId }
    if (method === 'session.prompt') {
      expect(params).toEqual({ requestId: expect.any(String) as unknown, sessionId: expect.any(String) as unknown,
        content: expect.any(Array) as unknown, mode: expect.any(String) as unknown, clientTimeZone: expect.any(String) as unknown })
      return { accepted: true }
    }
    if (method === 'session.cancel') return { accepted: true }
    throw new Error('Unexpected method ' + method)
  })
  const changed = vi.fn()
  const session = createAssistantSession({ storage, call, getConnection: () => current, changed }) as AssistantSession
  return { session, storage, values, set, call, changed, setConnection: (value: SessionConnection) => { current = value } }
}

const lost = () => Object.assign(new Error('lost reply'), { code: 'result_unknown' })
const calls = (call: { mock: { calls: unknown } }): SessionCall[] => call.mock.calls as SessionCall[]
const promptCalls = (call: { mock: { calls: unknown } }) => calls(call).filter(([method]) => method === 'session.prompt')
const callParams = (call: { mock: { calls: unknown } }, method: string) => calls(call).find(([name]) => name === method)?.[1]
const pending = (session: AssistantSession) => { const value = session.read().pending
  expect(value).not.toBeNull()
  return value as PendingInput }
const binding = (session: AssistantSession) => { const value = session.read().binding
  expect(value).not.toBeNull()
  return value as SessionBinding }
const pendingCreate = (session: AssistantSession) => { const value = session.read().pendingCreate
  expect(value).not.toBeNull()
  return value as PendingCreate }
const streamId = (session: AssistantSession) => { const value = session.read().streamId
  expect(value).not.toBeNull()
  return value as string }
const snapshot = (session: AssistantSession, records: SessionRecord[] = [], cursor = -1): SessionFrame => ({
  type: 'event', streamId: session.read().streamId,
  event: { type: 'snapshot', header: { id: binding(session).sessionId, version: 1, createdAt: 1 }, records, cursor, hasMore: false, projections: {} },
})
const message = (rpcId: string, seq = 0): SessionRecord => ({ type: 'event', event: { type: 'user/message', seq, time: 1, data: { role: 'user', id: 'message-1', source: { kind: 'user', rpcId }, content: input() } } })

describe('assistant Session binding and unconfirmed submissions', () => {
  test('first submission creates a Session before sending and keeps the same binding', async () => {
    const h = harness()
    await h.session.submit({ content: input() })
    const created = callParams(h.call, 'session.create')!
    expect(created.sessionId).toBe(binding(h.session).sessionId)
    expect(promptCalls(h.call)).toHaveLength(1)
    expect(promptCalls(h.call)[0][1].sessionId).toBe(created.sessionId)
    const methods = calls(h.call).map(([method]) => method)
    expect(methods.indexOf('session.create')).toBeLessThan(methods.indexOf('session.prompt'))
  })

  test('unknown first creation does not dispatch input and retry retains the original Session identity', async () => {
    const h = harness()
    h.call.mockImplementationOnce(async () => { throw lost() })
    await expect(h.session.submit({ content: input() })).rejects.toThrow('lost reply')
    const original = pendingCreate(h.session).sessionId
    expect(promptCalls(h.call)).toHaveLength(0)
    await h.session.create()
    await h.session.submit({ content: input() })
    expect(binding(h.session).sessionId).toBe(original)
    expect(promptCalls(h.call)).toHaveLength(1)
  })

  test('persists before sending and keeps a failed persistence attempt out of the network', async () => {
    const h = harness()
    await h.session.bind('session-1')
    h.storage.set.mockRejectedValueOnce(new Error('quota'))
    await expect(h.session.submit({ content: input() })).rejects.toMatchObject({ code: 'storage_failed' })
    expect(promptCalls(h.call)).toHaveLength(0)
  })
  test('freezes input synchronously and uses the exact Session prompt wire shape', async () => {
    const h = harness()
    await h.session.bind('session-1')
    const content = input()
    const sent = h.session.submit({ content })
    content[0].text = 'Mutated'
    await sent
    expect(callParams(h.call, 'session.prompt')?.content).toEqual(input())
    expect(pending(h.session).status).toBe('accepted')
    await h.session.submit({ content: [{ type: 'text', text: 'Next input' }] })
    expect(promptCalls(h.call)).toHaveLength(2)
  })
  test('unknown input survives disconnect and cannot be rebound or discarded', async () => {
    const h = harness()
    await h.session.bind('session-1')
    h.call.mockRejectedValueOnce(lost())
    await expect(h.session.submit({ content: input() })).rejects.toMatchObject({ code: 'result_unknown' })
    const saved = pending(h.session)
    h.setConnection({ baseUrl: 'https://dsh.test', phase: 'offline' })
    await h.session.connectionChanged({ baseUrl: 'https://dsh.test', phase: 'offline' })
    expect(binding(h.session).sessionId).toBe('session-1')
    expect(pending(h.session).requestId).toBe(saved.requestId)
    await expect(h.session.discardDraft()).rejects.toMatchObject({ code: 'pending_locked' })
    h.setConnection(connection())
    await expect(h.session.bind('session-2')).rejects.toMatchObject({ code: 'pending_locked' })
    await h.session.connectionChanged(connection())
    expect(promptCalls(h.call)).toHaveLength(1)
    await h.session.retry()
    const sent = promptCalls(h.call)
    expect(sent[1]?.[1]).toEqual(sent[0]?.[1])
  })
  test('a foreign connection cannot receive a pending request or its old stream events', async () => {
    const h = harness()
    await h.session.bind('session-1')
    h.call.mockRejectedValueOnce(lost())
    await h.session.submit({ content: input() }).catch(() => {})
    const oldStream = streamId(h.session)
    const foreign = { ...connection(), baseUrl: 'https://other.test' }
    h.setConnection(foreign)
    await h.session.connectionChanged(foreign)
    await expect(h.session.retry()).rejects.toMatchObject({ code: 'target_changed' })
    await h.session.onEvent({ ...snapshot(h.session), streamId: oldStream })
    expect(pending(h.session).status).toBe('unknown')
    expect(h.session.read().records).toEqual([])
    expect(promptCalls(h.call)).toHaveLength(1)
  })
  test('valid restored unknown input is retried with its original id after a worker restart', async () => {
    const h = harness()
    await h.session.bind('session-1')
    h.call.mockRejectedValueOnce(lost())
    await h.session.submit({ content: input() }).catch(() => {})
    const first = callParams(h.call, 'session.prompt')
    const restarted = harness(h.values)
    await restarted.session.restore()
    await restarted.session.connectionChanged(connection())
    expect(promptCalls(restarted.call)).toHaveLength(0)
    await restarted.session.retry()
    expect(callParams(restarted.call, 'session.prompt')).toEqual(first)
  })
  test('mismatched persistent pending targets fail closed without rewriting storage', async () => {
    const h = harness()
    await h.session.bind('session-1')
    h.call.mockRejectedValueOnce(lost())
    await h.session.submit({ content: input() }).catch(() => {})
    sessionState(h.values[KEY]).pending!.sessionId = 'session-other'
    const restarted = harness(h.values)
    await expect(restarted.session.restore()).rejects.toMatchObject({ code: 'storage_invalid' })
    expect(restarted.storage.set).not.toHaveBeenCalled()
    expect(restarted.call).not.toHaveBeenCalled()
  })
  test('new-session clicks create new identities while a lost create keeps its original id and cwd', async () => {
    const h = harness()
    await h.session.create({ cwd: '/first' })
    const first = binding(h.session).sessionId
    await h.session.create({ cwd: '/second' })
    expect(binding(h.session).sessionId).not.toBe(first)
    h.call.mockRejectedValueOnce(lost())
    await h.session.create({ cwd: '/third' }).catch(() => {})
    const saved = pendingCreate(h.session)
    expect(saved.cwd).toBe('/third')
    const restarted = harness(h.values)
    await restarted.session.restore()
    await restarted.session.create()
    expect(callParams(restarted.call, 'session.create')).toEqual({ sessionId: saved.sessionId, cwd: '/third' })
  })
  test('snapshot echoes acknowledge a lost receipt and preserve wrapped records', async () => {
    const h = harness()
    await h.session.bind('session-1')
    h.call.mockRejectedValueOnce(lost())
    await h.session.submit({ content: input() }).catch(() => {})
    const record = message(pending(h.session).requestId)
    await h.session.onEvent(snapshot(h.session, [record], 0))
    expect(h.session.read().pending).toBeNull()
    expect(h.session.read().records).toEqual([record])
    await h.session.onEvent({ type: 'event', streamId: streamId(h.session), event: record })
    expect(h.session.read().records).toHaveLength(1)
  })
  test('an inbox echo is accepted only after a matching snapshot baseline', async () => {
    const h = harness()
    await h.session.bind('session-1')
    h.call.mockRejectedValueOnce(lost())
    await h.session.submit({ content: input() }).catch(() => {})
    const rpcId = pending(h.session).requestId
    const record: SessionRecord = { type: 'event', event: { type: 'agent/inbox/spliced', seq: 0, time: 1, data: { inserted: [{ source: { kind: 'user', rpcId } }] } } }
    await h.session.onEvent({ type: 'event', streamId: streamId(h.session), event: record })
    expect(h.session.read().pending).not.toBeNull()
    await h.session.onEvent(snapshot(h.session))
    await h.session.onEvent({ type: 'event', streamId: streamId(h.session), event: record })
    expect(h.session.read().pending).toBeNull()
    expect(h.session.read().records).toEqual([record])
  })
  test('stream errors remain visible and stopping calls the Session cancellation API', async () => {
    const h = harness()
    await h.session.bind('session-1')
    await h.session.onEvent(snapshot(h.session))
    await h.session.onEvent({ type: 'event', streamId: streamId(h.session), error: { code: 'stream_error', message: 'read failed' } })
    expect(h.session.read().error?.code).toBe('stream_error')
    await h.session.stop()
    expect(h.call).toHaveBeenCalledWith('session.cancel', { sessionId: 'session-1' })
  })
  test('a delayed storage write cannot send after its connection was withdrawn', async () => {
    const h = harness()
    await h.session.bind('session-1')
    const stored = deferred<undefined>()
    const started = deferred<undefined>()
    h.storage.set.mockImplementationOnce(async (patch) => { started.resolve(undefined)
      await stored.promise
      await h.set(patch) })
    const submitting = h.session.submit({ content: input() })
    await started.promise
    h.setConnection({ baseUrl: 'https://dsh.test', phase: 'offline' })
    const disconnected = h.session.connectionChanged({ baseUrl: 'https://dsh.test', phase: 'offline' })
    stored.resolve(undefined)
    await expect(submitting).rejects.toMatchObject({ code: 'offline' })
    await disconnected
    expect(promptCalls(h.call)).toHaveLength(0)
  })
})
