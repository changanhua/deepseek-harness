# Agent Note: Browser field operation lifecycle

Status: implemented

English | [中文](2026-09-12-browser-field-operation-lifecycle.zh.md)

## Problem

Browser tools exposed individual reads and writes but lacked a durable authority for the complete lifecycle of a field task. A model could not query an uncertain request without replaying it, a planned group of actions paid one model round trip per step, a page result panel had no shared ownership or cleanup contract across the Browser provider and a dynamic Cordis Plugin, and process-local task state could not recover after a Host restart. Tool presence alone therefore did not guarantee that recovery, page targeting, task acceptance, and retraction composed into one usable flow.

## Decision

The Browser service owns explicit request identity, executor capability declaration, exact page identity, action transport, and page-workspace actions. A request has a caller-minted id and caller-scoped retained status that is read without replay and without exposing its authority fingerprint. An online executor declares protocol version, implemented action kinds, and request recovery during its authenticated handshake. A bounded action sequence prepares and commits each action independently, preserves upload-path policy, records each result as it arrives, and stops at the first result that is not `observed`. A page workspace starts with `page_map`, whose short-lived exact-document evidence carries unique selectors and disposable/protected hints, and continues through an extension-owned `region_render` mount that `region_clear` can restore.

Region content is a bounded plain-data union rendered as text nodes; links accept only HTTP(S). The page runtime rejects ambiguous selectors and binds each mount to its Session, installation, grant epoch, and page identity. Replace mode moves the selected region's child nodes aside rather than destroying them, and the Host accepts it only for mapped disposable, non-protected regions. The Host reserves shared region capacity before dispatch, while the dynamic Cordis runner owns every region created by one activation and attempts restoration during stop, update, startup failure, and undefine. An unknown render or clear stays in the pending cleanup set instead of becoming proof that no page effect exists. `document_replaced` records a vanished resource; `target_url_stale` does not.

`@changanhua/dsh-browser-task` owns the Session-persistent field-task projection. It separates immutable evidence and target binding, action attempts and receipts, page-resource leases, capability snapshots, delegation facts, and acceptance checks. Its completion rule accepts no observed action, delegated run, or rendered panel by itself: every clause needs checker-backed current evidence, there can be no blocker or unresolved write, budgets remain available, and each resource is released or proven vanished with a matching receipt. V1 rejects retained resources; explicit Session/user ownership transfer is deferred. The tool-browser loop is a stateless continuation and checker facade over that projection; it never becomes a second task authority.

The five model tools are `browser_request_status`, `browser_action_sequence`, `browser_page_map`, `browser_region_render`, and `browser_region_clear`. The dynamic Plugin facade exposes the same page-workspace flow as `harness.browser.pageMap`, `render`, and `restore`; it does not create a second page protocol.

## Alternatives considered

**Add only model-facing tools.** This would make schemas visible while leaving dynamic Cordis Plugins unable to own and retract the same region resources, which is the runtime path used for persistent in-page adaptations.

**Let one region selector target every match.** This makes short selectors convenient but turns a single intended sidebar into duplicate or destructive mounts. `page_map` returns unique selectors, and rendering rejects ambiguity.

**Treat stop or timeout as successful cleanup.** A request can cross the extension boundary before its receipt is lost. Pending cleanup therefore survives an unknown outcome and blocks unsafe rebinding until a later clear is observed.

**Persist page-region state as durable product data.** A region belongs to one live document and extension runtime. Durable storage would outlive the object it identifies and still could not restore a replaced document after browser or Host loss, so this decision keeps the resource process-local and makes that limitation explicit.

## Consequences

The field agent has one durable recovery, page-workspace, and acceptance lifecycle instead of unrelated helper calls. Fewer model round trips do not bypass preparation, authorization, stale-page checks, upload provenance, or planned-before-dispatch receipts. Dynamic Plugin teardown returns cleanup-pending identities when restoration is unresolved. Page maps and region state remain bounded in memory: a document replacement clears the page-side mount, while a simultaneous Host or extension restart can leave no owner able to prove restoration and requires fresh observation rather than a retry claim. An executor capability or target change blocks ordinary writes until the Session projection records the recovery decision.

## Verification

Focused provider, page-runtime, tool, runner, and browser-task tests exercise request recovery, evidence-bound replacement, capacity reservation, stale-target resource disposition, Session replay, checker-backed completion, and runner cleanup. A representative live field task driven by DeepSeek-v4.1-flash remains an explicit acceptance gap; package and fixture checks do not claim that model behavior has passed.
