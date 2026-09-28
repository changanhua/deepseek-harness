---
description: "Session-persistent BrowserTask evidence, action, resource, authority, delegation, and acceptance state."
kind: "package-reference"
---

# @changanhua/dsh-browser-task

English | [中文](README.zh.md)

## Summary

`@changanhua/dsh-browser-task` is the Session-backed domain authority for one browser task. Every closed-operation mutation writes a complete `browser-task/change` post-state; the projection can therefore replay after a Host restart without a process-local task map. A Session may start the next task only after the former task is terminal, and a durable source sequence prevents replaying the same input as a new task.

Browser lifecycle listeners apply that authority to ordinary tools, direct Provider calls, prepared commits, and Dynamic Cordis Browser calls. Each write records a `dispatch-intent` and action-free recovery locator, then flushes the Session before the Provider may send. Replay performs no Browser call. A sent unknown write remains reconcile-only; a Host-memory miss can query the extension journal by its exact locator but cannot execute the action. Deterministic failures retain a semantic fingerprint without request or mount ids. The same failing target is blocked after its first occurrence until a materially different reference or later bounded page-map evidence proves the precondition changed. Internal projection errors create an `internal-invariant` blocker instead of becoming retryable Browser failures.

The domain deliberately separates page evidence, exact target binding, action receipts, resource disposition, authority snapshots, delegation and acceptance. Evidence binds a real Session fact or Browser receipt, page target and capability epoch; page-map recovery facts retain opaque region references but no CSS selectors. Delegation facts retain canonical Subagent run, background Job, or Cordis package/run identities plus bounded output digests; a successful delegation never satisfies acceptance by itself. A `region-content` clause requires the matching render receipt and a fresh page observation of the rendered text, while completion still waits for the region's final cleanup disposition. A resource is reserved before dispatch; `delivery:not-sent` may release that reservation without pretending a page clear occurred. An ordinary entry unmount releases the visible lease while it may deliberately retain collected values; a later `forgetCollected:true` call is a separate owner-fenced finalizer and is never short-circuited merely because the visible lease is already released. Completion requires checker-backed current evidence for every clause, no unresolved writes or blockers, budgets that were never exceeded, and every page resource released or confirmed vanished. A newer direct user message may explicitly cancel the Session task only after every resource has a receipt-backed final disposition; the unknown attempt remains historical fact.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

Read-only tab discovery is independent of task page admission and remains subject to Provider authorization. It does not change task targets, capabilities, evidence, attempts or budgets. Selection receipts retain failure reasons so consumers can distinguish an obsolete browser-session reference from an uncertain operation after replay; the service never adopts a replacement identity from a tab listing.

### Task continuation

#### What the model sees

Consumers expose compact task state and evidence references, not raw page contents. A model uses `browser_task_start` and `browser_task_verify` through the consumer, rather than interacting with this kernel directly.

#### Token effect

Task state is bounded by the kernel's clause, evidence, attempt, resource, delegation, step, and action limits; raw page bodies remain outside this package's model-facing projection.

#### KV Cache effect

Stable task schema and consumer composition preserve the reusable prefix. Changed task state enters only as later consumer output.

## Known Limitations and Deferred Work

- Projection state version 11 stores BrowserTask change version 6 snapshots; older task-change formats are rejected without migration. A target-free task captures a null user-selection revision, retains a pending exact tab reference after `tab_open`, and adopts a page only from a matching main-frame snapshot. Adoption is task-local and never changes the user's Session binding.
- The standard Web composition and `tool-browser` consumer use this service, but no dedicated task-status UI renders its generic Session projection yet.
- An owner cancellation is available only after cleanup and an explicit latest direct-user marker: `[browser-task:cancel]` or `[browser-task:accept-unknown]`. The Agent must ask for that marker when an unknown browser effect needs an owner decision; it cannot infer consent from ordinary prose or assert what the effect did.
- Extension journal expiry, storage loss, an offline executor, or a mismatched locator leaves the request unknown. The task does not infer `not-sent` and does not replay the write.
- `advancePage` consumes only the canonical receipt of a settled observed attempt. It keeps installation, tab, frame, budget, attempts, and selection revision fixed; only a document-id replacement disposes old page resources. A same-document route update does not invent cleanup. The persisted target receipt is the authority for later provider reads; a rebind cannot borrow an unrelated receipt.
- Page receipts retain up to eight opener candidates in a complete observation of at most 4 KiB, including source tab, browser-session identity and truncation. Invalid observations are discarded without altering the action outcome. Replay checks the same bounded shape. Candidates may accompany an unknown action and never settle it or grant access to another page.
- Task scope is `single-tab`, `descendants`, or a fixed `explicit-set`, bounded to 32 complete tab references. `selectTarget` atomically spends one action and records the fixed snapshot request. A v3 receipt can adopt a target only after fresh full-tab verification, current authority, and replayable scope provenance; ordinary snapshots cannot select implicitly. Unknown selection reads retain their outcome even when recovery proves quiescence. Cross-page evidence never satisfies a current-page check.
- Selection does not move leases. Page-function handoff uses the current task-selected page and unchanged user-selection revision; it requires current acceptance, exact active resources, and the authenticated Cordis owner without requiring a redundant manual page pin. Exact non-transferred leases retain cleanup permission on their original page even after user selection changes; current browser grants still apply. A completed task retains read-only access to its final exact page under the unchanged user-selection revision, with no further selection or input.
- A representative DeepSeek-v4.1-flash extension acceptance completed through the configured standard Web deployment; package tests and live Session evidence remain separately owned.

<a id="dev-note"></a>
### Dev Note

The Session event types and projection fold in [source](src/index.ts) own the durable vocabulary; tool-browser only supplies the continuation and checker consumer.
