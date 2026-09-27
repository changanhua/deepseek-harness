import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConnectionRecovery, installConnectionRecoveryHooks } from '../src/assistant-recovery.js'

const harness = () => {
  const values = {}
  const storage = { get: vi.fn(async key => ({ [key]: values[key] })),
    set: vi.fn(async (patch) => { Object.assign(values, structuredClone(patch)) }) }
  let state = { phase: 'offline', baseUrl: 'http://127.0.0.1:3080' }
  const connection = { read: vi.fn(async () => state), retrySaved: vi.fn(async () => true) }
  const fetchImpl = vi.fn(async () => ({ status: 405 }))
  const options = { storage, connections: { dsh: connection }, fetchImpl }
  return { storage, connection, fetchImpl, options, recovery: createConnectionRecovery(options),
    state: (value) => { state = value } }
}
afterEach(() => { vi.useRealTimers() })

describe('event-driven browser connection recovery', () => {
  it('wires browser startup, extension update and successful top-frame navigation and removes every hook', async () => {
    const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() })
    const chromeApi = { runtime: { onStartup: event(), onInstalled: event() }, webNavigation: { onCompleted: event() } }
    const wake = vi.fn(async () => {})
    const dispose = installConnectionRecoveryHooks({ chromeApi, wake })
    chromeApi.runtime.onStartup.addListener.mock.calls[0][0]()
    chromeApi.runtime.onInstalled.addListener.mock.calls[0][0]()
    const navigate = chromeApi.webNavigation.onCompleted.addListener.mock.calls[0][0]
    navigate({ frameId: 1, url: 'http://127.0.0.1:3080/' })
    navigate({ frameId: 0, url: 'http://127.0.0.1:3080/' })
    expect(wake.mock.calls).toEqual([[], [], [{ url: 'http://127.0.0.1:3080/' }]])
    dispose()
    for (const source of [chromeApi.runtime.onStartup, chromeApi.runtime.onInstalled, chromeApi.webNavigation.onCompleted]) {
      expect(source.removeListener).toHaveBeenCalledWith(source.addListener.mock.calls[0][0])
    }
  })
  it('ignores other pages and recovers only the configured origin with one credential-preserving attempt', async () => {
    const h = harness()
    await h.recovery.wake({ url: 'https://unrelated.test/' })
    expect(h.fetchImpl).not.toHaveBeenCalled()
    await h.recovery.wake({ url: 'http://127.0.0.1:3080/' })
    expect(h.fetchImpl).toHaveBeenCalledOnce()
    expect(h.fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'HEAD', credentials: 'omit', redirect: 'error' })
    expect(h.connection.retrySaved).toHaveBeenCalledExactlyOnceWith({ once: true })
  })

  it('coalesces event storms and persists the cooldown across worker recreation without polling', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.fetchImpl.mockRejectedValue(new Error('offline'))
    await Promise.all(Array.from({ length: 50 }, () => h.recovery.wake()))
    await createConnectionRecovery(h.options).wake()
    expect(h.fetchImpl).toHaveBeenCalledOnce()
    expect(h.connection.retrySaved).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(h.fetchImpl).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    await h.recovery.wake()
    expect(h.fetchImpl).toHaveBeenCalledTimes(2)
  })

  it.each(['connected', 'connecting', 'unauthorized', 'configured', 'unconfigured'])(
    'does not reconnect a %s connection', async (phase) => {
      const h = harness(); h.state({ phase, baseUrl: 'http://127.0.0.1:3080' })
      await h.recovery.wake()
      expect(h.fetchImpl).not.toHaveBeenCalled()
      expect(h.connection.retrySaved).not.toHaveBeenCalled()
    })

  it('does not join the finite retry loop or reopen a connection disconnected during its probe', async () => {
    const h = harness()
    h.state({ phase: 'offline', baseUrl: 'http://127.0.0.1:3080', retryPending: true })
    await h.recovery.wake(); expect(h.fetchImpl).not.toHaveBeenCalled()
    h.state({ phase: 'offline', baseUrl: 'http://127.0.0.1:3080' })
    h.fetchImpl.mockImplementationOnce(async () => {
      h.state({ phase: 'configured', baseUrl: 'http://127.0.0.1:3080' }); return { status: 200 }
    })
    await h.recovery.wake()
    expect(h.connection.retrySaved).not.toHaveBeenCalled()
  })
})
