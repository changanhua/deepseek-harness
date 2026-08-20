/**
 * The Capability viewer's client store: a framework-neutral snapshot/
 * subscribe surface over the capabilityRegistry Remote. It owns the load
 * chain — a full snapshot read on demand — and exposes the result as a bare
 * observable the inject `hooks` compartment hands to the renderer. No
 * subscription machinery lives in a component.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { CapabilitySnapshot } from '@deepseek-ai/dsh-host-capability-registry/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'

/** The narrow Remote face the store drives; test fakes satisfy exactly this. */
export interface CapabilityRemoteFace {
  list(request: { sessionId: SessionId }): Promise<RemoteResult<CapabilitySnapshot>>
}

/** One store snapshot; the view subscribes through getSnapshot/subscribe. */
export interface CapabilityStoreSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  sessionId: SessionId | undefined
  snapshot: CapabilitySnapshot | undefined
}

const EMPTY: CapabilityStoreSnapshot = {
  status: 'idle',
  error: null,
  sessionId: undefined,
  snapshot: undefined,
}

/** Read the RemoteResult value or throw its wire error message. */
function valueOf<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Human text for a rejected wire call. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Capability panel store.
 */
export class CapabilityStore {
  #snapshot: CapabilityStoreSnapshot = EMPTY
  #listeners = new Set<() => void>()
  #disposed = false
  #generation = 0

  constructor(private readonly remote: CapabilityRemoteFace) {}

  /** Current snapshot for synchronous readers. */
  getSnapshot = (): CapabilityStoreSnapshot => this.#snapshot

  /** Subscribe to snapshot changes; returns the unsubscribe disposer. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /** Drop listeners and reject further updates. */
  dispose(): void {
    this.#disposed = true
    this.#listeners.clear()
  }

  #set(patch: Partial<CapabilityStoreSnapshot>): void {
    if (this.#disposed) return
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of [...this.#listeners]) listener()
  }

  /** Load a full capability snapshot for one session.
   * @param sessionId - the session whose capability snapshot to load. */
  async load(sessionId: SessionId): Promise<void> {
    if (this.#disposed) return
    const generation = ++this.#generation
    this.#set({ status: 'loading', error: null, sessionId })
    try {
      const snapshot = valueOf(await this.remote.list({ sessionId }))
      if (generation !== this.#generation) return
      this.#set({ status: 'ready', error: null, snapshot })
    } catch (error: unknown) {
      if (generation !== this.#generation) return
      this.#set({ status: 'error', error: messageOf(error) })
    }
  }

  /** Retry the last load with the same sessionId. */
  async retry(): Promise<void> {
    const sessionId = this.#snapshot.sessionId
    if (sessionId !== undefined) await this.load(sessionId)
  }

  /** Reset to idle, dropping the addressing slot. */
  reset(): void {
    this.#generation += 1
    this.#set({ status: 'idle', error: null, sessionId: undefined, snapshot: undefined })
  }
}
