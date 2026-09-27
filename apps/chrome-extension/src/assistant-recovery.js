const EVENT_COOLDOWN_MS = 10_000
const PROBE_TIMEOUT_MS = 3000
const KEY_PREFIX = 'dsh.browser.recovery.'

/** Browser-owned events wake recovery; page content cannot invoke this hook. */
export const installConnectionRecoveryHooks = ({ chromeApi, wake }) => {
  const recover = () => { void Promise.resolve(wake()).catch(() => {}) }
  const navigated = details => {
    if (details.frameId === 0 && typeof details.url === 'string') {
      void Promise.resolve(wake({ url: details.url })).catch(() => {})
    }
  }
  chromeApi.runtime.onStartup.addListener(recover)
  chromeApi.runtime.onInstalled.addListener(recover)
  chromeApi.webNavigation.onCompleted.addListener(navigated)
  return () => {
    chromeApi.runtime.onStartup.removeListener(recover)
    chromeApi.runtime.onInstalled.removeListener(recover)
    chromeApi.webNavigation.onCompleted.removeListener(navigated)
  }
}

/** A credential-free liveness check; only the WebSocket handshake can establish authority. */
export const probeAssistantService = async (baseUrl, fetchImpl = fetch, signal) => {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) return false
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, PROBE_TIMEOUT_MS)
  try {
    const response = await fetchImpl(new URL('/api/browser-extension/v1/ws', baseUrl).href,
      { method: 'HEAD', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal })
    return !controller.signal.aborted && response.status >= 200 && response.status < 500
  } catch { return false }
  finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort) }
}

/** Browser lifecycle events trigger at most one probe per connection; no polling timer is retained. */
export const createConnectionRecovery = ({ storage, connections, fetchImpl = fetch }) => {
  const pending = new Map()
  const recover = async (id, connection, url) => {
    const state = await connection.read()
    if (state.phase !== 'offline' || state.retryPending || !state.baseUrl) return
    if (url !== undefined) {
      try { if (new URL(url).origin !== new URL(state.baseUrl).origin) return } catch { return }
    }
    const key = KEY_PREFIX + id
    const prior = (await storage.get(key))[key]
    const now = Date.now()
    if (prior?.baseUrl === state.baseUrl && Number.isFinite(prior.nextProbeAt)
      && prior.nextProbeAt > now && prior.nextProbeAt <= now + EVENT_COOLDOWN_MS) return
    await storage.set({ [key]: { baseUrl: state.baseUrl, nextProbeAt: now + EVENT_COOLDOWN_MS } })
    if (!await probeAssistantService(state.baseUrl, fetchImpl)) return
    const current = await connection.read()
    if (current.phase !== 'offline' || current.retryPending || current.baseUrl !== state.baseUrl) return
    await connection.retrySaved({ once: true })
  }
  return {
    wake({ url } = {}) {
      return Promise.allSettled(Object.entries(connections).map(([id, connection]) => {
        if (pending.has(id)) return pending.get(id)
        const work = recover(id, connection, url).finally(() => { pending.delete(id) })
        pending.set(id, work)
        return work
      }))
    },
  }
}
