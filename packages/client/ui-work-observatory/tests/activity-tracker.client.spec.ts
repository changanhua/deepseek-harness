// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientObservation } from '@deepseek-ai/dsh-host-work-observatory/types'
import { SessionId } from '@deepseek-ai/dsh-session'
import { installActivityTracker } from '../src/client/activity-tracker.ts'

const disposers: Array<() => void> = []

function documentState(visibility: DocumentVisibilityState, focused: boolean): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: visibility })
  vi.spyOn(document, 'hasFocus').mockReturnValue(focused)
}

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Work Observatory browser activity tracker', () => {
  it('sends Host-stamped state only and associates activity with the current Session', async () => {
    vi.useFakeTimers()
    documentState('visible', true)
    const observations: ClientObservation[] = []
    const sessionId = SessionId('s1')
    disposers.push(installActivityTracker({
      idSource: () => 'browser-1',
      sessionId: () => sessionId,
      observeClient: (observation) => { observations.push(observation) },
    }))
    await flush()

    expect(observations).toEqual([{
      clientId: 'browser-1', seq: 0, visible: true, active: false, sessionId,
    }])
    document.dispatchEvent(new Event('pointerdown'))
    await flush()
    expect(observations.at(-1)).toEqual({
      clientId: 'browser-1', seq: 1, visible: true, active: true, sessionId,
    })
    expect(observations.at(-1)).not.toHaveProperty('clientObservedAt')
  })

  it('serializes Remote writes and continues after a transport failure', async () => {
    vi.useFakeTimers()
    documentState('visible', true)
    const calls: ClientObservation[] = []
    let rejectFirst: (reason: unknown) => void = () => {}
    const onError = vi.fn()
    disposers.push(installActivityTracker({
      idSource: () => 'browser-1',
      sessionId: () => undefined,
      observeClient: (observation) => {
        calls.push(observation)
        if (calls.length === 1) return new Promise((_, reject) => { rejectFirst = reject })
      },
      onError,
    }))
    await flush()
    document.dispatchEvent(new Event('pointerdown'))
    await flush()
    expect(calls).toHaveLength(1)
    rejectFirst(new Error('offline'))
    await flush()
    expect(calls.map(call => call.seq)).toEqual([0, 1])
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' }))
  })

  it('requires fresh interaction after a hidden document becomes visible again', async () => {
    vi.useFakeTimers()
    documentState('visible', true)
    const observations: ClientObservation[] = []
    disposers.push(installActivityTracker({
      idSource: () => 'browser-1',
      sessionId: () => undefined,
      observeClient: (observation) => { observations.push(observation) },
    }))
    await flush()

    document.dispatchEvent(new Event('pointerdown'))
    await flush()
    expect(observations.at(-1)?.active).toBe(true)

    documentState('hidden', false)
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(observations.at(-1)).toMatchObject({ visible: false, active: false })

    documentState('visible', true)
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(observations.at(-1)).toMatchObject({ visible: true, active: false })
  })

  it('removes activity listeners and timers on HMR disposal', async () => {
    vi.useFakeTimers()
    documentState('visible', true)
    const observations: ClientObservation[] = []
    const dispose = installActivityTracker({
      idSource: () => 'browser-1',
      sessionId: () => undefined,
      observeClient: (observation) => { observations.push(observation) },
    })
    await flush()
    dispose()
    document.dispatchEvent(new Event('pointerdown'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(observations).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
