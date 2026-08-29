# Personal Delivery MVP

Status: proposed implementation contract

Baseline: `80719bfbb8d8409b1b0b812843ec686fac62f907`

## Outcome

Personal Delivery turns one approved GitHub Issue into one evidence-backed code delivery without making a Session, an Agent report, or a second control-plane service authoritative. The first release proves one vertical flow for one local repository and one human operator:

```text
GitHub Issue revision
  -> immutable ContractRevision
  -> bounded WorkPacket
  -> ownerless Queue work
  -> isolated Git worktree
  -> Codex completion claim
  -> independent verification
  -> human acceptance
```

The product is a DSH profile bundle composed from independent plugins. It is not an easyGo sidecar and does not add Delivery state to Queue core. The architectural rationale lives in the [Personal Delivery Agent Note](../../.agents/notes/proposed/architecture/2026-08-29-personal-delivery-above-queue.md).

## P0 user path

1. The user pastes a GitHub Issue URL and explicitly imports the current Issue revision.
2. Delivery stores an immutable `ContractRevision` and rejects readiness while open decisions or required fields remain unresolved.
3. The user creates one `WorkPacket` pinned to that revision, repository, and base commit.
4. The user selects Codex and starts the packet; Delivery first records a pending dispatch and the Bridge idempotently admits one ownerless `code.change@1` WorkItem through the trusted Queue operator path.
5. The runner creates one Attempt-owned worktree, invokes Codex there, reaches process-tree quiescence, and records the checkpoint commit in a `CompletionClaim` with system-collected Git evidence.
6. Delivery admits `code.verify@1` for that exact commit; the verifier obtains its command plan from the trusted revision/base and records a `VerificationVerdict` plus evidence.
7. The user accepts, rejects, or explicitly waives the delivery. Acceptance never follows automatically from Queue success or Agent text.
8. DSH restart preserves the Contract revision, Packet, Queue records, evidence references, verdict, and decision.

P0 uses manual import rather than GitHub webhook synchronization. The existing signed adapter remains available for a later idempotent intake rule, but its `202` response proves only in-memory dispatch, not downstream completion ([GitHub webhook adapter](../../packages/webhook/webhook-github/README.md)).

## Fact ownership

| Fact | Authority |
| --- | --- |
| Current Issue text, product scope, and acceptance wording | GitHub |
| Exact Issue version adopted for one execution | `ContractRevision` |
| Packet boundary and human decision | Delivery |
| Work, Attempt, retry, cancellation, Result, Receipt, and Attention | [`ctx.taskQueue`](../subsystems/task-queue.md) |
| Base, checkpoint, target commit, changed paths, and diff | Git |
| Agent transcript | Session |
| Logs, patches, screenshots, build output, and their digests | Evidence storage |
| Quota, reset time, and environment observations | [`ctx.runtimeFacts`](../subsystems/runtime-facts.md) |
| Ready, Running, Review, Blocked, and Accepted lanes | UI projection only |

Delivery does not persist another Attempt or a writable catch-all status. The UI derives its lanes from the immutable Delivery records and current Queue view defined in [Protocol V1](2026-08-29-delivery-protocol-v1.md).

## Composition boundary

P0 reuses Queue v2 for durable execution and recovery, the Codex app-server implementation for the selected executor when Gate B permits it, Storage for Delivery metadata, Subprocess for Git and validation processes, Runtime Facts for advisory capacity observations, Remote for host operations, and UI slots for the workbench. The [Queue ownership decision](../../.agents/notes/implemented/architecture/2026-08-27-queue-v2-reuse-boundaries.md) remains authoritative for Work and Attempt semantics.

New plugin responsibilities are limited to:

- Delivery domain persistence and projections;
- manual GitHub Issue intake;
- governed Git worktree ownership and local evidence retention;
- the `code.change@1` and `code.verify@1` Queue bridges;
- independent verification;
- Delivery Remote/UI projection;
- one bundle that selects these plugins.

The bundle contains composition only. Queue core never imports Delivery, GitHub, Git workspace, verifier, Codex, or UI packages.

## Safety and recovery invariants

- A `WorkPacket` binds one immutable `ContractRevision` and one base commit. Editing the Issue creates another revision and never mutates a running Packet.
- Delivery commits a deterministic pending dispatch before Queue admission. Restart retries the same key and input, so a crash on either side of the cross-store call converges on one Queue Work id.
- Queue success for `code.change@1` means only that a `CompletionClaim` was recorded. It does not mean verification passed or the delivery was accepted.
- One code Attempt owns one isolated worktree. It never executes in the DSH control-center checkout.
- `prepare()` performs no Git or external side effect. Worktree creation and executor startup occur only after the Queue start boundary has a live owner.
- A checkpoint commit is required before verification, descends from the Packet base commit, and is recorded by the governed runner rather than trusted from Agent text. The verifier targets that exact commit in an independent checkout or reset worktree.
- Verification commands are fixed argv plus a bounded working directory. The Packet snapshots their resolved plan and Contract/base-blob provenance before execution; the verifier never loads Agent-modified validation configuration or executes a shell string.
- A passed verdict requires matching base/target ancestry, every required check, an empty forbidden-path finding set, and intact required evidence.
- Evidence is immutable and content-addressed by SHA-256. A missing or mismatched evidence object prevents acceptance.
- Any execution that may have crossed a side-effect boundary and loses provable ownership becomes `unknown`; it is never automatically retried or marked successful.
- Only the user can create an `AcceptanceDecision`. A waiver is explicit and records its reason.
- Runtime Facts may recommend when to start Codex. P0 does not automatically start work when quota changes.

## Non-goals

P0 excludes GitHub webhook synchronization and write-back, automatic PR creation or merge, a DSH code executor, a general artifact platform, exact Codex thread resumption, automatic quota scheduling, value scoring, a window optimizer, multi-repository orchestration, Batch/DAG execution, multi-host leases, teams, RBAC, and multi-tenancy.

P0 also excludes a public executor registry unless the scaffold review proves that a reusable capability is necessary. Gate B has selected extraction of the existing explicit-cwd app-server transport as its implementation direction; the remaining worktree, cancellation, and quiescence proof does not by itself publish `ctx.codeExecutors`. [Protocol V1](2026-08-29-delivery-protocol-v1.md) freezes executor-neutral durable data, not an imagined API.

## Acceptance scenarios

The MVP is complete only when automated or controlled end-to-end evidence covers all of these scenarios:

1. A valid Issue revision reaches a checkpoint commit, passes independent verification, receives human acceptance, and remains queryable after restart.
2. Editing the Issue during execution creates a new revision while the running Packet remains pinned to the old one.
3. Repeating import or start, including restart between Queue admission and Delivery binding, converges on the existing logical object; a changed payload under the same key fails.
4. Cancellation stops the complete Codex process tree and preserves a truthful Queue/Delivery outcome.
5. A crash or post-start durability failure leaves `unknown` plus operator Attention, preserves the worktree, and does not start a duplicate Attempt.
6. A completion claim without a checkpoint commit cannot enter verification.
7. A failed command, forbidden-path modification, missing evidence object, or digest mismatch prevents acceptance.
8. Two Packets for one repository use different worktrees and cannot modify the DSH control-center checkout.

Implementation opens only after Gate A and Gate B in the [multi-PR plan](2026-08-29-personal-delivery-multi-pr-plan.md) pass. Gate B owns executable evidence for the parent-free Codex integration; PR-C0 owns the later decision about any public executor service.
