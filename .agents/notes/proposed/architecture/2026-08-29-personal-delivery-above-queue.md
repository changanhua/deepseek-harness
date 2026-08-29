# Agent Note: Personal Delivery composes above the durable Queue

Status: proposed

English | [中文](2026-08-29-personal-delivery-above-queue.zh.md)

## Problem

DSH can run rich Agent Sessions and Queue v2 can preserve typed Work, Attempts, results, retries, resource claims, and crash uncertainty across process restarts. Neither capability owns an approved GitHub requirement revision, a bounded code packet, an isolated Git worktree, independent verification evidence, or the user's acceptance decision. Treating a Session or an Agent's final message as the delivery record would make execution narration authoritative and would lose cross-Session continuity.

Running easyGo as a second control plane would add another Work/Attempt scheduler, worker lease, retry model, and operator state beside Queue v2. Moving all delivery semantics into Queue core would create the opposite coupling: generic scheduling would import GitHub, Git, Codex, verification, and product-acceptance policy. A monolithic Delivery plugin would keep those concerns out of Queue but would still prevent independent replacement and lifecycle ownership.

Personal Delivery requires two capabilities that must remain narrower than the product domain. Trusted Queue operator admission must create ownerless work without exposing generic enqueue authority to a browser. Codex execution must accept an explicit Attempt-owned cwd without inventing a supervisor Session or publishing a generic executor registry.

## Proposal

Personal Delivery is a profile bundle that composes independent DSH plugins above the [durable Queue](../../../../docs/subsystems/task-queue.md). Delivery owns immutable requirement adoption and human decisions; Queue keeps its existing authority over Work and Attempts. Git owns commit identity, Session owns transcript, evidence storage owns bytes, and Runtime Facts owns advisory capacity observations.

The first implementation lives in the fork's `packages/delivery/` group because it depends on the fork-owned Queue v2 contracts. The bundle contains composition only. Queue core does not import Delivery, GitHub, Git workspace, verifier, executor, Remote, or UI packages. Intake calls Delivery rather than Queue; `delivery-task-queue` alone consumes Delivery and Queue, declares the Delivery WorkKinds, and registers their handlers.

The [MVP contract](../../../../docs/specs/2026-08-29-personal-delivery-mvp.md) limits the first vertical slice to manual GitHub Issue import, one local repository, Codex execution, fixed-command verification, local evidence, and explicit human acceptance. [Protocol V1](../../../../docs/specs/2026-08-29-delivery-protocol-v1.md) owns the durable object meanings, while the [multi-PR plan](../../../../docs/specs/2026-08-29-personal-delivery-multi-pr-plan.md) owns implementation order and path exclusivity.

### Package topology

The proposal fixes fifteen package roles before parallel implementation. The [`packages/delivery` map](../../../../packages/delivery/README.md) owns the per-package navigation; this note owns why the roles stay separate.

| Layer | Packages | Responsibility |
| --- | --- | --- |
| Shared foundations | `delivery-protocol`, `delivery`, `repo-workspace`, `delivery-evidence`, `delivery-testkit` | Freeze Queue-independent data, three Service Definitions, runtime schemas, fixtures, and contract fakes. |
| Replaceable providers and integrations | `delivery-local`, `repo-workspace-git-local`, `delivery-evidence-local`, `delivery-runner-codex`, `delivery-verifier`, `delivery-github-intake`, `delivery-remote`, `delivery-task-queue` | Implement one owned mechanism each without editing another Wave package or the frozen protocol. |
| Product composition | `client/ui-delivery`, `bundle/personal-delivery` | Render derived state and select plugins; neither package becomes a durable authority. |

Only three public host services exist: `Delivery` at `ctx.delivery`, `RepositoryWorkspace` at `ctx.repoWorkspace`, and `DeliveryEvidence` at `ctx.deliveryEvidence`. Local providers subclass those definitions; `delivery-testkit` supplies contract-conformant fakes. No executor, verifier, intake, Remote, UI, or bundle package declares another Delivery context key.

`delivery-protocol` exports durable objects, strict runtime schemas, golden fixtures, and the intent/resolved/output DTOs for `code.change@1` and `code.verify@1`. It does not depend on Queue, augment `WorkKindMap`, define live prepared values, or register a handler. This keeps Delivery persistence, providers, test fakes, Remote DTOs, and UI projections usable without importing Queue lifecycle types.

### Capability ownership

