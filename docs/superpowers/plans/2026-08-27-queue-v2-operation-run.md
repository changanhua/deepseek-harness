# Queue v2 `operation.run@1` Implementation Plan

English | [中文](2026-08-27-queue-v2-operation-run.zh.md)

**Goal / DoD:** Add an `operation.run@1` WorkKind on top of the existing Queue v2 WIP without mounting it by default, so a live Agent can submit only fixed operations from a host allowlist and complete one verifiable vertical through a real managed subprocess, durable Work/Attempt/Result records, an owner Notification, explicit result retrieval, and Queue Workspace refresh; no model input may select an executable, argv, cwd, env, shell, profile, model, or credential.

**Architecture:** Create an `operation-run-task-queue` WorkKind Bridge that reuses durable scheduling from `ctx.taskQueue` and process-tree lifecycle ownership from `ctx.subprocess`; create a separate `tool-operation-run-task-queue` Consumer that derives authority from a live Agent Session. At admission, host configuration resolves `operationId` into immutable, secret-free execution facts. `dsh-base` reserves only one `operation-run` resource unit, and `apps/cli` only makes the opt-in packages resolvable; the default composition mounts neither Handler nor Consumer. Queue core, Jobs, Goal, Workflow, Subagent, and the existing DSH/image Handlers do not depend on this capability.

**Dependencies:** Preserve the Queue v2, owner delivery, restricted DSH worker, image Batch, and operator workbench WIP in the current checkout; the completed contract in the [Queue v2 closure plan](2026-08-27-queue-v2-owner-delivery-worker-closure.md) is this plan's baseline. The Baseline Gate below must pass before implementation begins. If Queue v2 itself fails, close it in its owning plan instead of mixing that repair into this feature. This capability is an opt-in package and does not enter the default `dsh-base` composition.

**Real Acceptance Path:** Use a real Loader to compose `LocalTaskQueue + LocalSubprocessRuntime + operation.run Handler + Agent admission Consumer + generic Queue result/delivery`. Configure a test-only `fixture.echo` operation, actually start a local Node process, and persist fixed output. Close and reopen the Queue root, explicitly read the typed result from the owner Session, and prove that the Notification contains only stable references. Then use the same test-only composition to start a `fixture.wait` operation, cancel it in the real Queue Workspace, refresh, and confirm the authoritative canceled state with no alert or console error.

**Broad Verification Budget:** Tasks 1-4 run only named tests and local typechecks. After the real Loader/process and browser verticals complete, freeze code and run `pnpm run build:lib:host` once, `pnpm run build:lib:client` once, `pnpm run build:web` once, one focused Queue suite, `pnpm run lint` once, `pnpm run doc-sync` once, one Agent Note/package gate, and one owned-path `git diff --check`; estimated time is 25-40 minutes. Rerun a broad command only after modifying the owner path named by its failure. Unrelated dirty-checkout failures from global commands are observation results only: do not claim repository-wide green and do not expand the repair.

## Global Constraints

