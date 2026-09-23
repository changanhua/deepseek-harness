# Browser Assistant V2 Implementation Plan

English | [中文](2026-09-20-browser-assistant-v2.zh.md)

**Goal / DoD:** Deliver the accepted personal extension: independent home, explicit conversation choice, a pinned target shared by Browser tools and Cordis, evidence-backed page cognition, and usable global/page functions that survive a new conversation. Completion requires the real extension and model path, not the HTML prototype.

**Architecture:** Adapt existing extension controllers, Browser/BrowserTask and Dynamic Cordis. The Host owns execution identity and lifecycle; Chrome owns surface selection and drafts; UI renders projections. No second browser task engine or general-purpose function registry.

**Dependencies:** Windows/PowerShell, current checkout and dependencies, connected Chrome extension, and the configured DeepSeek V4.1 Flash route. Ordinary Codex development is not DSH self-development; DSH performs browser tasks for acceptance, not source edits or self-certification.

**Real Acceptance Path:** After session/target wiring, pin page A, browse B, and ask about A through the extension. Then create, use, modify and stop a real page function; open a new conversation between creation and stop. Independently inspect the affected DOM, model request route, receipts and resource ownership.

**Broad Verification Budget:** One complete `pnpm run build` and `pnpm run build:chrome-extension` for the first live slice; one final rebuild only if later source changed. At final freeze run the affected suites, `pnpm run lint:contracts-ready`, `pnpm run test:docs` and `pnpm run doc-sync` once. Runtime duration is not yet measured. Reuse unchanged evidence; rerun only the failed or changed owner. No full repository test loop.

## Baseline and handoff

This is an implementation plan, not a shipped capability reference. Checkout: `C:\Users\xbh\deepseek-harness`, branch `master`, HEAD `0e23e42b68da6cc65c41aba15cf23ebcd1896a89`. Initial binary diff hash: `546e01fa87f27fc3d3f204c38cdbbf8e8ee22fb5`. A changed HEAD does not invalidate the product decisions, but does require a relevant diff check before reusing source evidence.

Accepted visual source: `C:\Users\xbh\.codex\visualizations\2026\09\16\01a0aae0-e995-7ae3-9f8b-5956317badf7\dsh-browser-assistant-v2.html`; SHA256 `95DF8B40CFDEC428CC0A7AB3D1947DEB046DF782BD0B6F73574D2A2AE5DC659E`. Keep its visual hierarchy and interactions; replace simulated state, replies and functions with real adapters.

Existing dirty files are protected: `packages/browser/browser-extension/tests/{gateway,grants}.spec.ts`, `packages/browser/browser-task/tests/browser-task.spec.ts`, `packages/browser/tool-browser/src/schema.ts`, and `packages/browser/tool-browser/tests/{diagnostics,loop,policy}.spec.ts`. Add focused sibling specs where possible. Read and preserve overlapping hunks; do not stage or revert unrelated work.

Baseline command executed on 2026-09-20: `pnpm run test -- apps/chrome-extension/tests/assistant-session.spec.ts apps/chrome-extension/tests/assistant-surfaces.spec.ts apps/chrome-extension/tests/sidebar.spec.ts` — 3 files, 41 tests passed, 12.35 seconds. These old tests do not cover V2 acceptance. The existing build record names `a7cbead` and was not revalidated; it is not evidence for this candidate.

Delivery mode is `governed`. Astra owns this handoff and boundary decisions; Sol owns subsequent implementation and integration. Terra owns the bounded UI lane. No new GitHub Issue, PR, push, runtime replacement or background monitor is authorized by this plan.

## Frozen product decisions

