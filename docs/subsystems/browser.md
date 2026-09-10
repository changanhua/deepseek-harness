# Browser Assistant

English | [中文](browser.zh.md)

The [browser package group](../../packages/browser/README.md) owns `ctx.browser`, explicit page references, and the authenticated extension provider. These definitions describe caller and executor identity; they do not grant a model permission to act.

## Identity and operations

An installation is one independently authorized Chrome extension. An operation names both its calling Session and its target installation. A page reference carries Chrome tab, frame, and document identity plus the observed URL; an element reference also names its snapshot. Switching the foreground tab does not change these targets. Replaced nodes, changed action attributes, and stale document references are rejected rather than resolved again by selector.

```ts type-equiv
/** Page identity is independent of whichever tab is currently in the foreground. */
interface BrowserPage {
  readonly tabId: number
  readonly frameId: number
  readonly documentId: string
  readonly url: string
}
```

```ts type-equiv
/** A snapshot-local element reference, never a selector to be rematched later. */
interface BrowserElementReference {
  readonly page: BrowserPage
  readonly snapshotId: string
  readonly elementId: string
}
```

```ts type-equiv
/** Current consumers: interactive tools, explicit page intake, and finite monitor checks. */
type BrowserAction =
  | { readonly kind: 'tabs' }
  | { readonly kind: 'snapshot'; readonly tabId: number; readonly frameId: number; readonly documentId?: string; readonly query?: string; readonly offset?: number; readonly limit?: number; readonly textLimit?: number; readonly tree?: boolean; readonly treeCursor?: string; readonly treeLimit?: number; readonly includeOptions?: boolean }
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
```

A `tree` snapshot returns one stable cached hierarchy in pages. Its Document, element, text, and open Shadow Root nodes retain indexes and parent indexes across `treeCursor` reads; it does not rematch nodes. Iframe elements mark their source boundary, while frame documents require their own read. Hidden, editable, script, and style text is omitted, although hidden structure remains available with a hidden marker.

```ts type-equiv
/** One separately authorized installation; no credential material is exposed. */
interface BrowserInstance {
  readonly installationId: string
  readonly extensionId: string
  readonly online: boolean
  readonly grantEpoch: number
  readonly origins: readonly string[]
  readonly scopes: readonly string[]
}
```

```ts type-equiv
/** One caller-owned operation; providers enforce the instance's current grant. */
interface BrowserOperation {
  readonly sessionId: SessionId
  readonly installationId: string
  readonly action: BrowserAction
}
```

```ts type-equiv
/** A carrier acknowledgement is not itself an observed business effect. */
interface BrowserActionResult {
  readonly requestId: string
  readonly sessionId: SessionId
  readonly installationId: string
  readonly outcome: 'observed' | 'failed' | 'cancelled' | 'unknown'
  readonly delivery: 'not-sent' | 'sent'
  readonly reason?: string
  readonly value?: JsonValue
}
```

## Prepared actions

Model tools prepare one immutable action before requesting approval. The provider owns an expiring ticket binding the Session, installation, grant epoch and complete action; a commit cannot replace its parameters. The extension keeps target and form values only in bounded document memory and compares them synchronously before executing. Changed or evicted snapshots and changed form state invalidate the preparation.

The tool policy uses both the action kind and browser-observed effect. Only native details disclosure, scrolling and waiting run without action approval. Other clicks, navigation, filling (which may autosave) and submission use the existing Approval service. Upload paths must be absolute and appear verbatim in the current user message; the model tool checks that origin before it executes the action and adds no separate approval dialog. The displayed value preview comes from the proposed Host input; existing page field values are not returned by preparation.

A visible local change is reported as observed, without claiming business success. Unverified clicks and submissions remain unknown; invalid forms are rejected. Filling reports whether the requested local value was set without returning a website-rewritten value. Callers inspect the resulting page before concluding that their intended outcome occurred.

