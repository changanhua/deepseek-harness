---
description: "Authenticated Chrome-extension browser provider with owner-approved grants, bounded Host HTTP and WebSocket requests, and session-addressed execution."
kind: "package-reference"
---

# @changanhua/dsh-browser-extension

English | [中文](README.zh.md)

## Summary

Choose this provider to connect an approved Chrome worker to session-addressed browser operations and selected DSH Sessions through the Host web server. It pairs an extension with a verifier and challenge, lets the signed-in owner approve or revoke narrowly scoped grants, and forwards bounded requests over HTTP and WebSocket. The worker uses the assistant runtime, connection, channel, journal, executor, and page layers to perform browser actions. Before each send the provider checks the grant scope, allowed origin, and authorization epoch; model tools belong to the tool-browser consumer, and this package does not schedule background monitoring.

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

Compose this provider with `webServer`, `connection`, `credentials`, and `@changanhua/dsh-browser` when a Host owns the approved extension connection.

### Authority and request handling

The provider registers `/api/browser-extension/v1` HTTP and WebSocket routes on the Host web server and serves the signed-in owner approval page at `/browser-assistant`. An extension starts a verifier/challenge pairing request. The owner chooses only a subset of the requested scopes and origins, including the separate `session:interact` permission, and can later revoke a grant stored by the credential provider. A visible same-Session peer with `session:interact` receives browser-action approval through the existing Approval answer chain, identified by a transport UUID; hidden or disconnected peers delegate to Web. The `/info` scope list describes the protocol vocabulary; it does not prove that every scope has an executor.

`prepare()` creates a private ticket bound to the current grant epoch, Session, and action. `executePrepared()` rechecks that binding before dispatch. The worker synchronously rechecks form state before commit: it expands local `<details>` directly, treats other clicks with no visible change as `unknown`, and reports a visible local page change as `observed` without claiming a business outcome. Fill receipts do not return the final page value; approval previews come from the Host input. For an unknown action, the journal first inspects a quiescent receipt and requires a user button before it persists `acknowledgementPending`; `browser.acknowledge` sends only the minimal identity, outcome, and quiescence fact to the Host, then clears the pending acknowledgement after success. Reconnection can synchronize it again. An old epoch can only query status or cancel a current write and never executes an old page action. Requests, frames, results, capacity, and deadlines are bounded. The provider sends a heartbeat every 20 seconds and disconnects stale peers. Cancellation asks the worker to stop; a missing receipt, disconnect, deadline, or transport failure becomes `unknown`. Reconnection recovers request status only: it does not replay queries or writes, and no unknown mutating operation is released until the worker reports quiescence.

With `session:interact`, the authenticated peer receives a strict `SessionController` facade for listing, creating, prompting, cancelling, reading pages and attachments, and one controlled follow stream. It validates each RPC request, serializes follow replacement, limits concurrent Session requests to `maxSessionRequests` (default `4`, range `1`–`8`), and retains the existing 16 MiB WebSocket frame bound. The provider requires `sessionController` as an injected peer dependency.

The provider accepts only actions implemented by its protocol. Puppeteer is the default executor for `click`, `fill`, `submit`, `double_click`, `right_click`, `hover`, `press`, `select`, `check`, `drag`, `upload`, navigation, tab, screenshot, scroll, and wait actions. The DOM compatibility executor supports only `click`, `fill`, `submit`, `navigate`, `scroll`, and `wait`, and rejects the newer action kinds. It does not install or configure a Chrome extension, and the service definition alone does not mount these routes. Source configuration is defined by [BrowserExtension.Config](src/index.ts); the generated [configuration catalog](../../../docs/config-catalog.md) is the exhaustive reference.

Interactive snapshots include visible elements' local references, DOM roles, readable labels, and disabled, read-only, required, checked, and expanded states. A tree snapshot pages a stable full Document, element, text, and open Shadow Root hierarchy; nodes retain their indexes and parent indexes across cursors, and iframe elements only mark their source boundary. Native labels and `aria-labelledby` are resolved without reading editable values. Hidden, editable, script, and style text is absent from tree output; text fields, select controls, and editable bodies are excluded from snapshot prose and element labels. Preparation retains values only in the document's bounded memory for comparison. Hidden or disabled controls cannot execute, and changes to visibility or effective disabled/read-only state invalidate prepared actions. Screenshots require the main frame and are limited to 400,000 base64 characters. Upload accepts only absolute paths that the current user message explicitly names; that check runs before model-tool execution without a separate approval dialog.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`BrowserExtension` implements `ctx.browser` and owns Host route registration, credential-backed grants, and the live extension transport. The connected worker owns its browser-side assistant runtime, channel, journal, executor, and page actions. `BrowserSessions` is the provider's strict RPC facade over `ctx.sessionController`, so the worker receives cloned results instead of direct service access. Pairing stores no reusable verifier in public views. Approval and revocation disconnect an affected peer, while each request seals the grant epoch and target before delivery. [Grant handling](src/grants.ts), [request settlement](src/requests.ts), [Session RPC](src/sessions.ts), and [wire validation](src/wire.ts) contain the exact protocol rules.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Browser definition](../browser/README.md) — defines the `ctx.browser` operations implemented here.
- [Web Client subsystem](../../../docs/subsystems/web-client.md) — explains Host web routes and signed-in requests.
- [Storage subsystem](../../../docs/subsystems/storage.md) — explains credential-provider persistence boundaries.
- [Host web server](../../host/webserver/README.md) — owns registered HTTP and WebSocket routes.
- [Client connection](../../client/connection/README.md) — owns request authority and owner-cookie checks.

-----

<a id="model-experience"></a>
## Model Experience

With an existing `session:interact` grant, `reading.generate` makes one direct DSH model request containing only the supplied reading prompt and material. It does not create a Session, load history, register tools, or run the Agent loop. Model routes and credentials come from the Host adapters; reading selection overrides the DSH default. Each connection permits one active reading, bounded to 52,000 input characters, 64,000 output characters, and four minutes. Stop or disconnect aborts the request; transport failure never retries automatically.

#### KV Cache Impact

Independent readings send no previous questions or outputs, so their input cost does not grow with reading history. Provider caching may apply to shared prompt prefixes; the gateway retains no conversation cache.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Real authenticated-site and real-model acceptance depend on the configured deployment.
- Browser tools are composed in the standard Agent preset; this provider does not choose a model or sign in to websites.
- Monitoring does not consume browser-worker or Session stream results.
- SiYuan integration, observation, and global-key handling do not consume browser-worker or Session stream results.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
