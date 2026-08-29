# Personal Delivery MVP

Status: PR-C0 contract-freeze candidate; production providers remain unavailable

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

1. The user pastes a GitHub Issue URL and explicitly imports the current Issue revision for one configured repository. The body contains one authoritative `dsh-delivery-work-brief@1` YAML block with every Contract field; narrative outside it is supporting context only.
2. Delivery stores an immutable `ContractRevision` and rejects readiness while open decisions or required fields remain unresolved. A verification source is required: an inline source contains at least one fixed-argv check, while a Git-blob source must resolve to at least one such check before Packet creation.
3. The user creates one `WorkPacket`. The host resolves the Contract's configured repository and base-selection rule to a trusted full commit, then derives the verification plan only from the Contract field or from the exact Git blob at that commit. The Packet persists that base, plan, provenance, and digest.
4. The user selects Codex and starts the packet; Delivery first records a pending dispatch and the Bridge idempotently admits one ownerless `code.change@1` WorkItem through the trusted Queue operator path.
5. The runner creates one Attempt-owned worktree, invokes Codex there, reaches process-tree quiescence, and records the checkpoint commit in a `CompletionClaim` with system-collected Git evidence.
6. The user selects the bound successful change. Before mutating Delivery or Queue, the host resolves its exact Queue Work and Attempt result, derives the target commit and plan digest, and proves target ancestry from the Packet base. Only then may Delivery admit `code.verify@1`; the verifier records a `VerificationVerdict` plus evidence.
7. The user accepts, rejects, or explicitly waives the delivery. The host resolves both Delivery-bound Queue Work/Attempt results rather than accepting a submitted claim or verdict; ordinary acceptance additionally integrity-reads every referenced evidence object. Acceptance never follows automatically from Queue success, a browser-supplied verdict, or Agent text.
8. DSH restart preserves the Contract revision, Packet, Queue records, evidence references, verdict, and decision. Reopening a Packet uses its persisted exact base revision even when the original source ref has moved.

P0 uses manual import rather than GitHub webhook synchronization. The existing signed adapter remains available for a later idempotent intake rule, but its `202` response proves only in-memory dispatch, not downstream completion ([GitHub webhook adapter](../../packages/webhook/webhook-github/README.md)).

Remote is a narrow browser edge, not an authority transfer. Browser requests may select existing references such as a configured repository, Contract revision, Packet, or bound dispatch, along with user-owned inputs such as Issue URL, executor, decision, reason, and decision nonce. They cannot allocate new durable object ids or supply idempotency keys, actor identity, repository/base proof, resolved verification plan, verification target, or verdict; trusted host composition derives or resolves those values. For this single-user MVP, `delivery-remote` host configuration supplies the stable `operatorId` used as human actor identity; it defaults to `local-operator` and never crosses the browser wire.

The Work Brief block is marked by an exact `<!-- dsh-delivery-work-brief@1 -->` line immediately followed by a `yaml` fence. Its strict value requires `format`, outcome, context, allowed and forbidden scope arrays, explicitly identified acceptance clauses and open decisions, a base-selection rule, a Contract-field or Git-blob verification source, and reference links. Missing values are parse failures; unresolved product ambiguity is an explicit open-decision entry. Stable clause, decision, and inline-check ids are authored in the Issue rather than generated from list order. The package golden fixture is the copyable template.

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

PR-C0 freezes contracts, package boundaries, fixtures, and fakes only. Its local Delivery, repository-workspace, evidence, Codex-runner, verifier, GitHub-intake, Remote, Queue-handler registration, UI, and bundle providers fail explicitly as unavailable or remain empty composition scaffolds. They must not simulate persistence, Git ownership, evidence storage, host projection, execution, or end-to-end delivery before their implementation PRs.

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

- A `WorkPacket` binds one immutable `ContractRevision` and one exact provider-verified base commit. Editing the Issue or moving the source ref creates no change to a running or resumed Packet.
- Delivery commits a deterministic pending dispatch before Queue admission. Restart retries the same key and input, so a crash on either side of the cross-store call converges on one Queue Work id.
- Queue success for `code.change@1` means only that a `CompletionClaim` was recorded. It does not mean verification passed or the delivery was accepted.
- One code Attempt owns one isolated worktree. It never executes in the DSH control-center checkout.
- `prepare()` performs no Git or external side effect. Worktree creation and executor startup occur only after the Queue start boundary has a live owner.
- A checkpoint commit is required before verification and is recorded by the governed runner rather than trusted from Agent text. Before any verification dispatch mutation, the Bridge resolves the selected bound `code.change@1` Queue Work and exact successful Attempt result, validates the completed claim and its identities, derives the target and trusted plan digest, and proves base-to-target ancestry.
- Verification commands are fixed argv plus a bounded working directory. Packet creation first resolves the Contract base and derives the plan only from the Contract field or an integrity-read Git blob at that exact base, limited to 64 KiB. Shell command-string modes such as `sh -c`, `pwsh -Command`, and `cmd /C` are rejected; invoking a trusted script file as argv is allowed.
- A passed verdict requires matching base/target ancestry, every required check, no Packet path-boundary finding, and intact required evidence. Packet path rules use inclusive subtree matching, empty-allowlist-as-unrestricted semantics, and forbidden-first precedence.
- Evidence is immutable and content-addressed by SHA-256. Acceptance resolves the exact Delivery-bound change and verification Queue Work/Attempt results, then integrity-reads every `EvidenceRef`; any missing, mismatched, or wrongly provenanced object prevents acceptance.
- Any execution that may have crossed a side-effect boundary and loses provable ownership becomes `unknown`; it is never automatically retried or marked successful.
- Only the user can create an `AcceptanceDecision`. A waiver is explicit and records its reason.
- Runtime Facts may recommend when to start Codex. P0 does not automatically start work when quota changes.

## Non-goals

P0 excludes GitHub webhook synchronization and write-back, automatic PR creation or merge, a DSH code executor, a general artifact platform, exact Codex thread resumption, automatic quota scheduling, value scoring, a window optimizer, multi-repository orchestration, Batch/DAG execution, multi-host leases, teams, RBAC, and multi-tenancy.

P0 also excludes a public executor registry. Gate B selected the existing explicit-cwd app-server transport, and PR-C0 freezes the narrow `@deepseek-ai/dsh-subagent-codex/app-server-run` production subpath for the Codex runner rather than publishing `ctx.codeExecutors`. [Protocol V1](2026-08-29-delivery-protocol-v1.md) remains executor-neutral durable data, not an imagined service API.

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

Gate A and Gate B outcomes are recorded in the foundation described by the [multi-PR plan](2026-08-29-personal-delivery-multi-pr-plan.md). Wave 1 opens only from one merged PR-C0 SHA; the C0 decision keeps the parent-free Codex integration behind its narrow production subpath and creates no public executor service.
