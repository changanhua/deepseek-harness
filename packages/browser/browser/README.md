---
description: "Session-addressed browser service definition for consumers and providers that need explicit installation, page, and element targets."
kind: "package-reference"
---

# @changanhua/dsh-browser

English | [中文](README.zh.md)

## Summary

Use this package when browser work must identify the session and its exact installation, page, or element target. Consumers can list authorized instances and submit an operation through `ctx.browser`; a provider decides how to carry it out. An unavailable or lost result remains `unknown`, so a consumer must reconcile it instead of replaying the operation. This definition does not mount a provider or route by itself; the extension provider connects the Chrome worker.

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

Interactive `snapshot` actions accept optional `query`, `offset`, `limit`, and `textLimit` fields for semantic control search, pagination, and body-text budgets. They also accept `tree`, `treeCursor`, and `treeLimit`: a tree read pages one cached full DOM hierarchy with stable node and parent indexes, while element references remain exact snapshot-local nodes. The extension provider validates their bounds; tools own model-facing defaults and action feedback.

Entry actions use an explicit page identity and content region. `entry_inspect` is read-only: it evaluates one region-scoped `:scope` item selector and reports matched and valid counts, missing titles or links, duplicate links, and bounded samples without changing the page. `entry_mount` can use the same region and selectors to add one controlled action to each valid item; `entry_unmount` removes the exact mount id. Dynamic Cordis Plugins should use the runner-owned `harness.browser` facade so Session identity, stable mount ids, and lifecycle cleanup do not depend on generated code.

The action type also covers prepared mouse, keyboard, form, selection, drag, upload, navigation, tab, screenshot, scroll, and wait operations. The uploaded paths must be absolute and named verbatim by the current user message before the model tool executes them; this path-origin check does not add another approval dialog.

`isAuthorized(instance)` synchronously rechecks an earlier instance snapshot against current identity, epoch, scopes, and sites. Use it after asynchronous work before disclosing retained observations. Offline status alone does not revoke authority; revocation must fail this check as soon as it starts.

`instances()` reports authorized browser installations without exposing credentials. `execute()` accepts an explicit session, installation, and action target; `prepare()` returns an expiring ticket bound to that provider, epoch, Session, and action, and `executePrepared()` can submit only that ticket. Results distinguish an observed local action, failure, cancellation, and `unknown` outcome. An `unknown` result is not permission to retry because the provider cannot prove that the browser did not perform a mutating action.

`observe()` performs only a finite `tabs` or `snapshot` read under an explicit observation grant epoch and both `browser:read` and `browser:observe` scopes. An observer snapshot does not allocate or retain element references in the interactive element cache; an unavailable browser is never reported as an unchanged observation.

The package has no configuration and no standalone mount path. Compose it with a provider such as [`@changanhua/dsh-browser-extension`](../browser-extension/README.md), which connects a Chrome worker, and let the consumer record any session result that it needs to retain.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`Browser` is the service definition for `ctx.browser`. Its API carries immutable references for a session, installation, page, and element instead of discovering an implicit active browser target. Providers implement instance discovery, preparation, and execution; consumers own their session writes and recovery policy. The [source](src/index.ts) and [operation types](src/types.ts) define the exact public shape.

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

None. This definition registers no model tools, prompt sections, or model context, and it does not make model requests. A consumer decides whether and how an operation result becomes a session event; the definition does not write results into a session.

#### KV Cache Impact

None. Browser references and operation results do not enter model context through this package.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The package defines an abstraction only; it provides no browser executor, persistence, model tool, or user-facing route.
- An `unknown` outcome remains unresolved until the responsible consumer reconciles it; the definition never converts it into an automatic retry.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
