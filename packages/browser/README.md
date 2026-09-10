---
description: "The browser package group for session-addressed browser operations and the authenticated Chrome-extension provider."
kind: "package-group"
---

# browser/ — Session-addressed browser access

English | [中文](README.zh.md)

## Summary

This group defines browser operations that name their session, installation, page, and element targets explicitly. Consumers can select a provider behind `ctx.browser` without treating an extension connection as permission to act on every page. The extension provider connects an authenticated Chrome worker through the Host gateway and owner-approved grants, while the tool consumer prepares and approves model-facing page actions. Native approval delegates to the existing Approval service for a visible same-Session Chrome peer. The monitor consumer owns durable plans and comparisons, delegates each finite read to Queue, and retains notifications until acknowledged.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The definition and its Host provider have separate responsibilities and can be composed independently.

| Package | Role |
|---|---|
| [`@changanhua/dsh-browser`](browser/README.md) | Defines session-addressed instances, operations, and expiring prepared-action tickets on `ctx.browser`. |
| [`@changanhua/dsh-browser-extension`](browser-extension/README.md) | Connects an approved Chrome worker through authenticated HTTP and WebSocket routes. |
| [`@changanhua/dsh-tool-browser`](tool-browser/README.md) | Registers model-facing inspection and approval-gated page-action tools. |
| [`@changanhua/dsh-browser-monitor`](browser-monitor/README.md) | Owns persistent monitor plans, finite Queue checks and recoverable notification delivery. |

<a id="related-documentation"></a>
## Related documentation

- [Architecture](../../docs/architecture.md) — explains service definitions, providers, and consumers in a Cordis composition.
- [Web Client subsystem](../../docs/subsystems/web-client.md) — describes the Host web application that supplies browser routes.
- [Storage subsystem](../../docs/subsystems/storage.md) — describes durable storage boundaries used by credential providers.
- [Host web server](../host/webserver/README.md) — owns HTTP and WebSocket route registration.
- [Client connection](../client/connection/README.md) — owns Host authority and signed-in owner checks.

<a id="dev-note"></a>
## Dev Note

None.
