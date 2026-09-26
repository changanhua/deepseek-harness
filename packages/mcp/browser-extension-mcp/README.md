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

Use `browser_status` to select an installation and inspect its live declared capabilities. `browser_open_tab` is available only when the connected executor declares both `targetFreeOpen: true` and `tab_open`; it creates one background tab at an HTTP(S) URL and returns only `{ opened, tab: { tabId, windowId, browserSessionId } }`. Supply a new UUID v4 `requestId` and keep it for recovery. The call does not wait for the DOM and returns no PageRef: use `browser_tabs` to confirm the current URL, then pass that complete tab reference to the first `browser_read_page` as `expectedTab` to obtain the page/document and element references for later reads or actions. The reference survives an extension worker restart but becomes stale after browser or extension restart. Actions support scrolling, navigation, clicking, filling, and pressing keys. Verify changes with a fresh read. The extension shares its execution journal across DSH and Codex, so an unresolved write on one tab blocks conflicting writes from either caller.

Reads preserve original loaded text and its truncation indicators. Tree cursors paginate nodes in one document; long individual nodes can be shortened. A finished traversal does not prove that hidden or unloaded source content was read. A changed page rejects the read rather than returning content from a different target.

Unknown actions may have happened. `browser_request_status` never replays an action. For an opening request, reuse the same caller-supplied UUID v4 with the same URL while its 60-second relay receipt is retained; a different owner or payload receives `request_conflict`. After relay retention is absent, the relay can ask an executor that declares restart status lookup to read its extension journal, without executing the action again. A restarted MCP process has a new task identity and cannot recover a prior task's receipt. The extension's unresolved-write protection remains authoritative.

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
