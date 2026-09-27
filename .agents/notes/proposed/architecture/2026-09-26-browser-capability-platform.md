# Agent Note: Browser capability platform design baseline

Status: proposed

English | [中文](2026-09-26-browser-capability-platform.zh.md)

## Problem

A successful browser demonstration does not determine the platform's responsibilities. A design centered on one selected document can omit opening a first page, following a link into another tab, observing a same-document route change, or recovering an action whose receipt was lost. Implementing only that demonstration can turn these gaps into unrelated exceptions and duplicate execution between DSH and Codex.

The user wants an extension that changes infrequently, stays reasonably simple, and preserves both agent environments. The user requires complex browsing from an existing page or a new URL, asks that the design accommodate Cordis, and limits the current delivery to browser capabilities. These are user requirements; the mechanisms below are proposed design decisions, not previously approved requirements.

## Proposal

### Epic outcome

A user gives a browser task to a Codex or DSH agent. The agent can start from an explicitly selected page, discover an authorized existing page, or open a URL without an existing page reference. It observes the page, acts on fresh targets, follows permitted transitions, and reports results supported by independent page observations. The user can inspect the active target and unresolved actions. DSH may be offline while Codex uses its independent browser connection.

This is design candidate browser-platform-r1, prepared for review. It establishes intended behavior and the first-phase boundary; it does not claim implementation or runtime acceptance. An implementation slice is chosen only after this product boundary is accepted. A passing demonstration never substitutes for the scenario matrix below.

### Requirement traceability

| User requirement | Proposed response | Evidence that rejects the design |
| --- | --- | --- |
| Few business-driven extension updates | Browser mechanisms in the extension; website knowledge and calculations with the agent environment | A second website requires a domain-specific executor branch |
| Preserve DSH and Codex capabilities | Shared execution semantics, separate adapters and runtime policies | Codex direct browsing requires DSH, or DSH loses an existing Browser operation |
| Navigation, new pages and starting from zero | Distinct open, tab, document and task-target concepts | Opening needs an old page, a child cannot be adopted, or a stale element executes |
| Accommodate Cordis | Preserve Browser Definition, Provider and Consumer roles | A dynamic plugin bypasses Browser checks or the extension needs another Cordis runtime |
| Complete the browser stage first | Common browsing and both adapters before ecosystem exports | Completion depends on a general DSH gateway, capability marketplace or FC solver |

### Morphological choices

