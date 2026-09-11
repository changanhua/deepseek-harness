import { createHash } from 'node:crypto'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import type {
  BrowserDispatchFrame, BrowserInvocation, BrowserReceipt, BrowserRequestIdentity,
  BrowserRequestLimits, BrowserRequestResult, BrowserRequestStatus,
} from './types.ts'

/** Capture a detached invocation and digest every authority, target, action and deadline field. */
export function sealBrowserInvocation(request: Omit<BrowserInvocation, 'fingerprint'>): BrowserInvocation {
  const body = {
    protocolVersion: request.protocolVersion, grantEpoch: request.grantEpoch,
    requestId: request.requestId, sessionId: request.sessionId, installationId: request.installationId,
    deadline: request.deadline, mutates: request.mutates, payload: request.payload,
    ...(request.target === undefined ? {} : { target: request.target }),
  }
  const serialized = canonical(body)
  return { ...JSON.parse(serialized) as Omit<BrowserInvocation, 'fingerprint'>,
    fingerprint: createHash('sha256').update(serialized).digest('hex') }
}

interface Connection { readonly send: (frame: BrowserDispatchFrame) => void }
interface Entry {
  readonly request: BrowserInvocation
  readonly promise: Promise<BrowserRequestResult>
  readonly resolve: (result: BrowserRequestResult) => void
  readonly cancel: AbortController
  readonly cleanup: () => void
  readonly retainUntil: number
  result: BrowserRequestResult | undefined
  quiescent: boolean
  released: boolean
}

/**
 * Host-local requests with conservative lost-receipt handling. The gateway owns
 * authorization and sockets; the extension owns the restart-safe write lock.
 */
export class BrowserRequests {
  private readonly connections = new Map<string, Connection>()
  private readonly entries = new Map<string, Entry>()
  private closed = false