| ID | Observable requirement | Owner / evidence |
| --- | --- | --- |
| R1 | Home works without a page; conversation/new/history remain user choices; main navigation is Chat / Page cognition / Functions. | I2 / real UI |
| R2 | Pin and switch a target; browsing other tabs never changes it; both Browser and Cordis obey it. | I1, I3 / A-B wrong-tab negative test |
| R3 | Group cognition by exact page document and present it as a semantic atlas. Show only content/DOM actually supplied to the agent, with provenance, time, coverage and omissions. Pinning reads no body. Minor DOM changes do not refresh cognition. | I4 / log-to-UI comparison and read counters |
| R4 | Global/page functions have real open, run, stop, details and natural-language edit paths. A new conversation does not destroy them. | I5 / independent DOM and lifecycle observations |
| R5 | Streams, edits, reconnects and multiple surfaces do not duplicate messages, redirect drafts or replay unknown submissions. Preserve model selection and image attachments. | I1, I2 / reducer and integration tests |
| R6 | Accepted behavior comes from the exact built extension/Host and actual model route, with five evidence layers and independent review. | I6 / acceptance ledger |

Capture, monitoring and Independent Reading leave the main experience; their backend/data are not deleted. Exclude multi-page task orchestration, automatic DOM polling, a new authorization wizard, new capacity knobs, cross-process function persistence and automatic page reinjection. Global visibility is not global browser authority.

## Shared contracts

### Conversation and target

A surface gets its own opaque identity and selection/draft state, scoped to connection origin and installation. A Session target is Host-owned, revisioned and shared by surfaces that explicitly select that Session. Each send carries the expected Session and target revision; mismatch rejects locally or at admission without redirecting content. A new conversation starts without a target. Do not create a Session merely to show home.

Pinning selects a stable tab, not an eternally valid document. Resolve the current document/frame identity at operation admission and enforce it at dispatch. Navigation invalidates old element/region references, not the user's tab choice. Tab close becomes unavailable; never fall back to the foreground tab. An in-flight operation retains its captured target; switching cannot retarget an already sent write.

Binding is not a read, browser permission or acceptance proof. Record model-visible target facts through the existing durable Session path. Reuse BrowserTask exact-target and request-reconciliation invariants; do not enforce target correctness only in a prompt.

### Page cognition

The Host projects successful, committed tool results or explicitly submitted context; pending captures are not cognition. Each item identifies Session, source event/request, target/document, observation time, actual read mode, included ranges/nodes and truncation/omissions. Keep snapshot/tree cursors within their real validity; do not claim a complete DOM from a paginated fragment or infer known content from the URL.

Cognition is per Session and exact document. First page-dependent questions may trigger a bounded read; generic chat does not. Later questions reuse evidence unless new information is needed. Manual refresh requests a real model-visible read. Likes and small mutations cause no polling, hashing or model call. Keep the last observation after navigation, labelled as an earlier document, without treating its locators as live.

### User functions and temporary resources

A function has a stable identity, origin Session/plugin/version/run identity, global or exact-page scope, purpose and truthful run/render/cleanup state. Global/page are discovery scopes; the original execution authority remains fenced. Function stop is distinct from stopping a conversation. Updating a function settles its old run before installing a new run.

Separate a creation task's temporary execution resources from its delivered function resources. Only a checked, exact resource handoff to a live function owner may remove that creation task's cleanup obligation. A bare `retained` state, UI checkbox or model assertion cannot complete a task. The recipient retains stop/reconcile responsibility; unknown writes and cleanup remain unresolved until observed. Never broaden detached cleanup into arbitrary detached execution.

V1 survival is across turns, panel reopen and new conversations within one Host process. Explicitly delivered functions are promoted inside the existing Cordis registry to the authenticated personal installation owner; `createdBySessionId` remains audit provenance, not their destruction trigger. Non-delivered plugins keep their current Agent ownership. Original Agent disposal must not destroy a promoted function. Host loss is not restart persistence; navigation/document loss requires explicit rerun with fresh references, never automatic injection.

Each explicit user function command is admitted by the existing authenticated extension channel and names the exact function/version. A new run or natural-language edit captures the current live Agent/Session and its freshly validated target authority; old runs keep their original cleanup ledger. Cross-Session visibility alone grants nothing. Do not fabricate the old Agent as live or let model-supplied owner/Session strings mint control. No new consent dialog is needed for this same personal installation.

