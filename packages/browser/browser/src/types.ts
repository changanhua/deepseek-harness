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

/** One bounded plain-data block rendered by an extension-owned page region. */
export type BrowserRegionBlock =
  | { readonly type: 'heading'; readonly text: string }
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'item'; readonly title: string; readonly meta?: string | undefined; readonly link?: string | undefined }
  | { readonly type: 'keyvalue'; readonly label: string; readonly value: string }
  | { readonly type: 'link'; readonly text: string; readonly href: string }

/**
 * Model-facing, selector-free description of a temporary result panel.
 * The Host compiles this into the extension wire blocks after resolving a
 * short-lived regionRef.  It is intentionally data, never HTML.
 */
export interface BrowserRegionPresentation {
  readonly title?: string
  readonly summary?: string
  readonly items?: readonly { readonly title: string; readonly meta?: string; readonly link?: string }[]
  readonly facts?: readonly { readonly label: string; readonly value: string }[]
  readonly links?: readonly { readonly text: string; readonly href: string }[]
  readonly footer?: string
}

/** Host-authored bounded query used only to bind fresh snapshot evidence to a live DSH region mount. */
export interface BrowserPresentationQuery {
  readonly mountId: string
  readonly text: string
}

/** Current consumers: interactive tools, explicit page intake, and finite monitor checks. */
export type BrowserAction =
  | { readonly kind: 'tabs' }
  | { readonly kind: 'snapshot'; readonly tabId: number; readonly frameId: number; readonly documentId?: string; readonly query?: string; readonly offset?: number; readonly limit?: number; readonly textLimit?: number; readonly tree?: boolean; readonly treeCursor?: string; readonly treeLimit?: number; readonly includeOptions?: boolean; readonly structure?: boolean; readonly presentationQueries?: readonly BrowserPresentationQuery[] }
  | { readonly kind: 'page_map'; readonly page: BrowserPage }
  | { readonly kind: 'entry_inspect'; readonly page: BrowserPage; readonly regionSelector: string; readonly selector: string; readonly titleSelector?: string; readonly linkSelector?: string; readonly sampleLimit?: number }
  | { readonly kind: 'entry_mount'; readonly page: BrowserPage; readonly mountId: string; readonly regionSelector?: string; readonly selector: string; readonly label: string; readonly titleSelector?: string; readonly linkSelector?: string; readonly collected?: readonly string[] }
  | { readonly kind: 'entry_unmount'; readonly page: BrowserPage; readonly mountId: string; readonly forgetCollected?: boolean }
  | { readonly kind: 'region_render'; readonly page: BrowserPage; readonly mountId: string; readonly regionRef: BrowserRegionRef; readonly presentation: BrowserRegionPresentation; readonly placement?: 'prepend' | 'append'; readonly mode?: 'append' | 'replace' }
  | { readonly kind: 'region_clear'; readonly page: BrowserPage; readonly mountId: string }
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

/** Executor-declared protocol surface captured when an installation connects. */
export interface BrowserExecutorCapabilities {
  readonly protocolVersion: 1
  readonly actionKinds: readonly BrowserAction['kind'][]
  /** The executor can reconcile sent requests without replaying their action. */
  readonly requestRecovery: true
  /** The executor can answer a durable journal status lookup after Host restart. */
  readonly restartStatusLookup?: true
}

/** Public, action-free key retained with a sent attempt for restart recovery. */
export interface BrowserRecoveryLocator {
  readonly kind: 'extension-journal-v1'
  readonly protocolVersion: 1
  readonly transportRequestId: string
  readonly installationId: string
  readonly grantEpoch: number
}

/** One separately authorized installation; no credential material is exposed. */
export interface BrowserInstance {
  readonly installationId: string
  readonly extensionId: string
  readonly online: boolean
  readonly grantEpoch: number
  readonly origins: readonly string[]
  readonly scopes: readonly string[]
  /** Detached handshake snapshot; absent only while the authorized installation is offline. */
  readonly capabilities?: BrowserExecutorCapabilities
}

/** One caller-owned operation; providers enforce the instance's current grant. */
export interface BrowserOperation {
  readonly sessionId: SessionId
  readonly installationId: string
  /** Minted by the caller before dispatch; repeated identities are journaled idempotently. */
  readonly requestId: string
  readonly action: BrowserAction
}

/** One provider-owned dispatch boundary for a logical Browser operation. */
export type BrowserDispatchPhase = 'execute' | 'prepare' | 'prepared-commit' | 'observe'
export interface BrowserOperationContext {
  readonly operation: BrowserOperation
  readonly phase: BrowserDispatchPhase
  readonly logicalMutates: boolean
}
export interface BrowserDispatchContext {
  /** Caller identity and action; prepared probes retain the eventual commit identity here. */
  readonly operation: BrowserOperation
  /** Exact transport request entering the provider boundary; a prepare probe uses a separate id. */
  readonly transportRequestId: string
  readonly phase: BrowserDispatchPhase
  readonly logicalMutates: boolean
  readonly transportMutates: boolean
  readonly grantEpoch: number
}
export type BrowserDispatchDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deny'; readonly result: BrowserActionResult }
export type BrowserOperationSettlement =
  | { readonly kind: 'prepared' }
  | { readonly kind: 'result'; readonly result: BrowserActionResult }
  | { readonly kind: 'error'; readonly delivery: 'not-sent' | 'sent'; readonly reason: string }

/** A finite background read, bound to the separately approved observation grant. */
export interface BrowserObservation {
  readonly sessionId: SessionId
  readonly installationId: string
  readonly grantEpoch: number
  readonly action: Extract<BrowserAction, { readonly kind: 'tabs' | 'snapshot' | 'page_map' }>
}

/** Provider-owned, one-action approval binding; callers cannot replace its parameters. */
export type BrowserPreparedTicket = Branded<'BrowserPreparedTicket'>
export const BrowserPreparedTicket = (value: string): BrowserPreparedTicket => value as BrowserPreparedTicket
/** Host-minted, short-lived reference to one exact page-map region. */
export type BrowserRegionRef = Branded<'BrowserRegionRef'>
export const BrowserRegionRef = (value: string): BrowserRegionRef => value as BrowserRegionRef

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

/** Caller-scoped lookup of one retained request; querying never replays its action. */
export interface BrowserRequestStatusQuery {
  readonly requestId: string
  readonly sessionId: SessionId
  readonly installationId: string
  /** Required when the Host no longer has the in-memory transport request. */
  readonly recoveryLocator?: BrowserRecoveryLocator
}

/** Current retained state of one Browser request. */
export type BrowserRequestStatus = Omit<BrowserActionResult, 'outcome'> & {
  readonly outcome: BrowserActionResult['outcome'] | 'in-flight'
  readonly quiescent?: boolean
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