  /** Bounds cover retained requests/results; unresolved writes are never evicted. */
  constructor(private readonly limits: BrowserRequestLimits) {
    if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value <= 0)) {
      throw new RangeError('browser request bounds must be positive safe integers')
    }
  }

  /** Replace one authenticated connection and reconcile uncertain IDs without executing them again. */
  connect(installationId: string, send: (frame: BrowserDispatchFrame) => void): {
    receive: (receipt: BrowserReceipt) => void
    disconnect: () => void
  } {
    if (this.closed) throw new Error('browser requests closed')
    this.disconnect(installationId, this.connections.get(installationId))
    const connection = { send }
    this.connections.set(installationId, connection)
    for (const entry of this.entries.values()) {
      if (entry.request.installationId === installationId && entry.result?.outcome === 'unknown') {
        this.send(entry, { type: 'status', request: identityOf(entry.request) })
      }
    }
    return {
      receive: (receipt) => {
        if (this.closed || this.connections.get(installationId) !== connection) return
        if (!isRecord(receipt)) {
          this.disconnect(installationId, connection)
          return
        }
        const entry = this.find(receipt)
        if (entry === undefined || entry.request.installationId !== installationId) return
        if (entry.result !== undefined && entry.result.outcome !== 'unknown') return
        if (!['observed', 'failed', 'cancelled', 'unknown'].includes(receipt.outcome)
          || receipt.reason !== undefined && typeof receipt.reason !== 'string'
          || receipt.quiescent !== undefined && typeof receipt.quiescent !== 'boolean') {
          this.unknown(entry, 'invalid_receipt')
          return
        }
        const result: BrowserRequestResult = {
          ...identityOf(entry.request), delivery: 'sent', outcome: receipt.outcome,
          ...(receipt.value === undefined ? {} : { value: receipt.value }),
          ...(receipt.reason === undefined ? {} : { reason: receipt.reason }),
        }
        if (bytes(result) > this.limits.maxResultBytes) {
          this.unknown(entry, 'result_too_large')
          return
        }
        this.settle(entry, structuredClone(result), receipt.quiescent === true)
      },
      disconnect: () => { this.disconnect(installationId, connection) },
    }
  }

  /**
   * Admit one validated invocation; an exact duplicate shares its current receipt.
   * Cancellation after sending requests a stop but cannot assert that no effect occurred.
   */
  execute(request: BrowserInvocation, signal: AbortSignal): Promise<BrowserRequestResult> {
    const reject = (reason: string, outcome: 'failed' | 'cancelled' = 'failed') =>
      Promise.resolve<BrowserRequestResult>({ ...identityOf(request), delivery: 'not-sent', outcome, reason })
    if (this.closed) return reject('closed')
    this.prune()
    const existing = this.entries.get(request.requestId)
    const sealed = sealBrowserInvocation(request)
    if (existing !== undefined) {
      if (!sameIdentity(existing.request, request) || sealed.fingerprint !== existing.request.fingerprint) {
        return reject('request_conflict')
      }
      return existing.result === undefined ? existing.promise : Promise.resolve(structuredClone(existing.result))
    }
    if (signal.aborted) return reject('cancelled', 'cancelled')
    if (!Number.isSafeInteger(request.deadline) || request.deadline <= Date.now()
      || request.deadline - Date.now() > this.limits.maxDurationMs) return reject('deadline')
    if (request.fingerprint !== sealed.fingerprint) return reject('invalid_fingerprint')
    if (request.mutates && request.target === undefined) return reject('target_required')
    if (!this.connections.has(request.installationId)) return reject('offline')
    if (this.entries.size >= this.limits.capacity) return reject('capacity')
    if (bytes({ type: 'execute', request: sealed }) > this.limits.maxRequestBytes) return reject('request_too_large')
    if (request.mutates && [...this.entries.values()].some(entry => this.conflicts(entry, request))) return reject('target_busy')
    const deferred = Promise.withResolvers<BrowserRequestResult>()
    const cancel = new AbortController()
    const abort = () => { cancel.abort(signal.reason) }
    const onCancel = () => { this.send(entry, { type: 'cancel', request: identityOf(entry.request) }) }
    const timer = setTimeout(() => {
      cancel.abort(new Error('browser request deadline'))
      if (entry.result === undefined) this.unknown(entry, 'deadline')
    }, request.deadline - Date.now())
    timer.unref()
    const entry: Entry = {
      request: sealed, promise: deferred.promise, resolve: deferred.resolve, cancel,
      retainUntil: request.deadline + this.limits.receiptRetentionMs,
      result: undefined, quiescent: false, released: false,
      cleanup: () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        cancel.signal.removeEventListener('abort', onCancel)
      },
    }
    this.entries.set(request.requestId, entry)
    signal.addEventListener('abort', abort, { once: true })
    cancel.signal.addEventListener('abort', onCancel, { once: true })
    this.send(entry, { type: 'execute', request: structuredClone(sealed) })
    return deferred.promise
  }

  /** Missing or mismatched identity means unknown, never proof that an action was not run. */
  status(identity: BrowserRequestIdentity): BrowserRequestStatus {
    const entry = this.find(identity)
    if (entry === undefined) return { ...identityOf(identity), delivery: 'sent', outcome: 'unknown', reason: 'receipt_unavailable' }
    return entry.result === undefined
      ? { ...identityOf(entry.request), delivery: 'sent', outcome: 'in-flight' }
      : structuredClone(entry.result)
  }

  /**
   * Release an uncertain write only after executor quiescence and an explicit owner decision.
   * The gateway must authenticate that decision; this never changes the observed outcome.
   */
  acknowledgeUnknown(identity: BrowserRequestIdentity): boolean {
    if (this.closed) return false
    if (!this.entries.has(identity.requestId)) return true
    const entry = this.find(identity)
    if (entry?.result !== undefined && entry.result.outcome !== 'unknown') return true
    if (entry?.result?.outcome !== 'unknown' || !entry.quiescent) return false
    entry.released = true
    return true
  }

  /** Settle callers and detach timers/listeners; socket shutdown belongs to the gateway. */
  dispose(): void {
    if (this.closed) return
    this.closed = true
    for (const entry of this.entries.values()) {
      if (entry.result === undefined) { entry.cancel.abort(); this.unknown(entry, 'closed') }
      entry.cleanup()
    }
    this.connections.clear()
    this.entries.clear()
  }

  private find(identity: BrowserRequestIdentity): Entry | undefined {
    const entry = this.entries.get(identity.requestId)
    return entry !== undefined && sameIdentity(entry.request, identity) ? entry : undefined
  }

  private conflicts(entry: Entry, request: BrowserInvocation): boolean {
    return entry.request.mutates && !entry.released
      && (entry.result === undefined || entry.result.outcome === 'unknown')
      && entry.request.installationId === request.installationId
      && entry.request.target?.tabId === request.target?.tabId
  }

  private disconnect(installationId: string, connection: Connection | undefined): void {
    if (connection === undefined || this.connections.get(installationId) !== connection) return
    this.connections.delete(installationId)
    for (const entry of this.entries.values()) {
      if (entry.request.installationId === installationId && entry.result === undefined) this.unknown(entry, 'disconnected')
    }
  }

  private send(entry: Entry, frame: BrowserDispatchFrame): void {
    const connection = this.connections.get(entry.request.installationId)
    if (connection === undefined) { this.unknown(entry, 'disconnected'); return }
    try { connection.send(frame) } catch { this.unknown(entry, 'transport_error') }
  }

  private unknown(entry: Entry, reason: string): void {
    this.settle(entry, { ...identityOf(entry.request), delivery: 'sent', outcome: 'unknown', reason })
  }

  private settle(entry: Entry, result: BrowserRequestResult, quiescent = false): void {
    // A callback may publish its receipt and then throw. Never replace that
    // committed observation with a transport error from the same stack.
    if (entry.result !== undefined && entry.result.outcome !== 'unknown') return
    entry.cleanup()
    entry.result = result
    entry.quiescent = quiescent
    entry.resolve(structuredClone(result))
  }

  private prune(): void {
    for (const [key, entry] of this.entries) {
      if (entry.result !== undefined && entry.retainUntil <= Date.now()
        && (entry.result.outcome !== 'unknown' || !entry.request.mutates || entry.released)) this.entries.delete(key)
    }
  }
}

function identityOf(request: BrowserRequestIdentity): BrowserRequestIdentity {
  return { protocolVersion: request.protocolVersion, grantEpoch: request.grantEpoch,
    requestId: request.requestId, sessionId: request.sessionId, installationId: request.installationId,
    deadline: request.deadline, fingerprint: request.fingerprint }
}

function sameIdentity(left: BrowserRequestIdentity, right: BrowserRequestIdentity): boolean {
  return JSON.stringify(identityOf(left)) === JSON.stringify(identityOf(right))
}

function bytes(value: object): number { return Buffer.byteLength(JSON.stringify(value), 'utf8') }

function canonical(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => {
    const entry = value[key]
    if (entry === undefined) throw new TypeError('browser invocation contains an undefined value')
    return `${JSON.stringify(key)}:${canonical(entry)}`
  }).join(',')}}`
}

function isRecord(value: unknown): boolean { return typeof value === 'object' && value !== null && !Array.isArray(value) }
