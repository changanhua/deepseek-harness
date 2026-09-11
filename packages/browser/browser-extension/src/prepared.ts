import { randomUUID } from 'node:crypto'
import type { BrowserAction, BrowserActionDescription, BrowserActionResult, BrowserOperation, BrowserPreparedAction, BrowserPreparedTicket } from '@changanhua/dsh-browser'
import { BrowserPreparedTicket as ticketId } from '@changanhua/dsh-browser/types'
import { browserPreparationSchema } from './wire.ts'

interface PreparedDispatch {
  readonly action: BrowserAction
  readonly operation: BrowserOperation
  readonly payload: { readonly kind: 'prepare'; readonly action: BrowserAction; readonly expiresAt: number } | { readonly kind: 'commit'; readonly action: BrowserAction; readonly preparationId: string }
  readonly mutates: boolean
  readonly deadline: number
  readonly target: BrowserActionDescription['page']
  readonly grantEpoch?: number
  readonly signal: AbortSignal
}

interface Entry {
  readonly ticket: BrowserPreparedTicket
  readonly operation: BrowserOperation
  readonly preparationId: string
  readonly expiresAt: number
  readonly description: BrowserActionDescription
  readonly grantEpoch: number | undefined
  readonly signal: AbortSignal
  commit: Promise<BrowserActionResult> | undefined
  result: BrowserActionResult | undefined
}

/** Host-owned, bounded tickets that separate page observation from one irreversible commit. */
export class BrowserPreparations {
  private readonly entries = new Map<BrowserPreparedTicket, Entry>()
  private preparing = 0
  private closed = false

  constructor(private readonly options: {
    readonly capacity: number
    readonly requestTTL: number
    readonly requestDeadlineMs?: number
    readonly dispatch: (request: PreparedDispatch) => Promise<BrowserActionResult>
    /** Synchronous epoch and scope fence immediately before each dispatch. */
    readonly permit: (operation: BrowserOperation, grantEpoch: number | undefined) => boolean
    readonly verify?: (operation: BrowserOperation, grantEpoch: number | undefined) => Promise<boolean>
  }) {}

  async prepare(operation: BrowserOperation, signal: AbortSignal, grantEpoch?: number): Promise<BrowserPreparedAction> {
    this.checkLifetime(signal)
    const fixed = structuredClone(operation)
    const target = targetOf(fixed.action)
    if (target === undefined) throw failure('prepare_unavailable')
    this.prune()
    if (this.entries.size + this.preparing >= this.options.capacity) throw failure('capacity')
    if (!this.options.permit(fixed, grantEpoch)) throw failure('unauthorized')
    this.preparing += 1
    const now = Date.now()
    const expiresAt = now + this.options.requestTTL
    const deadline = now + (this.options.requestDeadlineMs ?? this.options.requestTTL)
    try {
      const result = await this.options.dispatch({ operation: fixed, action: fixed.action,
        payload: { kind: 'prepare', action: fixed.action, expiresAt }, mutates: false, deadline, target, signal,
        ...(grantEpoch === undefined ? {} : { grantEpoch }) })
      this.checkLifetime(signal)
      if (result.outcome !== 'observed') throw failure(result.reason ?? result.outcome)
      const observed = browserPreparationSchema.safeParse(result.value)
      if (!observed.success || !samePage(observed.data.description.page, target) || observed.data.description.kind !== fixed.action.kind) throw failure('invalid_preparation')
      if (observed.data.expiresAt > expiresAt || observed.data.expiresAt <= Date.now()) throw failure('invalid_preparation')
      if (!this.options.permit(fixed, grantEpoch) || !await (this.options.verify?.(fixed, grantEpoch) ?? Promise.resolve(true))) throw failure('unauthorized')
      this.checkLifetime(signal)
      if (!this.options.permit(fixed, grantEpoch)) throw failure('unauthorized')
      const ticket = ticketId(randomUUID())
      const entry: Entry = { ticket, operation: fixed, preparationId: observed.data.preparationId,
        expiresAt: observed.data.expiresAt, description: descriptionOf(observed.data.description),
        grantEpoch, signal, commit: undefined, result: undefined }
      this.checkLifetime(signal)
      this.entries.set(ticket, entry)
      return { ticket, expiresAt: entry.expiresAt, description: structuredClone(entry.description) }
    } finally { this.preparing -= 1 }
  }