- Preserve the current dirty checkout, untracked Queue/image/evidence files, live services, and Queue data; do not reset, clean, switch branches, delete Queue roots, stop unrelated processes, or absorb unrelated WIP.
- The v1 caller intent for `operation.run@1` contains only `operationId`; it accepts no generic JSON input, dynamic parameters, script path, or argv. A business operation that requires parameters must use a new named operation definition, or the contract must be revised only after a second real Consumer proves the need.
- An operation definition comes from trusted host configuration and must contain an explicit `revision`; admission persists the complete resolved facts, so a config reload does not change an already admitted WorkItem.
- An operation definition does not accept `env`, and argv must not contain credential values. The plugin fails loudly on structurally recognizable credential carriers; whether an arbitrary opaque string is secret remains a review responsibility of the trusted finite host allowlist. The child receives only the scrubbed parent environment from `ctx.subprocess`.
- Callers, tool results, Notifications, Remote, and UI must not expose resolved argv, cwd, full stderr, spill paths, or credential-shaped material.
- `prepare()` validates only an existing cwd and side-effect-free facts; it must not create a workspace, download dependencies, or run commands.
- `start()` is the sole side-effect boundary and must synchronously return a `LiveAttempt`; one operation-local lifecycle owner converges the process, timeout timer, cancellation, and settlement.
- Only prepare/spawn failures that occur before a side effect starts may be retried automatically. Nonzero exit, timeout, post-start loss, and unprovable cancellation must not be retried automatically.
- Queue core gains no operation-specific API; generic `task_queue_result` and owner delivery are reused unchanged.
- The Agent Consumer may obtain `AgentWorkQueue` only from a live Agent Session; the operator facade gains no process-admission path.
- The new packages are not active Cordis rows in `dsh-base`, web, or the standard preset. Queue `resourceCapacity` in `dsh-base` only reserves `operation-run: 1`, while `apps/cli/package.json` only places both packages in the install-resolution closure. Real and Loader tests use an explicit test composition. The README provides a profile opt-in configuration that inserts both Bridge and Consumer rows and supplies complete capacity.
- Do not restore the HEAD `dsh/claude/codex/opencode/arkcli/node/shell` executor selector and do not provide a compatibility shim.
- Do not implement Agent Provider routing, automatic Goal continuation, multi-host scheduling, a generic Artifact Store, server-side pagination, or live Queue event push.
- Write each documentation paragraph on one physical line; update paired READMEs, the subsystem document, and the Agent Note together and re-record translation pairing.

## Frozen Contract

`operation-run-task-queue` augments `WorkKindMap` from its own package root and does not modify Queue core types.

```ts ignore-check
export interface OperationRunIntent {
  readonly operationId: string
}

export interface ResolvedOperationRun {
  readonly operationId: string
  readonly revision: string
  readonly argv: readonly string[]
  readonly cwd: string
  readonly resource: string
  readonly units: number
  readonly maxAttempts: number
  readonly collectBytes: number
  readonly resultBytes: number
  readonly failureTailBytes: number
  readonly graceMs: number
  readonly timeoutMs: number
}

export type PreparedOperationRun = ResolvedOperationRun

export interface OperationRunOutput {
  readonly operationId: string
  readonly revision: string
  readonly summary: string
  readonly stdout?: {
    readonly text: string
    readonly truncated: boolean
  }
}

declare module '@deepseek-ai/dsh-task-queue' {
  interface WorkKindMap {
    'operation.run@1': WorkKindDefinition<
      OperationRunIntent,
      ResolvedOperationRun,
      PreparedOperationRun,
      OperationRunOutput
    >
  }
}
```

Bridge config uses `operationId` as its record key and stores a complete definition. Plugin load validates every definition exactly once; any blank id/revision/description/argv/cwd/resource, non-positive integer, `resultBytes > collectBytes`, `failureTailBytes > collectBytes`, duplicate revision identity, or credential-shaped config field makes the whole plugin fail loudly.

```ts ignore-check
export interface OperationDefinition {
  readonly revision: string
  readonly description: string
  readonly argv: readonly string[]
  readonly cwd: string
  readonly resource: string
  readonly units: number
  readonly maxAttempts: number
  readonly collectBytes: number
  readonly resultBytes: number
  readonly failureTailBytes: number
  readonly graceMs: number
  readonly timeoutMs: number
}

export interface Config {
  readonly operations: Readonly<Record<string, OperationDefinition>>
}
```

Agent tools are fixed as `operation_run_enqueue` and `operation_run_enqueue_batch`. The single form accepts `title`, `operationId`, and `idempotencyKey`; each Batch item accepts `title` and `operationId`, while the Batch also accepts `idempotencyKey` and a positive integer `maxParallel`. Tool schemas contain no execution internals.

## Failure and Result Matrix

