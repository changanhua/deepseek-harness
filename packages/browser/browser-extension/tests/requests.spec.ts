import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserRequests, sealBrowserInvocation } from '../src/requests.ts'
import type { BrowserDispatchFrame, BrowserInvocation } from '../src/types.ts'

const limits = { capacity: 8, maxRequestBytes: 2048, maxResultBytes: 2048, maxDurationMs: 1000, receiptRetentionMs: 1000 }
const invocation = (id = 'r1', tabId = 11): BrowserInvocation => sealBrowserInvocation({
  protocolVersion: 1, grantEpoch: 1,
  requestId: id, sessionId: 's1', installationId: 'i1', deadline: Date.now() + 100,
  target: { tabId, frameId: 0, documentId: 'doc1' }, mutates: true, payload: { action: 'click', elementId: 'e1' },
})
const liveSignal = () => new AbortController().signal
describe('Host browser request ownership', () => {
  let requests: BrowserRequests
  beforeEach(() => { vi.useFakeTimers(); requests = new BrowserRequests(limits) })
  afterEach(() => { requests.dispose(); vi.useRealTimers() })

  it('deduplicates an exact request and binds the receipt to its session and installation', async () => {
    const frames: BrowserDispatchFrame[] = []
    const connection = requests.connect('i1', (frame) => { frames.push(frame) })
    const request = invocation()
    const first = requests.execute(request, liveSignal())
    const duplicate = requests.execute(request, liveSignal())
    expect(frames).toEqual([{ type: 'execute', request }])
    connection.receive({ ...request, outcome: 'observed', value: { clicked: true } })
    expect(await duplicate).toEqual(await first)
    expect(requests.status(request)).toMatchObject({ outcome: 'observed', value: { clicked: true } })
    expect(await requests.execute({ ...request, payload: { action: 'submit' } }, liveSignal())).toMatchObject({ delivery: 'not-sent', reason: 'request_conflict' })
  })

  it('rejects response correlation from a different session', async () => {
    const connection = requests.connect('i1', () => {})
    const request = invocation()
    const result = requests.execute(request, liveSignal())
    connection.receive({ ...request, sessionId: 'another', outcome: 'observed' })
    connection.disconnect()
    expect(await result).toMatchObject({ outcome: 'unknown', delivery: 'sent' })
    expect(requests.status({ ...request, sessionId: 'another' }).outcome).toBe('unknown')
  })

  it('queries lost actions after reconnect without replaying them, ignoring the old connection', async () => {
    const firstFrames: BrowserDispatchFrame[] = []
    const first = requests.connect('i1', (frame) => { firstFrames.push(frame) })
    const request = invocation()
    const pending = requests.execute(request, liveSignal())
    first.disconnect()
    expect(await pending).toMatchObject({ outcome: 'unknown', delivery: 'sent' })
    const nextFrames: BrowserDispatchFrame[] = []
    const next = requests.connect('i1', (frame) => { nextFrames.push(frame) })
    expect(nextFrames.map(frame => frame.type)).toEqual(['status'])
    first.receive({ ...request, outcome: 'observed' })
    expect(requests.status(request).outcome).toBe('unknown')
    next.receive({ ...request, outcome: 'observed', value: 'confirmed after reconnect' })
    expect(requests.status(request)).toMatchObject({ outcome: 'observed', value: 'confirmed after reconnect' })
    expect(firstFrames).toHaveLength(1)
  })

  it('keeps an unknown write locked while allowing another tab and a same-tab observation', async () => {
    const first = requests.connect('i1', () => {})
    const request = invocation()
    const lost = requests.execute(request, liveSignal())
    first.disconnect(); await lost
    const next = requests.connect('i1', () => {})
    expect(await requests.execute(invocation('r2'), liveSignal())).toMatchObject({ delivery: 'not-sent', reason: 'target_busy' })
    const other = invocation('r3', 12)
    const otherPending = requests.execute(other, liveSignal())
    next.receive({ ...other, outcome: 'observed' }); expect((await otherPending).outcome).toBe('observed')
    const read = sealBrowserInvocation({ ...invocation('r4'), mutates: false, payload: { action: 'snapshot' } })
    const reading = requests.execute(read, liveSignal())
    next.receive({ ...read, outcome: 'observed' }); expect((await reading).outcome).toBe('observed')
  })

  it('never sends after a pre-admission stop or an expired deadline', async () => {
    const frames: BrowserDispatchFrame[] = []
    requests.connect('i1', (frame) => { frames.push(frame) })
    const stopped = AbortSignal.abort()
    expect(await requests.execute(invocation(), stopped)).toMatchObject({ delivery: 'not-sent', outcome: 'cancelled' })
    expect(await requests.execute({ ...invocation('expired'), deadline: Date.now() }, liveSignal())).toMatchObject({ delivery: 'not-sent', reason: 'deadline' })
    expect(frames).toEqual([])
  })

  it('sends cancellation and waits for an actual executor outcome', async () => {
    const frames: BrowserDispatchFrame[] = []
    const connection = requests.connect('i1', (frame) => { frames.push(frame) })
    const controller = new AbortController()
    const request = invocation()
    const pending = requests.execute(request, controller.signal)
    controller.abort()
    expect(frames.map(frame => frame.type)).toEqual(['execute', 'cancel'])
    connection.receive({ ...request, outcome: 'observed', value: 'effect already happened' })
    expect(await pending).toMatchObject({ outcome: 'observed', value: 'effect already happened' })
  })

  it('reports an unacknowledged deadline as unknown and keeps its write lock', async () => {
    const frames: BrowserDispatchFrame[] = []
    requests.connect('i1', (frame) => { frames.push(frame) })
    const request = invocation()
    const pending = requests.execute(request, liveSignal())
    await vi.advanceTimersByTimeAsync(101)
    expect(await pending).toMatchObject({ outcome: 'unknown', delivery: 'sent', reason: 'deadline' })
    expect(frames.map(frame => frame.type)).toEqual(['execute', 'cancel'])
    expect(await requests.execute(invocation('r2'), liveSignal())).toMatchObject({ reason: 'target_busy' })
  })

  it('does not evict an acknowledged receipt to admit a new request at capacity', async () => {
    requests.dispose(); requests = new BrowserRequests({ ...limits, capacity: 1 })
    const connection = requests.connect('i1', () => {})
    const request = invocation()
    const pending = requests.execute(request, liveSignal())
    connection.receive({ ...request, outcome: 'observed' }); await pending
    expect(await requests.execute(invocation('r2', 12), liveSignal())).toMatchObject({ reason: 'capacity' })
    expect((await requests.execute(request, liveSignal())).outcome).toBe('observed')
  })

  it('bounds complete multibyte responses and retains uncertainty instead of assuming failure', async () => {
    const connection = requests.connect('i1', () => {})
    const request = invocation()
    const pending = requests.execute(request, liveSignal())
    connection.receive({ ...request, outcome: 'observed', value: '字'.repeat(1000) })
    expect(await pending).toMatchObject({ outcome: 'unknown', reason: 'result_too_large' })
    expect(await requests.execute(invocation('r2'), liveSignal())).toMatchObject({ reason: 'target_busy' })
  })

  it('allows only an explicit matching unknown acknowledgement to release a write', async () => {
    const connection = requests.connect('i1', () => {})
    const request = invocation()
    const pending = requests.execute(request, liveSignal())
    connection.disconnect(); await pending
    const current = requests.connect('i1', () => {})
    expect(requests.acknowledgeUnknown({ ...request, sessionId: 'wrong' })).toBe(false)
    expect(requests.acknowledgeUnknown(request)).toBe(false)
    current.receive({ ...request, outcome: 'unknown', quiescent: true })
    expect(requests.acknowledgeUnknown(request)).toBe(true)
    expect(requests.status(request).outcome).toBe('unknown')
    const next = requests.execute(invocation('r2'), liveSignal())
    requests.dispose()
    expect(await next).toMatchObject({ delivery: 'sent', outcome: 'unknown' })
  })

  it('contains a transport exception as an unknown attempted send', async () => {
    requests.connect('i1', () => { throw new Error('write callback failed') })
    expect(await requests.execute(invocation(), liveSignal())).toMatchObject({ outcome: 'unknown', delivery: 'sent' })
  })

  it('removes timers and refuses future dispatch after disposal', async () => {
    requests.connect('i1', () => {})
    const pending = requests.execute(invocation(), liveSignal())
    requests.dispose()
    expect(await pending).toMatchObject({ outcome: 'unknown' })
    expect(vi.getTimerCount()).toBe(0)
    expect(await requests.execute(invocation('r2'), liveSignal())).toMatchObject({ delivery: 'not-sent', reason: 'closed' })
  })

  it('seals canonical content including authority, document and deadline', () => {
    const request = invocation()
    const reordered = sealBrowserInvocation({ ...request, payload: { elementId: 'e1', action: 'click' } })
    expect(reordered.fingerprint).toBe(request.fingerprint)
    for (const changed of [
      { grantEpoch: 2 }, { sessionId: 'other' }, { deadline: request.deadline + 1 },
      { target: { tabId: 11, frameId: 0, documentId: 'other' } }, { payload: { action: 'submit' } },
    ]) expect(sealBrowserInvocation({ ...request, ...changed }).fingerprint).not.toBe(request.fingerprint)
  })

  it('ignores a response whose authority epoch or body identity changed', async () => {
    const connection = requests.connect('i1', () => {})
    const request = invocation()
    const pending = requests.execute(request, liveSignal())
    connection.receive({ ...request, grantEpoch: 2, outcome: 'observed' })
    connection.receive({ ...request, fingerprint: 'different', outcome: 'observed' })
    expect(requests.status(request).outcome).toBe('in-flight')
    connection.disconnect()
    expect((await pending).outcome).toBe('unknown')
  })

  it('never expires an unresolved write to make room for another one', async () => {
    requests.dispose(); requests = new BrowserRequests({ ...limits, capacity: 1 })
    const connection = requests.connect('i1', () => {})
    const request = invocation()
    const pending = requests.execute(request, liveSignal())
    connection.disconnect(); await pending
    await vi.advanceTimersByTimeAsync(10000)
    requests.connect('i1', () => {})
    expect(await requests.execute(invocation('r2', 12), liveSignal())).toMatchObject({ reason: 'capacity' })
    expect(requests.status(request).outcome).toBe('unknown')
  })

  it('keeps a write unknown when an executor supplies an invalid outcome', async () => {
    const connection = requests.connect('i1', () => {})
    const request = invocation()
    const pending = requests.execute(request, liveSignal())
    connection.receive({ ...request, outcome: 'bogus' } as never)
    expect(await pending).toMatchObject({ outcome: 'unknown', reason: 'invalid_receipt' })
    expect(await requests.execute(invocation('r2'), liveSignal())).toMatchObject({ reason: 'target_busy' })
  })

  it('preserves a synchronously observed result even if the transport callback then throws', async () => {
    const connection = requests.connect('i1', (frame) => {
      if (frame.type === 'execute') connection.receive({ ...frame.request, outcome: 'observed' })
      throw Error('late write failure')
    })
    const request = invocation()
    expect((await requests.execute(request, liveSignal())).outcome).toBe('observed')
    expect(requests.status(request).outcome).toBe('observed')
  })
})
