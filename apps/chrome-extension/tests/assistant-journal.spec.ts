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
  acknowledgementPending?: boolean
  result?: JournalResult }
type JournalRecord = { version: 1
  journalId: string
  entries: JournalEntry[] }
type AssistantJournal = {
  handle: (frame: { type: 'execute' | 'status' | 'cancel'
    request: BrowserInvocation }) => Promise<JournalResult>
  acknowledge: (identity: BrowserInvocation) => Promise<void>
  acknowledgements: () => Promise<JournalResult[]>
  confirmAcknowledgement: (identity: BrowserInvocation) => Promise<void>
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
  test('unknown writes require explicit acknowledgement after executor quiescence', async () => {
    const h = harness()
    const r = request()
    h.execute.mockResolvedValueOnce({ outcome: 'unknown', value: {}, quiescent: false })
    await h.journal.handle({ type: 'execute', request: r })
    await expect(h.journal.acknowledge(r)).rejects.toThrow('executor_not_quiescent')
    h.inspect.mockResolvedValueOnce({ outcome: 'unknown', quiescent: true })
    await h.journal.acknowledge(r)
    expect((await h.journal.list())[0]).toMatchObject({ released: true, acknowledgementPending: true })
    const receipts = await h.journal.acknowledgements()
    expect(receipts[0]).toMatchObject({ requestId: r.requestId, outcome: 'unknown', quiescent: true })
    expect(receipts[0]).not.toHaveProperty('value')
    await h.journal.confirmAcknowledgement(r)
    expect(await h.journal.acknowledgements()).toEqual([])
    expect(await h.journal.handle({ type: 'execute', request: request() })).toMatchObject(receipt)
  })
  test('late human acknowledgement cannot replace an already observed status result', async () => {
    const h = harness()
    const r = request()
    const checked = deferred<undefined>()
    const inspection = deferred<JournalResult>()
    h.execute.mockResolvedValueOnce({ outcome: 'unknown', value: {}, quiescent: false })
    await h.journal.handle({ type: 'execute', request: r })
    h.inspect.mockImplementationOnce(async () => { checked.resolve(undefined)
      return inspection.promise })
    const acknowledging = h.journal.acknowledge(r)
    await checked.promise
    h.inspect.mockResolvedValueOnce(receipt)
    expect(await h.journal.handle({ type: 'status', request: r })).toMatchObject(receipt)
    inspection.resolve({ outcome: 'unknown', quiescent: true })
    await acknowledging
    expect((await h.journal.list())[0].result).toMatchObject(receipt)
    expect(await h.journal.acknowledgements()).toEqual([])
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
    expect(await h.journal.handle({ type: 'execute', request: r })).toMatchObject({ outcome: 'unknown', reason: 'receipt_persistence_failed' })
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
