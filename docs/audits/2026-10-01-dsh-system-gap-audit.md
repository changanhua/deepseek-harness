# DSH System Gap Audit

English | [中文](2026-10-01-dsh-system-gap-audit.zh.md)

Reference audit, dated 2026-10-01. Implementation baseline: `master@b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`. Remote master was reread with `git ls-remote` and fetched on 2026-09-30 at 20:40 UTC; it matched the task baseline. This document is a pinned evidence snapshot, not a replacement for package owners or an implementation specification.

## Summary

Use this audit to distinguish existing responsibilities, unfinished committed work, explicit non-goals and unproven abstractions. “Implemented” below means source, schema and wiring inspected; it does not claim fresh live acceptance tests. Unmerged branches are identified separately.

## Table of Contents

- [1. Executive Summary](#1-executive-summary)

- [2. Current System Map](#2-current-system-map)

- [3. Active Work Map](#3-active-work-map)

- [4. Hypothesis Audit](#4-hypothesis-audit)

- [5. Newly Discovered Gaps](#5-newly-discovered-gaps)

- [6. False Positives](#6-false-positives)

- [7. Cross-project Lessons](#7-cross-project-lessons)

- [8. Architecture Candidates](#8-architecture-candidates)

- [9. Build Candidates](#9-build-candidates)

- [10. Watchlist](#10-watchlist)

- [11. Final Matrix](#11-final-matrix)

- [12. Verification and Evidence](#12-verification-and-evidence)

## 1. Executive Summary

DSH is already a composable, owner-partitioned agent runtime with durable Session and Queue facts, explicit execution authority, source-backed Knowledge/Memory governance, and opt-in Planning and Delivery products. It is not merely a chat loop waiting for Context, Memory, Runtime or Capability planes. Its unfinished work is concentrated in trustworthy composition and acceptance across existing owners.

The three strongest confirmed remaining responsibilities are listed below. All have planned owners; none is classified as an ownerless CONFIRMED_GAP. An open Issue alone is not the proof: each was checked against current code and active work.

1. Real Eval execution identity, isolated subject/grader execution and independent regression acceptance remain planned around [#49](https://github.com/changanhua/deepseek-harness/issues/49)–[#60](https://github.com/changanhua/deepseek-harness/issues/60). Master has deterministic replay/report contracts, not this whole trusted execution chain. [E13](#e13) [E14](#e14)
2. Queue terminal notifications do not cold-resume an authorized Goal. [#42](https://github.com/changanhua/deepseek-harness/issues/42) already owns the Activation Grant/Request/Receipt bridge; Schedule/Webhook/IM extensions are explicitly deferred. [E20](#e20)
3. Cross-Session/Goal/Workflow request, Token and wall-clock reservation/settlement is [#43](https://github.com/changanhua/deepseek-harness/issues/43). Token measurement, Queue capacity and Goal round limits exist but do not implement that shared budget authority. [E04](#e04) [E17](#e17) [E43](#e43)

Important false positives: final model context already has an assembly/commit/reconstruction chain; Knowledge and Memory already have review, promotion and invalidation; Planning already stores dependencies, manual order, estimates and cross-Plan priority suggestions; capability installation and lifecycle are distributed among real owners. SSP has implementation in [PR #78](https://github.com/changanhua/deepseek-harness/pull/78), Domain Runtime Phase A exists on its branch, and RIR has a spec-only seed in [PR #79](https://github.com/changanhua/deepseek-harness/pull/79). Unmerged does not mean undesigned; a spec does not mean implemented.

No new general-purpose Plane reaches L4 or L5 in this audit. Generic Runtime, Constitution, universal Context Fabric, Credential Plane, Portfolio Manager and Experience Compiler remain unjustified as new authorities. No current repeated failure was established that requires moving ownership into them. The audit found narrow owner limitations, 67 pre-existing invariant companion/publication violations, and stale owner documentation; those are recorded without turning them into new platforms.

## 2. Current System Map

Persistence is listed by fact owner, not by UI. A Definition is not a deployed provider. Base composition and optional add-ons are separate evidence; profile mounting is not equivalent to live acceptance.

| Concern | Canonical Owner | Persistence | Authority | Key Contract | Status |
| --- | --- | --- | --- | --- | --- |
| Session / Session Query | Session; SessionQuery | append-only Session log; derived query index | Session append; caller-scoped query access | id + seq; canonical fold / trace [E09](#e09) [E10](#e10) | Implemented; full-text opt-in |
| Agent / Context | Agent registry; agent-loop; systemPrompt | model-visible facts in Session | prepared request admission; scoped contributors | assemble → commit → derive/freeze [E01](#e01) [E02](#e02) [E03](#e03) | Implemented |
| Goal | Goal; goal-round-driver | goal/change in Session | exact Agent + Goal revision; transient arming | one current objective; bounded rounds [E43](#e43) | Implemented; cold Activation planned |
| Workflow | WorkflowEngine; worker-thread provider | caller-owned live run; Session facts remain Session-owned | run holder cancel/dispose | foreground orchestration; child lifecycle [E44](#e44) | Implemented; not durable Queue |
| Queue | task-queue; task-queue-local | atomic ChangeSet ledger / recovery projection | verified Agent/operator; handler claims | Attempt / unknown / retry / capacity [E16](#e16) [E17](#e17) | Implemented; base |
| Planning / Thinking Desk | Planning Board; planning-local; separate exploration branch | Board revisions, proposals, reviews, references | CAS + explicit adoption; exploration is non-canonical | Plan / Focus / ResourceRef [E33](#e33) [E35](#e35) [E48](#e48) | Planning implemented; UI/Desk in progress |
| Eval | eval library; snapshot adapter; planned execution owners | fixtures/reports; planned durable run/evidence | independent checks; future Host-resolved Plan | route/case/fixture/Session refs [E13](#e13) [E14](#e14) | Replay implemented; real execution planned |
| Browser / Cognition | Browser provider; BrowserTask; separate cognition consumer | receipts/journal + Session task facts | grant/epoch/page/task; quiescence proof | unknown → reconcile, not replay [E51](#e51) [E36](#e36) | Browser implemented; cognition PR #73 incomplete acceptance |
| Content / Knowledge / Memory | Content; KnowledgeBase; projectMemory | distinct Storage Domains, immutable versions/releases/decisions | source checks; publish checks; human Memory decisions | not interchangeable truth stores [E25](#e25) [E21](#e21) [E23](#e23) | Implemented; optional governance compositions |
| Delivery | Delivery; deliveryEvidence; local providers | Contract/Packet/decision domain + evidence bytes | human requirement approval and acceptance | verified Packet/Attempt/check binding [E11](#e11) [E12](#e12) [E47](#e47) | Implemented optional chain; Epic #13 still open |
| RepositoryWorkspace | repoWorkspace; git-local | Git worktree + Attempt owner marker | verified commit token; exact lease holder | checkpoint after quiescence; remove/preserve [E15](#e15) | Implemented; Eval bridge planned |
| Activation / Budget | planned services #42 / #43 | planned Grant/Request/Receipt and reservation/settlement domains | human grant / budget + final dispatch enforcement | [#42](https://github.com/changanhua/deepseek-harness/issues/42) [#43](https://github.com/changanhua/deepseek-harness/issues/43) | Planned; not master runtime |
| SSP | side-effect-safety; Host-bound adapter | bounded atomic Storage Domain document | human proof + opaque admission + exclusive effect lease | SENT/risk before send; UNKNOWN lookup only [E39](#e39) | PR #78 implementation; opt-in; no production adapter |
| Domain Runtime | domainArtifacts registry; fcSbcDomain provider | provider-owned immutable Reality/Plan artifacts | bounded typed reads/planning; no execution authority | provider refs; coverage/freshness/lineage [E55](#e55) [E58](#e58) [E59](#e59) | Phase A branch implemented; not master |
| RIR | planned independent Assessment owner | planned immutable assessments and baseline drift | advice only; Planning remains canonical | no automatic approval/dispatch [E38](#e38) | PR #79 spec only |
| Capabilities / Credentials | Tool/Skill/Preset/MCP/Loader; CredentialProvider | owner source/lockfiles/events; credential records | scoped execution; Host/provider/human flow boundaries | read-only Host projection ≠ authority [E26](#e26) [E31](#e31) | Implemented; narrow lifecycle limits |

## 3. Active Work Map

Snapshot: 2026-09-30 20:41–20:52 UTC. All 30 open Issues and nine open PRs were read, including bodies, diff metadata and available discussion. Branch pagination exhausted at 56 visible heads; Git remote heads independently matched the inventory. Package trees were scanned across those heads. Activation/Budget directories were not found; Eval-bearing heads had two directory-tree variants, neither adding the planned trusted executor. Owner-focused branch diffs supplement, but do not prove absence of arbitrary differently named implementations. A slower exhaustive historical source grep was not completed and is not counted as evidence.

| Open PR | Head / frozen commit | Base | Audited status |
| --- | --- | --- | --- |
| [PR #79](https://github.com/changanhua/deepseek-harness/pull/79) | `codex/requirement-investment-review-wp1` / [`3e670dd29c`](https://github.com/changanhua/deepseek-harness/commit/3e670dd29ca056fff8efb831d9ee3693024d3755) | `master` | Draft; specification seed only |
| [PR #78](https://github.com/changanhua/deepseek-harness/pull/78) | `integrate/ssp-wp1` / [`f64e9699ef`](https://github.com/changanhua/deepseek-harness/commit/f64e9699ef5d2f1aeec954f3356b940a5eca136e) | `master` | Open, not Draft; SSP kernel; no production adapter |
| [PR #73](https://github.com/changanhua/deepseek-harness/pull/73) | `codex/browser-cognition-alignment-20260923` / [`0626052e73`](https://github.com/changanhua/deepseek-harness/commit/0626052e73bed8799b8baef0a82e930453892e83) | `codex/browser-semantic-map` | Draft; cognition implementation, quality acceptance incomplete |
| [PR #72](https://github.com/changanhua/deepseek-harness/pull/72) | `codex/pcp-composition-proposal` / [`6aa2a0e668`](https://github.com/changanhua/deepseek-harness/commit/6aa2a0e66816ba3483c59d1c4de2e99dff650779) | `master` | Draft; composition proposal, no new control store |
| [PR #71](https://github.com/changanhua/deepseek-harness/pull/71) | `codex/pr1-tool-terminal-state` / [`a3a1b95f77`](https://github.com/changanhua/deepseek-harness/commit/a3a1b95f771b9feca986d071e916ac6f28243d59) | `master` | Draft; terminal settlement fix; live acceptance incomplete |
| [PR #70](https://github.com/changanhua/deepseek-harness/pull/70) | `codex/project-context-baseline` / [`8c5cfc4440`](https://github.com/changanhua/deepseek-harness/commit/8c5cfc4440aa17d2224664053b73ce64b99981d9) | `codex/personal-mainline-integration` | Draft; project-context docs, not runtime authority |
| [PR #69](https://github.com/changanhua/deepseek-harness/pull/69) | `codex/eval-scenario-design` / [`7f8927a73e`](https://github.com/changanhua/deepseek-harness/commit/7f8927a73e066046df64d73dddf06dbe76eb60fb) | `master` | Draft; multi-turn Eval/browser design, no runtime implementation |
| [PR #9](https://github.com/changanhua/deepseek-harness/pull/9) | `learning/dsh-mastery-course` / [`e421f9dc5d`](https://github.com/changanhua/deepseek-harness/commit/e421f9dc5d9f93c64247f06c7c8ddfc6883e3de1) | `master` | Open, not Draft; human learning runtime; learner evidence pending |
| [PR #7](https://github.com/changanhua/deepseek-harness/pull/7) | `intelligence/phase0` / [`f425ef240f`](https://github.com/changanhua/deepseek-harness/commit/f425ef240f4c287ab6b34a18789ae4bc97a8f5c7) | `master` | Open, not Draft; repository intelligence Phase 0, no runtime service |

Other important branch evidence: `codex/planning-ui-workspace@78a9d52c2accbdf5e026b4114a86a4285bbf0e5b` contains native Thinking Desk Agent-loop and manual canvas work; its implementation/WP4 specs supersede the master UI spec for that branch. `dot/domain-runtime-plane@7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2` contains Phase A code with tree `09fa9991147243c6872127d65bd4cd9cb35b9fb6`, not just [#77](https://github.com/changanhua/deepseek-harness/issues/77) design ([E58](#e58) [E59](#e59) [E60](#e60)). `codex/session-review-v0@8e41cc18d55427f011423df027b0f1930b4a25e7` is an implementation candidate, explicitly not runtime-accepted. A branch existing is not proof that someone is currently executing it. [E40](#e40)

| Open Issues / Roadmap | Fact and boundary |
| --- | --- |
| [#13](https://github.com/changanhua/deepseek-harness/issues/13) | Delivery vertical integration; master already has substantial implementation |
| [#40](https://github.com/changanhua/deepseek-harness/issues/40), [#41](https://github.com/changanhua/deepseek-harness/issues/41) | autonomous-loop roadmap and Eval foundation; planned / in progress |
| [#42](https://github.com/changanhua/deepseek-harness/issues/42), [#43](https://github.com/changanhua/deepseek-harness/issues/43), [#44](https://github.com/changanhua/deepseek-harness/issues/44) | Activation, Budget, capability Eval gates; planned |
| [#45](https://github.com/changanhua/deepseek-harness/issues/45), [#46](https://github.com/changanhua/deepseek-harness/issues/46), [#47](https://github.com/changanhua/deepseek-harness/issues/47), [#48](https://github.com/changanhua/deepseek-harness/issues/48) | Eval Web workbench; labeled in progress, labels are not execution proof |
| [#49](https://github.com/changanhua/deepseek-harness/issues/49), [#50](https://github.com/changanhua/deepseek-harness/issues/50), [#51](https://github.com/changanhua/deepseek-harness/issues/51), [#52](https://github.com/changanhua/deepseek-harness/issues/52), [#53](https://github.com/changanhua/deepseek-harness/issues/53), [#54](https://github.com/changanhua/deepseek-harness/issues/54), [#55](https://github.com/changanhua/deepseek-harness/issues/55), [#56](https://github.com/changanhua/deepseek-harness/issues/56), [#57](https://github.com/changanhua/deepseek-harness/issues/57), [#58](https://github.com/changanhua/deepseek-harness/issues/58), [#59](https://github.com/changanhua/deepseek-harness/issues/59), [#60](https://github.com/changanhua/deepseek-harness/issues/60), [#61](https://github.com/changanhua/deepseek-harness/issues/61) | trusted Eval execution and acceptance; #50 ready, remainder planned |
| [#62](https://github.com/changanhua/deepseek-harness/issues/62), [#63](https://github.com/changanhua/deepseek-harness/issues/63), [#64](https://github.com/changanhua/deepseek-harness/issues/64) | Delivery import acceptance canaries, not three platform gaps |
| [#74](https://github.com/changanhua/deepseek-harness/issues/74), [#75](https://github.com/changanhua/deepseek-harness/issues/75) | explicit multi-page continuation and connector restart recovery |
| [#76](https://github.com/changanhua/deepseek-harness/issues/76), [#77](https://github.com/changanhua/deepseek-harness/issues/77) | SSP-WP1 and Domain Runtime Phase A; unmerged implementation exists |

The roadmap already rejects distributed schedulers, generic Artifact stores, a second capability registry and automatic model/Skill promotion. [#52](https://github.com/changanhua/deepseek-harness/issues/52) reuses RepositoryWorkspace; [#55](https://github.com/changanhua/deepseek-harness/issues/55) does not expand Delivery Evidence into a universal store; [PR #72](https://github.com/changanhua/deepseek-harness/pull/72) proposes composition and owner-routed commands, not a new canonical control database. [PR #73](https://github.com/changanhua/deepseek-harness/pull/73) reports real transport/model work but failed cognition-quality acceptance; its Source/Focus binding cannot be advertised as complete.

## 4. Hypothesis Audit

Classification applies to the stated responsibility, not the presence of a package name. L0 = hypothesis; L1 = local evidence hint; L2 = verified current gap after owner/active-work checks; L3 = at least two real repeated unmet cases; L4 = justified general architecture; L5 = real case, owner, boundary, invariants and acceptance ready for building. N/A means no remaining gap is asserted for that scoped mechanism. Existing planned work can be confirmed unfinished without becoming an ownerless CONFIRMED_GAP. This audit does not infer L3 from two code branches or test fixtures.

### H1 — Cross-domain Context Composition

**Classification** — PARTIAL; existing assembly chain is implemented. A new universal owner is HYPOTHESIS.

**Maturity** — L1 for cross-source arbitration; N/A for existing assembly.

**FACT / Evidence** — SystemPrompt assembles scoped sections, contexts and tools. The loop projects runtime context, admits input and a prepared model route, commits visible facts, then derives and freezes messages from Session. TokenMeter and Compaction handle pressure; runtime-facts owns local relevance/freshness. [E01](#e01) [E02](#e02) [E03](#e03) [E04](#e04) [E49](#e49)

**Current owner / Existing contract** — systemPrompt owns composition; each domain owns its facts; agent-loop owns admission; Session owns durable model history. PromptSection/PromptContext, scope disposal, per-step projection, request/header/context and derived messages form the contract. This is a distributed ownership design, not an ownerless step.

**Planned owner / Explicit non-goal** — [#43](https://github.com/changanhua/deepseek-harness/issues/43) plans usage-budget admission, not semantic relevance selection. Planning uses bounded context packs and ResourceRefs; Browser selection in [PR #73](https://github.com/changanhua/deepseek-harness/pull/73) covers page/task evidence, not all domains. SystemPrompt is not a universal retrieval/ranking authority.

**Actual gap** — No global assembly admission cap was found; a Skill body is returned whole while other resources have bounded renderers. This is a concrete local limit, but there is no audited pair of real tasks showing unavoidable cross-domain duplication or overflow requiring a new owner. [E01](#e01) [E50](#e50)

**Not a gap / Repeated need / Ownership collision** — Multiple local compilers are expected when facts have different authority and freshness. No duplicated canonical fact store was established. A parallel Context store would collide with Session reconstruction; a shared relevance score could erase domain authority. Repeated unmet cases: not established.

**PROPOSAL / Recommendation** — observe; first bound oversized Skill output within its existing owner if a real case requires it. Consider a shared admission contract only after measured competing-source failures, without moving fact ownership.

#### Context contribution boundaries

Session/historical facts use canonical projection and explicit SessionQuery references ([E10](#e10)); Goal supplies its own prompt guidance ([E61](#e61)); Planning supplies a current-revision context pack without dereferencing external transcripts ([E56](#e56)); Knowledge/Memory expose bounded owner-checked tool results rather than silently injecting an entire store ([E21](#e21) [E24](#e24)); Browser Observation/Task receipts remain page/epoch-bound ([E51](#e51)), while Cognition selected context is active PR #73 work with incomplete quality acceptance. Skill, Tool and Preset determine visible content and schemas through their scoped registries ([E27](#e27) [E06](#e06) [E29](#e29)). Evidence is fetched through its owner rather than presumed globally trusted ([E12](#e12)); TokenMeter measures pressure, not semantic relevance ([E04](#e04)). Local freshness checks therefore remain with source owners; the loop controls final admission. No repository evidence establishes that all of these inputs are automatically fetched before every model call.

### H2 — System Constitution / Machine-readable Ownership

**Classification** — PARTIAL: operation enforcement and diagnostic mechanisms exist, but repository companion/publication compliance is incomplete.

**Maturity** — L2 for confirmed companion compliance gaps; a new Constitution Plane remains L0–L1 hypothesis.

**FACT / Evidence** — Tool execution enforces scoped visibility and monotonic guards. Package-owned invariant registration rejects duplicate ownership and unwinds effects. Source checks validate companions, namespace ownership and documented omissions; module/config/Cordis catalogs expose structure. [E06](#e06) [E07](#e07) [E08](#e08) [E05](#e05)

**Current owner / Existing contract** — Service Definitions and operation owners enforce mutations; Cordis owns topology/lifecycle; package checks own declared dependency/publication rules; diagnostic companions observe divergence. State stays with domain owners, not the diagnostics registry.

**Planned owner / Explicit non-goal** — [PR #7](https://github.com/changanhua/deepseek-harness/pull/7) is repository intelligence, not a runtime constitutional authority. Diagnostics are opt-in in compositions; the minimal SDK mounts companions, whereas base does not universally enable them. An observer does not replace operation-time refusal or protect every direct one-shot LLM call.

**Observed compliance limit** — The exact-base and audit-head verify-package-invariants checks both fail with the same 67 findings: 54 empty companion installers, seven misplaced client peer dependencies, two invalid invariant exports, two invalid publication file entries, and two missing omission reasons. These are static companion/publication violations, not proof that operation-time refusal fails. They prevent interpreting existing mechanisms as repository-wide compliance. A separate static graph check also reports 12 missing service-role classifications on both revisions; see section 12.

**Actual gap** — Natural-language owner documentation can drift: Skill README denies diagnostics/shadow inspection that managementSnapshot and Host projection already implement. This is a documentation accuracy failure, not missing runtime ownership. [E42](#e42) [E27](#e27) [E26](#e26)

**Not a gap / Repeated need / Ownership collision** — A missing universal graph does not remove existing enforcement. Two stale statements in one README are not two independent runtime failure cases. A central rule engine would duplicate domain-specific refusal and could weaken it.

**PROPOSAL / Recommendation** — do not add a Constitution Plane; repair companion/publication compliance and stale owner prose in separately authorized work, then verify profile-specific coverage for the concrete invariants.

### H3 — Cross-domain Provenance / Causal Trace

**Classification** — PARTIAL; strong domain provenance exists, universal causal query is unproven.

**Maturity** — L1 for universal cross-link consumer; planned Eval evidence work is L2.

**FACT / Evidence** — Session has stable id/seq, source relations, lineage and canonical trace. Delivery binds evidence digests to Packet/Work/Attempt/check and validates them before human acceptance. Eval reports retain revision/route/fixture/Session identity, but evidenceRefs are strings, not Delivery EvidenceRefs. [E09](#e09) [E10](#e10) [E11](#e11) [E12](#e12) [E13](#e13) [E14](#e14)

**Current owner / Existing contract** — Session/SessionQuery, Delivery/Evidence, Queue and Eval each own their identity and validation. Content captures verified settled Session sources; Memory decisions bind exact revisions and human command identity. A same-named string or arbitrary URI is not automatically a causal edge.

| Requested chain segment | Evidence | Boundary |
| --- | --- | --- |
| Requirement → RIR → Planning | Optional RIR path: spec only; baseline and advice refs planned | Not a mandatory gate or the only Planning entry |
| Requirement → Planning / Planning → Goal | Planning captures sources and adopts revisions without RIR [E33](#e33) [E35](#e35); a typed Plan-revision→Goal bridge was not verified | Existing first edge; second edge remains uncertain |
| Planning → Delivery → Queue → evidence → human acceptance | Board handoff / Packet / Attempt / check bindings exist [E62](#e62) [E11](#e11) [E12](#e12) | Implemented within those owners |
| Goal ↔ Agent / Queue terminal → Goal | Goal in Session; terminal notification exists; cold activation [#42](https://github.com/changanhua/deepseek-harness/issues/42) | Existing + planned |
| Tool action → SSP → Domain artifact | SSP kernel and immutable domain refs exist on separate branches [E39](#e39) [E55](#e55) | Production bridge not proved |
| Artifact / Session → Eval → acceptance | Session/fixture refs exist; strong real evidence and Gate consumers [#55](https://github.com/changanhua/deepseek-harness/issues/55) [#58](https://github.com/changanhua/deepseek-harness/issues/58) | Partial / planned; not generic acceptance |

**Planned owner / Explicit non-goal** — [#55](https://github.com/changanhua/deepseek-harness/issues/55) owns Eval evidence; [#58](https://github.com/changanhua/deepseek-harness/issues/58) bridges Gate consumers. Session trace is bounded direct citation/replacement semantics, not arbitrary recursive global causality. No accepted spec establishes a second event store.

**Actual gap / Repeated need** — A single end-to-end query over the entire proposed chain was not verified. Its absence is not proof of missing underlying identity, nor of a necessary new store. No two current failed cross-domain investigations were established.

**Not a gap / Ownership collision** — Do not replace Session fold, Delivery integrity or owner authorization with a telemetry graph. Query visualization and typed link consumers are different from durable fact ownership.

**PROPOSAL / Recommendation** — observe; extend a read-only consumer only for a demonstrated investigation, resolving original owner refs rather than copying truth.

### H4 — Generic Runtime / Execution Environment

**Classification** — HYPOTHESIS for a new general runtime; existing scoped runtimes are implemented and Eval reuse is PLANNED.

**Maturity** — L1; Eval isolation integration is L2, not evidence for a new Plane.

**FACT / Evidence** — RepositoryWorkspace owns verified commit/worktree leases and cleanup. Queue owns Attempt settlement/unknown. Browser owns grants/epochs/receipts/quiescence. SSP leases guard side-effect admission, not cwd/process/network. These protect different objects. [E15](#e15) [E16](#e16) [E51](#e51) [E39](#e39)

**Current owner / Existing contract** — Checkout: exact revision, Attempt marker, checkpoint after process quiescence, remove/preserve. Queue: admission, resource claims, prepare/start, cancel/drain, unknown recovery. Browser: exact page/epoch and status-only reconciliation. SSP: approval/risk/CAS and opaque admitted handles.

**Planned owner / Explicit non-goal** — [#52](https://github.com/changanhua/deepseek-harness/issues/52) explicitly reuses RepositoryWorkspace for Eval cells; [#53](https://github.com/changanhua/deepseek-harness/issues/53) and [#59](https://github.com/changanhua/deepseek-harness/issues/59) own subject/grader/controller isolation. Temporary DSH_HOME and environment inheritance in the replay harness do not prove secret, network or OS isolation. [E52](#e52)

**Actual gap / Repeated need** — Trusted Eval execution is unfinished with an assigned owner. No pair of real unmet same-contract runtime use cases was established. Delivery plus planned Eval is positive evidence for reusing the existing lease, not duplicating it.

**Not a gap / Ownership collision** — A common word “lease” does not imply interchangeable authority or recovery. A new manager owning credentials, workspace, Browser writes, Queue retries and approval would become a God Plane.

**PROPOSAL / Recommendation** — do nothing to generic architecture; finish and evaluate the scoped #52/#53/#59 contracts first.

### H5 — External Trigger Integration

**Classification** — PLANNED for Queue→Goal Activation; DEFERRED_BY_DESIGN for subsequent Schedule/Webhook/email/IM bridges.

**Maturity** — L2 for the confirmed cold-continuation shortfall; L1 for a universal external-event abstraction.

**FACT / Evidence** — Webhook already authenticates through adapters and dispatches verified deliveries into Workspace Sessions, but has no durable dedup/receipt/replay. Schedule persists reminders for live root Agents; cold reminders become overdue. Queue notifications are injected at a later pre-step and do not wake cold Sessions. [E18](#e18) [E19](#e19) [E20](#e20)

**Current owner / Existing contract** — Webhook owns ingress verification and trusted routing; Schedule owns live reminders; Queue owns terminal facts; Goal owns objective state; ordinary Session activation owns reattachment. These are working contracts, not one missing scheduler.

**Planned owner / Explicit non-goal** — [#42](https://github.com/changanhua/deepseek-harness/issues/42) specifies Activation Grant/Request/Receipt, trigger identity, expiry/revocation/count, deterministic handshake/reconciliation, flush-before-consumption and one admitted Goal round. It excludes Schedule/Webhook/email/IM, arbitrary prompt cron/DAG and distributed exactly-once. Git/file/browser event bridges have no frozen generic contract in the inspected plan.

**Actual gap / Repeated need** — The specific cold continuation is real planned work, not ownerless. Queue completion, timer expiry and webhook arrival are different supported promises; counting them as three failures of one missing framework would be invalid.

**Not a gap / Ownership collision** — No second scheduler, authentication system or Agent loop is justified. A future bridge must preserve the ingress owner’s verified identity and the Activation owner’s grant limits; HTTP receipt is not execution completion.

**PROPOSAL / Recommendation** — extend existing owners through the already specified #42 bridge; design other bridges later, one real trigger case at a time.

### H6 — Knowledge Governance

**Classification** — PARTIAL overall; persistence, provenance, review/promotion and freshness already exist in their declared scopes.

**Maturity** — L1 for broader semantic/cross-library governance; N/A for existing lifecycle.

**FACT / Evidence** — Knowledge validates source snapshots and citations, fences stage input/review hashes, propagates stale dependencies, and publishes immutable releases only after current checks. Memory has candidate/accept/reconfirm/retire history, exact human revision decisions, source SHA checks, review deadlines and conflict withholding. Content has immutable versions and separate drafts. [E21](#e21) [E22](#e22) [E23](#e23) [E24](#e24) [E25](#e25)

**Current owner / Existing contract** — Content owns saved user text; KnowledgeBase owns authored source-backed knowledge and publication; projectMemory owns reusable project claims and eligibility. Storage provides durability without acquiring domain authority. Human acceptance permits reuse but is not proof of factual truth.

**Planned owner / Explicit non-goal** — Knowledge marks semantic duplicate/contradiction checks `not_run`; Memory lexical/topic matching does not detect arbitrary semantic conflict or perform automatic extraction. Optional compositions are real, but not enabled everywhere. [E21](#e21) [E46](#e46) [#40](https://github.com/changanhua/deepseek-harness/issues/40) defers broader knowledge integration pending earlier loop evidence.

**Actual gap** — A retrieval: lexical and Session full-text mechanisms exist, semantic recall remains limited. B persistent knowledge: exists. C provenance: exists. D review/promotion: exists. E freshness/supersession: source invalidation, review expiry, active revision/current release and retirement exist. Remaining semantic relation detection and cross-library policy are not demonstrated general system gaps.

**Not a gap / Repeated need / Ownership collision** — No two current missed semantic cases were verified that require a universal Memory governor. Saved Content, accepted Memory and published Knowledge are not interchangeable trust levels. Automatic promotion would collide with existing human authority.

**PROPOSAL / Recommendation** — observe; preserve existing governance. If actual contradictions recur, extend advisory checks in the owning Knowledge/Memory service with human adjudication, not a second store or global truth engine.

### H7 — Capability Lifecycle / Supply Chain

**Classification** — PARTIAL; lifecycle exists by capability type, with narrow remaining limits.

**Maturity** — L2 for verified local omissions below; new unified lifecycle authority remains L1.

**FACT / Evidence** — Tools have scoped execution/disposal/guards; Skills have providers, invalidation, selection, diagnostics and shadow inspection; Presets have generation isolation and boundary-checked swap; MCP has generation-bound reconnect/refresh/disposal. The Host capabilityRegistry is a scoped read-only projection, not an installation authority. [E06](#e06) [E27](#e27) [E29](#e29) [E30](#e30) [E26](#e26)

**Current owner / Existing contract** — Installation/version: profile package manager and manifest/lockfiles; activation: Loader; tool permission: ToolRuntime; Skill content/freshness: provider and registry; Preset replacement: generation owner; MCP connection health: connection supervisor. Deprecation/replacement are type-specific, not one shared enum. CLI plugin transactions and Desktop shell-owned installation exist. [E57](#e57)

**Planned owner / Explicit non-goal** — [#44](https://github.com/changanhua/deepseek-harness/issues/44) and [#58](https://github.com/changanhua/deepseek-harness/issues/58) plan capability evaluation gates, not another registry. MCP tools-only bridging and model-facing Skill body version notifications are explicit scope limits. The read-only Host projection must not silently gain installation or permission mutation.

**Actual gap** — Three concrete owner omissions: MCP connection state/last sync is not exposed by the management projection; malformed filesystem Skills are logged/discarded before provider diagnostics reach the registry; superseded Preset generations have no joined-agent reclamation accounting. Active owner diffs contained no implementation of these fixes. [E26](#e26) [E28](#e28) [E29](#e29)

**Not a gap / Repeated need / Ownership collision** — Registered tool count is not connection health. Retaining a generation while old Agents still use it is necessary, not a bug. No two real current failures/resource-growth traces were obtained for these omissions, so they do not reach L3. A global manager guessing health or killing fibers would violate the original owner.

**PROPOSAL / Recommendation** — extend existing owners only if a concrete task justifies it: sanitized MCP status, existing SkillProviderObservation diagnostics, and Preset lifetime accounting. Preserve generation identity and disposal semantics; do not create a second capability store.

### H8 — Identity / Credential / Secret Authority

**Classification** — PARTIAL across deployment isolation; CredentialProvider and authority boundaries already exist.

**Maturity** — L2 for planned budget/isolation shortfalls; a new Credential Plane remains L1.

**FACT / Evidence** — CredentialProvider separates references, metadata and plugin-owned records, with per-operation provider resolution and human authorization flows. Same-OS-user file access is explicitly not a secret isolation boundary. Browser grant/epoch, Host authority, provider credential and SSP approval protect different actions. [E31](#e31) [E32](#e32) [E51](#e51) [E39](#e39)

**Current owner / Existing contract** — Credentials owns resolution/storage protocol; each provider owns its record meaning; Host owns trusted entry; Browser owns site/action grants; SSP owns effect approval/admission. CredentialRef locates a secret; an authorization reference permits a specific operation. They are not substitutes.

**Planned owner / Explicit non-goal** — [#50](https://github.com/changanhua/deepseek-harness/issues/50) [#51](https://github.com/changanhua/deepseek-harness/issues/51) [#53](https://github.com/changanhua/deepseek-harness/issues/53) [#59](https://github.com/changanhua/deepseek-harness/issues/59) require Host-approved Eval credential/cost refs and controller/subject/verifier separation. [#43](https://github.com/changanhua/deepseek-harness/issues/43) defines usage budgets. It excludes currency billing, chargeback, generic RBAC and distributed quotas. SSP risk accounting is not LLM usage settlement.

**Actual gap / Repeated need** — A private path and isolated DSH_HOME alone cannot establish hostile-subject isolation. That need is already assigned to the planned execution provider. No repeated evidence justifies combining all these authorities into one credential service. This audit inspected contracts only and read no secret values.

**Not a gap / Ownership collision** — Successful secret resolution is not permission to spend. A Browser-authenticated operation is not permission to call a paid model. Merging these into one ledger would conflate revocation, usage settlement and irreversible effect risk.

**PROPOSAL / Recommendation** — extend the already planned #43/#53/#59 owners; require negative cross-access and dispatch-admission tests. Do not add a new global authority wrapper.

### H9 — Requirement Portfolio / Engineering Capital Allocation

**Classification** — PARTIAL; the claim “no portfolio ordering owner” is partly falsified.

**Maturity** — L1 for a dedicated new portfolio owner; no confirmed responsibility gap.

**FACT / Evidence** — Planning persists manual order, dependencies, versioned eight-factor estimates and reviews. Its UI computes cross-Plan suggestedOrder from value/urgency/reuse/compounding minus time/token/risk/cognitive costs; unknown factors do not get a score. Queue separately arbitrates actual resource capacity. [E33](#e33) [E34](#e34) [E35](#e35) [E17](#e17)

**Current owner / Existing contract** — Planning remains the canonical priority/order/dependency owner; user decisions, CAS, rationale, reviews, Session records and ResourceRefs already support comparison and evidence retention. Delivery approval and Queue execution are separate. The existing scoring projection is a fact being audited, not a recommendation to introduce a score here.

**Planned owner / Explicit non-goal** — RIR [PR #79](https://github.com/changanhua/deepseek-harness/pull/79) owns proposed immutable single-subject assessments, baseline drift, qualitative allocation and advice routes; portfolio ordering and realized outcome learning are excluded from WP1. Budget [#43](https://github.com/changanhua/deepseek-harness/issues/43) limits runtime usage, not engineering opportunity cost. [E38](#e38)

**Actual gap / Repeated need** — No specific mandatory action was found that existing Planning review/Session/refs cannot express. A dedicated comparison record absent from the schema is not enough to establish a gap. The proposed RIR acceptance cases are not repeated failed capital-allocation decisions.

**Not a gap / Ownership collision** — A new Portfolio Manager could duplicate Planning order, RIR assessment, Budget settlement and Queue dispatch. Investment advice must not become approval or canonical mutation.

**PROPOSAL / Recommendation** — observe; use existing Planning plus a bounded model/human comparative review. Re-audit only when two real decisions cannot be reconstructed or acted on through those contracts.

### H10 — Experience to System Improvement

**Classification** — PARTIAL; local runtime recovery and human improvement loops already exist.

**Maturity** — L1 for a generic automated learner; incomplete planned verification is tracked by its existing owner.

**FACT / Evidence** — BrowserTask persists deterministic failure fingerprints and requires changed preconditions to unblock. Planning review binds revision/outcome/lessons/follow-up refs. Memory promotion is human-controlled. Two resolved incident reports show real failure→diagnosis→guardrail/test corrections, not two unresolved demands for a new learner. [E36](#e36) [E37](#e37) [E35](#e35) [E23](#e23) [E53](#e53) [E54](#e54)

**Current owner / Existing contract** — Session feedback owns correction facts; BrowserTask owns task recovery; Planning owns reviews/follow-ups; Memory owns usable claims; Eval owns regression evidence; Skill maintenance owns reviewed changes. Learning does not confer new permissions.

**Planned owner / Explicit non-goal** — Session Review branch is an implementation candidate, with no automatic trigger, memory promotion, Skill editing or Issue creation. Its 33 synthetic-test claim is not live acceptance. A private human-review Skill maintenance proposal records a partial trial with zero candidates, not completed promotion. [E40](#e40) [E41](#e41) [#44](https://github.com/changanhua/deepseek-harness/issues/44) [#58](https://github.com/changanhua/deepseek-harness/issues/58) [#61](https://github.com/changanhua/deepseek-harness/issues/61) plan other evaluation/authoring links; RIR outcome learning is deferred.

**Actual gap / Repeated need** — The universal automated chain from arbitrary friction to reviewed rule/Skill/Eval/Knowledge change is not verified. Existing partial loops and explicit no-automatic-promotion boundaries are substantial. No two current unmet cases establish the necessity of a shared Experience Compiler.

**Not a gap / Ownership collision** — Do not turn old failures into current truth, self-review into acceptance, unknown writes into retries, or experience into a second state store. Repository intelligence and human learning PRs do not imply a product self-improvement runtime.

**PROPOSAL / Recommendation** — observe; manually trace one authorized real correction through existing feedback, owner change, independent Eval and human review, measuring incremental value before automation.

## 5. Newly Discovered Gaps

These are additional audited responsibilities or limitations beyond the headline hypotheses. “Newly discovered” here does not mean new to the repository roadmap. None authorizes implementation during this audit.

### N1 — Trusted Eval execution and independent acceptance

**Classification / Maturity** — PLANNED / L2.

**FACT / Evidence** — Master validates replay/report schemas and fixture/Session identity. It does not contain the full Host-approved live execution proof, isolated subject/grader, durable strong evidence and Gate chain specified in [#49](https://github.com/changanhua/deepseek-harness/issues/49)–[#60](https://github.com/changanhua/deepseek-harness/issues/60). [E13](#e13) [E14](#e14) [E52](#e52)

**Current owner / Existing contract / Planned owner** — Eval library and snapshot adapter; Session records actual traces; RepositoryWorkspace provides leases; Queue owns Attempts. Planned Eval PlanProvider, execution provider, evidence owner and narrow bridges fill the remaining contracts.

**Actual gap / Explicit non-goal** — Independent execution identity and acceptance cannot be inferred from passing replay, manifest declarations or Agent self-report. The accepted plan forbids another loop, workspace manager or generic artifact store.

**Not a gap / Repeated need / Ownership collision** — Existing Eval is not absent. Declared scenarios and tests are not counted as multiple fresh live failures; this audit did not run providers. A new Eval Plane would duplicate the assigned work.

**PROPOSAL / Recommendation** — extend existing owner; finish the roadmap’s provenance and isolation contracts before expanding dashboards or claiming trustworthy self-development.

### N2 — Unified runtime usage admission

**Classification / Maturity** — PLANNED / L2.

**FACT / Evidence** — TokenMeter measures; Goal caps rounds; Queue limits resource concurrency. None is a durable shared request/Token/wall-clock reservation ledger. [E04](#e04) [E43](#e43) [E17](#e17) [#43](https://github.com/changanhua/deepseek-harness/issues/43) defines one, including retries and prepared/direct stream enforcement.

**Current owner / Existing contract / Planned owner** — LLM runtime owns final dispatch; usage adapters own observed usage; planned Budget owns Scope/Limit/Reservation/Settlement/Decision. Domain bridges retain their own lifecycle.

**Actual gap / Explicit non-goal** — Atomic parent/child reservations, crash settlement and permission-to-spend are unfinished. Currency billing and replacing Queue capacity or SSP risk accounting are excluded.

**Not a gap / Repeated need / Ownership collision** — There are multiple consumers, but that does not justify a second Budget or Policy engine. No monetary loss or production overrun was measured in this audit.

**PROPOSAL / Recommendation** — extend the planned owner at adapter dispatch; retain usage uncertainty instead of inventing exact cost.

### N3 — Owner prose contradicts existing management contracts

**Classification / Maturity** — PARTIAL / L2 for owner documentation accuracy; no new system authority.

**FACT / Evidence** — The Skill README says diagnostics and shadow inspection are absent; managementSnapshot exposes both and the Host consumes them. [E42](#e42) [E27](#e27) [E26](#e26)

**Current owner / Existing contract / Planned owner** — Skill owner documentation and its existing source/tests/catalog checks; no active repair was located. This is a source-versus-prose conflict with implementation taking precedence.

**Actual gap / Explicit non-goal** — Structural freshness gates do not prove arbitrary natural-language claims. The two stale statements establish misleading documentation, not a missing registry or permission engine.

**Not a gap / Repeated need / Ownership collision** — Both statements are in one README, so they do not satisfy two independent real-system use cases. An audit index must link to owners, not become a second canonical architecture catalog.

**PROPOSAL / Recommendation** — extend existing documentation verification narrowly; repair only in separately authorized work. Product code and old prose remain unchanged here.

### Investment judgement for confirmed remaining contracts

Severity and build priority are different. The following are qualitative audit inferences, not forecasts, scores, or claims that upstream has promised to ship a replacement.

| Responsibility | System leverage | Model substitution risk | Upstream substitution | No-build alternative | Wrong-abstraction risk | Reversibility | Evidence quality |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Eval trusted execution | High across validation/Delivery/Goal | Better models do not prove isolation or identity | Generic evaluators are replaceable; DSH owner bindings remain local | Use existing replay + human independent verification while incomplete | High if creating a second runtime/store | Reuse leases now; postpone UI extras | Strong contract evidence; live acceptance not rerun |
| Activation / future triggers | High for unattended continuation | Authorization, revocation and dedup do not disappear | Ingress adapters replaceable; grant semantics domain-specific | Explicit manual resume; existing live reminders | High if replacing schedulers/authentication | Narrow bridge reversible; new canonical scheduler costly | One frozen cold-continuation case; generic repetition unproved |
| Budget admission | High across fan-out/retry/continuation | Hard spending bounds are not reasoning quality | Generic token accounting may substitute, not exact DSH admission | Round/concurrency caps and human supervision only partially substitute | Medium when scoped; high as universal policy | Ledger semantics should precede widespread automation | Strong missing-contract evidence; no measured loss |
| Capability diagnostics / reclamation | Local operational leverage | Model may help diagnose; cannot reclaim owned fibers safely by guessing | Generic tooling possible; lifecycle still owner-specific | Logs, controlled reload, current management views | High for global manager; low for narrow owner read API | Read-only diagnostics highly reversible; disposal needs care | Source omissions confirmed; repeated real incidents absent |
| Owner prose drift | Broad decision accuracy; local repair | Better readers can verify source; drift persists | Generators help structure, not every semantic claim | Correct linked owner prose and review against source | Very high if used to justify Constitution Plane | Documentation repair is easy to reverse | Two statements, one owner; strong contradiction evidence |
| Invariant companion compliance | Broad diagnostic and CI consistency | Stronger models do not make invalid publication contracts valid | General package tooling may substitute; owner declarations remain local | Use existing gates and review rules; no new architecture needed | High if expanded into a Constitution Plane | Narrow metadata/companion corrections are reversible; retain real runtime checks | Strong: 67 identical base/head findings; no runtime refusal failure proved |

## 6. False Positives

| Initial appearance | Audit result | Reason |
| --- | --- | --- |
| No Context owner | Falsified as stated | Existing composition/Session request authority; universal selection remains unproven |
| No Constitution Plane means no enforcement | Falsified | Operation guards, Definition boundaries and package invariant checks already exist |
| Missing provenance/event store | Falsified as a blanket claim | Strong Session/Delivery identities; some planned crosslinks and weaker Eval refs |
| All leases need Generic Runtime | Not established | Lease subjects and recovery obligations differ; Eval explicitly reuses RepoWorkspace |
| Missing Memory/governance/promotion | Falsified | Knowledge review/stale/release and Memory human acceptance/expiry/retirement exist |
| Capability lifecycle absent | Falsified | Installation, scope, version/generation, replacement, guards and diagnostics exist by type |
| Credential Plane absent means secrets have no owner | Falsified | CredentialProvider exists; same-user isolation and cost authorization are separate |
| RIR is already an investment engine | Falsified | PR #79 has only a spec; Planning already has ordering and estimates |
| No experience-learning loop | Falsified as blanket claim | Task recovery, manual incident improvements and review/promotion loops exist |
| SSP/Domain Runtime missing because not merged | Falsified | Unmerged implementation exists; production effects/real capture remain bounded limitations |

Architecture smells explicitly rejected: duplicating Planning/Queue/Session truth; a second Agent loop; a new scheduler for trigger integration; a universal Artifact store above existing refs/evidence; a policy engine overriding SSP/Host/human approval; a God Plane owning context, events, state and execution; and generalizing from only FC27 or one Browser task. These are risks of proposed abstractions, not allegations that every smell already exists in master.

## 7. Cross-project Lessons

External sources were consulted only after the internal hypothesis and active-work audit. They support implementation patterns for already confirmed unfinished contracts, never the existence of a DSH gap. No full external product survey or vendor adoption is proposed.

### GitHub webhook delivery

Observed pattern: stable delivery identity survives redelivery; authentication and event/action validation precede handling. Failed deliveries are not automatically redelivered. Problem it solves: repeated, missed or forged ingress. DSH analogue: existing VerifiedWebhookDelivery lacks durable dedup/receipt, and future Activation bridges are explicitly deferred. Transferability: adapt identity and reconciliation at the future bridge; do not replace the scheduler or treat HTTP success as business completion. Sources: [GitHub best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks), [failed delivery handling](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries).

### LangSmith evaluation separation

Observed pattern: offline regression uses curated examples to compare versions; code evaluators and model judges are distinct approaches. Problem it solves: separating benchmark evidence from production impressions and choosing an appropriate oracle. DSH analogue: the existing Eval roadmap needs trustworthy execution evidence and independent acceptance, not merely an Agent success claim. Transferability: adapt the separation of test inputs, observed runs and evaluators into existing Eval contracts; inspiration only for presentation. The external pattern does not prove OS isolation or replace DSH human approval. Source: [LangSmith evaluation types](https://docs.langchain.com/langsmith/evaluation-types).

## 8. Architecture Candidates

None newly justified at L4. Existing Activation, Budget, Eval and RIR designs are not erased by this result, nor promoted to a larger architecture. Two implementations using a word such as lease, context or evidence do not establish a shared unmet responsibility.

## 9. Build Candidates

This audit does not have enough evidence to support immediately adding a new system Plane. No new L5 build candidate is proposed. Existing scoped Issues retain their own specification, dependencies and acceptance; this audit is not an implementation authorization or a replacement prioritization decision.

## 10. Watchlist

| Watch item | Maturity | Evidence required to upgrade |
| --- | --- | --- |
| Context arbitration | L1 | Two real tasks lose required information through competing domain inputs despite existing local bounds; retain exact request/log evidence |
| Causal query | L1 | Two concrete investigations cannot connect existing typed identities/refs; identify the missing edge before adding any index |
| Generic Runtime | L1 | Two domains require the same currently unrepresentable lease semantics after #52/#53 reuse is tested |
| Knowledge semantics | L1 | Source-backed contradictory claims escape current checks in two distinct real tasks; human judgments retained |
| Capability lifecycle omissions | L2 | Actual MCP troubleshooting, missing-Skill or unused-generation resource traces justify a narrow owner change |
| Portfolio comparison | L1 | Two real allocation decisions cannot be expressed/reconstructed through Planning review, Session and refs |
| Experience automation | L1 | Repeated reviewed corrections demonstrate value beyond existing manual loops; independent evaluation rejects unsafe promotion |
| Owner documentation accuracy | L2 | A concrete contradictory claim is linked to current source; repair original owner, not a parallel inventory |

Model improvement could substantially reduce the value of custom relevance scoring, portfolio reasoning, semantic duplicate heuristics and generic experience summarizers; those should be tested with prompts/Skills/manual review first. It does not remove the need for durable identity, exact human authority, revocation, atomic admission, source validity or independent execution evidence. This distinction is an architectural inference, not a prediction of any vendor release.

## 11. Final Matrix

| Candidate | Classification | Maturity | Existing Owner | Evidence Strength | Recommended Action |
| --- | --- | --- | --- | --- | --- |
| H1 Cross-domain Context | PARTIAL | L1 | systemPrompt / loop / Session / domain contributors | High existing chain; low repeated-gap evidence | observe |
| H2 Ownership enforcement | PARTIAL | L2 | operation owners / Cordis / package checks | Mechanisms exist; 67 baseline compliance findings | repair within existing checks; no new Plane |
| H3 Causal trace | PARTIAL | L1 | SessionQuery / Delivery / Eval / Queue | High domain provenance; global query need uncertain | observe; reuse refs |
| H4 Generic Runtime | HYPOTHESIS | L1 | RepoWorkspace / Queue / Browser / SSP | Distinct contracts established; abstraction need weak | do nothing; reuse #52 |
| H5 External triggers | PLANNED | L2 | Activation #42 + ingress/Goal/Queue | High narrow contract; generic bridges deferred | extend existing owners |
| H6 Knowledge governance | PARTIAL | L1 | KnowledgeBase / Memory / Content | High lifecycle; semantic generalization weak | observe |
| H7 Capability lifecycle | PARTIAL | L2 | Tool / Skill / Preset / MCP / Loader | High local omissions; no repeated incident proof | narrow owner extension |
| H8 Credentials and authority | PARTIAL | L2 | Credentials / Host / Browser / Budget / Eval | High boundaries; isolation acceptance incomplete | existing planned owners |
| H9 Portfolio | PARTIAL | L1 | Planning; RIR assessment planned | Ordering exists; new-owner necessity unproved | observe / no-build review |
| H10 Experience improvement | PARTIAL | L1 | feedback / Browser / Planning / Memory / Eval / Skill | Real local/manual loops; generic automation unproved | observe |
| N1 Trusted Eval execution | PLANNED | L2 | Eval #49–#60 | High implementation/roadmap contrast | extend existing owners |
| N2 Usage admission | PLANNED | L2 | Budget #43 / LLM runtime | High scoped missing-contract evidence | extend planned owner |
| N3 Owner prose drift | PARTIAL | L2 | Skill owner docs / source checks | Direct source/prose contradiction | separate documentation repair |

Maturity in a PARTIAL row refers to the stated remainder, not the maturity of the existing product. H5’s future ingress bridges are DEFERRED_BY_DESIGN; H9’s new dedicated owner remains HYPOTHESIS. No composite score is calculated. No candidate is assigned CONFIRMED_GAP merely because a package name, dedicated record or unified dashboard is absent.

## 12. Verification and Evidence

Audit scope: master source/schema/service definitions/runtime wiring and profile patches; root, package and docs AGENTS; architecture/subsystems/owner READMEs and active decision notes; active specs, all visible open Issues/PRs and relevant branch code. Archived notes were not treated as current authority. No product implementation, refactor, real provider request or Browser/FC business write was performed. Only this audit and its bilingual pairing are intended for delivery.

Placement: the requested docs/audits directory contains a dated reference snapshot. Status and fixed commits are essential audit evidence rather than rolling architecture authority. This document does not modify an owner contract or create an architecture decision. Existing contradictory prose and unrelated baseline failures are deliberately not repaired.

Reproducibility: check out the exact baseline and use the pinned source links below; compare active refs at their recorded commit rather than current branch tips. Repeat open Issue/PR searches separately because remote state changes. Negative findings are bounded by the inspected owners and visible sources; private local work, secret values, runtime deployment state and undisclosed branches are not evidence here.

Baseline static checks were run before authoring: verify-md-links reported 19 findings; verify-md-wrap reported 36; verify-translation-pairing reported 136. The repository test:docs wrapper failed before its gates because the tsx CLI could not open a local IPC pipe (EPERM). Direct node --import tsx entrypoints allowed the three static checks above. These are baseline/tooling results, not new audit defects. The local audit did not run product tests, full build, full lint/doc-sync or live model/browser acceptance; remote CI execution is reported separately below.

Final focused validation results are recorded in the delivery PR or accompanying delivery note; source citation existence/ranges, bilingual structure, Markdown links/wrap, patch scope and exact baseline are checked without changing product code. Source tests and PR-reported acceptance are cited as evidence inspected, never as tests rerun by this audit.

### CI follow-up on the audit delivery

The first audit commit 70e3ab330b6934a0cd7e8817772bbf2ed9099fb4 produced two failed CI workflows. Linux failed verify-package-invariants with the 67 findings described in H2; exact baseline and head static outputs were byte-identical. The later verify-doc-graphs --check step did not execute in that CI run; separate read-only checks on both revisions reported the same 12 missing role classifications: browser, browserActivity, browserMonitor, browserTasks, content, contentBrowser, contentRemote, contentSession, knowledgeBase, knowledgeQueue, planning and planningDelivery. Absolute checkout paths in stack traces differ, so only the semantic graph error is identical. These findings are recorded, not repaired. [Linux job](https://github.com/changanhua/deepseek-harness/actions/runs/36777835841/job/110100135072).

Windows repository build succeeded, then personal-source-distribution had one passing and one failing test: five plugins did not activate. session-projection-cache and delivery-local waited for storageDomain; delivery-task-queue and delivery-remote waited for delivery; runtime-probe waited for delivery and deliveryRemote. The relevant product source, configuration, fixture, workflow and lockfile are unchanged from the exact baseline. No document-induced cause was identified from that comparison, but the Windows baseline runtime was not independently rerun, so the runtime cause remains unconfirmed. C0 reported job success after scope detection, with its substantive gates/tests skipped; that is not a C0 test pass. Client typecheck after the failing Windows step was not reached. [Windows job](https://github.com/changanhua/deepseek-harness/actions/runs/36777835811/job/110100135124), [C0 scope job](https://github.com/changanhua/deepseek-harness/actions/runs/36777835811/job/110100135286).

CI ran synthetic merge commit b1296a34bc4859622f6533595772eac53049ea90, whose tree c71401bc9c3d1226420da95cefb10991fcbf4b91 was independently confirmed equal to the first audit commit. The local static baseline comparison used the exact baseline and audit head, not an unrelated branch.

### Frozen branch inventory and negative-search boundary

The following 56 refs are the complete visible branch snapshot used for the exclusion checks. Reproduce directory evidence with git ls-tree -r --name-only COMMIT and git rev-parse COMMIT:packages/eval. For unmerged owner work, compare git diff --name-status from git merge-base(BASELINE, COMMIT) to COMMIT over packages/mcp, packages/skill and packages/preset, and separately over the Eval/Goal/Workflow/Queue/LLM owner paths. Missing package names are only one probe; implementation conclusions also use the source and Issue contracts above.

| Branch at snapshot | Commit | packages/eval tree |
| --- | --- | --- |
| `architecture-explorer-assets` | [`4032b71f2a0e1e6c06ac1350bea495f3d4e11539`](https://github.com/changanhua/deepseek-harness/commit/4032b71f2a0e1e6c06ac1350bea495f3d4e11539) | — |
| `codex/architecture-explorer` | [`7d4adda41c72753a1a127d9de36f6a6527470276`](https://github.com/changanhua/deepseek-harness/commit/7d4adda41c72753a1a127d9de36f6a6527470276) | — |
| `codex/architecture-explorer-base` | [`7606e15ab69836d053b3ac2c35e1c7a4281f9b1e`](https://github.com/changanhua/deepseek-harness/commit/7606e15ab69836d053b3ac2c35e1c7a4281f9b1e) | — |
| `codex/browser-cognition-alignment-20260923` | [`0626052e73bed8799b8baef0a82e930453892e83`](https://github.com/changanhua/deepseek-harness/commit/0626052e73bed8799b8baef0a82e930453892e83) | `697218857e06427b5e6d900b4f8c8d21f7f0b715` |
| `codex/browser-page-model-v1` | [`a10b51ce0dbd884ec246c62e4c8381516202abfb`](https://github.com/changanhua/deepseek-harness/commit/a10b51ce0dbd884ec246c62e4c8381516202abfb) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/browser-semantic-map` | [`373adc182f539c2fbba0097cbb5c996e893471ca`](https://github.com/changanhua/deepseek-harness/commit/373adc182f539c2fbba0097cbb5c996e893471ca) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/control-mcp-isolated` | [`14ab024ee62ccc1a25305ec149a47fbea45b7cfe`](https://github.com/changanhua/deepseek-harness/commit/14ab024ee62ccc1a25305ec149a47fbea45b7cfe) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/delivery-c0` | [`f6c961c44e05cc8d7eb1c1704a8bd682463b1ebd`](https://github.com/changanhua/deepseek-harness/commit/f6c961c44e05cc8d7eb1c1704a8bd682463b1ebd) | — |
| `codex/delivery-c0-windows-durability-deps` | [`ed08c90a9e356e690af3e937d1171104aa6ec91d`](https://github.com/changanhua/deepseek-harness/commit/ed08c90a9e356e690af3e937d1171104aa6ec91d) | — |
| `codex/delivery-contract` | [`ce633df6c54f5291cb020a8bf59742ab51544d9d`](https://github.com/changanhua/deepseek-harness/commit/ce633df6c54f5291cb020a8bf59742ab51544d9d) | — |
| `codex/delivery-d1-local` | [`e127eee5090ddfa33fafec4729fcb200d2773a1f`](https://github.com/changanhua/deepseek-harness/commit/e127eee5090ddfa33fafec4729fcb200d2773a1f) | — |
| `codex/delivery-d2-workspace-evidence` | [`c807cdb779bc274ba5d528e8ba584f8ae59ec6a3`](https://github.com/changanhua/deepseek-harness/commit/c807cdb779bc274ba5d528e8ba584f8ae59ec6a3) | — |
| `codex/delivery-d3-codex-runner` | [`8bc5f4ef8f83dba51b314419332d8e9b10ebff51`](https://github.com/changanhua/deepseek-harness/commit/8bc5f4ef8f83dba51b314419332d8e9b10ebff51) | — |
| `codex/delivery-d4-verifier` | [`9b45563c3b9f0b2ca7a789bbea23291ee323628c`](https://github.com/changanhua/deepseek-harness/commit/9b45563c3b9f0b2ca7a789bbea23291ee323628c) | — |
| `codex/delivery-d5-github-intake` | [`b9093af522ed99bbf7a997d5269e420fbd0f7dac`](https://github.com/changanhua/deepseek-harness/commit/b9093af522ed99bbf7a997d5269e420fbd0f7dac) | — |
| `codex/delivery-d6-remote-ui` | [`68deab5836c872199d90b683d23a4dbfecc7d86d`](https://github.com/changanhua/deepseek-harness/commit/68deab5836c872199d90b683d23a4dbfecc7d86d) | — |
| `codex/delivery-gate-b-proof` | [`a580dcb1917454b76a18960201eb45fcde298634`](https://github.com/changanhua/deepseek-harness/commit/a580dcb1917454b76a18960201eb45fcde298634) | — |
| `codex/delivery-i1-queue-bridge` | [`36a4f57ed1ae7c9cfe3bda3873b271df0f5a2427`](https://github.com/changanhua/deepseek-harness/commit/36a4f57ed1ae7c9cfe3bda3873b271df0f5a2427) | — |
| `codex/delivery-i2-bundle-e2e` | [`2e3b29ca1a8972ba51c99e35fcfbe7a689bc42d6`](https://github.com/changanhua/deepseek-harness/commit/2e3b29ca1a8972ba51c99e35fcfbe7a689bc42d6) | — |
| `codex/delivery-queue-readiness` | [`858892b33a0b168272d36b3c8cdfd5073f456d6f`](https://github.com/changanhua/deepseek-harness/commit/858892b33a0b168272d36b3c8cdfd5073f456d6f) | — |
| `codex/delivery-spike-codex` | [`1df9b53b2c56cda31ff8e80a969eb6c94b8e3251`](https://github.com/changanhua/deepseek-harness/commit/1df9b53b2c56cda31ff8e80a969eb6c94b8e3251) | — |
| `codex/delivery-spike-queue` | [`bf3e3ddeda3fb3c19d1ebb15311eaa62fa2b499d`](https://github.com/changanhua/deepseek-harness/commit/bf3e3ddeda3fb3c19d1ebb15311eaa62fa2b499d) | — |
| `codex/downstream-governance` | [`f2b2fb0b4603863cfe6026ad78a890adbef2188c`](https://github.com/changanhua/deepseek-harness/commit/f2b2fb0b4603863cfe6026ad78a890adbef2188c) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/downstream-maintenance-policy-port` | [`9d052f241ea3aa842873efaf867b6254843eda38`](https://github.com/changanhua/deepseek-harness/commit/9d052f241ea3aa842873efaf867b6254843eda38) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/eval-scenario-design` | [`7f8927a73e066046df64d73dddf06dbe76eb60fb`](https://github.com/changanhua/deepseek-harness/commit/7f8927a73e066046df64d73dddf06dbe76eb60fb) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/fork-linux-compute` | [`1eb34610ca88e8bc2b05079f6350d49710d90fce`](https://github.com/changanhua/deepseek-harness/commit/1eb34610ca88e8bc2b05079f6350d49710d90fce) | — |
| `codex/fork-linux-compute-master` | [`2a7bf484afb7ec4abf6d0d4733591337ffa3f96d`](https://github.com/changanhua/deepseek-harness/commit/2a7bf484afb7ec4abf6d0d4733591337ffa3f96d) | — |
| `codex/fork-windows-ci` | [`21acf271d364c0dacaec691f51229f199561e581`](https://github.com/changanhua/deepseek-harness/commit/21acf271d364c0dacaec691f51229f199561e581) | — |
| `codex/fork-windows-ci-args` | [`f75144dbc0c8c22792c1f459216ac5b896a5d331`](https://github.com/changanhua/deepseek-harness/commit/f75144dbc0c8c22792c1f459216ac5b896a5d331) | — |
| `codex/fork-windows-ci-pnpm` | [`7bee0add32fb6f4a73cbf61e7963dd7316a7de0b`](https://github.com/changanhua/deepseek-harness/commit/7bee0add32fb6f4a73cbf61e7963dd7316a7de0b) | — |
| `codex/fork-windows-ci-scope` | [`7945fcf580faef789d8d16b90f380449435e71f1`](https://github.com/changanhua/deepseek-harness/commit/7945fcf580faef789d8d16b90f380449435e71f1) | — |
| `codex/incremental-planning` | [`ee35ae9398f9e2bf4a848822390122ed30372db9`](https://github.com/changanhua/deepseek-harness/commit/ee35ae9398f9e2bf4a848822390122ed30372db9) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/master-backup-before-upstream-candidate-20260915` | [`d3421cf170d6729978d93f22db40b633274ec5a9`](https://github.com/changanhua/deepseek-harness/commit/d3421cf170d6729978d93f22db40b633274ec5a9) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/merge-reuse-agent-instructions` | [`e2af960a81b97159d392e324bdeafcc23e60e591`](https://github.com/changanhua/deepseek-harness/commit/e2af960a81b97159d392e324bdeafcc23e60e591) | — |
| `codex/pcp-composition-proposal` | [`6aa2a0e66816ba3483c59d1c4de2e99dff650779`](https://github.com/changanhua/deepseek-harness/commit/6aa2a0e66816ba3483c59d1c4de2e99dff650779) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/personal-delivery-foundation` | [`527338cf077a475e82b718faa12cc16bfc82283f`](https://github.com/changanhua/deepseek-harness/commit/527338cf077a475e82b718faa12cc16bfc82283f) | — |
| `codex/personal-delivery-rollup` | [`f3e056333e0dc80fa7db379065857b0c9523ef21`](https://github.com/changanhua/deepseek-harness/commit/f3e056333e0dc80fa7db379065857b0c9523ef21) | — |
| `codex/personal-mainline-integration` | [`ae2fa15c1289aa3161feccf422ba4abb3857daec`](https://github.com/changanhua/deepseek-harness/commit/ae2fa15c1289aa3161feccf422ba4abb3857daec) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/planning-ui-workspace` | [`78a9d52c2accbdf5e026b4114a86a4285bbf0e5b`](https://github.com/changanhua/deepseek-harness/commit/78a9d52c2accbdf5e026b4114a86a4285bbf0e5b) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/pr1-tool-terminal-state` | [`a3a1b95f771b9feca986d071e916ac6f28243d59`](https://github.com/changanhua/deepseek-harness/commit/a3a1b95f771b9feca986d071e916ac6f28243d59) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/project-context-baseline` | [`8c5cfc4440aa17d2224664053b73ce64b99981d9`](https://github.com/changanhua/deepseek-harness/commit/8c5cfc4440aa17d2224664053b73ce64b99981d9) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/project-memory-mainline` | [`c2798b2e804a61936c0da431300af65cfb798636`](https://github.com/changanhua/deepseek-harness/commit/c2798b2e804a61936c0da431300af65cfb798636) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/requirement-investment-review-wp1` | [`3e670dd29ca056fff8efb831d9ee3693024d3755`](https://github.com/changanhua/deepseek-harness/commit/3e670dd29ca056fff8efb831d9ee3693024d3755) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/session-review-v0` | [`8e41cc18d55427f011423df027b0f1930b4a25e7`](https://github.com/changanhua/deepseek-harness/commit/8e41cc18d55427f011423df027b0f1930b4a25e7) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/side-effect-safety-plane` | [`a607f579d781aab0ef247dd1089198c5110f95a2`](https://github.com/changanhua/deepseek-harness/commit/a607f579d781aab0ef247dd1089198c5110f95a2) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/task-queue-service-authorization` | [`9df74bfc4c1e5213c79af8d3c5c9c14deb03d1e2`](https://github.com/changanhua/deepseek-harness/commit/9df74bfc4c1e5213c79af8d3c5c9c14deb03d1e2) | — |
| `codex/working-context-v0` | [`eb00de8d41df7e4bb1ea89b62882efed63945f90`](https://github.com/changanhua/deepseek-harness/commit/eb00de8d41df7e4bb1ea89b62882efed63945f90) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `docs/architecture-intelligence` | [`0d1ea7303298aa0562673a8fae1738e083a4e25b`](https://github.com/changanhua/deepseek-harness/commit/0d1ea7303298aa0562673a8fae1738e083a4e25b) | — |
| `docs/runtime-awareness-clean` | [`8ae68fc1a23b8ce3137a76bd23b90748a1524945`](https://github.com/changanhua/deepseek-harness/commit/8ae68fc1a23b8ce3137a76bd23b90748a1524945) | — |
| `docs/runtime-awareness-design` | [`e1085c49c38da0b8604b416924f1c5491851b1ce`](https://github.com/changanhua/deepseek-harness/commit/e1085c49c38da0b8604b416924f1c5491851b1ce) | — |
| `dot/domain-runtime-plane` | [`7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2`](https://github.com/changanhua/deepseek-harness/commit/7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `integrate/ssp-wp1` | [`f64e9699ef5d2f1aeec954f3356b940a5eca136e`](https://github.com/changanhua/deepseek-harness/commit/f64e9699ef5d2f1aeec954f3356b940a5eca136e) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `intelligence/phase0` | [`f425ef240f4c287ab6b34a18789ae4bc97a8f5c7`](https://github.com/changanhua/deepseek-harness/commit/f425ef240f4c287ab6b34a18789ae4bc97a8f5c7) | — |
| `learning/dsh-mastery-course` | [`e421f9dc5d9f93c64247f06c7c8ddfc6883e3de1`](https://github.com/changanhua/deepseek-harness/commit/e421f9dc5d9f93c64247f06c7c8ddfc6883e3de1) | — |
| `master` | [`b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`](https://github.com/changanhua/deepseek-harness/commit/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `tmp/task5-runtime-inspect-trigger` | [`54be7b0e31ec5ec9c40a665061018c7212394bc2`](https://github.com/changanhua/deepseek-harness/commit/54be7b0e31ec5ec9c40a665061018c7212394bc2) | — |

Scan summary: 22 heads contain packages/eval; 21 share the baseline tree. The remaining cognition branch changes invariant companions/documentation/build metadata, not a new trusted Eval executor. Across all visible heads, unmerged MCP/Skill/Preset owner diffs only add the two Thinking Desk preset files on the Planning branch. Goal/Workflow had no unmerged owner changes; the inspected Queue/Eval changes and older LLM type extensions do not implement #42/#43/#49. This is bounded source evidence, not proof against undisclosed work or arbitrary aliases.

### Pinned source ledger

Every E-reference resolves to a specific repository file, symbol and commit. Line ranges are checked against that Git object; source outside master is explicitly pinned to its branch commit. Ranges point to the central contract, and a symbol description may identify additional nearby methods.

<a id="e01"></a>

**E01** — [`packages/core/system-prompt/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/core/system-prompt/src/index.ts#L553-L627) — `SystemPrompt.assemble`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e02"></a>

**E02** — [`packages/core/agent-loop/src/agent.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/core/agent-loop/src/agent.ts#L240-L270) — `preStep; request construction also at 542–629`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e03"></a>

**E03** — [`packages/core/agent-loop/src/runtime-context.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/core/agent-loop/src/runtime-context.ts#L83-L157) — `SystemPromptProjection; RuntimeContextProjection`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e04"></a>

**E04** — [`packages/llm/token-meter/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/llm/token-meter/src/index.ts#L100-L214) — `TokenMeter.measure`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e05"></a>

**E05** — [`packages/core/agent-loop/src/invariant.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/core/agent-loop/src/invariant.ts#L19-L56) — `assert log-derived frozen loop request`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e06"></a>

**E06** — [`packages/core/tools/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/core/tools/src/index.ts#L1466-L1506) — `guarded ToolRuntime execution`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e07"></a>

**E07** — [`packages/runtime-diagnostics/invariants/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/runtime-diagnostics/invariants/src/index.ts#L136-L194) — `InvariantRegistry.register`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e08"></a>

**E08** — [`scripts/package-invariants.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/scripts/package-invariants.ts#L191-L340) — `companion registration and omission validation`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e09"></a>

**E09** — [`packages/core/session/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/core/session/src/index.ts#L669-L744) — `append validation; owned sequence and source event references`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e10"></a>

**E10** — [`packages/session-query/session-query/src/tracing.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/session-query/session-query/src/tracing.ts#L26-L106) — `canonical foldSurface and traceEvent`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e11"></a>

**E11** — [`packages/delivery/delivery-protocol/src/schemas.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/delivery/delivery-protocol/src/schemas.ts#L658-L699) — `human acceptance decision and typed EvidenceRef provenance`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e12"></a>

**E12** — [`packages/delivery/delivery-local/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/delivery/delivery-local/src/index.ts#L940-L1019) — `evidence resolution and acceptance provenance validation`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e13"></a>

**E13** — [`packages/eval/eval/src/run.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/eval/eval/src/run.ts#L47-L70) — `evalCaseResultSchema; evalRunSchema`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e14"></a>

**E14** — [`packages/eval/eval-session-snapshot/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/eval/eval-session-snapshot/src/index.ts#L135-L211) — `recorded identity validation and Session/fixture refs`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e15"></a>

**E15** — [`packages/delivery/repo-workspace/src/types.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/delivery/repo-workspace/src/types.ts#L86-L148) — `change and verification workspace lease contracts`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e16"></a>

**E16** — [`packages/task-queue/task-queue-local/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/task-queue/task-queue-local/src/index.ts#L445-L576) — `claimNext and Attempt execution lifecycle`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e17"></a>

**E17** — [`packages/task-queue/task-queue-local/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/task-queue/task-queue-local/src/index.ts#L824-L859) — `resource and Batch capacity enforcement`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e18"></a>

**E18** — [`packages/webhook/webhook/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/webhook/webhook/src/index.ts#L57-L174) — `VerifiedWebhookDelivery dispatch and effect disposal`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e19"></a>

**E19** — [`packages/schedule/schedule/src/runtime.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/schedule/schedule/src/runtime.ts#L228-L316) — `live reminder maintenance and followup barrier`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e20"></a>

**E20** — [`packages/task-queue/tool-task-queue/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/task-queue/tool-task-queue/src/index.ts#L98-L159) — `pre-step notification injection; durable flush before ack`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e21"></a>

**E21** — [`packages/knowledge/knowledge-base/src/repository.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/knowledge/knowledge-base/src/repository.ts#L707-L848) — `immutable release; current publishability checks; semantic checks not_run`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e22"></a>

**E22** — [`packages/knowledge/knowledge-base/src/repository.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/knowledge/knowledge-base/src/repository.ts#L479-L508) — `current stage input and review fingerprints`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e23"></a>

**E23** — [`packages/memory/memory/src/schema.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/memory/memory/src/schema.ts#L14-L134) — `source-backed revisions and human decisions`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e24"></a>

**E24** — [`packages/memory/memory-local/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/memory/memory-local/src/index.ts#L105-L120) — `accept source and review deadline validation; eligibility at 210–231`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e25"></a>

**E25** — [`packages/content/content/src/schema.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/content/content/src/schema.ts#L48-L125) — `immutable content versions, draft fence, Session source`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e26"></a>

**E26** — [`packages/host/capability-registry/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/host/capability-registry/src/index.ts#L117-L218) — `read-only scoped inventory and MCP projection`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e27"></a>

**E27** — [`packages/skill/skill/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/skill/skill/src/index.ts#L614-L630) — `managementSnapshot; provider diagnostics at 786–847`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e28"></a>

**E28** — [`packages/skill/skill-filesystem/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/skill/skill-filesystem/src/index.ts#L814-L846) — `parseSkillFile: log and discard invalid candidates`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e29"></a>

**E29** — [`packages/preset/agent-presets/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/preset/agent-presets/src/index.ts#L730-L815) — `turn-boundary swap; superseded generation reclamation TODO`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e30"></a>

**E30** — [`packages/mcp/mcp-client/src/connection.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/mcp/mcp-client/src/connection.ts#L137-L287) — `generation-bound connection, refresh and retry lifecycle`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e31"></a>

**E31** — [`packages/credentials/credentials/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/credentials/credentials/src/index.ts#L170-L247) — `CredentialProvider reference and record APIs`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e32"></a>

**E32** — [`packages/credentials/credentials-local/README.md`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/credentials/credentials-local/README.md#L113-L115) — `same-user filesystem access is not secret isolation`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e33"></a>

**E33** — [`packages/planning/planning/src/schema.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/planning/planning/src/schema.ts#L95-L106) — `planningEstimateSchema; Board and mutations at 277–346`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e34"></a>

**E34** — [`packages/client/ui-planning/src/client/projections.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/client/ui-planning/src/client/projections.ts#L3-L25) — `planningPriorityScore`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e35"></a>

**E35** — [`packages/planning/planning-local/src/store.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/planning/planning-local/src/store.ts#L343-L389) — `manual order, dependencies, revision-bound reviews`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e36"></a>

**E36** — [`packages/browser/browser-task/src/failure.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/browser/browser-task/src/failure.ts#L4-L38) — `stable deterministic failure fingerprint`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e37"></a>

**E37** — [`packages/browser/browser-task/src/evidence.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/browser/browser-task/src/evidence.ts#L27-L49) — `changed-precondition recovery proof`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e38"></a>

**E38** — [`docs/specs/2026-10-01-requirement-investment-review-wp1.md`](https://github.com/changanhua/deepseek-harness/blob/3e670dd29ca056fff8efb831d9ee3693024d3755/docs/specs/2026-10-01-requirement-investment-review-wp1.md#L399-L438) — `RIR non-goals and reuse boundaries`; commit `3e670dd29ca056fff8efb831d9ee3693024d3755`.

<a id="e39"></a>

**E39** — [`packages/guard/side-effect-safety/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/f64e9699ef5d2f1aeec954f3356b940a5eca136e/packages/guard/side-effect-safety/src/index.ts#L75-L94) — `restart uncertainty; persist-before-send at 217–238`; commit `f64e9699ef5d2f1aeec954f3356b940a5eca136e`.

<a id="e40"></a>

**E40** — [`downstream/plugins/session-review/README.md`](https://github.com/changanhua/deepseek-harness/blob/8e41cc18d55427f011423df027b0f1930b4a25e7/downstream/plugins/session-review/README.md#L5-L24) — `implementation candidate; no automatic promotion`; commit `8e41cc18d55427f011423df027b0f1930b4a25e7`.

<a id="e41"></a>

**E41** — [`.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md#L33-L77) — `private maintenance proposal and partial trial evidence`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e42"></a>

**E42** — [`packages/skill/skill/README.md`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/skill/skill/README.md#L143-L152) — `stale negative statements about diagnostics and shadow inspection`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e43"></a>

**E43** — [`packages/goal/goal/README.md`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/goal/goal/README.md#L158-L161) — `goal state, round cap and scheduling boundary`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e44"></a>

**E44** — [`packages/workflow/workflow/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/workflow/workflow/src/index.ts) — `WorkflowEngine definition and run ownership`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e45"></a>

**E45** — [`packages/bundle/base/cordis.patch.yml`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/bundle/base/cordis.patch.yml) — `base profile composition`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e46"></a>

**E46** — [`packages/bundle/personal-memory/cordis.patch.yml`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/bundle/personal-memory/cordis.patch.yml) — `explicit Memory add-on`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e47"></a>

**E47** — [`packages/bundle/personal-delivery/cordis.patch.yml`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/bundle/personal-delivery/cordis.patch.yml) — `explicit Delivery composition`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e48"></a>

**E48** — [`packages/bundle/personal-planning/cordis.patch.yml`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/bundle/personal-planning/cordis.patch.yml) — `explicit Planning composition`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e49"></a>

**E49** — [`packages/context/runtime-facts/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/context/runtime-facts/src/index.ts#L160-L188) — `baseline relevance and exposure; freshness at 220–267`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e50"></a>

**E50** — [`packages/skill/tool-skill/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/skill/tool-skill/src/index.ts#L153-L174) — `invocation checks and full Skill body result`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e51"></a>

**E51** — [`packages/browser/browser-extension/README.md`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/browser/browser-extension/README.md#L30-L54) — `grant, epoch, page, receipt and quiescence boundaries`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e52"></a>

**E52** — [`packages/test-support/session-snapshot/src/launcher.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/test-support/session-snapshot/src/launcher.ts#L119-L143) — `formal profile launch; environment inheritance`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e53"></a>

**E53** — [`docs/postmortem/0003-web-agent-gui-feedback-loop.md`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/docs/postmortem/0003-web-agent-gui-feedback-loop.md#L5-L46) — `resolved incident with Session evidence and corrections`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e54"></a>

**E54** — [`docs/postmortem/0005-web-merge-runtime-regressions.md`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/docs/postmortem/0005-web-merge-runtime-regressions.md#L5-L44) — `resolved incident and regression prevention`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e55"></a>

**E55** — [`docs/specs/2026-10-01-domain-runtime-plane-fc27-first-adapter.md`](https://github.com/changanhua/deepseek-harness/blob/7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2/docs/specs/2026-10-01-domain-runtime-plane-fc27-first-adapter.md) — `Phase A design authority`; commit `7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2`.

<a id="e56"></a>

**E56** — [`packages/planning/planning/src/context.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/planning/planning/src/context.ts#L5-L29) — `buildPlanningContext; opaque ResourceRefs`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e57"></a>

**E57** — [`apps/cli/src/plugin.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/apps/cli/src/plugin.ts#L120-L162) — `runPlugin profile package transaction`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e58"></a>

**E58** — [`packages/domain-runtime/domain-runtime/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2/packages/domain-runtime/domain-runtime/src/index.ts) — `Domain Artifact registry implementation`; commit `7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2`.

<a id="e59"></a>

**E59** — [`packages/domain-runtime/fc-sbc-domain/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2/packages/domain-runtime/fc-sbc-domain/src/index.ts) — `FC domain service implementation`; commit `7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2`.

<a id="e60"></a>

**E60** — [`outputs/issue-77/verification-report.md`](https://github.com/changanhua/deepseek-harness/blob/7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2/outputs/issue-77/verification-report.md) — `Phase A historical verification report; not current publication status`; commit `7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2`.

<a id="e61"></a>

**E61** — [`packages/goal/tool-goal/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/goal/tool-goal/src/index.ts#L188-L210) — `Goal prompt section`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e62"></a>

**E62** — [`packages/planning/planning-delivery-bridge/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/planning/planning-delivery-bridge/src/index.ts#L105-L168) — `Planning generation to Delivery Case and durable handoff`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

## Dev Note

No implementation is proposed by this audit. Watchlist recommendations remain non-authoritative hypotheses until their stated evidence and ownership tests are met.
