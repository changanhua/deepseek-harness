import type { ClientObservation } from '@deepseek-ai/dsh-api-remotes/client'

const ACTIVE_TIMEOUT_MS = 60_000
const HEARTBEAT_MS = 15_000
const POINTER_MOVE_THROTTLE_MS = 5_000

type TimerHandle = ReturnType<typeof setTimeout>
type IntervalHandle = ReturnType<typeof setInterval>

/** Inputs required by the browser-document activity producer. */
export interface ActivityTrackerOptions {
  /** Document receiving visibility and interaction signals. */
  readonly document?: Document
  /** Window receiving focus and page lifecycle signals. */
  readonly window?: Window
  /** Clock used for browser timestamps and idle deadlines. */
  readonly now?: () => number
  /** Identity source called once for each document lifecycle. */
  readonly idSource?: () => string
  /** Remote operation receiving observations in producer order. */
  readonly observeClient: (observation: ClientObservation) => void | Promise<unknown>
  /** Optional sink for transport failures; failures never stop later sends. */
  readonly onError?: (error: unknown) => void
}

/**
 * Install the app-scope activity producer and return its complete disposer.
 *
 * @param options - Browser dependencies and the Work Observatory remote.
 * @returns A disposer that removes listeners, timers, and pending sends.
 */
export function installActivityTracker(options: ActivityTrackerOptions): () => void {
  const documentRef = options.document ?? globalThis.document
  const windowRef = options.window ?? globalThis.window
  const now = options.now ?? (() => Date.now())
  const idSource = options.idSource ?? (() => globalThis.crypto.randomUUID())
  const clientId = idSource()

  let disposed = false
  let sequence = 0
  let visible = documentRef.visibilityState === 'visible'
  let focused = documentRef.hasFocus()
  let pageHidden = false
  let lastInteractionAt: number | undefined
  let lastPointerMoveAt = Number.NEGATIVE_INFINITY
  let lastSentVisible: boolean | undefined
  let lastSentActive: boolean | undefined
  let idleTimer: TimerHandle | undefined
  let heartbeatTimer: IntervalHandle | undefined
  let sendQueue: Promise<void> = Promise.resolve()

  const enqueue = (visibleValue: boolean, activeValue: boolean): void => {
    const observation: ClientObservation = {
      clientId,
      seq: sequence,
      visible: visibleValue,
      active: activeValue,
      clientObservedAt: now(),
    }
    sequence += 1
    sendQueue = sendQueue
      .then(async () => {
        if (disposed) return
        await options.observeClient(observation)
      })
      .catch((error) => {
        options.onError?.(error)
      })
  }

  const clearIdleTimer = (): void => {
    if (idleTimer === undefined) return
    globalThis.clearTimeout(idleTimer)
    idleTimer = undefined
  }

  const clearHeartbeat = (): void => {
    if (heartbeatTimer === undefined) return
    globalThis.clearInterval(heartbeatTimer)
    heartbeatTimer = undefined
  }

  const currentVisible = (): boolean => !pageHidden && visible

  const currentActive = (at: number): boolean => (
    currentVisible()
    && focused
    && lastInteractionAt !== undefined
    && at - lastInteractionAt < ACTIVE_TIMEOUT_MS
  )

  const scheduleIdleTimer = (): void => {
    clearIdleTimer()
    if (lastInteractionAt === undefined || !currentActive(now())) return
    const remaining = Math.max(0, ACTIVE_TIMEOUT_MS - (now() - lastInteractionAt))
    idleTimer = globalThis.setTimeout(() => {
      idleTimer = undefined
      const at = now()
      if (currentActive(at)) {
        scheduleIdleTimer()
        return
      }
      sync(false)
    }, remaining)
  }

  const ensureHeartbeat = (): void => {
    if (heartbeatTimer !== undefined || !currentVisible()) return
    heartbeatTimer = globalThis.setInterval(() => {
      if (!currentVisible()) {
        clearHeartbeat()
        return
      }
      sync(true)
    }, HEARTBEAT_MS)
  }

  function sync(force: boolean): void {
    const visibleValue = currentVisible()
    const activeValue = currentActive(now())
    if (force || visibleValue !== lastSentVisible || activeValue !== lastSentActive) {
      lastSentVisible = visibleValue
      lastSentActive = activeValue
      enqueue(visibleValue, activeValue)
    }
    if (visibleValue) ensureHeartbeat()
    else clearHeartbeat()
    scheduleIdleTimer()
  }

  const recordInteraction = (): void => {
    lastInteractionAt = now()
    sync(false)
  }

  const onVisibilityChange = (): void => {
    pageHidden = false
    visible = documentRef.visibilityState === 'visible'
    sync(false)
  }
  const onFocus = (): void => {
    focused = true
    sync(false)
  }
  const onBlur = (): void => {
    focused = false
    sync(false)
  }
  const onPageHide = (): void => {
    pageHidden = true
    sync(false)
  }
  const onPointerMove = (): void => {
    const at = now()
    if (at - lastPointerMoveAt < POINTER_MOVE_THROTTLE_MS) return
    lastPointerMoveAt = at
    recordInteraction()
  }

  documentRef.addEventListener('visibilitychange', onVisibilityChange)
  documentRef.addEventListener('pointerdown', recordInteraction)
  documentRef.addEventListener('keydown', recordInteraction)
  documentRef.addEventListener('wheel', recordInteraction)
  documentRef.addEventListener('touchstart', recordInteraction)
  documentRef.addEventListener('pointermove', onPointerMove)
  windowRef.addEventListener('focus', onFocus)
  windowRef.addEventListener('blur', onBlur)
  windowRef.addEventListener('pagehide', onPageHide)

  sync(true)

  return () => {
    if (disposed) return
    disposed = true
    documentRef.removeEventListener('visibilitychange', onVisibilityChange)
    documentRef.removeEventListener('pointerdown', recordInteraction)
    documentRef.removeEventListener('keydown', recordInteraction)
    documentRef.removeEventListener('wheel', recordInteraction)
    documentRef.removeEventListener('touchstart', recordInteraction)
    documentRef.removeEventListener('pointermove', onPointerMove)
    windowRef.removeEventListener('focus', onFocus)
    windowRef.removeEventListener('blur', onBlur)
    windowRef.removeEventListener('pagehide', onPageHide)
    clearIdleTimer()
    clearHeartbeat()
  }
}
