# Personal Delivery Multi-PR Plan

Status: execution plan; parallel implementation remains gated

Baseline: `80719bfbb8d8409b1b0b812843ec686fac62f907`

## Objective

This plan minimizes parallel rework by separating two technical proofs, one contract freeze, independent implementation owners, and one integration owner. The [MVP contract](2026-08-29-personal-delivery-mvp.md) owns scope; [Protocol V1](2026-08-29-delivery-protocol-v1.md) owns durable meaning; the [Agent Note](../../.agents/notes/proposed/architecture/2026-08-29-personal-delivery-above-queue.md) owns architectural rationale.

No implementation PR may widen P0 or change a shared protocol locally. A required shared change returns to the contract owner and blocks only the affected branches.

## Merge graph

```text
PR-D0  Contract documents -----------------------+
                                                    -> PR-C0 Contract + scaffold
PR-GA  Gate A: Queue operator admission + safety -+            |
PR-GB  Gate B: explicit-worktree Codex proof -----+            |
                                                                 v
                +---------------- Wave 1 from one C0 SHA ----------------+
                | PR-D1 Delivery local                                  |
                | PR-D2 Git workspace + local evidence                  |
                | PR-D3 Codex runner selected by Gate B                 |
                | PR-D4 independent verifier                            |
                | PR-D5 manual GitHub intake                            |
                | PR-D6 Remote/UI against golden fixtures               |
                +--------------------------------------------------------+
                                         |
                                         v
                              PR-I1 Delivery/Queue bridge
                                         |
                                         v
                              PR-I2 Bundle + E2E rollup
```

`codex/delivery-contract`, `codex/delivery-spike-queue`, and `codex/delivery-spike-codex` start from the stated baseline and may proceed in parallel. PR-C0 begins only after both Gate results are recorded.

## Technical gates

### Gate A: trusted operator admission and post-start safety

Current Queue data already supports `ownerSessionId: null` and operator receipts, but `OperatorWorkQueue` cannot enqueue. The gate changes Queue only and must prove:

- an issued operator authority can idempotently enqueue one WorkItem and a homogeneous Batch without a Session;
- admitted WorkItems have `ownerSessionId: null`, receipts use operator ownership and an operator-specific source namespace, and terminal work creates no Session Notification;
- matching key/input returns the original id and conflicting input fails;
- browser Remote does not receive raw generic enqueue authority;
- if `handler.start()` returns live ownership but persisting `attempt/running` fails, Queue first aborts its controller and requests `LiveAttempt.cancel()`, then observes `live.done` and cancellation settlement within the configured bound before recording `unknown` plus Attention;
- cancellation rejection, a deadline, a conflicting late outcome, or another persistence failure remains post-start failure evidence; Queue never reclassifies it as `not-started` or automatically retries it, while a deadline records durable uncertainty and requires the operator to prove external quiescence before authorizing another Attempt;
- focused folding, admission, restart, cancellation, and lock-ownership tests pass.

Gate A owns only `packages/task-queue/task-queue/**`, `packages/task-queue/task-queue-local/**`, their paired package/subsystem documentation, the generated task-queue Cordis API catalog refresh required by the public operator change, and the Agent Note that explains the shipped Queue change. It does not import Delivery or add a Delivery-specific method. Generic Queue parity may include operator Batch admission; Personal Delivery P0 submits only single WorkItems.

### Gate B: explicit-worktree Codex execution

The existing Codex provider obtains cwd from `request.parent.session.header.cwd`, and `startCodexRun` still accepts the parent-bearing `SubagentStartRequest`, while its lower-level `CodexRunSpec` already accepts an explicit cwd. Source inspection therefore selects a parent-free package-internal entry as the feasibility direction. The gate must still run that real package-local Codex path against a disposable Git worktree and prove:

- the target file changes only inside the supplied worktree;
- no fake Agent or Session is needed to choose cwd;
- caller cancellation reaches Codex and the complete subprocess tree exits within the configured bound;
- startup failure, product failure, cancellation, completion, and loss of provable ownership remain distinguishable;
- cleanup failure is reported rather than hidden;
- no DSH control-center checkout is modified.
- the package root remains unchanged while PR-C0 records the production package-boundary decision.

Gate B uses this decision order:

1. Extract a parent-free request around the explicit-input Codex app-server driver and prove the lifecycle without fabricating a Parent.
2. Fall back to a governed `codex exec --json` subprocess adapter only if the executable proof shows that extraction cannot preserve cancellation and quiescence.

Gate B does not create or finalize `ctx.codeExecutors`, and its feasibility entry is not exported from the package root. PR-C0 owns the production package-boundary decision and introduces an executor capability only if the completed evidence plus a second replaceable implementation or another independent consumer justify it. A Delivery package must not deep-import the source-only entry merely because the monorepo can resolve it.

## PR ownership

### Serial foundation

| PR | Provides | Owned paths | Merge condition |
| --- | --- | --- | --- |
| PR-D0 | Three implementation specs and proposed architecture rationale | `docs/specs/2026-08-29-personal-delivery-*`, `docs/specs/2026-08-29-delivery-protocol-v1.md`, matching Agent Note triplet | Document gates and link checks pass. |
| PR-GA | Gate A Queue capability and safety fix | Gate A paths above plus its minimal generated Cordis API refresh | Focused Queue tests, catalog freshness, and repository typecheck pass. |
| PR-GB | Gate B parent-free Codex entry and executable proof | `packages/subagent/subagent-codex/**` and gate fixtures only | Real worktree/cancel/quiescence proof passes. |
| PR-C0 | Executable protocol, runtime schemas, golden fixtures, fake providers, frozen Delivery/Git-workspace/evidence Service Definitions, Gate-justified executor surface, and empty package scaffolds | `packages/delivery/delivery-protocol/**`, `delivery/**`, `repo-workspace/**`, `delivery-evidence/**`, `delivery-testkit/**`, remaining scaffold paths, and one-time shared manifests | JSON round-trip, invalid-fixture, fake-provider contract, typecheck, package-invariant, and loader-smoke checks pass. |

