import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ClientObservation } from '@changanhua/dsh-host-work-observatory/types'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'

const IDLE_MS = 60_000
const HEARTBEAT_MS = 15_000

interface ActivityTrackerOptions {
  readonly observeClient: (observation: ClientObservation) => unknown | Promise<unknown>
  readonly sessionId: () => SessionId | undefined
  readonly idSource?: () => string
  readonly onError?: (error: Error) => void
}

/** Install the one document-scoped, Host-stamped activity producer. */
export function installActivityTracker(options: ActivityTrackerOptions): () => void {
  const clientId = (options.idSource ?? randomUUID)()
  let seq = 0
  let disposed = false
  let active = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let remoteTail: Promise<void> = Promise.resolve()

  const visible = (): boolean => document.visibilityState === 'visible'
  const currentActive = (): boolean => active && visible() && document.hasFocus()

  const reportError = (error: unknown): void => {
    options.onError?.(error instanceof Error ? error : new Error(String(error)))
  }

  const send = (): void => {
    if (disposed) return
    const sessionId = options.sessionId()
    const observation: ClientObservation = {
      clientId,
      seq: seq++,
      visible: visible(),
      active: currentActive(),
      ...(sessionId === undefined ? {} : { sessionId }),
    }
    remoteTail = remoteTail
      .then(() => Promise.resolve(options.observeClient(observation)))
      .then(() => undefined, (error: unknown) => { reportError(error) })
  }

  const clearIdle = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    idleTimer = undefined
  }

  const interact = (): void => {
    if (!visible() || !document.hasFocus()) return
    clearIdle()
    const changed = !active
    active = true
    if (changed) send()
    idleTimer = setTimeout(() => {
      idleTimer = undefined
      active = false
      send()
    }, IDLE_MS)
  }

  const environmentChanged = (): void => {
    if (!visible()) {
      active = false
      clearIdle()
    }
    send()
  }
  const hide = (): void => {
    active = false
    clearIdle()
    send()
  }

  const interactions = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
  for (const type of interactions) document.addEventListener(type, interact, { passive: true })
  document.addEventListener('visibilitychange', environmentChanged)
  window.addEventListener('focus', environmentChanged)
  window.addEventListener('blur', environmentChanged)
  window.addEventListener('pagehide', hide)
  const heartbeat = setInterval(() => { if (visible()) send() }, HEARTBEAT_MS)
  send()

  return () => {
    disposed = true
    clearIdle()
    clearInterval(heartbeat)
    for (const type of interactions) document.removeEventListener(type, interact)
    document.removeEventListener('visibilitychange', environmentChanged)
    window.removeEventListener('focus', environmentChanged)
    window.removeEventListener('blur', environmentChanged)
    window.removeEventListener('pagehide', hide)
  }
}