| Fact or behavior | Owner | Negative guarantee |
| --- | --- | --- |
| Current Issue text and product acceptance wording | GitHub | Delivery does not silently overwrite it. |
| Adopted immutable requirement and bounded Packet | Delivery | Queue does not interpret product scope. |
| Work, Attempt, retry, cancellation, Result, Receipt, and Attention | Queue v2 | Delivery stores no duplicate Attempt or retry state. |
| Base, worktree, checkpoint, target commit, and diff | Git workspace plugin | Session cwd is not execution authority. |
| Completion statement | Executor output as `CompletionClaim` | A claim cannot verify or accept itself. |
| Verification checks and evidence | Independent verifier and evidence storage | Executor text is not verification evidence. |
| Acceptance, rejection, or waiver | Human-authored Delivery decision | No Agent or automatic rule accepts delivery. |
| Ready, Running, Review, Blocked, and Accepted lanes | UI projection | The lanes are not a writable durable status. |

`ContractRevision`, `WorkPacket`, `DispatchBinding`, `CompletionClaim`, `VerificationVerdict`, `AcceptanceDecision`, and `EvidenceRef` are Delivery protocol objects. Queue's existing `WorkItem`, `WorkAttempt`, `WorkResult`, `Receipt`, and `Attention` remain unchanged in meaning. `ResumeCapsule` is a derived Evidence object compiled from those authorities; it is not another lifecycle record.

The Bridge proposes provider-neutral `code.change@1` and `code.verify@1` WorkKinds. `delivery-task-queue` is their sole declaration-merging and runtime-registration owner; prepared values stay local to that package. Queue success for change work records a typed completion claim. Verification runs as separate work against the exact checkpoint commit. Only a matching passed verdict permits an ordinary acceptance; an explicit human waiver records the override.

Delivery and Queue cannot commit one transaction. Delivery therefore persists a `submitting` binding with a deterministic Queue idempotency key before enqueue, then records the returned Work id. Restart repeats unfinished enqueue with the same key and input; Queue returns the original id whether the earlier call committed or not. A bound id that Queue cannot resolve becomes corruption Attention and never causes admission under another key.

### Technical gates

Gate A extends trusted operator admission without exposing generic enqueue to the browser. Ownerless admission uses operator authority, operator-scoped idempotency, `ownerSessionId: null`, and no Session Notification. The same Queue change closes the immediate post-start ownership gap: if the running append fails after `LiveAttempt` exists, the provider aborts its controller, requests `LiveAttempt.cancel()`, observes cancellation and `live.done` within the configured bound, and only then records `unknown` plus Attention. Cancellation rejection, deadline, a conflicting late outcome, or another persistence failure remains post-start evidence; Queue never reclassifies it as `not-started` or automatically retries it. A deadline preserves durable uncertainty rather than an in-process handle or resource claim, so operator-authorized retry requires external proof that the prior effect is quiescent.

Gate B proves real Codex execution in a disposable explicit worktree, cancellation propagation, whole-process-tree quiescence, and truthful terminal classification. The supported `@deepseek-ai/dsh-subagent-codex/app-server-run` subpath exposes the parent-free explicit-cwd entry while preserving the Session-backed provider adapter at the package root. `delivery-runner-codex` consumes that narrow subpath; no Delivery package deep-imports source or fabricates an Agent or Session.

This proposal deliberately defines no `ctx.codeExecutors` API. One Codex runner and one Delivery consumer justify a supported lifecycle entry, not a provider registry or generic executor Service Definition. Another independent consumer or replaceable provider must supply new evidence before that public surface is reconsidered.

### Parallel implementation boundary

The executable protocol, Service Definitions, fakes, package manifests, and golden fixtures form one frozen base for every implementation Wave. A Wave package consumes that base and edits only its assigned package-local source, tests, README, and Agent Note scope. It must stop when it needs a protocol change, another Wave path, a root dependency, a wider authority surface, or another durable state.

The protocol and fake services make a Wave type-ready, not product-ready. Product readiness additionally requires concrete providers for all three services, the Codex runner, verifier, GitHub intake, Queue bridge, Remote, client workbench, bundle composition, and the vertical acceptance scenarios. Integration owns shared refreshes after parallel work begins.

### Execution and verification invariants

- A Packet binds one Contract revision and full base commit before Queue admission.
- Issue edits create another Contract revision and never mutate an admitted or running Packet.
- Delivery persists a deterministic pending dispatch before Queue enqueue and reconciles it by repeating the same idempotent call after restart.
- `resolveAdmission()` persists immutable executor, repository, policy, and verification facts; `prepare()` starts no Git or process side effect.
- One change Attempt owns one isolated worktree, and executor startup occurs only after Queue has published live ownership.
- A possible side effect followed by lost ownership becomes `unknown` and never auto-retries.
- The governed runner records a clean full checkpoint commit after quiescence, derives changed paths from Git, and proves that the commit descends from the Packet base; Agent prose is not commit authority.
- Verification uses the Packet's resolved fixed argv and Contract/base-blob provenance, never Agent-modified configuration, and targets the completed claim's exact checkpoint commit.
- A passed verdict requires matching ancestry, every required check, no forbidden-path finding, and intact required evidence.
- Evidence carries immutable URI, byte length, digest, type, and provenance; Queue persists references rather than bytes.
- Delivery rebuilds its projection from durable Delivery records and Queue views after restart; transient Queue events improve freshness but are not recovery authority.
- Runtime quota facts can change recommendations only. P0 never starts code work automatically.

