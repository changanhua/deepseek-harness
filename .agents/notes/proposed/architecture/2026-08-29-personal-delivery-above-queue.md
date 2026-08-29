# Agent Note: Personal Delivery composes above the durable Queue

Status: proposed

English | [中文](2026-08-29-personal-delivery-above-queue.zh.md)

## Problem

DSH can run rich Agent Sessions and Queue v2 can preserve typed Work, Attempts, results, retries, resource claims, and crash uncertainty across process restarts. Neither capability owns an approved GitHub requirement revision, a bounded code packet, an isolated Git worktree, independent verification evidence, or the user's acceptance decision. Treating a Session or an Agent's final message as the delivery record would make execution narration authoritative and would lose cross-Session continuity.

Running easyGo as a second control plane would add another Work/Attempt scheduler, worker lease, retry model, and operator state beside Queue v2. Moving all delivery semantics into Queue core would create the opposite coupling: generic scheduling would import GitHub, Git, Codex, verification, and product-acceptance policy. A monolithic Delivery plugin would keep those concerns out of Queue but would still prevent independent replacement and lifecycle ownership.

Two current capability gaps block implementation. The trusted Queue operator facade can inspect and mutate work but cannot admit ownerless work, even though the durable model supports operator receipts and `ownerSessionId: null`. The Codex provider obtains cwd from a real parent Session, even though Delivery must run in an Attempt-owned worktree without inventing a supervisor Session.

## Proposal

Personal Delivery is a profile bundle that composes independent DSH plugins above the [durable Queue](../../../../docs/subsystems/task-queue.md). Delivery owns immutable requirement adoption and human decisions; Queue keeps its existing authority over Work and Attempts. Git owns commit identity, Session owns transcript, evidence storage owns bytes, and Runtime Facts owns advisory capacity observations.

The first implementation lives in the fork's `packages/delivery/` group because it depends on the fork-owned Queue v2 contracts. The bundle contains composition only. Queue core does not import Delivery, GitHub, Git workspace, verifier, executor, Remote, or UI packages. Intake calls Delivery rather than Queue; a Bridge consumes Delivery and Queue and registers the Delivery WorkKinds.

The [MVP contract](../../../../docs/specs/2026-08-29-personal-delivery-mvp.md) limits the first vertical slice to manual GitHub Issue import, one local repository, Codex execution, fixed-command verification, local evidence, and explicit human acceptance. [Protocol V1](../../../../docs/specs/2026-08-29-delivery-protocol-v1.md) owns the durable object meanings, while the [multi-PR plan](../../../../docs/specs/2026-08-29-personal-delivery-multi-pr-plan.md) owns implementation order and path exclusivity.

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

The Bridge proposes provider-neutral `code.change@1` and `code.verify@1` WorkKinds. Queue success for change work records a typed completion claim. Verification runs as separate work against the exact checkpoint commit. Only a matching passed verdict permits an ordinary acceptance; an explicit human waiver records the override.

Delivery and Queue cannot commit one transaction. Delivery therefore persists a `submitting` binding with a deterministic Queue idempotency key before enqueue, then records the returned Work id. Restart repeats unfinished enqueue with the same key and input; Queue returns the original id whether the earlier call committed or not. A bound id that Queue cannot resolve becomes corruption Attention and never causes admission under another key.

### Technical gates

Gate A extends trusted operator admission without exposing generic enqueue to the browser. Ownerless admission uses operator authority, operator-scoped idempotency, `ownerSessionId: null`, and no Session Notification. The same Queue change closes the immediate post-start ownership gap: if the running append fails after `LiveAttempt` exists, the provider aborts its controller, requests `LiveAttempt.cancel()`, observes cancellation and `live.done` within the configured bound, and only then records `unknown` plus Attention. Cancellation rejection, deadline, a conflicting late outcome, or another persistence failure remains post-start evidence; Queue never reclassifies it as `not-started` or automatically retries it. A deadline preserves durable uncertainty rather than an in-process handle or resource claim, so operator-authorized retry requires external proof that the prior effect is quiescent.

Gate B proves real Codex execution in a disposable explicit worktree, cancellation propagation, whole-process-tree quiescence, and truthful terminal classification. The current `startCodexRun` still accepts parent-bearing `SubagentStartRequest`, although its lower-level run specification accepts explicit cwd. The gate therefore extracts a parent-free package-internal entry while preserving the Session-backed provider adapter. It does not export that entry from the package root; PR-C0 must choose a supported production boundary before Delivery consumes it. A governed `codex exec --json` subprocess adapter remains a fallback only if the executable proof exposes a cancellation or quiescence defect.

PR-C0 decides whether P0 needs a public executor capability after Gate B completes. This proposal deliberately defines no `ctx.codeExecutors` API. If one Codex runner is the only consumer and implementation, it owns the extracted entry privately; a public registry requires evidence from another independent consumer or replaceable provider.

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

**Create a generic executor registry before the Codex proof.** Rejected because one provider and one consumer do not justify a public capability. Gate B first proves the real lifecycle and reveals the smallest stable reusable input.

**Start with quota-driven planning and automatic launch.** Rejected because capacity observations cannot compensate for missing immutable scope, isolated execution, recovery, verification, and human acceptance. Runtime Facts remain recommendation input until the vertical delivery loop is reliable.

## Acceptance criteria

- Gate A admits ownerless work idempotently, performs bounded dual-channel cancellation after a post-start durability failure, and records uncertainty without automatic retry when quiescence cannot be proved.
- Gate B modifies only the supplied worktree, cancels the complete Codex process tree, and records evidence for the selected integration path.
- Executable schemas and golden fixtures round-trip every Protocol V1 object and reject invalid ids, digests, commits, command plans, and decision combinations.
- The Delivery/Queue Bridge registers both WorkKinds without adding a Queue dependency on any Delivery package.
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
