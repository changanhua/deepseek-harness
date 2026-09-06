---
description: "Browser authentication, source capture, and durable command results for the Content library."
kind: "package-reference"
---

# @changanhua/dsh-content-remote

English | [中文](README.zh.md)

## Summary

Save a completed plain-text Session reply and read or edit saved content through an authenticated browser request. The Host reads the source itself and returns the committed receipt. Retain that command identity when retrying a lost response.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this service in a Cordis composition with Connection, Content and the Session source bridge. It has no configuration. The generated `./remote` export supplies the browser's Typert methods; `./typert` supplies strict Host descriptors. The service does not install a Profile or UI.

Every method, including status, requires the exact active HTTP request signal from [Connection](../../client/connection/README.md). Reads return detached content; an absent entry or receipt returns null. A null receipt means unknown, not uncommitted. Capture accepts source references only; manual text remains unverified. Typed failures carry no text, filesystem paths or credential details.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Remote derives a synchronous authorization callback from Connection's live request binding. Content repeats that callback when a queued command reaches its commit admission. Capture delegates source reading to [content-session](../content-session/README.md), then uses the same Content mutation path. An already committed write is not rolled back because its response or connection is lost.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Content definition](../content/README.md) — records, revisions and receipts.
- [Content subsystem](../../../docs/subsystems/content.md) — shared ownership.
- [Content provider](../content-domain/README.md) — persistence and failure recovery.

<a id="model-experience"></a>
## Model Experience

None, as this browser Remote registers no model tools or model context.

#### KV Cache effect

No direct effect: content requests do not invoke a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Access uses the local operator's browser credential; there is no per-project ACL or distinction between people and automation possessing the same credential.
- WebSocket and direct in-process callers have no authenticated HTTP request binding and are refused. Browser UI and shipping Profile composition are separate consumers.
- Clearing a browser cookie does not revoke a request already sent; Connection's credential activation and expiry rules apply.

<a id="dev-note"></a>
### Dev Note

None.
