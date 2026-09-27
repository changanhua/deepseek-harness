/// <reference types="node" />
import { describe, expect, test, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { BrowserInvocation } from '../../../packages/browser/browser-extension/src/types.ts'
import { sealBrowserInvocation } from '../../../packages/browser/browser-extension/src/requests.ts'
import { createAssistantJournal, JOURNAL_KEY } from '../src/assistant-journal.js'

const installationId = '123e4567-e89b-42d3-a456-426614174000'
type JournalOutcome = 'observed' | 'failed' | 'cancelled' | 'unknown'
type JournalResult = { outcome: JournalOutcome
  value?: unknown
  quiescent: boolean
  reason?: string }
type JournalEntry = { identity: BrowserInvocation
  state: 'active' | 'settled'
  released: boolean
  result?: JournalResult }
type JournalRecord = { version: 1
  journalId: string
  entries: JournalEntry[] }
type AssistantJournal = {
  handle: (frame: { type: 'execute' | 'status' | 'cancel'
    request: BrowserInvocation }) => Promise<JournalResult>
  lookup: (locator: { kind: 'extension-journal-v1'; protocolVersion: 1; transportRequestId: string; installationId: string; grantEpoch: number }) => Promise<JournalResult | undefined>
  interrupt: (reason?: string, installationId?: string) => void
  list: () => Promise<JournalEntry[]>
}
type Deferred<T> = { promise: Promise<T>
  resolve: (value: T) => void }

const request = (tabId = 7, mutates = true): BrowserInvocation => sealBrowserInvocation({
  protocolVersion: 1, installationId, sessionId: 'session:test', grantEpoch: 1,
  requestId: randomUUID(), deadline: Date.now() + 30000, mutates,
  target: { tabId, frameId: 0, documentId: 'document-1' },
  payload: mutates ? { kind: 'fill', value: 'private input' } : { kind: 'snapshot', tabId, frameId: 0 },
})
const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const receipt: JournalResult = { outcome: 'observed', value: { changed: true }, quiescent: true }
const journalRecord = (values: Record<string, unknown>) => values[JOURNAL_KEY] as JournalRecord
const createJournal = (options: object): AssistantJournal => createAssistantJournal(options) as AssistantJournal

function harness() {
  const values: Record<string, unknown> = {}
  const storage = {
    get: vi.fn(async (key: string) => structuredClone({ [key]: values[key] })),
    set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(values, structuredClone(patch)) }),
  }
  const execute = vi.fn(async (_request: BrowserInvocation, _signal: AbortSignal): Promise<JournalResult> => receipt)
  const inspect = vi.fn(async (): Promise<JournalResult> => ({ outcome: 'unknown', quiescent: false }))
  const permit = vi.fn((_request: BrowserInvocation) => true)
  const canBootstrap = async () => true
  const journal = createJournal({ storage, execute, inspect, permit, canBootstrap })
  return { storage, execute, inspect, permit, canBootstrap, journal, values }
}