## Alternatives considered

**Keep easyGo as a sidecar control plane.** Rejected because its scheduler, workers, leases, retry state, and operator API duplicate Queue v2. Its worktree, validation, evidence, and process-supervision mechanisms remain useful implementation references and tests, not a second runtime authority.

**Implement one `dsh-delivery-desk` plugin.** Rejected because GitHub intake, domain persistence, Git worktree ownership, execution, verification, Remote, and UI have different dependencies, privileges, and failure lifetimes. One installable bundle can preserve a single product experience without one implementation object owning every concern.

**Extend Queue records with Contract, verification, and acceptance fields.** Rejected because Queue is a Work/Attempt scheduler shared by images, host operations, and restricted Agents. Product scope and human acceptance are not generic execution facts.

**Use Session or Goal as the durable delivery owner.** Rejected because one delivery can cross Sessions and executors, while transcript and Round budget remain separate facts. A failed Session must be replaceable without changing Packet identity.

**Create a generic executor registry around the Codex entry.** Rejected because one provider and one consumer do not justify a public capability. The supported `app-server-run` subpath exposes the smallest lifecycle needed by the Delivery-specific runner without adding `ctx.codeExecutors`.

**Start with quota-driven planning and automatic launch.** Rejected because capacity observations cannot compensate for missing immutable scope, isolated execution, recovery, verification, and human acceptance. Runtime Facts remain recommendation input until the vertical delivery loop is reliable.

## Acceptance criteria

- Gate A admits ownerless work idempotently, performs bounded dual-channel cancellation after a post-start durability failure, and records uncertainty without automatic retry when quiescence cannot be proved.
- Gate B modifies only the supplied worktree, cancels the complete Codex process tree, and records evidence for the selected integration path.
- Executable schemas and golden fixtures round-trip every Protocol V1 object and reject invalid ids, digests, commits, command plans, and decision combinations.
- The Queue-independent protocol exports both WorkKind DTO families, while `delivery-task-queue` alone augments Queue and registers their handlers without adding a Delivery dependency to Queue core.
- The fifteen package roles retain their assigned paths, and only `Delivery`, `RepositoryWorkspace`, and `DeliveryEvidence` publish Delivery context keys.
- The Codex runner consumes only the supported `app-server-run` subpath; no generic executor service or source deep import enters the Delivery group.
- Crashes before Queue admission and after Queue admission but before Delivery binding both reconcile to one Work id.
- One Issue revision reaches a checkpoint, independent passed verdict, human acceptance, and restart-stable query result.
- Issue edits, duplicate admission, cancellation, forbidden paths, failed checks, missing evidence, and host restart retain truthful non-accepted outcomes.
- Swapping or adding an executor later does not change Contract, Packet, Claim, Verdict, Evidence, or Acceptance semantics.

## Risks

The fork's Queue API and upstream alpha packages may change while the Delivery group develops. Frozen protocol fixtures and package-local dependencies limit the merge surface, but the integration owner must still measure upstream synchronization cost.

Delivery and Queue persistence can fail on opposite sides of admission. The pending-binding protocol buys deterministic convergence but adds a visible incomplete state; corruption or a missing bound Work fails closed for operator review.

Local evidence storage can become an accidental generic artifact platform. P0 accepts only current code-delivery evidence types; another consumer must justify a broader service, retrieval authority, and retention policy.

Fixed verification commands can still execute repository code. The verifier therefore requires explicit argv, bounded cwd and timeout, trusted-plan provenance, isolated checkout, secret-scrubbed environment, and subprocess-tree quiescence.

An `unknown` code Attempt can leave useful changes and an uncertain external effect. P0 preserves the worktree and requires operator resolution; it gives up automatic recovery rather than risk duplicate mutation or invented success.

The product can expand into a project manager before its delivery loop proves value. The MVP exclusions and acceptance scenarios remain the scope boundary; Planner, automatic launch, multi-host operation, and generalized artifacts require separate evidence and decisions.

The narrow Codex subpath is intentionally less flexible than a registry. A second consumer or provider may later justify a seam, but adding one before that evidence would create selection, registration, and lifecycle policy with no current owner.
