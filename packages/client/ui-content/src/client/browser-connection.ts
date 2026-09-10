/** UI projection of authenticated extension approval; credentials stay on the Host. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { BrowserConnectRequest, BrowserGrantSummary } from '@changanhua/dsh-content-browser/types'

/** Generated Remote-compatible operations used by this projection. */
export interface BrowserConnectionRemote {
  request(id: string, signal?: AbortSignal): Promise<RemoteResult<BrowserConnectRequest>>
  approve(id: string, signal?: AbortSignal): Promise<RemoteResult<BrowserConnectRequest>>
  reject(id: string, signal?: AbortSignal): Promise<RemoteResult<BrowserConnectRequest>>
  grants(signal?: AbortSignal): Promise<RemoteResult<BrowserGrantSummary[]>>
  revoke(id: string, signal?: AbortSignal): Promise<RemoteResult<void>>
}

/** Shared approval and authorized-installation view. */
export interface BrowserConnectionView {
  visible: boolean
  requestId: string | null
  request: BrowserConnectRequest | null
  grants: readonly BrowserGrantSummary[]
  busy: boolean
  error: string | null
}

/** One fiber-owned store; opening a request is read-only until explicit approval. */
export class BrowserConnectionStore implements HostObservable<BrowserConnectionView> {
  private view: BrowserConnectionView = { visible: false, requestId: null, request: null, grants: [], busy: false, error: null }
  private readonly listeners = new Set<() => void>()
  private readonly abort = new AbortController()
  private generation = 0

  /** @param remote - Authenticated generated Host namespace. */
  constructor(private readonly remote: BrowserConnectionRemote) {}
  /** Current immutable presentation. */
  getSnapshot = (): BrowserConnectionView => this.view
  /** Subscribe for framework rendering. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Read an approval request, or the installation list when no identity is supplied. */
  async open(requestId: string | null = null): Promise<void> {
    if (this.abort.signal.aborted) return
    const generation = ++this.generation
    this.publish({ visible: true, requestId, request: null, grants: [], busy: true, error: null })
    try {
      const state = requestId === null
        ? { grants: unwrap(await this.remote.grants(this.abort.signal)) }
        : { request: unwrap(await this.remote.request(requestId, this.abort.signal)) }
      if (this.current(generation)) this.publish({ ...this.view, ...state, busy: false })
    } catch (error) { this.fail(generation, error) }
  }

  /** Refresh the current read after a reported failure. */
  reload = (): Promise<void> => this.open(this.view.requestId)
  /** Hide this view without pretending an already submitted mutation was cancelled. */
  close = (): void => {
    this.generation += 1
    this.publish({ ...this.view, visible: false, request: null, busy: false })
  }
  /** Approve only the explicitly displayed pending request. */
  approve = (): Promise<void> => this.decide('approve')
  /** Reject only the explicitly displayed pending request. */
  reject = (): Promise<void> => this.decide('reject')

  /** Revoke one displayed installation and re-read the committed grant list. */
  async revoke(installationId: string): Promise<void> {
    if (this.abort.signal.aborted || this.view.busy || !this.view.visible
      || !this.view.grants.some(grant => grant.installationId === installationId)) return
    const generation = this.generation
    this.publish({ ...this.view, busy: true, error: null })
    try {
      unwrap(await this.remote.revoke(installationId, this.abort.signal))
      const grants = unwrap(await this.remote.grants(this.abort.signal))
      if (this.current(generation)) this.publish({ ...this.view, grants, busy: false })
    } catch (error) { this.fail(generation, error) }
  }

  /** End reads and suppress all late publication when the plugin unloads. */
  dispose(): void {
    this.generation += 1
    this.abort.abort()
    this.listeners.clear()
  }

  private async decide(action: 'approve' | 'reject'): Promise<void> {
    const request = this.view.request
    if (this.abort.signal.aborted || this.view.busy || !this.view.visible || request?.status !== 'pending') return
    const generation = this.generation
    this.publish({ ...this.view, busy: true, error: null })
    try {
      const result = unwrap(await this.remote[action](request.requestId, this.abort.signal))
      if (this.current(generation)) this.publish({ ...this.view, request: result, busy: false })
    } catch (error) { this.fail(generation, error) }
  }

  private current(generation: number): boolean { return !this.abort.signal.aborted && generation === this.generation }
  private fail(generation: number, error: unknown): void {
    if (this.current(generation)) this.publish({ ...this.view, busy: false, error: error instanceof RequestFailure ? error.code : 'transport' })
  }
  private publish(view: BrowserConnectionView): void {
    if (this.abort.signal.aborted) return
    this.view = Object.freeze(view)
    for (const listener of this.listeners) {
      try { listener() } catch { console.error('[ui-content] connection subscriber failed') }
    }
  }
}

class RequestFailure extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}
function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new RequestFailure(result.error.code)
  return result.value
}