```ts type-equiv
/** Provider-owned, one-action approval binding; callers cannot replace its parameters. */
type BrowserPreparedTicket = Branded<'BrowserPreparedTicket'>
```

```ts type-equiv
/** Bounded page facts for the approval UI, not instructions supplied by the page. */
interface BrowserActionDescription {
  readonly kind: BrowserAction['kind']
  readonly page: BrowserPage
  readonly title: string
  readonly target?: { readonly tag: string; readonly label: string; readonly type: string }
  readonly effect: 'local-disclosure' | 'navigation' | 'form-submit' | 'input-change' | 'unknown' | 'scroll' | 'wait'
  readonly destination?: string
  readonly valuePreview?: string
}
```

```ts type-equiv
/** Preparation is transient. Expiry, authority changes and page changes require a new approval. */
interface BrowserPreparedAction {
  readonly ticket: BrowserPreparedTicket
  readonly expiresAt: number
  readonly description: BrowserActionDescription
}
```

## Authority and recovery

The provider derives read or write scope from the action and checks the current installation grant before dispatch. The extension checks its current grant and Chrome site permissions before executing. Navigation verifies the resulting document; redirects beyond the authorized sites do not return the unauthorized destination's URL.

Each invocation binds its protocol version, grant epoch, request id, Session, installation, deadline, target and action to a digest. An exact duplicate shares its existing receipt. Reconnection asks for status and does not resend an action. The extension persists minimal intent before a page effect; the journal retains bounded result values without storing the original invocation payload. A restarted worker retains unresolved writes as locks on the whole tab, across Sessions and grant epochs. A missing initialized journal is an unavailable store, not an empty request history.

Cancellation requests a stop. A lost receipt or deadline produces `unknown` until executor evidence resolves it. An unresolved write remains locked until an observed terminal result or explicit acknowledgement after executor quiescence. Neither a timeout nor loss of site permission proves that an old document stopped executing.

The Puppeteer executor performs every implemented action. The DOM compatibility executor supports only `click`, `fill`, `submit`, `navigate`, `scroll`, and `wait`, and rejects newer action kinds. Screenshots require the main frame and are limited to 400,000 base64 characters. The [gateway README](../../packages/browser/browser-extension/README.md) owns transport bounds and configuration. The [Session Controller](../../packages/api/session-controller/README.md) owns conversation history; this service does not create a second message store.

## Finite observation and monitoring

`observe()` is a finite read for `tabs` or `snapshot`, bound to the caller Session, installation, and fixed observation grant epoch. Providers require both read and observation scope, and observer snapshots do not populate the interactive element-reference cache. An unavailable observation is a failure outcome, never evidence that a monitored page was unchanged.

[`dsh-browser-monitor`](../../packages/browser/browser-monitor/README.md) persists an explicit plan and accepted sample summary: a SHA-256 digest, match result, time, and page identity, rather than captured page text. A null interval schedules one check; periodic plans either coalesce overdue work to `latest` or skip it, and pause/resume changes the persisted plan before scheduling fresh work. Each due slot becomes the typed Queue work kind `browser.monitor.check@1`; the Queue input contains only monitor id, revision, and slot.

The monitor reserves outbox capacity for every notification one check may produce, then requires explicit acknowledgement for each delivered id. It supports up to 64 monitors by default, polls due work every 1,000 ms, and bounds one read attempt to 30 seconds. Gateway methods `monitor.list`, `monitor.create`, `monitor.pause`, `monitor.resume`, and `monitor.acknowledge` serve the native extension UI. Its worker refreshes the Host outbox after connecting and every 15 seconds, displaying a badge count and stable notification cards. Only an unconfirmed creation intent is persisted in Chrome. A settlement stored with each accepted result keeps Queue recovery linked until its terminal receipt is confirmed, so restart recovery does not read the browser again for an already accepted result.

## Retained browser activity

[`dsh-browser-activity`](../../packages/browser/browser-activity/README.md) owns raw uploaded facts, separately from monitor comparisons and curated knowledge. `ConfigureActivity` carries a stable request id, viewed revision, and explicit collection limits. `ActivityState` exposes the current policy and sequence, or an authorization-change state requiring explicit configuration. A pause is a persisted disabled policy with a new revision.

