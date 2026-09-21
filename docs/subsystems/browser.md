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
/** One bounded plain-data block rendered by an extension-owned page region. */
type BrowserRegionBlock =
  | { readonly type: 'heading'; readonly text: string }
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'item'; readonly title: string; readonly meta?: string | undefined; readonly link?: string | undefined }
  | { readonly type: 'keyvalue'; readonly label: string; readonly value: string }
  | { readonly type: 'link'; readonly text: string; readonly href: string }
```

```ts type-equiv
/**
 * Model-facing, selector-free description of a temporary result panel.
 * The Host compiles this into the extension wire blocks after resolving a
 * short-lived regionRef.  It is intentionally data, never HTML.
 */
interface BrowserRegionPresentation {
  readonly title?: string
  readonly summary?: string
  readonly items?: readonly { readonly title: string; readonly meta?: string; readonly link?: string }[]
  readonly facts?: readonly { readonly label: string; readonly value: string }[]
  readonly links?: readonly { readonly text: string; readonly href: string }[]
  readonly footer?: string
}
```

```ts type-equiv
/** Host-authored bounded query used only to bind fresh snapshot evidence to a live DSH region mount. */
interface BrowserPresentationQuery {
  readonly mountId: string
  readonly text: string
}
```

```ts type-equiv
/** Current consumers: interactive tools, explicit page intake, and finite monitor checks. */
type BrowserAction =
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
```

`page_map` returns at most 64 bounded regions for the exact document, but replaces each private selector with a short-lived opaque `regionRef`. Call it before `region_render`: a render accepts that reference and a bounded high-level presentation, while the Host alone resolves the selector and compiles plain-data blocks. The reference binds the Session, installation, grant epoch, exact page, and map lifetime; a new map invalidates its predecessors. Public action and status results recursively remove selectors, region selectors, and compiled blocks. This selector-free rule applies to page-map presentation only: the separately bounded `entry_inspect` and `entry_mount` site-adaptation actions retain their explicit, provider-validated selectors. Append mode adds extension-owned nodes; replace mode additionally requires the referenced disposable, non-protected region and moves its original children aside until `region_clear` restores them. The page runtime binds the mount to its Session, installation, grant epoch, and page identity, and does not silently bind an old mount to a new URL. A clear is settled only by an observed `cleared:true`, an observed exact `disposition:'absent'`, or a sent `document_replaced`; `target_url_stale` leaves the resource unresolved.

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
  /** Detached handshake snapshot; absent only while the authorized installation is offline. */
  readonly capabilities?: BrowserExecutorCapabilities
}
```

```ts type-equiv
/** One caller-owned operation; providers enforce the instance's current grant. */
interface BrowserOperation {
  readonly sessionId: SessionId
  readonly installationId: string
  /** Minted by the caller before dispatch; repeated identities are journaled idempotently. */
  readonly requestId: string
  readonly action: BrowserAction
}
```

```ts type-equiv
/** Host-minted, short-lived reference to one exact page-map region. */
type BrowserRegionRef = Branded<'BrowserRegionRef'>
```