PR-C0 creates every planned package manifest and local tsconfig before Wave 1, then performs the single pre-wave update to the root lockfile, TypeScript aggregate references, package group map, and generated catalogs. Those shared files freeze at the PR-C0 merge SHA. Wave 1 never edits them; after Wave 1 opens, PR-I2 is their sole owner if integration requires a deterministic refresh.

### Wave 1

| PR | Provides | Exclusive implementation ownership | Consumes |
| --- | --- | --- | --- |
| PR-D1 | ContractRevision, Packet, Binding, Decision persistence and projections | `packages/delivery/delivery-local/**` | Protocol, Storage |
| PR-D2 | Attempt worktree lease, checkpoint Git facts, and P0 local evidence bytes | `packages/delivery/repo-workspace-git-local/**`, `packages/delivery/delivery-evidence-local/**` | Protocol, Subprocess |
| PR-D3 | `code.change@1` execution adapter selected by Gate B | Gate-B-selected runner package under `packages/delivery/**` | Frozen protocol/workspace/evidence definitions and fakes, selected Codex path |
| PR-D4 | Trusted fixed-argv verification and verdict production | `packages/delivery/delivery-verifier/**` | Frozen protocol/workspace/evidence definitions and fakes, Subprocess |
| PR-D5 | Explicit GitHub Issue URL import and revision idempotency | `packages/delivery/delivery-github-intake/**` | Protocol and frozen Delivery definition/fake |
| PR-D6 | Delivery Remote and workbench projection | `packages/delivery/delivery-remote/**`, `packages/client/ui-delivery/**` | Protocol golden fixtures, Remote/UI slots |

Wave 1 branches start from one PR-C0 merge SHA. Each PR may edit only its owned paths and package-local tests/README/Agent Note triplet. It may not edit another implementation directory, Protocol V1 exports, Bundle/Profile files, base/web-app composition, root lockfile, TypeScript aggregates, package group maps, generated catalogs, `FORK-DIVERGENCE.md`, or global navigation.

PR-D3 through PR-D6 develop against PR-C0 definitions, fakes, and golden fixtures; none waits for another Wave 1 provider. PR-C0 freezes the Gate-selected runner package name before Wave 1, and no Wave branch renames it.

### Integration wave

PR-I1 exclusively owns `packages/delivery/delivery-task-queue/**`. The Bridge registers `code.change@1` and `code.verify@1`, persists a `submitting` binding before trusted ownerless Queue admission, conditionally binds the returned Work id, and reconciles unfinished handshakes with the same idempotency key. It maps Packet/Work/Attempt/Verdict identities and rebuilds its projection from durable bindings plus Queue views on activation. It may respond to `task-queue/changed` for freshness, but event delivery is not its recovery authority. A completed claim may enqueue verification; no code path automatically accepts delivery.

PR-I2 exclusively owns `packages/bundle/personal-delivery/**` plus final integration fixtures. It owns the Personal Delivery Bundle/Profile, final composition, root shared-file refresh, fork divergence record, and vertical E2E. It is the only post-Wave-1 PR allowed to modify Bundle/Profile patches, the root lockfile, TypeScript aggregate references, generated catalogs, document publication maps, or final E2E fixtures.

## Required PR contract

Every implementation PR description records:

```text
Provides:
Consumes:
Owned paths:
Forbidden paths:
Base commit:
Protocol fixture ids:
Required focused tests:
Merge gate:
```

Every branch preserves unrelated user work, uses a dedicated worktree, and targets the shared integration branch rather than merging directly into the baseline branch. Upstream synchronization pauses while Wave 1 is active.

## Integration gates

PR-I2 must prove the eight scenarios in the [MVP acceptance section](2026-08-29-personal-delivery-mvp.md#acceptance-scenarios). The minimum negative set includes forbidden-path modification, failed verification, cancellation, Issue edit during execution, duplicate submission, missing evidence, and restart after the Queue side-effect boundary.

The integration branch is not ready for rollup until:

- Gate A and Gate B evidence is committed;
- protocol valid/invalid fixtures and JSON round trips pass;
- every Wave 1 package passes focused tests against the frozen protocol;
- Queue restart and Delivery reconciliation agree without replaying transient events;
- a crash before Queue admission and a crash after Queue admission but before binding both converge on one Work id;
- the exact target commit verified is the commit offered for human acceptance;
- `pnpm run test:docs`, relevant typechecks/tests, loader smoke, build, and `git diff --check` pass;
- generated output is regenerated once by the integration owner and has no unexplained diff.

## Stop conditions

Parallel implementation pauses when a PR needs a public protocol change, another PR's owned path, a new root dependency, a wider authority surface, or a new durable state. The contract owner resolves the shared change once and republishes a base SHA; affected branches rebase after that decision.

P0 stops rather than expanding when Gate B cannot prove whole-tree quiescence for the selected Codex runner, Gate A cannot preserve truthful unknown/no-retry semantics after the side-effect boundary, verification cannot obtain trusted fixed commands, or the vertical E2E requires a second control-plane state machine.