| Path | Durable outcome | `category` | `sideEffect` | Auto retry |
| --- | --- | --- | --- | --- |
| Unknown or blank `operationId` | Admission rejects; no WorkItem | Not persisted | `not-started` | No |
| Definition or cwd fails during prepare | `failed` | Queue-owned `prepare-threw` | `not-started` | Allowed by existing Queue policy while attempts remain |
| `ctx.subprocess.spawn()` throws synchronously or `done` reports a spawn-level failure | `failed` | `operation-spawn` | `not-started` | Allowed while attempts remain |
| Nonzero exit code or signal exit | `failed` | `operation-exit` | `started` | No |
| Operation timeout | `failed` | `operation-timeout` | `started` | No |
| Owner/operator cancel after the cancel reason is latched and `waitForExit()` proves the complete process tree exited | `canceled` | None | Cancel intent already recorded by Queue | No |
| Complete process-tree exit cannot be proven after cancel/timeout | `unknown + Attention` | `operation-quiescence` | `unknown` | Operator authorize-retry only |
| Running append fails after start, or crash/shutdown cannot prove settlement | `unknown + Attention` | Queue recovery/shutdown category | `unknown` | Operator authorize-retry only |
| Exit 0 | `succeeded + OperationRunOutput` | None | `started` | Not applicable |

Successful stdout is retained from the head through `TextRetainer` under `resultBytes`; empty stdout produces only a summary. Failures keep only a stderr tail bounded by `failureTailBytes` and never persist spill paths. Notifications reuse only existing Work/Attempt/Result ids; the model must call `task_queue_result` to read output.

## File Map

| Area | Files | Owner |
| --- | --- | --- |
| Contract and Bridge | `packages/task-queue/operation-run-task-queue/{package.json,tsconfig.json,src/types.ts,src/index.ts,src/invariant.ts,tests/**}` | WorkKind, config, subprocess lifecycle, bounded output |
| Agent Consumer | `packages/task-queue/tool-operation-run-task-queue/{package.json,tsconfig.json,src/index.ts,src/invariant.ts,tests/**}` | Agent authority, single/Batch admission schema |
| Queue vertical | `packages/task-queue/task-queue-local/tests/operation-v2-vertical.spec.ts` | Durable Work/Attempt/Result/Notification and reopen |
| Real fixtures | `packages/task-queue/operation-run-task-queue/tests/fixtures/{emit-operation.mjs,wait-operation.mjs,exit-zero-on-release.mjs}` | Real Node stdout, process-tree cancellation, and exit-zero race fixtures |
| Browser acceptance | `apps/web/tests/task-queue-workspace.e2e.ts` | Real Task Queue Workspace, Remote action, refresh, console |
| Runtime availability | `apps/cli/package.json`, `pnpm-lock.yaml` | Let the released CLI/Profile Loader resolve both opt-in packages without mounting them automatically |
| Capacity and shared wiring | `packages/bundle/base/cordis.patch.yml`, `packages/bundle/base/tests/base.spec.ts`, `tsconfig.base.json`, `tsconfig.host.json` | Default `operation-run: 1` capacity, package aliases, project references |
| Test composition | A new package Loader fixture or equivalent test-only `cordis.yml` | Explicit Bridge/Consumer rows, test operations, complete Queue capacity |
| Package docs | `README.md`, `README.zh.md`, and `README.i18n.yaml` in both new packages | Config, semantics, limitations, Model Experience |
| Durable rationale | `.agents/notes/{proposed,implemented}/feature/2026-08-27-queue-operation-run.{md,zh.md,i18n.yaml}` | Current design, alternatives, verification evidence |
| Subsystem and guidance | `docs/subsystems/task-queue.{md,zh.md,i18n.yaml}`, `.agents/skills/dsh-task-queue/SKILL.md` | Optional WorkKind composition and usage boundary |
| Generated projections | Tool/config/module/Cordis catalogs | Updated only by repository generators |

## Delegation Strategy