```ts type-equiv
/** Public, action-free key retained with a sent attempt for restart recovery. */
interface BrowserRecoveryLocator {
  readonly kind: 'extension-journal-v1'
  readonly protocolVersion: 1
  readonly transportRequestId: string
  readonly installationId: string
  readonly grantEpoch: number
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

```ts type-equiv
/** Caller-scoped lookup of one retained request; querying never replays its action. */
interface BrowserRequestStatusQuery {
  readonly requestId: string
  readonly sessionId: SessionId
  readonly installationId: string
  /** Required when the Host no longer has the in-memory transport request. */
  readonly recoveryLocator?: BrowserRecoveryLocator
}
```

```ts type-equiv
/** Current retained state of one Browser request. */
type BrowserRequestStatus = Omit<BrowserActionResult, 'outcome'> & {
  readonly outcome: BrowserActionResult['outcome'] | 'in-flight'
  readonly quiescent?: boolean
}
```

## Page entries and site adaptation

Entry inspection and mounting follow the [Browser entry contract](../../packages/browser/browser/README.md). Their evidence is tied to current region and field nodes, including same-document replacement, rather than an ordinary prepared-action ticket. The document runtime retains at most 128 inspection records and 128 collection records; collection keys and values together fit in 65,536 UTF-8 bytes, with at most 512 links per collection. Capacity refusal preserves an existing collection.

The manifest-declared `zhihu-feed.js` content script owns the separate reading-feed adaptation. Its site selectors are not page-model defaults or evidence of page-model generalization. Model callers use the Cordis preset's page-model Skill and the runner facade; `browser_action` does not expose entry operations.

## Prepared actions

Model tools prepare one immutable action before requesting approval. Preparation is an admission-only, read-only probe: abandoning a ticket neither consumes a task action budget nor leaves a planned attempt. The provider owns an expiring ticket binding the Session, installation, grant epoch and complete action; a commit cannot replace its parameters. The extension keeps target and form values only in bounded document memory and compares them synchronously before executing. Changed or evicted snapshots and changed form state invalidate the preparation.

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

The caller mints every request id before dispatch. Each invocation binds that id, protocol version, grant epoch, Session, installation, deadline, target and action to a digest. An exact duplicate shares its existing receipt. An online installation exposes the worker's capability handshake, so a missing declaration or unsupported action is unavailable rather than a guessed fallback. `browser/operation-intent` admits one logical action before provider-specific checks; `browser/dispatch-intent` runs immediately before the transport boundary; `browser/operation-settled` records the durable result without rewriting it. BrowserTask listeners use all three for direct calls, tool calls, prepared commits, and Dynamic Cordis calls. At dispatch they persist the planned attempt and action-free recovery locator, flush the Session, and only then allow the send. Reconnection asks for status and does not resend an action. The extension persists minimal intent before a page effect; the journal retains bounded result values without storing the original invocation payload. A restarted worker retains unresolved writes as locks on the whole tab, across Sessions and grant epochs. A missing initialized journal is an unavailable store, not an empty request history.

Cancellation requests a stop. A lost receipt or deadline produces `unknown` until executor evidence resolves it. `requestStatus()` reads the caller-scoped retained state without replaying the request or disclosing its authority fingerprint. After Host memory loss, an exact recovery locator can issue only a journal `status-query` bound to the request, Session, installation, and original epoch; a missing, mismatched, offline, timed-out, or unsupported reply remains `unknown`. An unresolved write remains locked until an observed terminal result or explicit acknowledgement after executor quiescence. Neither a timeout nor loss of site permission proves that an old document stopped executing.

`@changanhua/dsh-browser-task` is the Session-persistent authority for a natural-language field task. Its projection separates immutable page evidence and target binding, planned/prepared/dispatched/settled attempts and receipts, page-resource leases, capability snapshots, canonical Subagent/Job/Cordis identities, and acceptance checks. A checker-backed acceptance clause is distinct from an observed page action or a completed delegated run. A region presentation clause cites both the observed render and the later fresh page evidence before cleanup. Terminal completion requires every clause to cite current evidence, no blocker or unresolved write, an unexhausted budget, and every resource released or confirmed vanished. A sent unknown request never replays. A deterministic not-sent failure blocks its unchanged semantic target after the first occurrence and resumes only when fresh evidence proves that precondition changed; internal projection errors become an `internal-invariant` blocker rather than a retryable Browser error. Exhausting a task budget permits only exact cleanup and ends the task once resources are final. If the extension accepts an unknown request, it releases only its transport lock; it does not finish the Session task. A later direct user message may explicitly cancel that task only after every page resource has a receipt-backed final disposition, while the unknown attempt remains in the log. The tool consumer only continues this projection; it is not a process-local task authority.

The Puppeteer executor performs every implemented action. The DOM compatibility executor supports only `click`, `fill`, `submit`, `navigate`, `scroll`, and `wait`, and rejects newer action kinds. Screenshots require the main frame and are limited to 400,000 base64 characters. The [gateway README](../../packages/browser/browser-extension/README.md) owns transport bounds and configuration. The [Session Controller](../../packages/api/session-controller/README.md) owns conversation history; this service does not create a second message store.

## Finite observation and monitoring

`observe()` is a finite read for `tabs`, `snapshot`, or `page_map`, bound to the caller Session, installation, and fixed observation grant epoch. Providers require both read and observation scope, and observer snapshots do not populate the interactive element-reference cache. An unavailable observation is a failure outcome, never evidence that a monitored page was unchanged.

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
 * Read one caller-scoped retained request without replaying it.
 * @param query - Session, installation, and request id returned by an earlier action.
 * @returns The current outcome and quiescence when known; authority fingerprints remain private.
 */
abstract requestStatus(query: BrowserRequestStatusQuery): Promise<BrowserRequestStatus>

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

<a id="ctxbrowsertasks--browsertaskservice"></a>

### `ctx.browserTasks` — `BrowserTaskService`

Session-log authority for one current browser task; no process-local task state exists.

```ts cordis-catalog
/**
 * Read the current durable browser task for one live Agent.
 * @param agent - Exact live Agent whose Session owns the task.
 * @returns A detached task snapshot, or `undefined` when none exists.
 */
