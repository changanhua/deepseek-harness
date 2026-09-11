# Agent Note: Browser content import

Status: implemented

English | [中文](2026-09-07-browser-content-import.zh.md)

## Problem

People need to preserve useful material from an open webpage in the existing Content library without pasting it by hand. A browser extension can see page content that the DSH Host cannot, but it must not inherit the Web session, expose durable credentials to page scripts, or create a second content store. The same connection model also needs to remain valid when DSH runs on the local machine, a LAN Host, or a remote server.

## Decision

[Browser execution authority](../architecture/2026-09-08-browser-execution-authority.md) owns the separate browser-operation grant and restart-safe execution journal. This import decision remains the owner of Content data and `content:import`; it does not authorize page actions.

The Chromium extension captures the current text selection on a generic page, one completed assistant reply on ChatGPT, or one expanded answer on Zhihu. It sends text, title, URL, site, capture time, scope, and an optional external message identity to the `@changanhua/dsh-content-browser` Host bridge. Content persists the body and an explicitly unverified `web-page` source in one `save-text` operation. A UUID capture identity maps to both `web:<captureId>` and the operation ID, so a lost response can be retried without creating a duplicate.

Each extension installation creates its own connection request using a retained verifier and a SHA-256 challenge. Opening the request in the signed-in Web application only displays the request; the user must approve it. The bridge exchanges the verifier for a bearer capability scoped to `content:import`, stores only a strict versioned token hash in the credentials provider, and returns secrets only to the exact extension Origin. Content scripts and the side panel never receive the capability. Revocation, replacement, request abort, and service disposal invalidate admitted imports again before Content commits them.

The extension accepts an HTTP(S) origin root as its DSH address. The protocol therefore works with a local, LAN, or server Host under the same contract. Deployment path prefixes are outside the current route shape, and remote operators own trusted authority and transport security. Pending handshakes stay in Host memory; approved grants, import receipts, and Content entries use their owning providers' persistence.

The extraction scope is deliberately small. Adapters beyond ChatGPT replies and Zhihu answers, automatic crawling, full-page cleaning, remote source fetching, semantic processing, synchronization, and automatic trust elevation remain outside this feature. Future adapters can add capture shapes behind the same versioned import boundary without changing Content ownership or the installation capability model.

Everyday capture happens beside the selected material or through the selection context menu. The single side panel owns reading previews and recovery; settings are secondary, with a remembered default of localhost port 3080. A trusted extension controller persists one pending snapshot before authorization or transmission. An attempted request remains immutable until its durable result is known; an unsent draft can be explicitly discarded. Connection recovery alone never starts an upload. Bounded receipt links let earlier page buttons open their saved entries without caching a second library.

## Verification

Automated browser acceptance drives the unpacked extension, built Web application, approval UI, generic selection and ChatGPT-shaped single-reply fixtures through import, editing, Host restart and grant revocation. Manual acceptance also exercises the installed extension on a live ChatGPT conversation and an ordinary webpage, including preview, import and opening the saved Content entry. A remote HTTPS deployment remains unverified.

## Alternatives considered

**Reuse the signed-in Web session from the extension.** This would couple the extension to browser cookies and give imported page code a larger authority boundary. A separate installation capability makes approval and revocation explicit and limits the credential to content import.

**Run a localhost-only native helper.** A native helper would make local DSH convenient but would split the product when DSH moves to a LAN or server. An HTTP(S) Host bridge keeps one connection contract for all three placements.

**Let the Host fetch and extract every URL.** Authenticated pages, dynamic views, and the user's current selection often do not exist in a server fetch. The extension owns extraction; the Host records the supplied source as unverified.

**Create a browser-specific content store.** A second store would fragment search, reading, persistence, and retry behavior. Browser imports enter the existing Content domain through its public mutation.

**Require a preview form for every capture.** Reading a page already supplies the common-case content review. Inline actions and sensible defaults preserve the reading flow; the side panel remains available when scope, title or recovery needs attention.

## Consequences

The shipped vertical proves explicit connection approval, durable import, Host restart recovery, generic selection capture, ChatGPT single-reply capture, Content editing, and grant revocation with the actual extension and Web UI. It buys one Content library and one connection protocol across Host placements. It also accepts that captured text is user-agent supplied, remote security depends on deployment configuration, pending approvals must restart after a Host restart, and new site adapters require their own DOM compatibility evidence.
