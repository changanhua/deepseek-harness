---
description: "Content library browser package for users capturing a completed plain-text assistant reply, editing drafts, committing versions, and reading the committed library."
kind: "package-reference"
---

# @changanhua/dsh-client-ui-content

English | [中文](README.zh.md)

## Summary

This package gives the Web application the content-library surface over the personal Content Host stack: a per-message capture entry in the assistant-action strip, a persistent sidebar entry, and a library workspace with editing. A user captures a completed, pure-text assistant reply or creates a manual entry; the entry lands in the library, where it can be edited as a draft, committed as an immutable version, favorited, and archived. The Host owns idempotency, source verification, and revisions, so repeated captures and reconnects cannot produce duplicates or lost updates on this surface.

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

Mount the browser package in a Client composition that exposes `contentRemote`, `contentBrowser` and the content medium behind them.

### When to choose it

Choose it for a Web surface whose composition mounts the content stack (`content-sqlite`, `content-domain`, `content-session`, `content-remote`) and where users should capture their own assistant replies. Omit it from Client compositions without the `contentRemote` Remote; the workspace then has no data source.

### Minimal configuration

```yaml
- name: '@changanhua/dsh-client-ui-content'
```

The package has no browser configuration. Its `dsh.client.inject` declaration requires the Remote assembly, locale, Chat, Conversation, layout, renderer, and sidebar packages; its Cordis body requires the slot registry, layout, both Content Remote namespaces and the locale service.

Browser imports show their website title, link and unverified provenance. The extension opens `/#content-entry=<entryId>` to refresh and select the saved entry. `/#extension-connect=<requestId>` opens an explicit approval dialog; visiting the URL does not grant access. **Browser connections** lists installations and permits revocation. [The browser bridge](../../content/content-browser/README.md) owns the authorization protocol.

Open **Content Library** from the persistent sidebar to read committed entries; click **Capture to library** in an assistant reply's action strip to capture that message. A captured message shows a pressed state with its entry id; clicking again replays the original creation receipt instead of duplicating the entry.

**New entry** creates a manual entry whose text lives in a first draft. **Edit** opens an entry in the editor: **Save draft** writes the working text, and **Commit version** folds the draft into a new immutable version. **Favorite** and **Archive** toggle the entry's metadata. When a save or commit arrives on a stale revision — another window edited the same entry — the editor re-reads the entry and shows both sides; **Keep my edit** retries the next save on the fresh base, and **Use library content** resets the editor to the re-read text.

**Save draft** is disabled until the text changes. A conflict blocks saving and committing until a side is chosen. The detail pane can add or remove project references; failed edit and metadata actions show localized errors. Metadata conflicts require **Reload entry** before another attempt and never retry automatically. Only one write per entry and one capture per page can run at a time.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One `ContentLibraryStore` per plugin fiber backs the workspace, the editor, and every capture entry. The load lane runs status then snapshot on one AbortSignal-backed lane, publishes Host phases verbatim (opening, unavailable, closed), and collapses concurrent refreshes. Each capture attempt mints a fresh `capture-ui:<sessionId>:<seq>:<nonce>` operation id, sends only that id plus the session id and the assistant message's event sequence, deduplicates concurrent clicks onto the in-flight attempt, and re-reads the snapshot after success. Button visibility is decided by a pure selection over the Chat projection (`AssistantMessageNode`): a durable message id, no interruption, and every block plain text with at least one non-blank character.

Editing and metadata share one `execute` lane per entry. Creating mints an `idea-ui:<nonce>` entry id; saving drafts and committing versions carry the Host-returned guard revisions. Each committed command invalidates earlier reads and awaits a new snapshot before returning; an unreadable baseline remains a visible failure. A `revision_conflict` re-reads the contested entry and marks an open editor conflicted without replacing its local text. Lost transport is reconciled through `receipt`. Navigation invalidates pending editor-opening results, and plugin disposal aborts all requests and prevents publication. The editor's title and body remain component-local state.

The exact owners are [`src/client/capture-target.ts`](src/client/capture-target.ts), [`src/client/controller.ts`](src/client/controller.ts), [`src/client/EntryEditor.tsx`](src/client/EntryEditor.tsx), [`src/client/CaptureAction.tsx`](src/client/CaptureAction.tsx), and [`src/client/ContentLibraryWorkspace.tsx`](src/client/ContentLibraryWorkspace.tsx).

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

- **Entry titles come from the Host** — a capture has no user-visible title until the Host records one; the row falls back to the head version's title, which may be empty for fresh captures.
- **Plain text only** — reasoning, tool calls, images, mixed blocks, and interrupted prefixes are never capturable, matching the Host source resolver; there is no partial capture.
- **No cross-surface capture status** — a page reload clears the pressed state; the library itself is authoritative, and a later capture of the same source replays the original creation receipt.
- **Editor text is page-local** — an in-progress draft title or body lives in the editor component; a reload discards it. Persisted drafts and versions stay on the Host.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The personal content stack is mounted by the `dsh-web-app` bundle; this package is its browser half. Browser e2e lives in `apps/web/tests/content-capture.e2e.ts` and `apps/web/tests/content-edit.e2e.ts`; `apps/web/tests/content-restart.e2e.ts` checks capture, drafts, versions and metadata across built `dsh web` restarts. The HTTP composed lane lives in `apps/cli/tests/content-capture-composed.e2e.ts`.

</details>