get(agent: Agent): BrowserTaskSnapshot | undefined

/**
 * Read the durable target revision and detached binding for one Session.
 * @param agent - Exact live Agent whose Session owns the target.
 * @returns The current revision and binding, or a null binding when no page is selected.
 */
readTarget(agent: Agent): BrowserSessionTargetState

/**
 * Commit an exact page selected by an authenticated user surface.
 * @param agent - Exact live Agent whose Session owns the target.
 * @param request - Expected revision, authenticated installation, and observed page.
 * @returns The committed binding at its next revision.
 */
bindTargetByUser(agent: Agent, request: { readonly expectedRevision: number readonly installationId: string readonly page: BrowserPage }): BrowserSessionTargetBinding

/**
 * Explicitly clear a Session target while advancing its stale-send fence.
 * @param agent - Exact live Agent whose Session owns the target.
 * @param expectedRevision - Compare-and-set revision observed by the user surface.
 * @returns The next revision with a null binding.
 */
clearTargetByUser(agent: Agent, expectedRevision: number): BrowserSessionTargetState

/**
 * Return the latest durable direct-user message available as a task source.
 * @param agent - Exact live Agent whose Session is inspected.
 * @returns The user-message sequence, or `undefined` before direct user input.
 */
latestUserSource(agent: Agent): number | undefined

/**
 * Create one task from a real user message after any prior task is terminal.
 * @param agent - Exact live Agent that owns the task.
 * @param request - Objective, acceptance clauses, target, source, and budgets.
 * @returns The committed revision-one task.
 */
create(agent: Agent, request: CreateBrowserTaskRequest): BrowserTaskSnapshot

/**
 * Append a bounded Browser receipt before any task mutation cites it.
 * @param agent - Exact live Agent that owns the task.
 * @param task - Current compare-and-set task revision.
 * @param receipt - Outcome bound to an existing attempt and exact authority.
 * @returns The durable receipt source reference.
 */
recordReceipt( agent: Agent, task: BrowserTaskRef, receipt: Omit<BrowserTaskReceipt, 'kind' | 'version' | 'taskId'>, ): Extract<BrowserTaskSourceRef, { kind: 'browser-task-receipt' }>

/**
 * Append one deterministic acceptance check over current evidence.
 * @param agent - Exact live Agent that owns the task.
 * @param task - Current compare-and-set task revision.
 * @param check - Checker identity, target, authority epoch, and clause results.
 * @returns The durable checker source reference.
 */
recordCheck(agent: Agent, task: BrowserTaskRef, check: Omit<import('./types.ts').BrowserTaskCheck, 'kind' | 'version' | 'taskId'>): { kind: 'browser-task-check'; sessionSeq: number }

/**
 * Record the extension capability and authorization snapshot.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param capability - Installation, grant epoch, scopes, actions, and protocol.
 * @returns The next task revision.
 */
recordCapability(agent: Agent, ref: BrowserTaskRef, capability: BrowserCapability): BrowserTaskSnapshot