### UI adapter

Sol owns a single view-model adapter in `apps/chrome-extension/src/assistant-view.js` and its tests. It exports a documented state with `surface`, `session`, `target`, `cognition` and `functions` sections; `session` includes normalized transcript/history/model selection, and functions are Cordis deliverables, not settings cards. Terra consumes this projection and dispatches commands; no Host lifecycle policy lives in rendering code.

Commands cover session create/select/stop/history, target pin/select/clear, send with attachments, cognition refresh/locate, function open/run/stop/edit/details and existing connection/model settings. Sol freezes concrete JS payloads and fixtures in I1 before Terra starts I2. Transport failures preserve typed errors and request identity; no optimistic success state substitutes for a receipt.

Freeze `function/edit` as `{ type, requestId, functionId, expectedVersion, sessionId, expectedTargetRevision, instruction }`. Page edits require the matching target revision; global edits use `null` and confer no Browser access. The authenticated channel derives installation ownership and the Host resolves the current live Agent from the checked Session; neither owner nor Agent identity is accepted as caller authority. Stale version/target rejects before model execution. The exact selected function reference is logged with the admitted user instruction. Run uses the same identity envelope; stop addresses the captured run and its original cleanup target, not the newly selected page.

The function snapshot is `{ availability, items }`, where availability is `unavailable`, `loading` or `ready`; items come only from the authenticated Host inventory and carry exact function/version/run identity, scope and observed execution/render/cleanup state. Before I5 the production adapter reports `unavailable` with no items. I1's running/cleanup fixtures are tests only; I2 must not ship them as fallback data.

## Delivery DAG and ownership

`I1 → (I2 UI in parallel with I3 Host target) → early real A/B slice → I4 cognition → I5 delivered functions → I6 final acceptance`. I5's lifecycle contract is serial Sol work; UI controls consume it afterwards. These are local task IDs, not GitHub Issues.

### I1 — Conversation and adapter foundation (Sol)

Role: consumer. Modify `apps/chrome-extension/src/{assistant-session,assistant-runtime,assistant-surfaces,worker}.js`; create `assistant-view.js` and `apps/chrome-extension/tests/assistant-view.spec.ts`. The existing worker broadcasts the adapter's real state to the sidebar and standalone surfaces. Update owning session/surfaces/channel tests only where affected. First write RED tests for surface-isolated drafts, send-time Session/revision mismatch, replacement semantics and gap resync. Reuse the formal Host `assistant-stream` contract, including its live baseline; retain visible settled content during bounded resync. Unknown pending sends are status-reconciled, never submitted again.

Completion: run the baseline command plus `pnpm run test -- apps/chrome-extension/tests/assistant-view.spec.ts`; publish concrete adapter fixtures for unread/read/streaming/offline/function-running/cleanup-pending states. If formal stream code is changed, include `packages/api/session-controller/tests/assistant-stream.host.spec.ts` and `packages/api/session-controller/tests/assistant-stream.client.spec.ts`. This closes neither target enforcement nor V2.

### I2 — Accepted UI (Terra)

Role: consumer; depends on I1. Exclusive files: `apps/chrome-extension/sidebar.html`, `src/sidebar.js`, `src/sidebar.css`, `tests/sidebar.spec.ts` under that app. Port the accepted layout, target controls, cognition and global/page function tabs. Keep drafts, attachments, keyboard behavior, accessible names and existing model selection. Remove capture/monitor/reading primary navigation without deleting underlying modules or retained data. Render unsupported or unavailable operations explicitly; no hard-coded demo successes.

Completion: RED/PASS with `pnpm run test -- apps/chrome-extension/tests/sidebar.spec.ts`; verify all adapter commands and empty/error states. Terra returns the bounded diff and command results, not a feature-complete claim. Sol owns adapter integration and updates outdated navigation expectations in `tests/sidebar-{activity,monitors}.spec.ts` without dropping backend tests.

