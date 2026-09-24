---
description: "Session-addressed browser service definition for consumers and providers that need explicit installation, page, and element targets."
kind: "package-reference"
---

# @changanhua/dsh-browser

English | [中文](README.zh.md)

## Summary

Use this package when browser work must identify the session and its exact installation, page, or element target. Consumers mint a request id before dispatch, list authorized instances and submit an operation through `ctx.browser`; a provider decides how to carry it out. An unavailable or lost result remains `unknown`, so a consumer must reconcile it instead of replaying the operation. This definition does not mount a provider or route by itself; the extension provider connects the Chrome worker.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Import the definition when implementing a browser provider or a trusted consumer that already has a session-scoped action to perform.

### Semantics and recovery

Interactive `snapshot` actions accept optional `query`, `offset`, `limit`, and `textLimit` fields for semantic control search, pagination, and body-text budgets. They also accept `tree`, `treeCursor`, and `treeLimit`: a tree read pages one cached full DOM hierarchy with stable node and parent indexes, while element references remain exact snapshot-local nodes. A trusted task consumer may add up to 32 bounded `presentationQueries` that bind expected text to a `mountId`; the extension reports success only while its isolated page runtime still owns that mount and the actual panel remains connected. The model-facing snapshot schema does not expose this internal evidence query. The extension provider validates all bounds; tools own model-facing defaults and action feedback.

Entry actions use an explicit page identity and content region. `entry_inspect` is read-only: it evaluates one region-scoped `:scope` item selector and reports matched and valid counts, missing titles or links, duplicate links, and bounded samples without changing the page. `entry_mount` requires a successful inspect for the same owner and binding whose region, item nodes and fields remain current; absent evidence returns `inspect_required`, changed evidence returns `stale_binding`. Invalid replacement does not remove a still-valid mount. Dynamic Cordis Plugins should use the runner-owned `harness.browser` facade so Session identity, stable mount ids, and lifecycle cleanup do not depend on generated code.

`entry_unmount` removes the exact owned mount and reports `unmounted` and `remaining`. Ordinary unmount preserves the document-local confirmed `collected` set; inspect again before restoring the mount. Omitted `collected` reuses that set, an explicit array replaces it, and `[]` clears it. `forgetCollected: true` on unmount also releases the retained set. Navigation and owner release do not restore it into another document or Session. Reused nodes cannot dispatch their former title/link. Business collection remains the consumer's responsibility; button state is not durable storage or proof of collection.

The action type also covers prepared mouse, keyboard, form, selection, drag, upload, navigation, tab, screenshot, scroll, and wait operations. The uploaded paths must be absolute and named verbatim by the current user message before the model tool executes them; this path-origin check does not add another approval dialog.

`isAuthorized(instance)` synchronously rechecks an earlier instance snapshot against current identity, epoch, scopes, and sites. Use it after asynchronous work before disclosing retained observations. Offline status alone does not revoke authority; revocation must fail this check as soon as it starts.

`instances()` reports authorized browser installations without exposing credentials. `execute()` accepts an explicit session, installation, and action target; `prepare()` is an admission-only read probe that returns an expiring ticket bound to that provider, epoch, Session, and action; and `executePrepared()` can submit only that ticket. Preparation is not a dispatched attempt. Results distinguish an observed local action, failure, cancellation, and `unknown` outcome. An `unknown` result is not permission to retry because the provider cannot prove that the browser did not perform a mutating action.

Every `BrowserOperation` carries the caller-minted request id. `browser/operation-intent` admits the logical operation, `browser/dispatch-intent` is the final pre-send decision, and `browser/operation-settled` publishes its immutable result. The provider journals the request identity before dispatch, so an exact repeat reads the same retained receipt rather than issuing another page action. A consumer that needs restart recovery stores the public action-free locator at dispatch, flushes its durable state before send, and later asks only for status. An online instance carries the executor handshake: protocol version, implemented action kinds, and request-recovery support. A consumer must treat a missing capability snapshot or a changed grant epoch as unavailable authority, not as permission to guess what the worker can do.

`page_map` establishes short-lived, exact-document evidence for `region_render`, but returns at most 64 opaque `regionRef` values instead of CSS selectors. `region_render` accepts one reference and one bounded `BrowserRegionPresentation`; the Host resolves the private selector and compiles the extension payload. Public action and status results recursively remove presentation selectors and compiled blocks. This does not change entry adaptation: `entry_inspect` and `entry_mount` remain provider-validated selector actions. A provider can append an extension-owned region only when that reference still names the selected region; replace additionally requires its disposable hint and rejects protected or unknown regions. A clear is confirmed only by an observed `cleared:true`, an observed exact `disposition:'absent'`, or a sent `document_replaced`; `target_url_stale` means the resource remains unresolved and requires a fresh observation or recovery decision. Host registrations carry a generation: a late clear or unmount may settle only its captured generation and cannot delete a later render or mount that reused the id.

`observe()` performs only a finite `tabs` or `snapshot` read under an explicit observation grant epoch and both `browser:read` and `browser:observe` scopes. An observer snapshot does not allocate or retain element references in the interactive element cache; an unavailable browser is never reported as an unchanged observation.

The package has no configuration and no standalone mount path. Compose it with a provider such as [`@changanhua/dsh-browser-extension`](../browser-extension/README.md), which connects a Chrome worker, and let the consumer record any session result that it needs to retain.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`Browser` is the service definition for `ctx.browser`. Its API carries immutable references and caller-minted request identities for a session, installation, page, and element instead of discovering an implicit active browser target. Providers implement instance discovery, capability declaration, preparation, and execution; consumers own their session writes and recovery policy. The [source](src/index.ts) and [operation types](src/types.ts) define the exact public shape.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Browser extension provider](../browser-extension/README.md) — connects the authenticated Chrome worker for this definition.
- [Architecture](../../../docs/architecture.md) — explains the service-definition, provider, and consumer roles.
- [Session subsystem](../../../docs/subsystems/session.md) — owns durable session facts and their recovery semantics.

-----

<a id="model-experience"></a>
## Model Experience

### Browser consumers

#### What the model sees

This definition registers no direct tool or prompt section. A composed consumer may expose `ctx.browser` operations, but the definition does not add page data or operation results to model context itself.

#### Token effect

None from this package alone; any tool schema and result cost belongs to the composed consumer.

#### KV Cache effect

None from this package alone; consumer composition determines any cacheable model prefix.

## Known Limitations and Deferred Work

- The package defines an abstraction only; it provides no browser executor, persistence, model tool, or user-facing route.
- An `unknown` outcome remains unresolved until the responsible consumer reconciles it; the definition never converts it into an automatic retry.
- Session-persistent task acceptance, evidence, receipts, and page-resource disposition belong to [`@changanhua/dsh-browser-task`](../browser-task/README.md), not to this service definition.

No invariant companion is published because this abstract definition owns no connections, grants, or execution state.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