/**
 * Add immutable bounded evidence from a real Session or Browser receipt fact.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param evidence - Digest, source, target, coverage, and authority epoch.
 * @returns The next task revision.
 */
recordEvidence(agent: Agent, ref: BrowserTaskRef, evidence: BrowserTaskSnapshot['evidence'][number]): BrowserTaskSnapshot

/**
 * Invalidate current evidence without deleting its durable identity.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param id - Existing evidence identity.
 * @param state - Invalidated evidence disposition.
 * @returns The next task revision.
 */
staleEvidence(agent: Agent, ref: BrowserTaskRef, id: string, state: 'stale' | 'superseded'): BrowserTaskSnapshot

/**
 * Plan one caller-identified Browser attempt before dispatch.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param attempt - Planned request, action, target, and authority identity.
 * @returns The next task revision.
 */
recordAttempt(agent: Agent, ref: BrowserTaskRef, attempt: BrowserActionAttempt): BrowserTaskSnapshot

/**
 * Advance an existing attempt through its monotonic lifecycle.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param attempt - Complete next attempt state with matching identity.
 * @returns The next task revision.
 */
advanceAttempt(agent: Agent, ref: BrowserTaskRef, attempt: BrowserActionAttempt): BrowserTaskSnapshot

/**
 * Reconcile an unknown attempt from a matching quiescent receipt.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param attempt - Settled replacement citing the recovery receipt.
 * @returns The next task revision.
 */
reconcileAttempt(agent: Agent, ref: BrowserTaskRef, attempt: BrowserActionAttempt): BrowserTaskSnapshot

/**
 * Reserve or advance one exact-page resource lease.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param resource - Complete next resource state and optional disposition.
 * @returns The next task revision.
 */
upsertResource(agent: Agent, ref: BrowserTaskRef, resource: BrowserPageResource): BrowserTaskSnapshot

/**
 * Resolve an uncertain resource from a matching Browser receipt.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param resource - Final resource disposition with its receipt source.
 * @returns The next task revision.
 */
reconcileResource(agent: Agent, ref: BrowserTaskRef, resource: BrowserPageResource): BrowserTaskSnapshot

/**
 * Link a Job, Subagent, or Cordis tool call without treating it as acceptance.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param work - Bounded delegated-work identity, status, source, and expectation.
 * @returns The next task revision.
 */
linkDelegatedWork(agent: Agent, ref: BrowserTaskRef, work: DelegatedWorkRef): BrowserTaskSnapshot

/**
 * Transfer every active function resource to one exact installation-owned Cordis run.
 * @param agent - Exact live Agent that owns the verified BrowserTask.
 * @param ref - Current compare-and-set task revision.
 * @param request - Authenticated function owner, delivery scope, and complete active resource set.
 * @returns The next task revision with transferred resources marked retained.
 */
handoffFunction(agent: Agent, ref: BrowserTaskRef, request: HandoffBrowserFunctionRequest): BrowserTaskSnapshot

/**
 * Apply checker-backed evaluations for declared acceptance clauses.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param evaluations - Clause results citing one matching check fact.
 * @returns The next verifying task revision.
 */
evaluate(agent: Agent, ref: BrowserTaskRef, evaluations: readonly AcceptanceEvaluation[]): BrowserTaskSnapshot

/**
 * Change a nonterminal task phase without clearing derived blockers.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param phase - Next nonterminal phase.
 * @param blockers - Optional complete blocker set; derived blockers cannot be removed here.
 * @returns The next task revision.
 */
transition(agent: Agent, ref: BrowserTaskRef, phase: Exclude<BrowserTaskSnapshot['phase'], 'terminal'>, blockers?: readonly BrowserTaskBlocker[]): BrowserTaskSnapshot

/**
 * Rebind a target only after an explicit target-loss edge.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param next - New exact installation and page identity.
 * @returns The next task revision with prior evidence stale.
 */
rebind(agent: Agent, ref: BrowserTaskRef, next: BrowserTargetBinding): BrowserTaskSnapshot

/**
 * Acknowledge an explicit rebind and clear only its target-loss blocker.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @returns The next task revision.
 */
acknowledgeTargetLoss(agent: Agent, ref: BrowserTaskRef): BrowserTaskSnapshot