### I3 — Common target enforcement and first real slice (Sol)

Role: bridge; depends on I1 and integrates I2. Own `packages/browser/browser-task/src/{types,domain,fold,index}.ts`, `packages/browser/browser-extension/src/{types,index,sessions}.ts`, `packages/browser/tool-browser/src/{loop,index}.ts` and the Cordis browser facade in `packages/extensions/cordis-host-runner/src/index.ts`. Add `target-binding.spec.ts` beside Browser-extension tests rather than overwriting protected WIP. The Host binding owner is BrowserTask's Session projection, independent of any single task; both callers consume it. Enforce the Session target for ordinary reads/actions and Cordis, including background tabs, stale documents and switching races. Keep Browser permissions and existing personal-local trust behavior unchanged. Do not introduce a Host-global selected tab that can redirect another Session.

Compose a dedicated `packages/preset/agent-presets/presets/browser-assistant/agent.cordis.yml` with both existing Browser and Cordis tools, and select it explicitly on extension Session creation through `sessions.ts`. Keep standard/cordis presets unchanged. Extend `packages/preset/agent-presets/tests/composition-inventory.spec.ts` and `packages/browser/browser-extension/tests/sessions.spec.ts`. Existing Sessions keep their preset; show an explicit capability mismatch rather than silently replacing it. This composition belongs before the first real slice, not at final acceptance.

Completion: focused target RED/PASS, then a complete build and extension build. Preflight the actual runtime identity before using it. Pin A and browse B; send a real page question and perform a reversible in-page action on A. Independently observe zero action on B and match the exact document in Session/tool receipts. Run this before broad hardening. A failed slice triggers narrow diagnosis, not another full suite.

### I4 — Evidence-backed page cognition (Sol, then Terra rendering)

Role: consumer; depends on I3. Implement the [semantic page atlas plan](2026-09-21-browser-assistant-semantic-page-atlas.md) through its P0–P4 sequence. `apps/chrome-extension/src/assistant-cognition.js` and its tests own deterministic page/region/coverage projection; `assistant-runtime.js` and the I1 adapter carry that state and own the existing refresh/location command receivers. Source committed Browser snapshots, page maps, bounded collection extraction and explicitly admitted context. Add the minimum Host projection only when the existing bounded follow window cannot supply the source; do not read pages from the renderer or persist a second full DOM database.

Completion: `pnpm run test -- apps/chrome-extension/tests/assistant-cognition.spec.ts apps/chrome-extension/tests/browser-dom-tree.spec.ts apps/chrome-extension/tests/browser-context.spec.ts apps/chrome-extension/tests/sidebar.spec.ts`. RED/PASS proves page-level grouping, unread-before-delivery, partial coverage honesty, Session/document separation, stale locator removal, unchanged read count after like changes and exactly one requested refresh path. Compare the real atlas with committed source events and page-map geometry, not just mocked labels.

### I5 — Delivered-function lifecycle (Sol)

Role: bridge; depends on I3/I4. Adapt `packages/extensions/cordis-host-runner/src/{index,types,lifecycle,registry}.ts`, `packages/extensions/tool-cordis/src/{index,prompt}.ts` and BrowserTask's `src/{index,types,domain,fold}.ts`; extend the existing browser-extension gateway, not an unscoped custom route. Add focused `function-handoff.spec.ts` alongside BrowserTask tests and extend runner tests. Use existing Dynamic Cordis definitions and operation receipts for discovery/run/stop/update, with the promoted ownership rule above. A transfer fact records exact task/resource/target and plugin/package/run identities. Only an observed active resource with no pending write or cleanup can transfer; `release-pending` cannot. Fold/replay, BrowserTask completion and tool-browser verification must agree on this checked disposition. Ordinary unmount's collected cache is not a retained visible resource.