`ActivityBatch` binds up to 32 events to that policy revision and a consecutive sequence; `ActivityReceipt` confirms its accepted count. `ActivityRecord` retains bounded facts with server-owned Session and grant provenance and one replay receipt. `ActivityQuery` filters by text, Session, and time; only the current grant epoch and authorized sites are readable. Retention continues without an open surface and while paused. The extension collector and knowledge destination remain separate consumers of these contracts.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbrowser--browser-abstract-seam"></a>

### `ctx.browser` — `Browser` (abstract seam)

Shared browser capability; an installation connection never implies a shared action target.

```ts cordis-catalog
/**
 * Return current authorized installations without exposing their credentials.
 * @returns Detached installation metadata and online state.
 */
abstract instances(): Promise<readonly BrowserInstance[]>

/**
 * Recheck a captured installation's authority synchronously; offline alone does not revoke access.
 * @param instance - Previously returned installation metadata.
 * @returns Whether its identity, epoch, scopes and sites still match the current authorization.
 */
abstract isAuthorized(instance: BrowserInstance): boolean

/**
 * Read once for a background monitor under its fixed observation authorization.
 * @param operation - Session, installation, grant epoch and read-only action.
 * @param signal - Stops this finite observation without scheduling further checks.
 * @returns The observation outcome; an unavailable browser is never an unchanged result.
 */
abstract observe(operation: BrowserObservation, signal: AbortSignal): Promise<BrowserActionResult>

/**
 * Execute against the explicit instance/page; lost results remain unknown and are not replayed.
 * @param operation - Caller Session, installation and domain action.
 * @param signal - Requests cancellation without promising to undo an effect.
 * @returns Observed outcome or an unresolved result with its request identity.
 */
abstract execute(operation: BrowserOperation, signal: AbortSignal): Promise<BrowserActionResult>

/**
 * Read facts for one page action and bind its immutable parameters before asking for approval.
 * @param operation - Caller Session, installation and action with an explicit page target.
 * @param signal - Cancels preparation before a ticket can be used.
 * @returns A bounded, expiring preparation; rejects when the target cannot be prepared.
 */
abstract prepare(operation: BrowserOperation, signal: AbortSignal): Promise<BrowserPreparedAction>

/**
 * Submit exactly the prepared action after rechecking authority and page facts.
 * @param ticket - Opaque preparation owned by this provider instance.
 * @param signal - Requests cancellation without undoing an already issued action.
 * @returns The retained outcome on repeated calls, without dispatching a second action.
 */
abstract executePrepared(ticket: BrowserPreparedTicket, signal: AbortSignal): Promise<BrowserActionResult>
```

Source: [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)

<a id="ctxbrowseractivity--browseractivity"></a>

### `ctx.browserActivity` — `BrowserActivity`

Owns bounded raw browser activity independently of the Chrome buffer and curated knowledge.

```ts cordis-catalog
/**
 * Inspect lifecycle readiness without exposing retained activity.
 * @returns The active dependency lifecycle phase.
 */
status(): { phase: 'opening' | 'ready' | 'unavailable' | 'closed' }

/**
 * Persist an explicit collection policy or pause under a viewed revision.
 * @param installationId - Authenticated installation owning the policy.
 * @param input - Stable request identity, viewed revision, and collection settings.
 * @param authorize - Dynamic transport authority check repeated at commit.
 * @returns The durable policy projection, including an identical prior receipt.
 */
configure(installationId: string, input: ConfigureActivity, authorize?: () => void): Promise<ActivityState>

/**
 * Resolve policy and sequence before the extension starts collection or recovery.
 * @param installationId - Authenticated installation owning the policy.
 * @param authorize - Dynamic transport authority check.
 * @returns The current policy, or an explicit authorization-change state.
 */
state(installationId: string, authorize?: () => void): Promise<ActivityState>

/**
 * Accept a bounded consecutive activity batch under current observation authority.
 * @param installationId - Authenticated installation supplying the facts.
 * @param input - Policy-bound batch with a stable retry identity.
 * @param authorize - Dynamic transport authority check repeated at commit.
 * @returns The durable last-batch receipt.
 */
append(installationId: string, input: ActivityBatch, authorize?: () => void): Promise<ActivityReceipt>

/**
 * Search retained raw facts within the current observation authority.
 * @param installationId - Authenticated installation owning the facts.
 * @param input - Text, Session, time, and result-count bounds.
 * @param authorize - Dynamic transport authority check.
 * @returns Detached facts bounded by count and encoded bytes.
 */
query(installationId: string, input: ActivityQuery, authorize?: () => void): Promise<ActivityRecord['events']>
```