| Wave | Owner | Exclusive scope | Input contract | Deliverable | Root verification |
| --- | --- | --- | --- | --- | --- |
| 0 | Root | Baseline, Frozen Contract, proposed Agent Note, `operation-run-task-queue/src/types.ts`, and shared workspace references | This plan's Frozen Contract | Types and decisions consumable by parallel implementation | Public typecheck, changed-file ownership |
| 1A | Worker A | Runtime/tests/README in `packages/task-queue/operation-run-task-queue/`, excluding files already frozen by Root | `OperationRun*` types, Config, failure matrix | Bridge, subprocess lifecycle, handler tests | Root reruns handler tests and checks that resolved facts contain no secret |
| 1B | Worker B | `packages/task-queue/tool-operation-run-task-queue/` | `operation.run@1` intent and tool names | Agent single/Batch Consumer and schema tests | Root checks for no executor/argv/cwd/env/profile/model/credential fields |
| 2 | Root | `task-queue-local` vertical, `apps/cli/package.json`, base capacity/test, workspace references, lockfile, docs, generated artifacts | Wave 1 packages | Integrated Loader/process vertical and complete source/runtime graph | `assertEntriesLoaded`, focused suite, real evidence, generated diff |
| 3 | Root | `apps/web/tests/task-queue-workspace.e2e.ts`, final builds/gates | Integrated opt-in test composition | Browser cancellation/refresh evidence | Screenshot/DOM assertions, alert/console, authoritative Remote state |
| 4 | One reviewer | Final materially changed diff, read-only | Frozen plan, diff, test evidence | One round of correctness/security/regression findings | Root handles only findings with new evidence and starts no recursive review |

Do not delegate recursively during implementation; freeze shared types before Wave 1. Workers do not modify bundle files, root tsconfigs, the lockfile, Queue core, the browser test, or each other's package. Root owns integration, real execution, final verification, and the completion claim.

## Baseline Gate

Before new feature work, read-only record `git status --short`, HEAD, Queue-v2-related dirty paths, and the current listener; do not stop any process. Then run one existing core baseline:

```powershell
pnpm vitest run packages/task-queue/task-queue/tests packages/task-queue/task-queue-local/tests packages/task-queue/task-queue-executor-dsh/tests packages/task-queue/tool-task-queue/tests packages/task-queue/tool-agent-run-task-queue/tests packages/image/image-generation-task-queue/tests packages/image/tool-image-generation-task-queue/tests
git diff --check -- packages/task-queue packages/image packages/client/ui-task-queue packages/bundle/base packages/bundle/web-app apps/cli
```

Expected: the existing Queue v2 focused suite and target diff check pass. If the failure is in a Queue v2 owner path that this plan has not modified, record the exact test and owner, stop `operation.run@1`, and do not mix Queue v2 release repair into this feature.

---

### Task 1: Freeze the opt-in operation contract

**Dependencies:** Baseline Gate passes.

**Ownership:** Create the `operation-run-task-queue` package skeleton, `src/types.ts`, public typecheck, and proposed Agent Note triplet; modify `tsconfig.base.json` and `tsconfig.host.json` so the frozen types compile. Root owns these files exclusively until Wave 1 begins.

**Interfaces:** Consume Queue v2 `WorkKindDefinition/WorkHandler/JsonValue`; produce the Frozen Contract types, Config, and the contract that forbids caller execution controls.

**Verification:** New behavior and public contract. First make `tests/public-api.typecheck.ts` and config-validation tests fail on missing types/implementation, then use `pnpm exec tsc -b packages/task-queue/operation-run-task-queue/tsconfig.json` to prove type closure. If the contract needs caller-controlled dynamic parameters, env, artifacts, or new Queue core fields, stop and revise the design rather than expanding it opportunistically during implementation.

**Acceptance contribution:** Gives both parallel packages one input/output and failure contract and prevents rebuilding the old executor selector.

1. The Agent Note records why `ctx.subprocess` is reused, why the HEAD adapters are not reused, why v1 intent contains only `operationId`, and why opt-in composition is a non-goal.
2. The package type surface exports only the Frozen Contract; `src/types.ts` contains no runtime values.
3. Config RED tests cover blanks, integer boundaries, byte-budget relations, empty argv, and forbidden env-like fields; public typecheck proves `OperationRunIntent` cannot accept argv/cwd/env/shell/profile/model/credential.

### Task 2: Implement the `operation.run@1` Bridge

**Dependencies:** Task 1 has frozen types and the Agent Note decision.

**Ownership:** Wave 1A exclusively owns `packages/task-queue/operation-run-task-queue/src/index.ts`, `src/invariant.ts`, handler tests, fixtures, and this package's README; it does not modify shared files.

