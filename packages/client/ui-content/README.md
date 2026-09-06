---
description: "Content library browser package for users capturing a completed plain-text assistant reply and reading the committed library."
kind: "package-reference"
---

# @changanhua/dsh-client-ui-content

English | [中文](README.zh.md)

## Summary

This package gives the Web application the content-library surface over the personal Content Host stack: a per-message capture entry in the assistant-action strip, a persistent sidebar entry, and a read-only library workspace. A user captures a completed, pure-text assistant reply; the entry lands in the library, where its committed title, badges, and head body can be read. The Host owns idempotency, source verification, and revisions, so repeated captures and reconnects cannot produce duplicates or lost updates on this surface.

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

Mount the browser package in a Client composition that also exposes the `contentRemote` Host Remote and the content medium behind it.

### When to choose it

Choose it for a Web surface whose composition mounts the content stack (`content-sqlite`, `content-domain`, `content-session`, `content-remote`) and where users should capture their own assistant replies. Omit it from Client compositions without the `contentRemote` Remote; the workspace then has no data source.

### Minimal configuration

```yaml
- name: '@changanhua/dsh-client-ui-content'
```

The package has no browser configuration. Its `dsh.client.inject` declaration requires the Remote assembly, locale, Chat, Conversation, layout, renderer, and sidebar packages; its Cordis body requires the slot registry, the `contentRemote` namespace, and the locale service.

Open **Content Library** from the persistent sidebar to read committed entries; click **Capture to library** in an assistant reply's action strip to capture that message. A captured message shows a pressed state with its entry id; clicking again replays the original creation receipt instead of duplicating the entry.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One `ContentLibraryStore` per plugin fiber backs the workspace and every capture entry. The load lane runs status then snapshot on one AbortSignal-backed lane, publishes Host phases verbatim (opening, unavailable, closed), and collapses concurrent refreshes. Each capture attempt mints a fresh `capture-ui:<sessionId>:<seq>:<nonce>` operation id, sends only that id plus the session id and the assistant message's event sequence, deduplicates concurrent clicks onto the in-flight attempt, and re-reads the snapshot after success. Button visibility is decided by a pure selection over the Chat projection (`AssistantMessageNode`): a durable message id, no interruption, and every block plain text with at least one non-blank character.

The exact owners are [`src/client/capture-target.ts`](src/client/capture-target.ts), [`src/client/controller.ts`](src/client/controller.ts), [`src/client/CaptureAction.tsx`](src/client/CaptureAction.tsx), and [`src/client/ContentLibraryWorkspace.tsx`](src/client/ContentLibraryWorkspace.tsx).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Content definition package](../../content/content/README.md) — the durable commands, receipts, and error codes this surface renders.
- [Content Remote](../../content/content-remote/README.md) — the authenticated namespace this package consumes.
- [Slots subsystem](../../../docs/subsystems/slots.md) — the assistant-actions, shell view, and sidebar insertion points.
- [Web client subsystem](../../../docs/subsystems/web-client.md) — dynamic Client package loading.

-----

<a id="model-experience"></a>
## Model Experience

None, as this browser capture entry and read-only library view register no model-facing Tool, prompt section, or Session event; captured text never enters model context or telemetry.

#### KV Cache effect

None; captures and library reads never enter model context or start a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Read-only library** — the workspace lists and reads entries; draft editing, version commits, and metadata commands are deferred to the next increment and are not reachable from this surface.
- **Entry titles come from the Host** — a capture has no user-visible title until the Host records one; the row falls back to the head version's title, which may be empty for fresh captures.
- **Plain text only** — reasoning, tool calls, images, mixed blocks, and interrupted prefixes are never capturable, matching the Host source resolver; there is no partial capture.
- **No cross-surface capture status** — a page reload clears the pressed state; the library itself is authoritative, and a later capture of the same source replays the original creation receipt.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The personal content stack is mounted by the `dsh-web-app` bundle; this package is the browser half only. The browser e2e lives at `apps/web/tests/content-capture.e2e.ts`, and the HTTP composed lane at `apps/cli/tests/content-capture-composed.e2e.ts`.

</details>
