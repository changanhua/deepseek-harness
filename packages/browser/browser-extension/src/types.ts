import type { JsonValue } from '@deepseek-ai/dsh-session/types'

/** Transport correlation; authorization is checked by the gateway before admission. */
export interface BrowserRequestIdentity {
  readonly protocolVersion: 1
  readonly grantEpoch: number
  readonly requestId: string
  readonly sessionId: string
  readonly installationId: string
  readonly deadline: number
  readonly fingerprint: string
}

/** One bounded invocation already validated by the browser service provider. */
export interface BrowserInvocation extends BrowserRequestIdentity {
  readonly target?: { readonly tabId: number; readonly frameId: number; readonly documentId: string }
  readonly mutates: boolean
  readonly payload: JsonValue
}

/** The result never turns lost acknowledgement into a safe-to-retry failure. */
export interface BrowserRequestResult extends BrowserRequestIdentity {
  readonly outcome: 'observed' | 'failed' | 'cancelled' | 'unknown'
  readonly delivery: 'not-sent' | 'sent'
  readonly reason?: string
  readonly value?: JsonValue
}

/** Requests and reconciliation use different wire messages. */
export type BrowserDispatchFrame =
  | { readonly type: 'execute'; readonly request: BrowserInvocation }
  | { readonly type: 'status' | 'cancel'; readonly request: BrowserRequestIdentity }

/** A response is accepted only on its current installation connection. */
export interface BrowserReceipt extends BrowserRequestIdentity {
  readonly outcome: 'observed' | 'failed' | 'cancelled' | 'unknown'
  readonly value?: JsonValue
  readonly reason?: string
  /** Executor has verified no old operation can continue; absence never releases an unknown write. */
  readonly quiescent?: boolean
}

/** A live invocation is distinct from a concluded but uncertain result. */
export type BrowserRequestStatus = BrowserRequestResult | (BrowserRequestIdentity & {
  readonly outcome: 'in-flight'
  readonly delivery: 'sent'
})

/** Bounds are supplied by the owning gateway configuration. */
export interface BrowserRequestLimits {
  readonly capacity: number
  readonly maxRequestBytes: number
  readonly maxResultBytes: number
  readonly maxDurationMs: number
  readonly receiptRetentionMs: number
}