**Interfaces:** Consume `ctx.taskQueue.registerHandler()`, `ctx.subprocess.spawn()`, `TextRetainer`, and Task 1 types; produce `createOperationRunHandler(config, subprocess)` and Cordis function-plugin registration.

**Verification:** High-risk side-effect boundary. RED tests cover unknown id, resolved-spec durability, resource/policy, prepare, synchronous spawn throw, done rejection, exit/signal, timeout, cancel, cancel-versus-exit-zero, a surviving descendant, stdout truncation, stderr tail, and disposer removal. Completion commands are `pnpm vitest run packages/task-queue/operation-run-task-queue/tests` and package `tsc -b`. Extract another public service only after a second concrete operation proves duplicated lifecycle logic.

**Acceptance contribution:** A real finite process can be executed by a typed Handler, every process fact is frozen at admission, and side-effect/failure classification follows Queue v2 recovery rules.

1. `resolveAdmission()` accepts only a registered id after trimming, copies and freezes the definition as the resolved spec, and derives `resources()` and `policy()` only from that resolved spec.
2. `prepare()` verifies that cwd is an existing directory; it creates no directory, resolves no new config, and starts no side effect.
3. `start()` synchronously creates one lifecycle owner; spawn uses a `SubprocessSpawnSpec` with no `env` field. Cancel/timeout first latch the cause under a first-cause rule and then reuse one idempotent `terminateAndWait` promise: call `terminate()` once and await `waitForExit()` to prove complete process-tree exit.
4. `LiveAttempt.done` still waits for tree quiescence after the direct child closes. A latched cancel wins a concurrent exit 0 and returns `canceled`; timeout returns a started failure; `waitForExit()` false/rejection returns `operation-quiescence/unknown`. Successful and failed text is bounded with `TextRetainer`, and spill paths are ignored.
5. The Cordis effect registers and unregisters the `operation.run@1` Handler exactly; duplicate Handlers continue to fail loudly in the Queue provider.

### Task 3: Implement the Agent admission Consumer

**Dependencies:** Task 1 has frozen intent, tool names, and Batch shape; this may run in parallel with Task 2.

**Ownership:** Wave 1B exclusively owns `packages/task-queue/tool-operation-run-task-queue/`.

**Interfaces:** Consume `TaskQueue.forAgent(createVerifiedAgentAuthority(exec.agent.session))` and the type-only `operation.run@1` declaration; produce `operation_run_enqueue`, `operation_run_enqueue_batch`, and a pure factory.

**Verification:** Authority and model-facing contract. RED tests prove rejection without a live Agent, owner derivation from Session, exact single/Batch requests, `maxParallel` bounds, and schemas without execution internals. Completion commands are `pnpm vitest run packages/task-queue/tool-operation-run-task-queue/tests` and package `tsc -b`.

**Acceptance contribution:** The model can submit host-named operations but cannot control processes, credentials, Providers, or Queue execution internals.

1. The pure factory follows the existing agent/image admission Consumer pattern and returns exactly two tools.
2. Single and Batch tools construct only `OperationRunIntent { operationId }`; Batch preserves each title and uses an empty `sharedPayload`.
3. Output exposes only Work/Batch ids; actual results remain available through generic `task_queue_result`.
4. The package invariant proves tool registration and the type-only WorkKind dependency without copying Handler config or the operation catalog.

### Task 4: Integrate the real Loader/process, durable reopen, and Queue Workspace

**Dependencies:** Tasks 2 and 3 focused tests pass; Root confirms both workers changed no shared files.

**Ownership:** Root modifies `apps/cli/package.json`, workspace references, the lockfile, base Queue capacity and its test; creates `task-queue-local/tests/operation-v2-vertical.spec.ts` and `apps/web/tests/task-queue-workspace.e2e.ts`; does not add either new package as an active Cordis row in base/web/standard.

**Interfaces:** Consume both new packages, LocalTaskQueue, LocalSubprocessRuntime, Session/Agent authority, generic result/delivery, Queue Remote/UI; produce a test-only Loader composition and real evidence.

**Verification:** Run the keyless real Node vertical first, then the browser boundary. Completion commands:

```powershell
pnpm vitest run packages/task-queue/operation-run-task-queue/tests packages/task-queue/tool-operation-run-task-queue/tests packages/task-queue/task-queue-local/tests/operation-v2-vertical.spec.ts
pnpm run build:lib:host
pnpm run build:lib:client
pnpm run build:web
pnpm vitest run --config vitest.web.config.ts apps/web/tests/task-queue-workspace.e2e.ts
```

**Acceptance contribution:** Proves the capability is more than packages and unit tests: a real process, durable Queue, owner result, and real browser operator path consume the same WorkItem.

1. The test composition loads Bridge and Consumer by package name, explicitly configures Queue with `resourceCapacity: { operation-run: 1 }`, proves through Loader `assertEntriesLoaded` that both new packages resolve, and separately asserts that admission fails loudly when the resource is not configured or a claim exceeds total capacity.
2. `fixture.echo` uses `process.execPath` and a fixed fixture path and prints `OPERATION-RUN-V1-OK`. In an Agent scope created by the real Loader, the vertical locates and executes the registered `operation_run_enqueue` tool with only `title/operationId/idempotencyKey`, verifies that the durable owner equals that Session, waits for success, inspects the resolved revision, Attempt, Result, and pending Notification, then closes and reopens the root and reads the same typed output again.
3. The real registration surface also rejects a missing Agent, extra execution fields, and an unregistered operation; direct `queue.forAgent().enqueue()` is not a substitute for Consumer evidence.
4. The delivery test durably appends the stable Notification message to the owner Session, flushes, then acknowledges it. The message contains no stdout, argv, cwd, or stderr; only `task_queue_result` returns bounded output.
5. `fixture.wait` starts at least one descendant Node process that remains alive. The browser opens Queue sidebar/workspace from the `dist` produced by this run's `build:web`, observes a running row, cancels it, waits for tree quiescence before observing canceled, preserves canceled after refresh, and checks for no alert, console error, or failed network request.
6. The browser assertion reads the Work id and authoritative Remote status and does not substitute button text, HTTP 200, or fixture JSON for durable-state evidence. It also covers cancel-versus-exit-zero and forbids success.
7. Test teardown reasserts process-tree exit and Queue-root lock release, but teardown cannot be the only quiescence proof before durable `canceled`; do not obtain a port by stopping an existing listener on 3080.

### Task 5: Release documentation, generated projections, and final freeze

**Dependencies:** Task 4 real-process and browser evidence passes.

**Ownership:** Root updates both package README pairs, the task-queue subsystem pair, the `dsh-task-queue` skill, the Agent Note triplet, and generated projections; it does not edit archived Agent Notes or hand-edit a generated catalog.

**Interfaces:** Consume final config/tool schemas and real evidence; produce current-state documentation, an optional composition recipe, a published package graph, and the completion report.

**Verification:** Non-behavioral synchronization plus one frozen broad milestone. READMEs describe default-off composition, complete config, result/failure semantics, known limitations, and Model Experience. The subsystem page adds only the WorkKind Bridge boundary and does not duplicate the config table. Completion commands:

```powershell
pnpm run verify-translation-pairing --write packages/task-queue/operation-run-task-queue/README.md packages/task-queue/tool-operation-run-task-queue/README.md docs/subsystems/task-queue.md .agents/notes/implemented/feature/2026-08-27-queue-operation-run.md
pnpm run gen-tool-catalog
pnpm run gen-config-catalog
pnpm run gen-cordis-catalog
pnpm run gen-doc-graphs
pnpm run gen-module-graph
pnpm vitest run packages/task-queue/task-queue/tests packages/task-queue/task-queue-local/tests packages/task-queue/task-queue-executor-dsh/tests packages/task-queue/tool-task-queue/tests packages/task-queue/tool-agent-run-task-queue/tests packages/task-queue/operation-run-task-queue/tests packages/task-queue/tool-operation-run-task-queue/tests packages/image/image-generation-task-queue/tests packages/image/tool-image-generation-task-queue/tests packages/client/ui-task-queue/tests
pnpm run build:lib:host
pnpm run build:lib:client
pnpm run build:web
pnpm run lint
pnpm run doc-sync
pnpm run verify-agent-note-format
pnpm run verify-package-paths
pnpm run verify-package-invariants
git diff --check -- apps/cli/package.json apps/web/tests/task-queue-workspace.e2e.ts packages/bundle/base packages/task-queue/operation-run-task-queue packages/task-queue/tool-operation-run-task-queue packages/task-queue/task-queue-local/tests/operation-v2-vertical.spec.ts tsconfig.base.json tsconfig.host.json pnpm-lock.yaml docs/subsystems/task-queue.md docs/subsystems/task-queue.zh.md .agents/skills/dsh-task-queue docs/superpowers/plans/2026-08-27-queue-v2-operation-run.md
```