Source: [`packages/browser/browser-activity/src/index.ts`](../../packages/browser/browser-activity/src/index.ts)

<a id="ctxbrowsermonitor--browsermonitor"></a>

### `ctx.browserMonitor` — `BrowserMonitor`

Owns persistent plans, accepted comparisons and notification ids, independently of any visible UI.

```ts cordis-catalog
/**
 * Current lifecycle state; unavailable never means that the page was unchanged.
 * @returns The active dependency lifecycle phase.
 */
status(): { readonly phase: 'opening' | 'ready' | 'unavailable' | 'closed' }

/**
 * Persist an explicit plan under the installation's current observation grant.
 * @param input - Immutable plan intent with its stable creation request id.
 * @param authorize - Transport permission check repeated at the commit boundary.
 * @returns The detached durable record, including an identical prior creation.
 */
create(input: CreateMonitor, authorize?: () => void): Promise<MonitorRecord>

/**
 * Return detached definitions and results for one installation; transport callers enforce read access.
 * @param installationId - The authorized browser installation.
 * @returns Its persisted plans, accepted comparisons and pending notifications.
 */
list(installationId: string): MonitorRecord[]

/**
 * Stop a plan and invalidate its queued and running checks.
 * @param id - The persisted monitor id.
 * @param installationId - The installation owning the plan.
 * @param revision - The viewed revision, when supplied by an interactive caller.
 * @param authorize - Transport permission check repeated before persistence.
 * @returns The paused record after any known Queue cancellation request.
 */
pause(id: string, installationId: string, revision?: string, authorize?: () => void): Promise<MonitorRecord>

/**
 * Bind an explicit resumption to current authority and start a fresh schedule.
 * @param id - The persisted monitor id.
 * @param installationId - The installation owning the plan.
 * @param revision - The viewed revision; stale controls cannot restart a new schedule.
 * @param authorize - Transport permission check repeated before persistence.
 * @returns The resumed record bound to the current observation grant.
 */
resume(id: string, installationId: string, revision?: string, authorize?: () => void): Promise<MonitorRecord>

/**
 * Acknowledge one notification after the receiving surface accepts responsibility for its presentation.
 * @param id - The persisted monitor id.
 * @param installationId - The installation owning the notification.
 * @param noticeId - The stable notification id to remove from the outbox.
 * @param authorize - Transport permission check repeated at the removal boundary.
 */
acknowledge(id: string, installationId: string, noticeId: string, authorize?: () => void): Promise<void>
```

Source: [`packages/browser/browser-monitor/src/index.ts`](../../packages/browser/browser-monitor/src/index.ts)

<a id="browser-events"></a>

### `browser/*` events

<a id="browserentry-click--emit"></a>

#### `browser/entry-click` — emit

A user clicked one entry mounted in an authorized external webpage.

```ts cordis-catalog
/**
 * A user clicked one entry mounted in an authorized external webpage.
 * @param event - Verified mount, Session, page, title, and link identity for the click.
 * @mode emit
 */
'browser/entry-click'(event: BrowserEntryEvent): void
```

Source: [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)
<!-- END GENERATED cordis-surface -->
