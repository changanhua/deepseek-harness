// @vitest-environment jsdom
import type { ClientObservation } from '@deepseek-ai/dsh-api-remotes/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installActivityTracker } from '../src/client/activity-tracker.ts'
import { apply, inject } from '../src/client/index.ts'

const trackers: Array<() => void> = []

function setDocumentState(visibilityState: DocumentVisibilityState, focused: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visibilityState,
  })
  vi.spyOn(document, 'hasFocus').mockReturnValue(focused)
}

function createTracker(
  observeClient: (observation: ClientObservation) => unknown | Promise<unknown>,
): ClientObservation[] {
  setDocumentState('visible', true)
  const observations: ClientObservation[] = []
  trackers.push(installActivityTracker({
    observeClient: (observation) => {
      observations.push(observation)
      return observeClient(observation)
    },
    idSource: () => 'client-1',
  }))
  return observations
}

async function flushRemoteQueue(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

function dispatch(target: EventTarget, type: string): void {
  target.dispatchEvent(new Event(type))
}

afterEach(() => {
  for (const dispose of trackers.splice(0)) dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('client activity tracker', () => {
  it('activates only the headless effect through the generated Work Observatory Remote', async () => {
    vi.useFakeTimers()
    setDocumentState('visible', true)
    const observeClient = vi.fn(() => Promise.resolve({ ok: true, value: { accepted: true } }))
    const warn = vi.fn()
    let dispose: (() => void) | undefined
    apply({
      effect: (factory: () => () => void) => { dispose = factory() },
      locale: { register: () => () => undefined },
      slots: { inject: () => () => undefined },
      remote: { workObservatory: { observeClient } },
      logger: { warn },
    } as never)
    await flushRemoteQueue()

    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.workObservatory'])
    expect(observeClient).toHaveBeenCalledWith(expect.objectContaining({ visible: true, active: false }))
    expect(warn).not.toHaveBeenCalled()
    dispose?.()
  })

  it('reports a resolved ok:false Remote result through the onError sink', async () => {
    vi.useFakeTimers()
    setDocumentState('visible', true)
    const warn = vi.fn()
    let dispose: (() => void) | undefined
    apply({
      effect: (factory: () => () => void) => { dispose = factory() },
      locale: { register: () => () => undefined },
      slots: { inject: () => () => undefined },
      remote: {
        workObservatory: {
          observeClient: () => Promise.resolve({
            ok: false,
            error: { code: 'internal', message: 'rejected', details: {} },
          }),
        },
      },
      logger: { warn },
    } as never)
    await flushRemoteQueue()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('work observatory: observation failed'))
    dispose?.()
  })

  it('sends an initial snapshot and activates on main-document interaction', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const observations = createTracker(() => undefined)
    await flushRemoteQueue()

    expect(observations).toEqual([{
      clientId: 'client-1', seq: 0, visible: true, active: false, clientObservedAt: 1_000,
    }])

    dispatch(document, 'pointerdown')
    await flushRemoteQueue()
    expect(observations.at(-1)).toMatchObject({ clientId: 'client-1', seq: 1, visible: true, active: true })
  })

  it('uses one client identity and monotonic sequence for the document lifecycle', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000)
    setDocumentState('visible', true)
    const idSource = vi.fn(() => 'document-lifecycle-1')
    const observations: ClientObservation[] = []
    trackers.push(installActivityTracker({
      idSource,
      observeClient: (observation) => { observations.push(observation) },
    }))
    await flushRemoteQueue()
    dispatch(document, 'pointerdown')
    dispatch(document, 'wheel')
    await flushRemoteQueue()

    expect(idSource).toHaveBeenCalledOnce()
    expect(observations.map(observation => observation.clientId)).toEqual([
      'document-lifecycle-1', 'document-lifecycle-1',
    ])
    expect(observations.map(observation => observation.seq)).toEqual([0, 1])
  })

  it('ends active state locally after sixty seconds without another interaction', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const observations = createTracker(() => undefined)
    await flushRemoteQueue()
    dispatch(document, 'pointerdown')
    await flushRemoteQueue()

    await vi.advanceTimersByTimeAsync(59_999)
    expect(observations.at(-1)?.active).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(observations.at(-1)).toMatchObject({ visible: true, active: false, clientObservedAt: 60_000 })
  })

  it('refreshes the local idle deadline on later interactions', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const observations = createTracker(() => undefined)
    await flushRemoteQueue()
    dispatch(document, 'pointerdown')
    await flushRemoteQueue()
    await vi.advanceTimersByTimeAsync(59_000)
    dispatch(document, 'keydown')
    await flushRemoteQueue()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(observations.at(-1)?.active).toBe(true)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(observations.at(-1)).toMatchObject({ active: false, clientObservedAt: 119_000 })
  })

  it('treats focus and blur as immediate active-state transitions', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const observations = createTracker(() => undefined)
    await flushRemoteQueue()
    dispatch(document, 'pointerdown')
    await flushRemoteQueue()

    dispatch(window, 'blur')
    await flushRemoteQueue()
    expect(observations.at(-1)).toMatchObject({ visible: true, active: false })

    dispatch(window, 'focus')
    await flushRemoteQueue()
    expect(observations.at(-1)?.active).toBe(true)
  })

  it('sends hidden state immediately and stops the visible heartbeat', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const observations = createTracker(() => undefined)
    await flushRemoteQueue()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(observations).toHaveLength(2)

    setDocumentState('hidden', true)
    dispatch(document, 'visibilitychange')
    await flushRemoteQueue()
    expect(observations.at(-1)).toMatchObject({ visible: false, active: false })
    const hiddenCount = observations.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(observations).toHaveLength(hiddenCount)
  })

  it('handles pagehide as an immediate hidden transition', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100)
    const observations = createTracker(() => undefined)
    await flushRemoteQueue()
    dispatch(window, 'pagehide')
    await flushRemoteQueue()

    expect(observations.at(-1)).toMatchObject({ visible: false, active: false, clientObservedAt: 100 })
  })

  it('accepts the standard interaction signals and throttles pointer movement', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const observations = createTracker(() => undefined)
    await flushRemoteQueue()

    for (const type of ['keydown', 'wheel', 'touchstart']) {
      setDocumentState('visible', true)
      dispatch(document, type)
      await flushRemoteQueue()
    }
    const beforePointerMoves = observations.length
    dispatch(document, 'pointermove')
    await flushRemoteQueue()
    expect(observations.length).toBe(beforePointerMoves)

    await vi.advanceTimersByTimeAsync(5_000)
    dispatch(document, 'pointermove')
    await flushRemoteQueue()
    expect(observations.length).toBe(beforePointerMoves)
  })

  it('keeps heartbeat snapshots while visible even when state is unchanged', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const observations = createTracker(() => undefined)
    await flushRemoteQueue()

    await vi.advanceTimersByTimeAsync(30_000)
    expect(observations).toHaveLength(3)
    expect(observations.map(observation => observation.seq)).toEqual([0, 1, 2])
    expect(observations.every(observation => observation.visible && !observation.active)).toBe(true)
  })

  it('serializes remote calls and continues after a transport failure', async () => {
    vi.useFakeTimers()
    setDocumentState('visible', true)
    const calls: ClientObservation[] = []
    let rejectFirst: (reason?: unknown) => void = () => undefined
    const observeClient = vi.fn((observation: ClientObservation) => {
      calls.push(observation)
      if (calls.length === 1) return new Promise<never>((_, reject) => { rejectFirst = reject })
      return Promise.resolve()
    })
    trackers.push(installActivityTracker({ observeClient, idSource: () => 'client-1' }))
    await flushRemoteQueue()
    dispatch(document, 'pointerdown')
    await flushRemoteQueue()
    expect(observeClient).toHaveBeenCalledOnce()

    rejectFirst(new Error('network down'))
    await flushRemoteQueue()
    expect(observeClient).toHaveBeenCalledTimes(2)
    expect(calls.map(observation => observation.seq)).toEqual([0, 1])
  })

  it('removes listeners and timers when disposed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const observations = createTracker(() => undefined)
    await flushRemoteQueue()
    const dispose = trackers.pop()!
    dispose()

    dispatch(document, 'pointerdown')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(observations).toHaveLength(1)
  })

  it('restores visible state on visibilitychange back while keeping active false without a new interaction', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const observations = createTracker(() => undefined)
    await flushRemoteQueue()
    dispatch(document, 'pointerdown')
    await flushRemoteQueue()
    await vi.advanceTimersByTimeAsync(61_000)
    expect(observations.at(-1)).toMatchObject({ visible: true, active: false })

    setDocumentState('hidden', true)
    dispatch(document, 'visibilitychange')
    await flushRemoteQueue()
    expect(observations.at(-1)).toMatchObject({ visible: false, active: false })

    await vi.advanceTimersByTimeAsync(60_000)
    setDocumentState('visible', true)
    dispatch(document, 'visibilitychange')
    await flushRemoteQueue()

    expect(observations.at(-1)).toMatchObject({ visible: true, active: false })
    expect(observations.at(-1)?.clientObservedAt).toBe(121_000)
  })

  it('emits visible=false active=false for an initially hidden document', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(5_000)
    setDocumentState('hidden', true)
    const observations: ClientObservation[] = []
    trackers.push(installActivityTracker({
      observeClient: (observation) => { observations.push(observation) },
      idSource: () => 'client-hidden',
    }))
    await flushRemoteQueue()

    expect(observations).toEqual([{
      clientId: 'client-hidden', seq: 0, visible: false, active: false, clientObservedAt: 5_000,
    }])
  })

  it('never emits active without visible across a full interaction lifecycle', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    setDocumentState('visible', true)
    const observations: ClientObservation[] = []
    trackers.push(installActivityTracker({
      observeClient: (observation) => { observations.push(observation) },
      idSource: () => 'client-invariant',
    }))
    await flushRemoteQueue()
    dispatch(document, 'pointerdown')
    await flushRemoteQueue()
    await vi.advanceTimersByTimeAsync(61_000)
    setDocumentState('hidden', true)
    dispatch(document, 'visibilitychange')
    await flushRemoteQueue()
    await vi.advanceTimersByTimeAsync(15_000)
    setDocumentState('visible', true)
    dispatch(document, 'visibilitychange')
    await flushRemoteQueue()
    dispatch(window, 'blur')
    await flushRemoteQueue()

    expect(observations.length).toBeGreaterThan(2)
    for (const observation of observations) {
      expect(!observation.active || observation.visible).toBe(true)
    }
    expect(observations.some(observation => observation.active && !observation.visible)).toBe(false)
  })
})