The capability analysis separates technical possibilities from preferred ownership. Each row below chooses a strategy for the browser stage and records why; it does not restrict which implementation language an owner can use. The [morphological method](https://www.swemorph.com/ma.html) informs the comparison, while the local contracts determine feasibility.

| Dimension | Selected strategy | Reason |
| --- | --- | --- |
| Starting point | Selected, discovered or newly opened | Existing tabs are not a prerequisite for autonomy |
| Target scope | Independent single-tab, descendant or explicit-set policy | A user-selected starting point can legitimately lead to several pages |
| Observation | Structure first, targeted detail and screenshots as needed | Bound result volume while retaining evidence for complex layouts |
| Execution granularity | One agent decision with bounded browser mechanics | Avoid repeated model waits without embedding website workflows |
| Website knowledge | Shared skills and caller-side deterministic modules | New business rules need not update the browser extension |
| State | Browser journal in extension; task state with caller | Recovery facts and task meaning have different lifetimes |
| Connection | Independent Codex and DSH adapters | Browser availability does not depend on DSH being online |
| DSH extensibility | Cordis Consumers use the existing Browser service | Preserve composition, scoped authority and cleanup |
| Presentation | Existing agent UI and generic extension/page projections | Rich display does not require domain calculations in the extension |

The rejected combinations are target-free startup that requires a PageRef, child-page tasks restricted to the original tab, precomputed element sequences across navigation, durable scheduling based only on worker globals, and Codex independence through a mandatory DSH hop. These are consistency constraints; excluding new domain solvers from phase one is a scope choice.

### Ownership

| Owner | Responsibility | State authority |
| --- | --- | --- |
| Browser and website | Real tabs, documents, frames, rendered state and business responses | Browser session and website state |
| Extension execution core | Target checks, bounded reads, input, transition facts, receipts, cancellation and write-conflict arbitration | Bounded execution journal; no task planner |
| Codex connector | MCP adaptation, caller identity, capability discovery and bounded results | Declared connection/request retention; no replacement for the journal |
| DSH Browser Service Provider | Adapt browser semantics to ctx.browser and current Cordis scope | Existing DSH grant and request ownership |
| DSH BrowserTask and agent | Target selection, task progress, business checks and authorized scope changes | Session facts |
| Codex agent | Target selection, task progress, business checks and tool choice | Codex task context and supported artifacts |
| Shared application knowledge | Website concepts, verified recipes and deterministic calculations | Versioned skills or owning modules; no reusable live element references |

The extension treats caller identity as opaque. The current wire name sessionId does not grant a Codex caller access to a DSH Session. Credentials, receipts and recovery queries remain with their originating connection. Physical browser-write conflicts are checked across connections.

## Browser decisions

### Entry and scope are independent

Entry may be a user-selected tab, an agent-discovered tab selected within task authority, or a new URL. Separately, allowed target scope may contain one tab, that tab and attributable descendants, or an explicitly selected set. The active target is a member of that scope. Selecting it neither focuses Chrome nor broadens site permission.

Existing user-fixed single-tab behavior remains available. A task asking to open a website and browse its details may select broader scope without confirmation for each ordinary navigation. “This page” does not authorize an unrelated foreground tab. A child-page relationship does not authorize arbitrary access to other user tabs.

DSH records the initial selection and accepted transitions in the same Session-owned task. A transition preserves budget, unresolved requests and resource ownership; creating another task cannot evade a blocker. Codex holds its corresponding task selection in its own environment. Neither caller changes the other's selection.

### Opening precedes observation

Browser-level open accepts an authorized installation, an allowed URL and a caller-generated request identity. It requires neither an existing PageRef nor a DOM attachment. Chrome returns a TabRef; a PageRef becomes available after the extension observes frame, document and actual URL. Tab creation and page readability are separate facts.

A confirmed creation receipt includes the created tab even while its destination loads. An uncertain create result is reconciled without creating another tab. Open therefore needs installation-level journal admission without a page target; ordinary page writes remain target-bound. Created-tab ownership must survive a worker restart within the declared journal retention.

An already running, connected Chrome installation is the first-phase prerequisite. Launching a stopped browser belongs to a separate local launcher. Open defaults to a background task-created tab; focus is explicit. Automatic cleanup is limited to confirmed task-created tabs; closing a pre-existing user tab requires that user intent.

### References have different lifetimes

A PageRef identifies installation, tab, frame, document and observed URL. An ElementRef additionally identifies its observation and element. The executor checks identities and actionability before dispatch. A selected tab may survive navigation; its old PageRef and ElementRefs do not.

Same-document routing or DOM replacement requires a new observation when the recorded URL or element meaning changes. Frame replacement invalidates its references. Tab loss or browser restart invalidates live handles: a remembered numeric tab id cannot restore authority. Reconnection discovers and validates targets instead of selecting the foreground tab.

### Observe progressively

Initial reads return bounded text, controls, frame boundaries and page identity. Queries and stable tree pagination refine the observation; screenshots provide visual evidence when structure is insufficient. The executor checks target identity before and after capture and rejects a result that crossed an incompatible document change. Results state observation time and relevant truncation or traversal limits. Completed tree traversal does not establish complete virtual-list inventory or server data.

The extension reports browser facts. Website interpretation, semantic summaries and coverage decisions belong to the caller or a deterministic domain module. Application knowledge may suggest where to inspect; it cannot supply a live locator or certify current stock, price, permissions or completion.

The full design permits coordinate input tied to an exact image, viewport and page identity. Phase one provides screenshots but adds no coordinate-input API and promises no canvas-only automation. Such input returns an explicit unsupported result and visible evidence. An agent cannot fabricate a DOM target or silently bypass an unresolved write through another channel.

### Execute bounded mechanics

The executor may scroll a known element into view, check actionability, issue one input, observe navigation and collect bounded feedback. These deterministic mechanics reduce model round trips without website rules. Operations have deadlines and cancellation; timeout does not mean input was never issued.

Phase one adds no arbitrary remote-code loader or general script language. Longer recipes and domain calculations stay with the agent environment. Existing bounded sequences stop when prepared references or expected state become invalid; they cannot reuse pre-navigation elements blindly. DOM readiness or a changed URL is not proof of business completion.

### Report transitions before selecting a continuation

A receipt may describe several changes: same-document update, same-tab navigation, child-tab/window creation, frame replacement, closure or uncertain transition. It includes before and after targets and association evidence. Source-tab events establish a source relationship, not necessarily which concurrent human or agent input caused it.

A directly observed open can establish exact request ownership. Uniquely associated navigation can provide a confirmed continuation. Multiple children, concurrent user input, delayed events or lost observations remain candidates or unknown. An agent selects a permitted confirmed target and reads it anew; ambiguous candidates need further observation or user choice when the task cannot distinguish them.

Newly active does not mean intended. Redirects are checked against current permission before protected content is returned. An inaccessible destination never extends the grant. Login or required human interaction is reported as task state rather than handled by replaying the previous action.

### Recover execution without inventing business success

Capacity backpressure identifies an operation rejected before execution and the earliest quiescent write expiry, when known. This is a recheck hint rather than reserved capacity or automatic retry authority. Callers can preserve the task and resume observation when capacity becomes available; pending writes still require recovery or settlement. Increasing the journal limit or replacing the browser profile is not the recovery contract.

Every mutating request receives an identity before dispatch. The extension persists intent before issue and retains receipts within explicit count, byte and time bounds. The journal stores recovery facts, not replayable action inputs. A matching retained identity returns its original work or receipt; a conflicting payload is rejected. Callers never resubmit a sent request after retention expires, and status lookup cannot execute. Bounded retention is not a perpetual exactly-once guarantee.

Callers distinguish not-sent from sent and observed, failed, cancelled or unknown outcomes. Observed browser effects remain business-unverified until website readback. Cancellation limits further work and cannot undo already delivered input.

A write that may still run blocks conflicting writes from both connections on its physical tab. Proven quiescence may release occupancy while the outcome remains unknown. Release does not permit repeating an uncertain purchase or submission. Expired or missing receipts remain unavailable or unknown, never evidence of no effect.

### Human control and presentation

The user can inspect target, caller, connection, task-created tabs and unresolved requests. UI distinguishes target selection from browser focus. Manual navigation or editing invalidates affected observations; agent resumption starts with a new read.

Existing DSH chat, reading and evidence views keep their service ownership. Generic page rendering and entry mounting retain exact owner, document and cleanup obligations. New website business panels do not enter the browser core. A displayed summary neither grants action authority nor proves completion.

## Cordis and future ecosystem access

DSH retains ctx.browser as Service Definition, its extension-backed Service Provider, and Tool, BrowserTask and dynamic Cordis Consumers. Profile/preset composition selects capabilities. Transition and recovery facts pass through that provider; lifecycle checks cover normal tools, direct provider calls and dynamic-plugin browser calls. Transport adaptation must preserve those scopes.

The dynamic runner owns Host code, Agent identity, package/run lifetime and its managed browser facade. DSH Client code uses its Client runner, not a new runtime inside the Chrome extension. Plugin stop/update retains cleanup responsibility. See the [Browser definition](../../../../packages/browser/browser/README.md), [BrowserTask](../../../../packages/browser/browser-task/README.md) and [Cordis Host runner](../../../../packages/extensions/cordis-host-runner/README.md).

Codex browses through its own MCP adapter without DSH. Adapters may have different tool groupings and output budgets; capability discovery must report actual operation/recovery support. DSH retains richer existing operations even when the initial Codex adapter exposes fewer operations.

A future DSH-to-Codex bridge can consume Service Definitions or delegate a real DSH Session. It remains independent of direct browser execution. This design adds no general capability registry, arbitrary ctx export or scoped-tool-registry copy. DSH business policy does not automatically govern the independent Codex connection.

## First-phase boundary

Phase one covers interactive browsing in a running, authorized Chrome installation on the operated Windows environment. It includes selected/discovered/new starting targets, permitted same-tab and child transitions, explicit multiple targets, bounded DOM/control/frame reads and screenshots, generic element actions, cancellation and receipt recovery through both adapters. Existing Browser and Cordis behavior must remain available.

New autonomous scheduling, general DSH exports, domain solvers, complete website-internal data access, canvas-only input, browser-process launch and rich-sidebar redesign are deferred. Future consumers can use this browser contract; these additions are not phase-one prerequisites. Existing support is not removed.

Task state stays with its caller. The extension owns execution and temporary resources. Phase one does not promise arbitrary Codex task restoration after process loss, durable dynamic Cordis packages, or successful reconciliation of irrecoverably lost business receipts. Automatic retry cannot conceal these limits.

## Baseline and drift checks

Each implementation slice cites its design decisions and required scenario rows. A website-specific executor branch, a new state owner, broader permission, changed target-adoption rule, changed recovery promise or mandatory DSH dependency for Codex reopens the design. File layout or a bounded internal helper alone does not reopen the product outcome.

Open implementation facts are concurrent-input event attribution, cross-window popup timing, recovery when a worker stops between tab creation and persistence, and the exact DSH Session changes needed to preserve one task across targets. Resolve each by focused contract discovery or a probe before its code change. They do not permit invented fallback behavior.

Observed checkout: 6ddb5ca503da7b8a0da286a716565963efcb2f50 with related WIP; dirtyDiffDigest: not-observed. The [extension wire](../../../../packages/browser/browser-extension/src/wire.ts), [Codex schema](../../../../packages/mcp/browser-extension-mcp/src/schema.ts) and [BrowserTask implementation](../../../../packages/browser/browser-task/src/index.ts) establish source gaps only. Installed-extension and Profile identity must be re-established for behavior verification.

FeatureCharterReceipt browser-platform-r1 has approval state proposed. Its scope is the first-phase outcome; inputs are the five user requirements above; decisions are this note's ownership and behavior sections; evidence is the named source inspection. Remaining gaps are the preceding facts and all composed/runtime/behavior verification. Changed actor, entry, authority, persistence, scenarios or closure invalidates the receipt.

## Alternatives considered

**One fixed document for every task.** Simple selection cannot represent first open or permitted child continuation. Fixed-tab use remains an available scope.

**Website workflows inside the extension.** Convenient for one application, but website rules and algorithms force extension updates. Shared skills and caller-side programs preserve reuse.

**One agent call per mechanical substep.** A smaller executor repeats waits and transition handling in every caller. Bounded generic mechanics belong beside the browser facts they validate.

**All Codex browsing through DSH.** This reuses Host state but couples availability and owners. Independent adapters preserve availability while sharing execution.

**Build a general ecosystem gateway first.** It exposes more DSH capabilities without solving opening, identity or transitions. It remains a separate later capability.

## Acceptance criteria

The matrix defines phase-one completion. Common browser rows apply separately to both adapters. The Cordis row applies to DSH; offline independence applies to Codex; cross-connection conflict checks require both connected. Every applicable row needs behavior and observable evidence; a happy-path sequence cannot replace negative cases. Controlled pages make timing failures reproducible, while real installed-extension checks establish integration.

| Scenario | Required result and independent evidence |
| --- | --- |
| Selected A while user browses B | Both adapters operate on A; target and receipt identify A without implicit focus change |
| No selected page | Open an allowed URL without an old PageRef; return created TabRef, then a fresh PageRef |
| Same-tab navigation, redirect, back/forward or reload | Read final permitted document; old element references fail before input |
| Same-document route or DOM replacement | Refresh affected references and verify the intended view |
| Click opens one attributable child | Report source/child evidence; follow only within scope and read the child anew |
| Multiple children or manual input | Return candidates/unknown; never guess from active flags or repeat the click |
| Explicit multiple-page comparison | Separate page evidence; target changes retain budgets and unresolved effects |
| iframe or virtual list | Read authorized loaded data with limits; do not infer complete inventory |
| Loading delay, blocked popup or human step | Bounded wait and an honest missing-observation or interaction result |
| Sent action loses reply | Same-request lookup; no duplicate input; conflict blocked until quiescent |
| Worker restart after open/input | Recover retained facts without another open/input; loss remains unknown |
| Target closes, browser restarts or grant changes | Invalidate stale handles, reject unauthorized continuation, no foreground fallback |
| DSH offline and dual connections | Codex direct browsing works alone; physical execution conflicts remain shared when both connect |
| Cordis consumer and cleanup | Same provider checks; stopping a scoped plugin cleans its exact resource only |
| Canvas-only input | Screenshot evidence and explicit unsupported result; no fabricated control or hidden bypass |

Required evidence layers are source-contract (definitions/provider/consumers), generated-declaration (affected tool/wire/Session artifacts), composed (DSH Profile/preset and Codex connector), runtime-observed (installed extension and advertised capability), and behavior-verified (matrix plus a real task with website readback). All five are required for phase-one completion.

This proposal supplements the active [personal browser assistant V2](../feature/2026-09-20-personal-browser-assistant-v2.md) and [field-operation lifecycle](../../implemented/feature/2026-09-12-browser-field-operation-lifecycle.md). Their fixed-target, delivered-evidence, request and cleanup rationale remains active. This draft supersedes no implemented decision and authorizes no archival; accepted changes must reconcile conflicting contracts in their owning notes.

## Risks

Browser events may establish a source tab without uniquely identifying the initiating input. Overclaiming attribution can select the wrong child. Browser loss can destroy recovery facts. Explicit uncertainty is required in both cases.

Generic mechanics cost more extension code than a raw click relay. Placement depends on browser facts and cross-site reuse. Site selectors, domain budgets and solver rules require reconsidering ownership.

Shared execution does not make DSH Session durability or Cordis policy apply to Codex-owned work. Cross-client business guarantees need a separate design and are not claimed here.

## Top-level closure condition

### Delivery order and frozen contracts

Runtime diagnostics identify the MCP process, relay process, and extension independently. Component versions and loaded module paths distinguish extension reloads from connector replacement; absent identity is unknown rather than evidence of an obsolete release. Diagnostic metadata never grants browser authority. Both extension connections report the same manifest metadata, and the DSH gateway explicitly accepts it. Pre-release delivery updates the participating components together without a separate legacy handshake. Keeping this observation in the existing status path avoids another registry, installer, or automatic process restart.

The independent MCP owner reserves request identities before relay dispatch. A lost HTTP reply retains that identity as unknown, allowing a status lookup without another input. The relay keeps its existing owner, payload and installation checks. Transport failure never supplies an executed:false or quiescent:true promise; recovery remains scoped to the original MCP owner, and replacing that process does not inherit earlier ownership.

The transition observation contract reports bounded browser facts in `value.transition`, independently of the original execution outcome. The source has both a browser-session tab reference and an exact page reference. Child candidates prove only an opener relationship; replacing the source document ends their attribution window. The executor checks final observed URLs against current permission and does not choose candidates. The request deadline bounds the complete observation, with at most 250 ms of additional observation after the action returns. Missing or late events do not prove that no page opened.

Same-tab task advancement consumes a canonical receipt bound to a settled observed attempt. A durable `targetReceipt` records the accepted authority through bootstrap and advancement; ordinary rebind clears it. Advancement preserves budget, attempts, user-selection revision, and resource owners. Replaced documents prove that their resources vanished. A route change within one document retains each resource's original URL and allows only exact owned cleanup against that URL, using the existing route-discard receipt. Uncertain execution is recovered by its original request before advancement. Explicit child selection and fixed multi-page scopes require fresh full-tab snapshots and preserve the same task; personal deployment and the complete acceptance matrix remain separate evidence.

BrowserTask page receipts preserve opener candidates in a separate bounded `children` observation, because child creation does not require the source document to change. The receipt owns the source page; the observation retains source tab, browser-session identity, candidate relationships and truncation. At most eight candidates and 4 KiB are retained, with the same validation during replay. These facts do not infer causation, settle unknown actions, or authorize a child-page read. Selection remains the caller's explicit decision followed by a fresh tab-bound snapshot.

After the design candidate, the user requested that delivery begin. This run retains the browser-platform-r1 outcome and orders implementation by the dependencies below; unproven mechanisms are not accepted behavior. The reuse decision is adapt: keep the existing Browser definition/provider, dual-connection executor, journal and BrowserTask instead of adding a platform runtime or general registry. Related source includes uncommitted WIP, and the personally installed extension version remains unverified.

| Slice | Owner and dependency | Closing evidence |
| --- | --- | --- |
| Opening and recovery | Extension, existing Browser provider and independent Codex connector; first create an explicit URL without a prior page | Background creation, caller-known request identity, receipt recovery, no reopening after loss, rejection when an older executor lacks support; actual extension and MCP create, read, click and read back |
| Same-task target adoption | BrowserTask and tool consumer; depends on the creation receipt | An installation-level creation attempt belongs to the same task, spends its budget and retains unresolved requests; associate a fresh page with the original receipt and adopt through revision CAS; never invent a PageRef |
| Transitions and scope | Extension reports facts; callers select permitted successors; depends on same-task adoption | Positive and negative cases for same-tab navigation, children, multiple candidates, human interference, redirects and multi-page comparison |
| Dual-adapter and lifecycle acceptance | Both adapters, DSH Profile and Cordis consumers; depends on the preceding slices | Every applicable scenario, resource cleanup, restart recovery, independent website readback and all five evidence layers |

Target-free opening uses tab_open without page on the wire, requires browser:write and current site authority, and requires the installation's targetFreeOpen declaration. It creates a background tab through the browser and returns opened plus a reference containing tabId, windowId and browserSessionId; a later read produces PageRef. Existing calls with page retain exact-page checks. Browser storage.session retains the session identity across worker restarts, while a browser or extension restart invalidates old references; the first read checks the complete expectedTab. This lifetime follows the [Chrome session storage contract](https://developer.chrome.com/docs/extensions/reference/api/storage#property-session). DSH agents cannot be described as completing tasks from zero until the second slice closes.

Codex callers specify requestId before opening. Within the same connection and declared retention bounds, matching identity and payload reuse the original request; conflicts are rejected. Recovery after relay memory loss uses the existing journal locator for status only. Loss of caller identity after MCP process restart, or missing/expired journal facts, remains unavailable or unknown. There is no new durable task registry, and an uncertain intent cannot be retried under a new identifier. Distinct explicit opening intents create independent tabs without an installation-wide lock; page-write conflicts still compare real tabs across connections. Settled receipts are unavailable after their query retention deadline, and later journal writes remove expired storage entries.

Independent review fixed two boundaries: installation site permission is not task intent, and a creation receipt is not authority to adopt a page. This slice opens only the caller's explicit URL, without automatic child following. Later adoption must preserve the task and resource owner; it cannot skip BrowserTask, reset budget, create a replacement task or weaken Cordis page checks.

Browser creation and journal receipt commit are not atomic. Worker loss between them remains unknown unless sufficient ownership evidence survives; recovery neither guesses a tab by URL nor creates another. A retained numeric tab ID grants no authority across browser sessions, and later input still requires current page identity. Passing one vertical closes only its slice; the complete matrix above still determines phase-one status.

DSH adopts a task-local target without writing the user's browser-target/change. A default single-tab task keeps its user-fixed target exclusive; an explicit task scope permits scoped selection; an unbound task captures the null selection revision, and a user bind or clear invalidates that admission. Installation-level creation and its first read each spend one action in the same task and use its existing attempt/receipt ownership. One BrowserTask settlement method accepts confirmed creation and fresh page observations for both ordinary tools and direct Provider calls. Only page branches carry PageRef; creation cannot invent a document. Cordis page-function delivery uses the freshly accepted task target with the unchanged user-selection revision, current acceptance evidence and exact owned resources. Selecting a task target does not itself transfer ownership; cordis_handoff performs that separate explicit operation without requiring the user to pin the same page again.


Read-only installation discovery must remain independent of an old task's page authority; otherwise a connection change can prevent the Agent from acquiring the fresh references that recovery requires. Listing never grants page access or migrates a task scope. An initial selection conclusively rejected as `tab_reference_stale` can end as failed only before page adoption and without pending pages, resources, delegated work or uncertain attempts. Its receipts and budget remain intact; a replacement task requires a newer direct user instruction, preserving the source-replay guard. An already adopted page or uncertain operation keeps its existing recovery obligations.

Connection recovery follows browser-owned lifecycle hooks rather than a permanent probe loop. Bounded transient retries end in a persisted pause; a matching service-page navigation or trusted extension lifecycle event can attempt recovery with existing credentials. Events only establish a reason to check availability, never grant authority. Coalescing and a durable cooldown prevent an event or worker-restart storm from becoming repeated connections. Silent server recovery without a browser event deliberately waits for the next hook or an explicit retry; a native background watcher is outside the extension contract.

The design is ready for implementation when the product boundary, exclusions and scenario matrix are accepted and ownership is not left to implementation shortcuts. Phase one completes only when both intended entries satisfy their applicable matrix rows on the installed extension, a real task has independently observed results, and all five evidence layers are available. A document, schema, passing unit suite or single demonstration cannot close delivery.
