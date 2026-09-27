---
description: "Use the browser extension from Codex without running a DSH Host."
kind: "package-reference"
---

# @changanhua/browser-extension-mcp

English | [中文](README.zh.md)

## Use the connector

This standalone MCP application connects Codex to the DSH browser extension through a small local relay. It imports no Harness runtime, starts no DSH Profile, and calls no model. DSH can use its existing connection to the same extension independently.

Install the built package in a stable local directory and register its absolute `lib/startup.js` with `codex mcp add browser-extension -- node <entry>`. Configuration lives at `~/.browser-connector/config.json`, overridable with `BROWSER_CONNECTOR_CONFIG`. Set `port` to an available fixed port (3091 by default), `extensionIds` to the installed extension IDs trusted by this user, and `secret` to 32 random bytes encoded as unpadded base64url. Keep the secret local; browser tools never return it.

Reload the unpacked browser extension, open its settings, and select “连接 Codex”. Its local address defaults to `http://127.0.0.1:3091`. Browser site permissions still apply. This one-time setup uses standing read/write consent and does not ask for approval on every call. The existing DSH connection has separate credentials and state.

The stdio entry exposes tools immediately. It starts the local relay independently when configuration is available. Multiple Codex tasks share the relay, each with a different request owner; closing a task does not stop it. The relay listens only on loopback. Extension connections require an explicitly trusted extension Origin, and local MCP calls use the configuration secret. Failure to connect affects tool results, not tool discovery. This external MCP application has no Cordis registrations and therefore publishes no Cordis invariant companion.

## Browser work

`browser_status` reports `connector.mcp` and `connector.relay` separately: each includes its package version, protocol version, loaded module path, process ID, and component start time. Each online installation reports the version from its browser manifest as `runtime.version`. Extension and connector versions use independent numbering. `issues` identifies unknown runtime information, differing connector versions, disconnected installations, and unavailable target-free opening. Missing metadata never proves that an installation is outdated. When the relay is unavailable, the tool error still includes the MCP identity. These diagnostics contain no configuration secrets and do not change execution permission.

Use the reported component and module path to locate an installation problem before updating it. Reloading Chrome's extension changes neither the active MCP process nor the relay. A source edit or build does not update an already loaded process. Runtime diagnostics do not switch releases, reconnect clients, or restart processes. The extension reports the same metadata to both connections; deploy a matching DSH gateway when updating the extension. Pre-release combinations with older DSH gateways are not supported.

Use `browser_status` to select an installation and inspect its live declared capabilities. `browser_open_tab` is available only when the connected executor declares both `targetFreeOpen: true` and `tab_open`; it creates one background tab at an HTTP(S) URL and returns only `{ opened, tab: { tabId, windowId, browserSessionId } }`. Supply a new UUID v4 `requestId` and keep it for recovery. The call does not wait for the DOM and returns no PageRef: use `browser_tabs` to confirm the current URL, then pass that complete tab reference to the first `browser_read_page` as `expectedTab` to obtain the page/document and element references for later reads or actions. The reference survives an extension worker restart but becomes stale after browser or extension restart. Actions support scrolling, navigation, clicking, filling, and pressing keys. Verify changes with a fresh read. The extension shares its execution journal across DSH and Codex, so an unresolved write on one tab blocks conflicting writes from either caller.

Reads preserve original loaded text and its truncation indicators. Tree cursors paginate nodes in one document; long individual nodes can be shortened. A finished traversal does not prove that hidden or unloaded source content was read. A changed page rejects the read rather than returning content from a different target.

In a control snapshot, `query` filters controls by label, text, context, role, placeholder or title; it does not search input values or all page prose. Its `text` and `structure` cover the returned controls' nearest local containers (`textScope: matched-controls`), with empty text when no controls match. `offset` pages controls and their local content. Omit `query` for whole-page text (`textScope: page`); use `structure: false` to omit region/list summaries. `textTruncated`, `elementsTruncated` and `scanTruncated` describe separate incomplete reads; a local or empty result is not evidence of whole-page absence.

Use `includeValues: true` for submission checks. Returned input/textarea controls include the current `value`, preserving whitespace and newlines, and `valueTruncated`. Values share a 16,384-character budget per read; narrow `query` or page controls when that budget truncates another field. Password, file and hidden inputs, and fields marked by credential, verification-code or payment autocomplete tokens, return no value (`valueRedacted: true`). Unmarked text fields can still contain sensitive data; request values only for the intended form. Default reads and tree mode omit values. Never treat an absent, redacted or truncated value as a verified empty field.

For a stable form, reuse one snapshot's exact references for sequential fills or fill followed by a key press. References expire after 60 seconds, can be evicted after further reads, and are rejected if URL, document or control identity changes; a value-only change does not invalidate them. Read the completed form with values before submitting once, then read the resulting item to verify success. `sameTab.kind: unchanged` describes page identity and can accompany a modal or content update; an observed input alone does not establish business success.

When checking GitHub Issue duplicates, search the requested repository with `is:issue in:title "<title>"`, without an open/closed filter, then compare each returned full title. Search a distinctive title fragment if tokenization is uncertain. A read-page `query` filters the already-loaded controls; it does not execute GitHub search. If submission becomes unknown, query its original request status and inspect the current page before any further action.

Unknown actions may have happened. `browser_request_status` never replays an action. For an opening request, reuse the same caller-supplied UUID v4 with the same URL while its 60-second relay receipt is retained; a different owner or payload receives `request_conflict`. After relay retention is absent, the relay can ask an executor that declares restart status lookup to read its extension journal, without executing the action again. A restarted MCP process has a new task identity and cannot recover a prior task's receipt. The extension's unresolved-write protection remains authoritative.

The MCP reserves each execution's request ID before sending it to the relay. If the reply is lost or cannot be returned, the tool retains the connection's session, installation and request ID in an `unknown` result with `quiescent: false`, alongside the connection error. Use `browser_request_status` with that ID; a transport error does not prove the input was not executed or has stopped. This recovery requires the same MCP owner and does not survive replacement of the MCP process.

## Model Experience

### What the model sees

Seven stable tools provide status, target-free tab opening, tabs, page reads, screenshots, actions, and request status. Original webpage content is untrusted source data. No DSH Session or Flash summary is used.

### Token effect

Tools add only their called results. Text defaults to 16,000 characters with a 50,000-character maximum; JSON tool results reject values over 256 KiB. Screenshots use MCP image content instead of embedding base64 in text.

### KV Cache effect

The tool catalog is static. Reads append new observations without rewriting prior results.

## Known Limitations and Deferred Work

- The extension's chat and reading UI still use DSH models. Codex analysis is initiated in Codex.
- Collapsed or unloaded content requires explicit browser actions followed by another read.
- Long DOM nodes can be shortened; results do not promise a lossless page export.
- A missing or restarted browser can leave sent actions unknown. Such actions are never automatically repeated.
- Opening a tab does not observe its loaded document. Confirm the tab URL and read it before using page actions.
- A page-bound `tab_open` validates its source page and still returns a complete background `TabRef`. Transition candidates remain observations; neither an opener relationship nor an observed navigation proves the input's effect or business success.