describe('Chrome durable browser execution journal', () => {
  test('journals target-free tab creation and recovers its exact receipt without reopening', async () => {
    const h = harness()
    const { target: _target, ...base } = request()
    const r = sealBrowserInvocation({ ...base, payload: { kind: 'tab_open', url: 'https://example.test/' } })
    const opened = { outcome: 'observed' as const, quiescent: true, value: { opened: true, tab: { tabId: 10, windowId: 1 } } }
    h.execute.mockImplementationOnce(async () => {
      expect(journalRecord(h.values).entries[0]).toMatchObject({ operation: 'tab_open', state: 'active', mutates: true })
      expect(JSON.stringify(h.values)).not.toContain('https://example.test/')
      return opened
    })
    expect(await h.journal.handle({ type: 'execute', request: r })).toMatchObject(opened)
    expect(await createJournal(h).handle({ type: 'execute', request: r })).toMatchObject(opened)
    expect(h.execute).toHaveBeenCalledTimes(1)
  })
  test('an unresolved open is never replayed but does not occupy another new tab', async () => {
    const h = harness()
    const { target: _target, ...base } = request()
    const r = sealBrowserInvocation({ ...base, payload: { kind: 'tab_open', url: 'https://example.test/' } })
    h.execute.mockResolvedValueOnce({ outcome: 'unknown', quiescent: false })
    await h.journal.handle({ type: 'execute', request: r })
    expect(await h.journal.handle({ type: 'execute', request: r })).toMatchObject({ outcome: 'unknown' })
    expect(await h.journal.handle({ type: 'execute', request: sealBrowserInvocation({ ...r, requestId: randomUUID() }) })).toMatchObject(receipt)
    expect(await h.journal.handle({ type: 'execute', request: request() })).toMatchObject(receipt)
    expect(await h.journal.handle({ type: 'execute', request: sealBrowserInvocation({ ...r, requestId: randomUUID(), installationId: randomUUID() }) })).toMatchObject(receipt)
    expect(h.execute).toHaveBeenCalledTimes(4)
  })
  test('expired creation receipts cannot be retrieved during an idle worker or executed again', async () => {
    const h = harness()
    let time = Date.now()
    const { target: _target, ...base } = request()
    const r = sealBrowserInvocation({ ...base, deadline: time + 10, payload: { kind: 'tab_open', url: 'https://example.test/' } })
    const journal = createJournal({ ...h, now: () => time, retentionMs: 20 })
    const locator = { kind: 'extension-journal-v1' as const, protocolVersion: 1 as const,
      transportRequestId: r.requestId, installationId: r.installationId, grantEpoch: r.grantEpoch }
    await journal.handle({ type: 'execute', request: r })
    time = r.deadline + 19
    expect(await journal.lookup(locator, r.sessionId)).toMatchObject(receipt)
    time += 1
    expect(await journal.lookup(locator, r.sessionId)).toBeUndefined()
    expect(await journal.handle({ type: 'execute', request: r })).toMatchObject({ outcome: 'unknown', reason: 'receipt_expired' })
    expect(h.execute).toHaveBeenCalledTimes(1)
  })
  test('target-free admission does not permit other writes or prepared-action wrappers', async () => {
    const h = harness()
    const { target: _target, ...base } = request()
    for (const payload of [{ kind: 'click' }, { kind: 'commit', action: { kind: 'tab_open', url: 'https://example.test/' } }]) {
      await expect(h.journal.handle({ type: 'execute', request: sealBrowserInvocation({ ...base, payload }) })).rejects.toThrow('invalid_request')
    }
    expect(h.execute).not.toHaveBeenCalled()
  })
  test('a worker lost after creation admission can query but cannot execute that open again', async () => {
    const h = harness()
    const { target: _target, ...base } = request()
    const r = sealBrowserInvocation({ ...base, payload: { kind: 'tab_open', url: 'https://example.test/' } })
    const started = deferred<undefined>()
    const effect = deferred<JournalResult>()
    h.execute.mockImplementationOnce(async () => { started.resolve(undefined); return effect.promise })
    const pending = h.journal.handle({ type: 'execute', request: r })
    await started.promise
    const retained = structuredClone(h.values)
    const recovered = createJournal({ ...h, storage: {
      get: async (key: string) => structuredClone({ [key]: retained[key] }),
      set: async (patch: Record<string, unknown>) => { Object.assign(retained, structuredClone(patch)) },
    } })
    expect(await recovered.handle({ type: 'status', request: r })).toMatchObject({ outcome: 'unknown', quiescent: false })
    expect(await recovered.handle({ type: 'execute', request: r })).toMatchObject({ outcome: 'unknown', quiescent: false })
    expect(h.execute).toHaveBeenCalledTimes(1)
    effect.resolve(receipt)
    await pending
  })
  test('persists minimal intent before an effect and redelivers its receipt without replay', async () => {
    const h = harness()
    const r = request()
    h.execute.mockImplementationOnce(async () => { expect(journalRecord(h.values).entries[0]).toMatchObject({ identity: { requestId: r.requestId }, state: 'active' })
      expect(JSON.stringify(h.values)).not.toContain('private input')
      return receipt })
    expect(await h.journal.handle({ type: 'execute', request: r })).toMatchObject(receipt)
    expect(await h.journal.handle({ type: 'execute', request: r })).toMatchObject(receipt)
    const restarted = createJournal(h)
    expect(await restarted.handle({ type: 'status', request: r })).toMatchObject(receipt)
    expect(h.execute).toHaveBeenCalledTimes(1)
  })
  test('restart locator only returns the exact durable journal receipt and never executes', async () => {
    const h = harness(); const r = request()
    await h.journal.handle({ type: 'execute', request: r })
    const restarted = createJournal(h)
    await expect(restarted.lookup({ kind: 'extension-journal-v1', protocolVersion: 1,
      transportRequestId: r.requestId, installationId: r.installationId, grantEpoch: r.grantEpoch },
    r.sessionId)).resolves.toMatchObject(receipt)
    await expect(restarted.lookup({ kind: 'extension-journal-v1', protocolVersion: 1,
      transportRequestId: r.requestId, installationId: r.installationId, grantEpoch: r.grantEpoch }, 'other-session')).resolves.toBeUndefined()
    await expect(restarted.lookup({ kind: 'extension-journal-v1', protocolVersion: 1,
      transportRequestId: r.requestId, installationId: r.installationId, grantEpoch: 2 }, r.sessionId)).resolves.toBeUndefined()
    expect(h.execute).toHaveBeenCalledTimes(1)
  })
  test('a restarted worker retains unknown writes across grant changes and never executes a status query', async () => {
    const h = harness()
    const effect = deferred<JournalResult>()
    const started = deferred<undefined>()
    const r = request()
    h.execute.mockImplementationOnce(async () => { started.resolve(undefined)
      return effect.promise })
    const original = h.journal.handle({ type: 'execute', request: r })
    await started.promise
    const recoveredStorage: Record<string, unknown> = structuredClone(h.values)
    const storage = {
      get: async (key: string) => ({ [key]: recoveredStorage[key] }),
      set: async (patch: Record<string, unknown>) => { Object.assign(recoveredStorage, structuredClone(patch)) },
    }
    const restarted = createJournal({ ...h, storage })
    expect(await restarted.handle({ type: 'status', request: r })).toMatchObject({ outcome: 'unknown', quiescent: false })
    const newer = sealBrowserInvocation({ ...request(), grantEpoch: 2 })
    expect(await restarted.handle({ type: 'execute', request: newer })).toMatchObject({ outcome: 'failed', reason: 'target_busy' })
    expect(await restarted.handle({ type: 'execute', request: request(8) })).toMatchObject(receipt)
    expect(await restarted.handle({ type: 'execute', request: request(7, false) })).toMatchObject(receipt)
    expect(h.execute).toHaveBeenCalledTimes(3)
    effect.resolve(receipt)
    await original
  })
  test('failed durable admission cannot execute and blocks further writes until recovery', async () => {
    const h = harness()
    h.storage.set.mockRejectedValueOnce(new Error('quota'))
    await expect(h.journal.handle({ type: 'execute', request: request() })).rejects.toThrow('journal_unavailable')
    await expect(h.journal.handle({ type: 'execute', request: request() })).rejects.toThrow('journal_unavailable')
    expect(h.execute).not.toHaveBeenCalled()
  })
  test('rechecks the current grant after awaiting storage', async () => {
    const h = harness()
    const originalSet = h.storage.set.getMockImplementation()!
    await h.journal.list()
    h.storage.set.mockImplementationOnce(async (patch: Record<string, unknown>) => { await originalSet(patch)
      h.permit.mockReturnValue(false) })
    expect(await h.journal.handle({ type: 'execute', request: request() })).toMatchObject({ outcome: 'cancelled', reason: 'authorization_changed' })
    expect(h.execute).not.toHaveBeenCalled()
  })
  test('concurrent same-tab writes conflict while an unrelated tab can proceed', async () => {
    const h = harness()
    const effect = deferred<JournalResult>()
    const started = deferred<undefined>()
    h.execute.mockImplementationOnce(async () => { started.resolve(undefined)
      return effect.promise })
    const first = h.journal.handle({ type: 'execute', request: request() })
    await started.promise
    expect(await h.journal.handle({ type: 'execute', request: request() })).toMatchObject({ reason: 'target_busy' })
    expect(await h.journal.handle({ type: 'execute', request: request(8) })).toMatchObject(receipt)
    effect.resolve(receipt)
    await first
  })
  test('只中断指定安装身份的执行，另一条连接仍可完成', async () => {
    const h = harness()
    const started = deferred<undefined>()
    const codexStarted = deferred<undefined>()
    const codexEffect = deferred<JournalResult>()
    const codexInstallationId = '323e4567-e89b-42d3-a456-426614174000'
    h.execute.mockImplementationOnce(async (_request: BrowserInvocation, signal: AbortSignal) => {
      started.resolve(undefined)
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
      return { outcome: 'cancelled', quiescent: true, reason: 'connection_lost' }
    })
    h.execute.mockImplementationOnce(async (_request: BrowserInvocation, signal: AbortSignal) => {
      codexStarted.resolve(undefined)
      return Promise.race([codexEffect.promise, new Promise<JournalResult>(resolve => signal.addEventListener('abort', () => {
        resolve({ outcome: 'cancelled', quiescent: true, reason: 'connection_lost' })
      }, { once: true }))])
    })
    const dsh = request(7, false)
    const codex = sealBrowserInvocation({ ...request(8, false), installationId: codexInstallationId })
    const dshRun = h.journal.handle({ type: 'execute', request: dsh })
    await started.promise
    const codexRun = h.journal.handle({ type: 'execute', request: codex })
    await codexStarted.promise
    h.journal.interrupt('connection_lost', installationId)

    await expect(dshRun).resolves.toMatchObject({ outcome: 'cancelled' })
    codexEffect.resolve(receipt)
    await expect(codexRun).resolves.toMatchObject(receipt)
  })
  test('capacity pressure evicts oldest settled reads but preserves write receipts', async () => {
    const h = harness()
    const journal = createJournal({ ...h, capacity: 3 })
    const write = request(7, true), firstRead = request(7, false), secondRead = request(7, false), thirdRead = request(7, false)
    for (const item of [write, firstRead, secondRead]) {
      expect(await journal.handle({ type: 'execute', request: item })).toMatchObject(receipt)
    }
    const restarted = createJournal({ ...h, capacity: 3 })
    expect(await restarted.handle({ type: 'execute', request: thirdRead })).toMatchObject(receipt)
    const entries = await restarted.list()
    expect(entries.map(item => item.identity.requestId)).toEqual([write.requestId, secondRead.requestId, thirdRead.requestId])
    expect(h.execute).toHaveBeenCalledTimes(4)
    expect(await restarted.handle({ type: 'status', request: write })).toMatchObject(receipt)
  })
  test('capacity pressure never evicts writes or unsettled reads', async () => {
    const h = harness()
    const journal = createJournal({ ...h, capacity: 2 })
    const first = request(7, true), second = request(8, true)
    expect(await journal.handle({ type: 'execute', request: first })).toMatchObject(receipt)
    expect(await journal.handle({ type: 'execute', request: second })).toMatchObject(receipt)
    expect(await journal.handle({ type: 'execute', request: request(9, false) })).toMatchObject({ outcome: 'failed', reason: 'journal_capacity' })
    expect((await journal.list()).map(item => item.identity.requestId)).toEqual([first.requestId, second.requestId])
    expect(h.execute).toHaveBeenCalledTimes(2)
  })
  test('capacity rejection reports no execution and an expiry check time, then recovers in the same journal', async () => {
    const h = harness()
    let clock = Date.now()
    const journal = createJournal({ ...h, capacity: 2, now: () => clock, retentionMs: 1000 })
    const first = sealBrowserInvocation({ ...request(7, true), deadline: clock + 100 })
    const second = sealBrowserInvocation({ ...request(8, true), deadline: clock + 100 })
    for (const pending of [first, second]) expect(await journal.handle({ type: 'execute', request: pending })).toMatchObject(receipt)
    const checkAt = Math.min(first.deadline, second.deadline) + 1000
    const rejected = sealBrowserInvocation({ ...request(9, false), deadline: clock + 100 })
    expect(await journal.handle({ type: 'execute', request: rejected })).toMatchObject({
      outcome: 'failed', reason: 'journal_capacity', quiescent: true,
      value: { admission: { executed: false, recheckAt: checkAt } },
    })
    expect(h.execute).toHaveBeenCalledTimes(2)
    clock = Math.max(first.deadline, second.deadline) + 1000
    const next = sealBrowserInvocation({ ...request(9, false), deadline: clock + 100 })
    expect(await journal.handle({ type: 'execute', request: next })).toMatchObject(receipt)
    expect(h.execute).toHaveBeenCalledTimes(3)
    expect((await journal.list()).map(item => item.identity.requestId)).toEqual([next.requestId])
    expect(await journal.handle({ type: 'execute', request: first })).toMatchObject({ outcome: 'failed', reason: 'deadline' })
    expect(h.execute).toHaveBeenCalledTimes(3)
  })
  test('capacity held by unquiescent requests has no time-only recovery and remains protected after deadlines', async () => {
    const h = harness()
    let clock = Date.now()
    h.execute.mockResolvedValue({ outcome: 'unknown', quiescent: false })
    const journal = createJournal({ ...h, capacity: 1, now: () => clock, retentionMs: 1000 })
    const unresolved = sealBrowserInvocation({ ...request(7, true), deadline: clock + 100 })
    expect(await journal.handle({ type: 'execute', request: unresolved })).toMatchObject({ outcome: 'unknown' })
    clock = unresolved.deadline + 1001
    const next = sealBrowserInvocation({ ...request(9, false), deadline: clock + 100 })
    expect(await journal.handle({ type: 'execute', request: next })).toMatchObject({ outcome: 'failed', reason: 'journal_capacity',
      value: { admission: { executed: false, recheckAt: null } } })
    expect(await journal.handle({ type: 'status', request: unresolved })).toMatchObject({ outcome: 'unknown', quiescent: false })
    expect(h.execute).toHaveBeenCalledTimes(1)
    expect((await journal.list()).map(item => item.identity.requestId)).toEqual([unresolved.requestId])
  })
  test('byte capacity rejects before execution with the retained write expiry', async () => {
    const h = harness()
    h.execute.mockResolvedValue({ ...receipt, value: { text: 'x'.repeat(800) } })
    const first = request(7, true)
    expect(await h.journal.handle({ type: 'execute', request: first })).toMatchObject({ outcome: 'observed', quiescent: true })
    const journal = createJournal({ ...h, maxStorageBytes: Buffer.byteLength(JSON.stringify(journalRecord(h.values))) + 32 })
    expect(await journal.handle({ type: 'execute', request: request(8, false) })).toMatchObject({
      outcome: 'failed', reason: 'journal_capacity', value: { admission: { executed: false, recheckAt: first.deadline + 60000 } },
    })
    expect(h.execute).toHaveBeenCalledTimes(1)
    expect((await journal.list()).map(item => item.identity.requestId)).toEqual([first.requestId])
  })
  test('a recheck time does not reserve the expired capacity for one caller', async () => {
    const h = harness()
    let clock = Date.now()
    const journal = createJournal({ ...h, capacity: 1, retentionMs: 1000, now: () => clock })
    const fresh = (sessionId: string, mutates: boolean) => sealBrowserInvocation({
      ...request(7, mutates), sessionId, deadline: clock + 100,
    })
    const first = fresh('first', true)
    expect(await journal.handle({ type: 'execute', request: first })).toMatchObject(receipt)
    expect(await journal.handle({ type: 'execute', request: fresh('waiting', false) })).toMatchObject({
      reason: 'journal_capacity', value: { admission: { recheckAt: first.deadline + 1000 } },
    })
    clock = first.deadline + 1000
    const competing = fresh('competing', true)
    expect(await journal.handle({ type: 'execute', request: competing })).toMatchObject(receipt)
    expect(await journal.handle({ type: 'execute', request: fresh('waiting', false) })).toMatchObject({
      reason: 'journal_capacity', value: { admission: { executed: false, recheckAt: competing.deadline + 1000 } },
    })
    expect(h.execute).toHaveBeenCalledTimes(2)
  })
  test('storage-byte pressure also evicts completed reads before refusing a new request', async () => {
    const h = harness()
    h.execute.mockResolvedValue({ outcome: 'observed', quiescent: true, value: { text: 'x'.repeat(800) } })
    const journal = createJournal({ ...h, capacity: 10, maxStorageBytes: 4000 })
    const write = request(7, true), firstRead = request(7, false), secondRead = request(7, false)
    for (const item of [write, firstRead, secondRead]) {
      expect(await journal.handle({ type: 'execute', request: item })).toMatchObject({ outcome: 'observed' })
    }
    const ids = (await journal.list()).map(item => item.identity.requestId)
    expect(ids).toContain(write.requestId)
    expect(ids).toContain(secondRead.requestId)
    expect(ids).not.toContain(firstRead.requestId)
  })
  test('cannot report a current read as observed after evicting its own receipt', async () => {
    const h = harness()
    h.execute.mockResolvedValue({ outcome: 'observed', quiescent: true, value: { text: 'x'.repeat(800) } })
    const journal = createJournal({ ...h, maxStorageBytes: 1000 })
    const current = request(7, false)

    expect(await journal.handle({ type: 'execute', request: current })).toMatchObject({
      outcome: 'unknown', reason: 'receipt_persistence_failed',
    })
    expect((await journal.list()).map(item => item.identity.requestId)).toContain(current.requestId)
    expect(h.execute).toHaveBeenCalledOnce()
  })
  test('compacting reads cannot evict a settled unknown write receipt', async () => {
    const h = harness()
    h.execute.mockResolvedValueOnce({ outcome: 'unknown', reason: 'effect_unverified', quiescent: true })
    const journal = createJournal({ ...h, capacity: 2 })
    const uncertain = request(7, true)
    expect(await journal.handle({ type: 'execute', request: uncertain })).toMatchObject({ outcome: 'unknown' })
    expect(await journal.handle({ type: 'execute', request: request(7, false) })).toMatchObject(receipt)
    expect(await journal.handle({ type: 'execute', request: request(7, false) })).toMatchObject(receipt)
    expect(await journal.handle({ type: 'execute', request: request(7, true) })).toMatchObject(receipt)
    expect((await journal.list())[0]).toMatchObject({ identity: { requestId: uncertain.requestId }, released: true })
  })
  test('an unknown write holds the tab until it is proven quiescent', async () => {
    const h = harness()
    h.execute.mockResolvedValueOnce({ outcome: 'unknown', reason: 'effect_unverified', quiescent: false })
    const journal = createJournal({ ...h, capacity: 3 })
    const uncertain = request(7, true)
    expect(await journal.handle({ type: 'execute', request: uncertain })).toMatchObject({ outcome: 'unknown' })
    expect(await journal.handle({ type: 'execute', request: request(7, true) })).toMatchObject({ outcome: 'failed', reason: 'target_busy' })
    expect((await journal.list())[0]).toMatchObject({ identity: { requestId: uncertain.requestId }, released: false })
  })
  test('cancel only requests stop; completion or verified quiescence owns release', async () => {
    const h = harness()
    const effect = deferred<JournalResult>()
    const started = deferred<undefined>()
    const r = request()
    let executionSignal: AbortSignal | undefined
    h.execute.mockImplementationOnce(async (_request: BrowserInvocation, signal: AbortSignal) => { executionSignal = signal
      started.resolve(undefined)
      return effect.promise })
    const first = h.journal.handle({ type: 'execute', request: r })
    await started.promise
    expect(await h.journal.handle({ type: 'cancel', request: r })).toMatchObject({ outcome: 'unknown', quiescent: false })
    expect(executionSignal?.aborted).toBe(true)
    expect(await h.journal.handle({ type: 'execute', request: request() })).toMatchObject({ reason: 'target_busy' })
    effect.resolve(receipt)
    expect(await first).toMatchObject(receipt)
    expect(await h.journal.handle({ type: 'execute', request: request() })).toMatchObject(receipt)
  })
  test('invalid fingerprints and reused identities cannot replace an earlier request', async () => {
    const h = harness()
    const r = request()
    await h.journal.handle({ type: 'execute', request: r })
    await expect(h.journal.handle({ type: 'execute', request: { ...r, payload: { kind: 'navigate' } } })).rejects.toThrow('invalid_fingerprint')
    const conflicting = sealBrowserInvocation({ ...r, payload: { kind: 'navigate' } })
    await expect(h.journal.handle({ type: 'execute', request: conflicting })).rejects.toThrow('request_conflict')
    expect(h.execute).toHaveBeenCalledTimes(1)
  })
  test('an unknown write releases the tab once inspection proves quiescence', async () => {
    const h = harness()
    const r = request()
    h.execute.mockResolvedValueOnce({ outcome: 'unknown', value: {}, quiescent: false })
    expect(await h.journal.handle({ type: 'execute', request: r })).toMatchObject({ outcome: 'unknown', quiescent: false })
    expect((await h.journal.list())[0]).toMatchObject({ released: false })
    h.inspect.mockResolvedValueOnce({ outcome: 'unknown', quiescent: true })
    expect(await h.journal.handle({ type: 'status', request: r })).toMatchObject({ outcome: 'unknown', quiescent: true })
    const entry = (await h.journal.list())[0]
    expect(entry).toMatchObject({ released: true })
    expect(entry.result).toMatchObject({ requestId: r.requestId, outcome: 'unknown', quiescent: true })
    expect(entry.result).not.toHaveProperty('value')
    expect(await h.journal.handle({ type: 'execute', request: request() })).toMatchObject(receipt)
  })
  test('each connection settles its own unresolved write without starving the other', async () => {
    const h = harness()
    const first = request(7, true)
    const second = sealBrowserInvocation({ ...request(8, true), installationId: '323e4567-e89b-42d3-a456-426614174000' })
    h.execute.mockResolvedValue({ outcome: 'unknown', quiescent: false })
    await h.journal.handle({ type: 'execute', request: first })
    await h.journal.handle({ type: 'execute', request: second })
    h.inspect.mockResolvedValue({ outcome: 'unknown', quiescent: true })
    expect(await h.journal.handle({ type: 'status', request: first })).toMatchObject({ outcome: 'unknown', quiescent: true })
    expect(await h.journal.handle({ type: 'status', request: second })).toMatchObject({ outcome: 'unknown', quiescent: true })
    const entries = await h.journal.list()
    expect(entries.filter(entry => entry.identity.installationId === first.installationId && entry.released)).toHaveLength(1)
    expect(entries.filter(entry => entry.identity.installationId === second.installationId && entry.released)).toHaveLength(1)
  })
  test('a slow inspection cannot replace an already observed status result', async () => {
    const h = harness()
    const r = request()
    const checked = deferred<undefined>()
    const inspection = deferred<JournalResult>()
    h.execute.mockResolvedValueOnce({ outcome: 'unknown', value: {}, quiescent: false })
    await h.journal.handle({ type: 'execute', request: r })
    h.inspect.mockImplementationOnce(async () => { checked.resolve(undefined)
      return inspection.promise })
    const slow = h.journal.handle({ type: 'status', request: r })
    await checked.promise
    h.inspect.mockResolvedValueOnce(receipt)
    expect(await h.journal.handle({ type: 'status', request: r })).toMatchObject(receipt)
    inspection.resolve({ outcome: 'unknown', quiescent: true })
    await slow
    expect((await h.journal.list())[0].result).toMatchObject(receipt)
  })
  test('malformed storage fails closed and cannot be replaced with an empty journal', async () => {
    const h = harness()
    h.values[JOURNAL_KEY] = { version: 1, entries: 'corrupt' }
    await expect(h.journal.handle({ type: 'execute', request: request() })).rejects.toThrow('journal_unavailable')
    expect(h.storage.set).not.toHaveBeenCalled()
    expect(h.execute).not.toHaveBeenCalled()
  })
  test('failed receipt persistence remains unknown and keeps the durable write lock', async () => {
    const h = harness()
    h.execute.mockImplementationOnce(async () => { h.storage.set.mockRejectedValueOnce(new Error('quota'))
      return receipt })
    const r = request()
    const failed = await h.journal.handle({ type: 'execute', request: r })
    expect(failed).toMatchObject({ outcome: 'unknown', reason: 'receipt_persistence_failed' })
    expect(failed.value).toBeUndefined()
    expect(journalRecord(h.values).entries[0].state).toBe('active')
    expect(await createJournal(h).handle({ type: 'status', request: r })).toMatchObject({ outcome: 'unknown' })
  })
  test('a missing previously initialized journal is corruption, not permission to discard its locks', async () => {
    const h = harness()
    const effect = deferred<JournalResult>()
    const started = deferred<undefined>()
    h.execute.mockImplementationOnce(async () => { started.resolve(undefined)
      return effect.promise })
    const running = h.journal.handle({ type: 'execute', request: request() })
    await started.promise
    Reflect.deleteProperty(h.values, JOURNAL_KEY)
    const restarted = createJournal(h)
    await expect(restarted.handle({ type: 'execute', request: request() })).rejects.toThrow('journal_unavailable')
    expect(h.execute).toHaveBeenCalledTimes(1)
    effect.resolve(receipt)
    await running
  })
  test('bootstrap requires an explicit unpaired installation', async () => {
    const h = harness()
    await expect(createJournal({ ...h, canBootstrap: async () => false }).list()).rejects.toThrow('journal_unavailable')
    expect(h.storage.set).not.toHaveBeenCalled()
  })
})
