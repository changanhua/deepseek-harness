# Personal Delivery Multi-PR Plan

Status: PR-C0 execution plan; Wave 1 remains gated on one merged C0 SHA

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

Gate B does not create or finalize `ctx.codeExecutors`, and its feasibility entry is not exported from the package root. PR-C0 records the production decision: no executor service is justified, and the selected explicit-cwd app-server transport is exposed only through the narrow `@deepseek-ai/dsh-subagent-codex/app-server-run` production subpath for the Delivery runner. A Delivery package must not deep-import a source-only entry merely because the monorepo can resolve it.

## PR ownership

### Serial foundation

| PR | Provides | Owned paths | Merge condition |
| --- | --- | --- | --- |
| PR-D0 | Three implementation specs and proposed architecture rationale | `docs/specs/2026-08-29-personal-delivery-*`, `docs/specs/2026-08-29-delivery-protocol-v1.md`, matching Agent Note triplet | Document gates and link checks pass. |
| PR-GA | Gate A Queue capability and safety fix | Gate A paths above plus its minimal generated Cordis API refresh | Focused Queue tests, catalog freshness, and repository typecheck pass. |
| PR-GB | Gate B parent-free Codex entry and executable proof | `packages/subagent/subagent-codex/**` and gate fixtures only | Real worktree/cancel/quiescence proof passes. |
| PR-C0 | Executable protocol, runtime schemas, golden fixtures, fake providers, frozen Delivery/Git-workspace/evidence Service Definitions, Gate-justified executor boundary, and explicit unavailable/empty package scaffolds | `packages/delivery/delivery-protocol/**`, `delivery/**`, `repo-workspace/**`, `delivery-evidence/**`, `delivery-testkit/**`, remaining scaffold paths, and one-time shared manifests | JSON round-trip, invalid-fixture, fake-provider authority-contract, typecheck, package-invariant, and loader-smoke checks pass; production-facing local providers remain unavailable. |

PR-C0 creates every planned package manifest and local tsconfig before Wave 1, then performs the single pre-wave update to the root lockfile, TypeScript aggregate references, package group map, and generated catalogs. Those shared files freeze at the PR-C0 merge SHA. Local Delivery, Git-workspace, evidence, runner, verifier, intake, Remote, Queue-handler registration, UI, and bundle packages are honest unavailable or empty scaffolds at that SHA; C0 does not claim their planned behavior. Wave 1 never edits shared files; after Wave 1 opens, PR-I2 is their sole owner if integration requires a deterministic refresh.

### Wave 1

| PR | Provides | Exclusive implementation ownership | Consumes |
| --- | --- | --- | --- |
| PR-D1 | Replace the C0 unavailable boundary with ContractRevision, Packet, Binding, Decision persistence and projections | `packages/delivery/delivery-local/**` | Protocol, Storage |
| PR-D2 | Replace the C0 unavailable boundaries with Attempt worktree lease, checkpoint Git facts, and P0 local evidence bytes | `packages/delivery/repo-workspace-git-local/**`, `packages/delivery/delivery-evidence-local/**` | Protocol, Subprocess |
| PR-D3 | Replace the C0 unavailable runner with the `code.change@1` execution adapter selected by Gate B | Gate-B-selected runner package under `packages/delivery/**` | Frozen protocol/workspace/evidence definitions and fakes, selected Codex path |
| PR-D4 | Replace the C0 unavailable verifier with trusted fixed-argv verification, Protocol-owned path-boundary findings, and verdict production | `packages/delivery/delivery-verifier/**` | Frozen protocol/workspace/evidence definitions and fakes, Subprocess |
| PR-D5 | Replace the C0 unavailable network/adoption boundary using the frozen strict Work Brief parser, explicit GitHub Issue URL import, and revision idempotency | `packages/delivery/delivery-github-intake/**` | Protocol and frozen Delivery definition/fake |
| PR-D6 | Replace the C0 unavailable/empty Remote and UI boundaries with Delivery host projection and workbench UI | `packages/delivery/delivery-remote/**`, `packages/client/ui-delivery/**` | Protocol golden fixtures, Remote/UI slots |

Wave 1 branches start from one PR-C0 merge SHA. Each PR may edit only its owned paths and package-local tests/README/Agent Note triplet. It may not edit another implementation directory, Protocol V1 exports, Bundle/Profile files, base/web-app composition, root lockfile, TypeScript aggregates, package group maps, generated catalogs, `FORK-DIVERGENCE.md`, or global navigation.

PR-D3 through PR-D6 develop against PR-C0 definitions, fakes, and golden fixtures; none waits for another Wave 1 provider. PR-C0 freezes the Gate-selected runner package name before Wave 1, and no Wave branch renames it.