  execute(ticket: BrowserPreparedTicket, signal: AbortSignal): Promise<BrowserActionResult> {
    const entry = this.entries.get(ticket)
    if (entry === undefined) return Promise.reject(failure('ticket_unavailable'))
    if (entry.result !== undefined) return Promise.resolve(structuredClone(entry.result))
    if (entry.commit !== undefined) return entry.commit.then(value => structuredClone(value))
    const terminal = (outcome: BrowserActionResult['outcome'], reason: string): Promise<BrowserActionResult> => {
      entry.result = resultFor(entry, outcome, reason)
      return Promise.resolve(structuredClone(entry.result))
    }
    if (signal.aborted || entry.signal.aborted) return terminal('cancelled', 'cancelled')
    if (this.closed) return terminal('failed', 'closed')
    if (entry.expiresAt <= Date.now()) {
      entry.result = resultFor(entry, 'failed', 'expired')
      return Promise.resolve(structuredClone(entry.result))
    }
    if (!this.options.permit(entry.operation, entry.grantEpoch)) return terminal('failed', 'unauthorized')
    const lifetime = AbortSignal.any([entry.signal, signal])
    const deadline = Math.min(entry.expiresAt, Date.now() + (this.options.requestDeadlineMs ?? this.options.requestTTL))
    const work = Promise.resolve().then(() => this.options.dispatch({ operation: entry.operation, action: entry.operation.action,
      payload: { kind: 'commit', action: entry.operation.action, preparationId: entry.preparationId },
      mutates: mutates(entry.operation.action), deadline, target: entry.description.page, signal: lifetime,
      ...(entry.grantEpoch === undefined ? {} : { grantEpoch: entry.grantEpoch }) }))
      .then(result => entry.result = structuredClone(result), (error: unknown) => entry.result = {
        ...resultFor(entry, 'unknown', error instanceof Error ? error.message : 'dispatch_failed'), delivery: 'sent',
      })
    entry.commit = work
    return work.then(value => structuredClone(value))
  }

  dispose(): void { this.closed = true }

  private checkLifetime(signal: AbortSignal): void {
    if (this.closed) throw failure('closed')
    if (signal.aborted) throw failure('cancelled')
  }

  private prune(): void {
    const now = Date.now()
    for (const [ticket, entry] of this.entries) {
      if (entry.expiresAt <= now && (entry.result !== undefined || entry.commit === undefined)) this.entries.delete(ticket)
    }
  }
}

function targetOf(action: BrowserAction): BrowserActionDescription['page'] | undefined {
  return 'element' in action ? action.element.page : 'page' in action ? action.page : undefined
}
function mutates(action: BrowserAction): boolean { return !['tabs', 'snapshot', 'wait', 'screenshot'].includes(action.kind) }
function samePage(left: BrowserActionDescription['page'], right: BrowserActionDescription['page']): boolean {
  return left.tabId === right.tabId && left.frameId === right.frameId && left.documentId === right.documentId && left.url === right.url
}
function descriptionOf(value: ReturnType<typeof browserPreparationSchema.parse>['description']): BrowserActionDescription {
  return { kind: value.kind, page: structuredClone(value.page), title: value.title, effect: value.effect,
    ...(value.target === undefined ? {} : { target: structuredClone(value.target) }),
    ...(value.destination === undefined ? {} : { destination: value.destination }),
    ...(value.valuePreview === undefined ? {} : { valuePreview: value.valuePreview }) }
}
function failure(code: string): Error { return Object.assign(new Error(code), { code }) }
function resultFor(entry: Entry, outcome: BrowserActionResult['outcome'], reason: string): BrowserActionResult {
  return { requestId: String(entry.ticket), sessionId: entry.operation.sessionId, installationId: entry.operation.installationId, outcome, delivery: 'not-sent', reason }
}