**Acceptance contribution:** Package, tool, config, documentation, and real behavior agree; existing Queue v2 capabilities do not regress; the completion claim has fresh source, test, and browser evidence.

1. After real evidence passes, move the proposed Agent Note to an implemented triplet using current-state Decision/Consequences/Verification prose; do not present future Agent Provider routing as implemented.
2. The README opt-in recipe requires a profile to install both Bridge and Consumer and configure at least one fixed secret-free operation. It does not recommend restoring node/shell or putting a Skill script directly into a Queue worker.
3. The `dsh-task-queue` skill calls `task_queue_kinds` to confirm whether `operation.run@1` is composed; when it is absent, it does not construct an operation-tool payload.
4. The completion report records Work/Attempt/Result/Notification ids, the Consumer tool call, owner Session, reopen fact, stdout bound, descendant pids before cancel and tree-exit fact, the fresh web build used by the browser, refresh, focused test count, owned-path gate, and remaining non-goals. If global lint/doc-sync includes existing WIP failures, report the exact failing paths and commands, do not attribute them to this feature, and do not claim repository-wide green.

## Stop Conditions

- The Baseline Gate proves an unresolved failure in Queue v2 core, owner delivery, root locking, or a current WorkKind.
- The first real production operation requires caller parameters, secret env, dynamic cwd, an arbitrary script path, or a byte artifact; establish a named domain WorkKind or revise the security contract first.
- The Handler must reread mutable config after admission to execute; that would break durable resolved facts.
- Operation output must exceed bounded text or persist a file; the current Queue does not own a generic Artifact Store.
- Browser acceptance can pass only by stopping an unrelated server, deleting existing Queue data, or using a fixture-only Remote.
- The feature requires modifying Queue core, Goal, Workflow, Subagent, or Jobs ownership; stop and redo the reuse decision.
- A broad gate fails only in dirty paths not modified by this plan; record the baseline and stop investigating.

## Deferred Follow-on Plans

1. Plan `agent.run@1` Provider routing only after a second real Provider supplies the same authority, cancellation, output, and restricted-composition evidence; Codex, Claude Code, and OpenCode cannot be reused merely because a HEAD adapter exists.
2. Introduce parameterized operations only after at least two real allowlisted operations demonstrate `operationId` explosion or repeated schemas; prefer a domain-specific WorkKind.
3. An external asynchronous remote job needs submit/poll/cancel/reconcile and durable remote identity; plan it as a separate Provider lifecycle instead of expanding the local-process Handler.
4. Queue-to-Goal continuation, multi-host Session ownership, and byte-exact Artifact capability remain within their existing deferred-plan boundaries.

## Final Review

1. Every DoD fact appears in the Bridge, Consumer, real process, owner delivery, browser, or docs task.
2. A caller can never pass argv/cwd/env/shell/profile/model/credential, and the resolved spec does not drift after admission.
3. Start/timeout/cancel have one lifecycle owner, and the failure matrix matches Queue auto-retry rules.
4. Queue core and current WorkKinds do not depend on the operation package, and the opt-in package does not enter the default Bundle.
5. Wave 1 file ownership does not overlap; Root owns shared files, integration, real execution, and the completion claim.
6. The real-process and browser verticals occur before broad verification and Agent Note promotion.
7. There is no placeholder, compatibility shim, generic artifact, recursive delegation, or duplicate broad suite.