PR-D3 and PR-D4 enforce their configured output budgets below a hard 64 MiB ceiling. PR-D3 also declares its output-retention behavior before execution. PR-D4's focused negative suite must create a lexically valid repository-relative cwd whose symlink resolves outside the lease root and prove that `lstat`/`realpath` containment rejects it before any process starts.

PR-D5 does not invent an Issue template. C0 exports and golden-tests the exact `dsh-delivery-work-brief@1` marker/YAML grammar, the strict schema for every Contract-owned field, and the mapping to `ContractRevisionDraft`. The Remote requires a configured repository selection; GitHub snapshot facts and the prior same-Issue revision remain host-derived.

PR-D1 and PR-D6 must preserve the C0 authority boundary. Packet creation resolves the Contract's configured base through the trusted repository provider and derives its non-empty plan only from the Contract field or an integrity-read Git blob at that exact base, with a 64 KiB limit. Both reuse Protocol's frozen plan-document parser and resolved-plan constructor rather than copying Fake behavior. The browser may select existing Contract, Packet, and binding references, but it never allocates durable object ids or supplies an idempotency key, actor, base proof, resolved plan, target commit, completion claim, or verdict. Decision recording resolves the exact change and verification Queue Work/Attempt results selected through Delivery-bound references; ordinary acceptance integrity-reads every referenced `EvidenceRef` before commit. The single-user D6 adapter takes actor identity only from the C0-frozen host `operatorId` config (default `local-operator`), never from the browser DTO.

### Integration wave

PR-I1 exclusively owns `packages/delivery/delivery-task-queue/**` and the runner/verifier Loader Config. Its defaults are executor `codex`, permission `never`, grace `5000` ms, model-output limit `64` KiB, verification-output limit `64` KiB, resource `agent-run`, `maxAttempts: 1`, and verifier version `personal-delivery-v1`; no Wave 1 package publishes a competing Loader Config. It replaces C0's unavailable handler-registration boundary while preserving the frozen host-only admission functions. The Bridge registers `code.change@1` and `code.verify@1`, persists a `submitting` binding before trusted ownerless Queue admission, conditionally binds the returned Work id, and reconciles unfinished handshakes with the same idempotency key. Verification start accepts only Packet plus a selected change binding: before either Delivery or Queue mutation, it resolves that bound Work's exact successful Result/Attempt, validates the completed claim and identities, derives target plus Packet plan digest, and proves ancestry from the persisted exact base. Protocol admission requires the completed claim to name at least one evidence id; exact matching Git evidence remains a verifier/acceptance integrity-read obligation rather than an I1 admission claim. It maps Packet/Work/Attempt/Verdict identities and rebuilds its projection from durable bindings plus Queue views on activation. It may respond to `task-queue/changed` for freshness, but event delivery is not its recovery authority. No code path automatically accepts delivery.

PR-I2 exclusively owns `packages/bundle/personal-delivery/**` plus final integration fixtures. It replaces C0's deliberately empty patch with the Personal Delivery Bundle/Profile and owns final composition, root shared-file refresh, fork divergence record, and vertical E2E. It is the only post-Wave-1 PR allowed to modify Bundle/Profile patches, the root lockfile, TypeScript aggregate references, generated catalogs, document publication maps, or final E2E fixtures.

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
- verification admission rejects invalid or mismatched change bindings, Work results, Attempt identities, target ancestry, and Packet plan identity before either Delivery or Queue mutates;
- the exact target commit derived from the bound successful change result is the commit verified and offered for human acceptance, including after the original base ref moves;
- ordinary acceptance derives the claim, verification intent, and verdict from the exact two Delivery-bound Queue Work/Attempt results and integrity-reads every referenced evidence object;
- shell command-string modes are rejected while direct fixed argv that names a trusted script file remains valid;
- `pnpm run test:docs`, relevant typechecks/tests, loader smoke, build, and `git diff --check` pass;
- generated output is regenerated once by the integration owner and has no unexplained diff.

## Stop conditions

Parallel implementation pauses when a PR needs a public protocol change, another PR's owned path, a new root dependency, a wider authority surface, or a new durable state. The contract owner resolves the shared change once and republishes a base SHA; affected branches rebase after that decision.

P0 stops rather than expanding when Gate B cannot prove whole-tree quiescence for the selected Codex runner, Gate A cannot preserve truthful unknown/no-retry semantics after the side-effect boundary, verification cannot obtain trusted fixed commands, or the vertical E2E requires a second control-plane state machine.