Completion: first RED tests reject invented transfers, cross-installation owners, stale versions, unresolved writes and forged retained states. PASS must prove a receipt-backed handoff, creation-task completion with its temporary resources settled, function usability after new chat, explicit stop/observed cleanup, failed/unknown cleanup, update ordering, navigation and owner loss. Run focused BrowserTask and runner tests before the real create/use/new-chat/stop scenario. Do not waive cleanup to obtain a green result.

### I6 — Composition, independent review and acceptance (Sol integrator)

Role: acceptance; depends on I1–I5. Keep the existing `base` BrowserTask and `web-app` Browser-extension/Cordis composition. Update only affected READMEs, subsystem-owned types, generated declarations/catalogs and bilingual records; keep the proposed decision note truthful until implementation passes. Add recorded Session replay and extension browser coverage for the new visible behavior. Shared manifests, lockfile, catalogs and broad commands remain primary-owned.

Use one fresh Sol High read-only reviewer on the stable diff plus ledger. Ask about wrong-tab/cross-Session authority, resource handoff, replay/unknown outcomes and missing tests; do not provide the desired verdict. Fix evidence-backed findings once, rerunning only affected checks. Re-review only if new evidence exposes another material risk.

## Acceptance evidence

Use natural-language goals, not a prescribed tool-call script. Example on a real discussion/article page: “Compare the visible viewpoints on this page and make a small comparison panel I can keep using. Let me click an item to return to its source. I will browse another tab while you work; keep working on the pinned page.” Then: “I started a new conversation; open that comparison tool again and add a source column.” Finally stop it through the extension. Do not post public comments, purchase, upload private files or modify external accounts for this test.

| Layer | Required closing evidence |
| --- | --- |
| source-contract | Reviewed scoped diff, RED/PASS and WIP preservation; no unchecked retained completion or prompt-only target policy. |
| generated-declaration | Current Host/Client generated contracts, extension build and affected catalog checks bound to candidate source. |
| composed | Exact web Profile/Bundle/Agent visibility and both normal Browser and Cordis paths. |
| runtime-observed | Host PID/start time/build, extension installation/source path and version, Session/request/target IDs, actual provider/model ID and non-secret route. |
| behavior-verified | Independent before/after DOM and screenshots; A-only side effect; cognition matches delivered data; cross-conversation use; stop clears exact resource; preserved raw failures and independent review. |

All five layers are required for this feature. Record the five-layer ledger and raw evidence under `.artifacts/browser-assistant-v2/`; redact secrets and unrelated page data. Include request counts/token usage when the provider reports them, without inventing pricing or a budget. A UI model label alone does not establish `deepseek-v4.1-flash`: retain the catalog-to-request mapping and ask before substituting another model.

## Delegation and escalation

Default concurrency is Sol plus one Terra. No recursive delegation, duplicate full-repo scans or broad worker test runs. Terra receives only the approved prototype, concrete adapter contract, exclusive files, focused command and stopping condition; it must preserve other changes. Sol integrates and owns acceptance. Use a second worker only for an actually independent substantial lane.

Escalate to Astra only for a changed target/authority/lifecycle contract, an unplanned cross-domain redesign, two evidence-backed failed root-cause attempts, or a reviewer-discovered wrong-tab/cross-Session/replay/resource-control risk. Return a bounded packet: expectation, observation, exact IDs, first divergent boundary, minimal alternatives and decision requested. Routine failures stay with Sol.

Stop for conflicting WIP that cannot be preserved, missing real-model/extension access, or new external/destructive authority. Do not stop unrelated services or reinstall the user's extension merely to simplify a test. Do not claim the product complete from this handoff, source tests or prototype validation.

## Dev Note

The current contract review found one worker-global Session binding, active-tab page selection, legacy stream rendering and no gap resync. Existing page/tree snapshots and Dynamic Cordis are reuse candidates, not evidence of V2 completion. The [proposed decision](../../../.agents/notes/proposed/feature/2026-09-20-personal-browser-assistant-v2.md) explains the ownership split. Implementation status starts at not started for I1–I6.

Charter outcome is not yet complete; only the listed acceptance evidence can close it.