/**
 * Resume after human interaction only with fresh authority and evidence.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @returns The next task revision without the human-interaction blocker.
 */
acknowledgeHumanInteraction(agent: Agent, ref: BrowserTaskRef): BrowserTaskSnapshot

/**
 * Consume durable Agent-continuation budget.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param steps - Positive number of continuation steps to consume.
 * @returns The next task revision.
 */
consumeContinuation(agent: Agent, ref: BrowserTaskRef, steps: number = 1): BrowserTaskSnapshot

/**
 * Consume durable Browser-action budget.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param actions - Positive number of Browser actions to consume.
 * @returns The next task revision.
 */
consumeAction(agent: Agent, ref: BrowserTaskRef, actions: number = 1): BrowserTaskSnapshot

/**
 * Terminate a task; completed outcomes pass every acceptance and cleanup gate.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param outcome - Terminal outcome.
 * @returns The terminal task revision.
 */
terminate(agent: Agent, ref: BrowserTaskRef, outcome: BrowserTaskSnapshot['outcome'] & string): BrowserTaskSnapshot

/**
 * End an uncertain task only from a newer direct user message. This records a
 * decision boundary; it never changes any unknown action or resource outcome.
 * @param agent - Exact live Agent that owns the task.
 * @param ref - Current compare-and-set task revision.
 * @param sourceSeq - Latest direct user message that explicitly requests cancellation.
 * @returns The terminal cancelled task revision.
 */
cancelByOwner(agent: Agent, ref: BrowserTaskRef, sourceSeq: number): BrowserTaskSnapshot
```

Types: [Agent](core.md)

Source: [`packages/browser/browser-task/src/index.ts`](../../packages/browser/browser-task/src/index.ts)

<a id="browser-events"></a>

### `browser/*` events

<a id="browserdispatch-intent--waterfall"></a>

#### `browser/dispatch-intent` — waterfall

Single-slot policy immediately before a Browser Provider can cross its transport boundary. Calling `next()` delegates to the next policy; a denial returns a conclusive result without sending.

```ts cordis-catalog
/**
 * Single-slot policy immediately before a Browser Provider can cross its transport boundary.
 * Calling `next()` delegates to the next policy; a denial returns a conclusive result without sending.
 * @param context - Logical operation plus exact transport identity, authority epoch, and mutation class.
 * @param next - Continue to the next dispatch listener or the default allow decision.
 * @mode waterfall
 */
'browser/dispatch-intent'(context: BrowserDispatchContext, next: () => BrowserDispatchDecision | Promise<BrowserDispatchDecision>): Promise<BrowserDispatchDecision>
```

Source: [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)

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

<a id="browseroperation-intent--waterfall"></a>

#### `browser/operation-intent` — waterfall

Single-slot admission for one logical Browser operation, before Provider-specific preconditions.

```ts cordis-catalog
/**
 * Single-slot admission for one logical Browser operation, before Provider-specific preconditions.
 * @param context - Caller identity, logical action, mutation class, and lifecycle phase.
 * @param next - Continue to the next admission listener or the default allow decision.
 * @mode waterfall
 */
'browser/operation-intent'(context: BrowserOperationContext, next: () => BrowserDispatchDecision | Promise<BrowserDispatchDecision>): Promise<BrowserDispatchDecision>
```

Source: [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)

<a id="browseroperation-settled--parallel"></a>

#### `browser/operation-settled` — parallel

Awaited non-rewriting notification after one logical operation reaches a durable lifecycle fact. A listener failure cannot replace the Provider result.

```ts cordis-catalog
/**
 * Awaited non-rewriting notification after one logical operation reaches a durable lifecycle fact.
 * A listener failure cannot replace the Provider result.
 * @param context - Exact logical operation and lifecycle phase that reached a fact.
 * @param settlement - Prepared marker, conclusive result, or conservative delivery error.
 * @mode parallel
 */
'browser/operation-settled'(context: BrowserOperationContext, settlement: BrowserOperationSettlement): Promise<void> | void
```

Source: [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)
<!-- END GENERATED cordis-surface -->
