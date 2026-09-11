import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session/types'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Page identity is independent of whichever tab is currently in the foreground. */
export interface BrowserPage {
  readonly tabId: number
  readonly frameId: number
  readonly documentId: string
  readonly url: string
}

/** A snapshot-local element reference, never a selector to be rematched later. */
export interface BrowserElementReference {
  readonly page: BrowserPage
  readonly snapshotId: string
  readonly elementId: string
}

/** Current consumers: interactive tools, explicit page intake, and finite monitor checks. */
export type BrowserAction =
  | { readonly kind: 'tabs' }
  | { readonly kind: 'snapshot'; readonly tabId: number; readonly frameId: number; readonly documentId?: string; readonly query?: string; readonly offset?: number; readonly limit?: number; readonly textLimit?: number; readonly tree?: boolean; readonly treeCursor?: string; readonly treeLimit?: number; readonly includeOptions?: boolean; readonly structure?: boolean }
  | { readonly kind: 'entry_mount'; readonly page: BrowserPage; readonly mountId: string; readonly selector: string; readonly label: string; readonly titleSelector?: string; readonly linkSelector?: string; readonly collected?: readonly string[] }
  | { readonly kind: 'entry_unmount'; readonly page: BrowserPage; readonly mountId: string }
  | { readonly kind: 'navigate'; readonly page: BrowserPage; readonly url: string }
  | { readonly kind: 'click'; readonly element: BrowserElementReference; readonly intent: string }
  | { readonly kind: 'fill'; readonly element: BrowserElementReference; readonly value: string; readonly intent: string }
  | { readonly kind: 'submit'; readonly element: BrowserElementReference; readonly intent: string }
  | { readonly kind: 'double_click' | 'right_click' | 'hover'; readonly element: BrowserElementReference; readonly intent: string }
  | { readonly kind: 'press'; readonly element: BrowserElementReference; readonly key: string; readonly intent: string }
  | { readonly kind: 'select'; readonly element: BrowserElementReference; readonly values: readonly string[]; readonly intent: string }
  | { readonly kind: 'check'; readonly element: BrowserElementReference; readonly checked: boolean; readonly intent: string }
  | { readonly kind: 'drag'; readonly element: BrowserElementReference; readonly target: BrowserElementReference; readonly intent: string }
  | { readonly kind: 'upload'; readonly element: BrowserElementReference; readonly files: readonly string[]; readonly intent: string }
  | { readonly kind: 'back' | 'forward' | 'reload' | 'tab_close' | 'tab_focus' | 'screenshot'; readonly page: BrowserPage }
  | { readonly kind: 'tab_open'; readonly page: BrowserPage; readonly url: string }
  | { readonly kind: 'scroll'; readonly page: BrowserPage; readonly x: number; readonly y: number }
  | { readonly kind: 'wait'; readonly page: BrowserPage; readonly milliseconds: number }

/** One separately authorized installation; no credential material is exposed. */
export interface BrowserInstance {
  readonly installationId: string
  readonly extensionId: string
  readonly online: boolean
  readonly grantEpoch: number
  readonly origins: readonly string[]
  readonly scopes: readonly string[]
}

/** One caller-owned operation; providers enforce the instance's current grant. */
export interface BrowserOperation {
  readonly sessionId: SessionId
  readonly installationId: string
  readonly action: BrowserAction
}

/** A finite background read, bound to the separately approved observation grant. */
export interface BrowserObservation {
  readonly sessionId: SessionId
  readonly installationId: string
  readonly grantEpoch: number
  readonly action: Extract<BrowserAction, { readonly kind: 'tabs' | 'snapshot' }>
}

/** Provider-owned, one-action approval binding; callers cannot replace its parameters. */
export type BrowserPreparedTicket = Branded<'BrowserPreparedTicket'>
export const BrowserPreparedTicket = (value: string): BrowserPreparedTicket => value as BrowserPreparedTicket

/** Bounded page facts for the approval UI, not instructions supplied by the page. */
export interface BrowserActionDescription {
  readonly kind: BrowserAction['kind']
  readonly page: BrowserPage
  readonly title: string
  readonly target?: { readonly tag: string; readonly label: string; readonly type: string }
  readonly effect: 'local-disclosure' | 'navigation' | 'form-submit' | 'input-change' | 'unknown' | 'scroll' | 'wait'
  readonly destination?: string
  readonly valuePreview?: string
}

/** Preparation is transient. Expiry, authority changes and page changes require a new approval. */
export interface BrowserPreparedAction {
  readonly ticket: BrowserPreparedTicket
  readonly expiresAt: number
  readonly description: BrowserActionDescription
}

/** A carrier acknowledgement is not itself an observed business effect. */
export interface BrowserActionResult {
  readonly requestId: string
  readonly sessionId: SessionId
  readonly installationId: string
  readonly outcome: 'observed' | 'failed' | 'cancelled' | 'unknown'
  readonly delivery: 'not-sent' | 'sent'
  readonly reason?: string
  readonly value?: JsonValue
}

/** One click on a page entry mounted by an `entry_mount` action, gated by the Host mount table. */
export interface BrowserEntryEvent {
  readonly installationId: string
  readonly sessionId: SessionId
  readonly mountId: string
  readonly entry: { readonly title: string; readonly link: string }
  readonly url: string
  readonly at: number
}
