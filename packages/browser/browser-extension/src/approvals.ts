import { randomUUID } from 'node:crypto'
import type { ApprovalOutcome, ApprovalRequestEvent } from '@deepseek-ai/dsh-user-approval/types'

type Decision = 'allowed-once' | 'rejected'
interface Peer { readonly id: string; readonly permit: () => boolean; readonly send: (frame: unknown) => void }
interface Pending {
  readonly peer: Peer
  readonly surfaceId: string
  readonly sessionId: string
  readonly id: string
  readonly toolName: string
  readonly callId?: string
  readonly reason?: string
  readonly signal?: AbortSignal
  readonly resolve: (outcome: ApprovalOutcome | undefined) => void
  readonly cleanup: () => void
}

/** Ephemeral native answerer; user-approval retains the audit pair and final decision authority. */
export class BrowserApprovals {
  private readonly visible = new Map<string, { peer: Peer; surfaceId: string; sessionId: string }>()
  private readonly pending = new Map<string, Pending>()
  private closed = false

  constructor(private readonly options: { readonly maxPending: number; readonly ttl: number }) {}

  presence(peer: Peer, input: { readonly surfaceId: string; readonly sessionId: string | null }): {
    surfaceId: string
    sessionId: string | null
    requests: readonly object[]
  } {
    if (this.closed || !peer.permit()) throw new Error('approval_unavailable')
    const key = this.surfaceKey(peer, input.surfaceId)
    if (input.sessionId === null) this.visible.delete(key)
    else this.visible.set(key, { peer, surfaceId: input.surfaceId, sessionId: input.sessionId })
    for (const pending of [...this.pending.values()]) {
      if (pending.peer === peer && pending.surfaceId === input.surfaceId && pending.sessionId !== input.sessionId) {
        this.finish(pending, pending.signal?.aborted ? 'cancelled' : undefined)
      }
    }
    return { surfaceId: input.surfaceId, sessionId: input.sessionId, requests: this.requests(peer, input.surfaceId, input.sessionId) }
  }

  decide(peer: Peer, input: {
    readonly surfaceId: string
    readonly sessionId: string
    readonly id: string
    readonly decision: Decision
  }): boolean {
    const pending = this.pending.get(input.id)
    const visible = this.visible.get(this.surfaceKey(peer, input.surfaceId))
    if (this.closed || pending === undefined || pending.peer !== peer || pending.surfaceId !== input.surfaceId
      || pending.sessionId !== input.sessionId || visible?.sessionId !== input.sessionId
      || !peer.permit() || pending.signal?.aborted) return false
    this.finish(pending, input.decision)
    return true
  }

  answer(request: ApprovalRequestEvent, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> {
    if (request.signal?.aborted) return Promise.resolve('cancelled')
    if (this.closed || request.toolName !== 'browser_action') return next()
    const selected = [...this.visible.values()].find(row => row.sessionId === request.agent.session.id && row.peer.permit())
    if (selected === undefined || this.pending.size >= this.options.maxPending || (request.reason?.length ?? 0) > 32768) return next()
    const decision = Promise.withResolvers<ApprovalOutcome | undefined>()
    // This id belongs only to the transport wait. Never infer an audit id from the last Session event:
    // concurrent approval calls can append their audit events before either answerer is entered.
    const id = randomUUID()
    const onAbort = (): void => { this.finish(pending, 'cancelled') }
    const timer = setTimeout(() => { this.finish(pending, 'cancelled') }, this.options.ttl); timer.unref()
    const pending: Pending = { peer: selected.peer, surfaceId: selected.surfaceId,
      sessionId: request.agent.session.id, id, toolName: request.toolName,
      resolve: decision.resolve, cleanup: () => { clearTimeout(timer); request.signal?.removeEventListener('abort', onAbort) },
      ...(request.callId === undefined ? {} : { callId: request.callId }),
      ...(request.reason === undefined ? {} : { reason: request.reason }),
      ...(request.signal === undefined ? {} : { signal: request.signal }) }
    this.pending.set(id, pending)
    request.signal?.addEventListener('abort', onAbort, { once: true })
    try { this.publish(selected.peer, selected.surfaceId, pending.sessionId) }
    catch { this.finish(pending, request.signal?.aborted ? 'cancelled' : undefined) }
    return decision.promise.then(outcome => outcome === undefined ? next() : outcome).catch(() => 'unavailable')
  }

  withdraw(peer: Peer): void {
    for (const [key, value] of this.visible) if (value.peer === peer) this.visible.delete(key)
    for (const pending of [...this.pending.values()]) {
      if (pending.peer === peer) this.finish(pending, pending.signal?.aborted ? 'cancelled' : undefined)
    }
  }

  dispose(): void {
    this.closed = true; this.visible.clear()
    for (const pending of [...this.pending.values()]) this.finish(pending, 'cancelled')
  }

  private requests(peer: Peer, surfaceId: string, sessionId: string | null): readonly object[] {
    return [...this.pending.values()]
      .filter(value => value.peer === peer && value.surfaceId === surfaceId && value.sessionId === sessionId).map(value => ({
        id: value.id, toolName: value.toolName,
        ...(value.callId === undefined ? {} : { callId: value.callId }), ...(value.reason === undefined ? {} : { reason: value.reason }) }))
  }
  private publish(peer: Peer, surfaceId: string, sessionId: string): void {
    peer.send({ type: 'approval', surfaceId, sessionId, requests: this.requests(peer, surfaceId, sessionId) })
  }
  private surfaceKey(peer: Peer, surfaceId: string): string { return `${peer.id}\u0000${surfaceId}` }
  private finish(pending: Pending, outcome: ApprovalOutcome | undefined): void {
    if (this.pending.get(pending.id) !== pending) return
    pending.cleanup(); this.pending.delete(pending.id)
    try { this.publish(pending.peer, pending.surfaceId, pending.sessionId) }
    catch { /* view delivery cannot alter the already settled decision */ }
    pending.resolve(outcome)
  }
}
