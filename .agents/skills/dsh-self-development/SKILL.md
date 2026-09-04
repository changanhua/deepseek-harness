---
name: dsh-self-development
description: Use when DeepSeek Harness agents, Goals, Workflows, Queue work, or bundled Skills are used to modify, build, test, review, integrate, or publish deepseek-harness itself or a repository DSH plugin. This includes self-hosted feature delivery, repair, validation, review, and release work where the harness under test may also provide the controller. Establish a known-good controller runtime and an isolated subject before any self-hosted run, so changed DSH code or Skill instructions cannot certify themselves. Do not use for ordinary external Codex editing, a one-off repository inspection, or operating an already-composed Queue task that does not change DSH.
---

# DSH Self Development

DSH can develop DSH, but it cannot be the only witness of its own change. A controller that loads the subject checkout, subject Profile, or changed Skill instructions has crossed the trust boundary: a passing task transcript then proves only that the changed system described itself as working.

This Skill orchestrates the boundary. It is not an execution API, a replacement queue, or a substitute for the owning DSH subsystem Skill. Read [the self-hosting protocol](references/self-hosting-protocol.md) before selecting a runtime or starting a self-hosted task.

## Trigger and scope

Use this Skill when either side of a development loop is DSH itself:

```text
DSH controller / Goal / Workflow / Queue / bundled Skill
        -> changes, builds, tests, reviews, merges, or publishes
deepseek-harness or a DSH plugin in this repository
```

It also applies when a changed repository Skill will guide a later agent that works on this checkout. The skill registry may dynamically reread `.agents/skills`; that makes a just-edited Skill subject code, not trustworthy controller policy.

Do not trigger merely because an external Codex agent edits TypeScript in this repository without using DSH as controller or subject runtime. Do not use it to enqueue arbitrary shell commands, choose an executor, or bypass the typed WorkKind admission contract.

## Operate as an overlay and reuse upstream receipts

This Skill overlays trust, isolation, policy snapshots, authority stops, and independent verification on the selected delivery workflow; it is not another serial planning phase. Consume valid Charter, Issue, Change, and Verification receipts through [the handoff protocol](../dsh-feature-delivery/references/handoff-evidence.md), then add self-hosting identities without repeating their architecture or tests.

Keep multi-agent roles explicit. The primary/controller agent owns admission and integration, subject workers own bounded disjoint implementation, and the verifier waits for a stable candidate and executes the frozen verifier plan. The subject and its workers run focused checks only; the verifier does not trust their verdict or rerun unrelated fresh evidence. With expensive or high-reasoning agents, prefer a few substantial lanes and one independent review over microtask fan-out.

Produce a `SelfDevelopmentReceipt` with controller/subject/verifier identities, policy and verifier-plan digests, isolation, delegated lane ownership, authority stops, world evidence, contamination status, and remaining acceptance gap.

## Invariants

Keep these facts explicit in every self-hosted run:

1. **Known-good controller.** The controller runs a previously approved DSH revision with an approved Profile, dependency tree, and Skill snapshot. It does not import, dynamically reload, or mount the subject checkout.
2. **Isolated subject.** The subject has its own worktree, build output, `DSH_HOME`, ports, data root, logs, and disposable credentials/configuration handles. Do not point either runtime at the user's normal DSH home or a shared durable Queue database.
3. **Frozen policy identity.** At run start, record the Charter identity, target revision, controller revision, Profile/config identity, and digest of every controller Skill used. A changed Skill may be tested as subject material, but cannot replace its approved snapshot during the run.
4. **Independent verdict.** The subject Agent, Goal, Workflow, Queue handler, changed runtime, and changed Skill cannot declare the change accepted. An independent verifier on the controller side checks artifacts and observed world state.
5. **Human authority stays human.** A person separately authorizes merge, push, publish, data migration, credential creation/use, and any paid external request. Automation may prepare evidence and stop at the authority boundary.
6. **Rollback remains usable.** Keep the known-good controller, target base/revision, subject patch/commit, isolated data, and evidence long enough to reproduce a failed run or return to the approved runtime.

If any invariant cannot be established, run only read-only discovery or ordinary non-self-hosted development. Do not relabel an unfenced self-hosted run as independent verification.

## 1. Freeze the authority record

Before execution, write a compact run record. It may live in the approved task artifact or durable task metadata, but must not be supplied only by the subject.

```text
Charter: <approved charter id/revision, or not applicable with reason>
Target: <subject worktree path + starting Git revision>
Controller: <known-good worktree/build revision + launch identity>
Controller policy: <Skill paths and content digests captured at start>
Subject policy: <changed Skill paths/digests, if any>
Verifier plan: <controller-owned immutable snapshot outside subject worktree: assertions, commands, checker/parser, input fixtures, golden/expected artifacts, allowed environment inputs, per-file and manifest digests>
Isolation: <controller/subject DSH_HOME, data roots, ports, log roots>
Authority: <recorded run-id, target, provider/model, credential scope/limit/expiry, and paid-call budget/amount limit; operations explicitly forbidden>
Verifier: <controller-side verifier and its independent assertion>
Rollback: <known-good launch and subject/base recovery reference>
```

`target revision` is an input to the task, not a mutable branch label. When the subject creates commits, record both start and result revisions. A dirty worktree is a separate identity; record its patch/diff reference rather than pretending it is the named commit.

For a changed Skill, snapshot the *content* available to the controller at start and calculate a content digest from the exact files. A path, mtime, branch name, or package version alone is not enough. The controller must read the snapshot rather than the live project Skill registry for the remainder of that run.

Freeze a separate **Verifier plan** before the subject starts. The controller owns this immutable snapshot outside the subject worktree. It names assertions, commands, checker/parser, input fixtures, golden or expected artifacts, and the only environment inputs the verifier may read; record a digest per file and for the complete manifest. The verifier executes that snapshot and reads subject artifacts only. Subject tests, a subject-written report, a task transcript, or `git diff` may support diagnosis, but cannot alone become world evidence.

## 2. Use the DSH delivery route in order

Self-hosting changes the trust boundary; it does not replace DSH architecture discipline. Route work in this order, skipping only steps whose input is already approved and still matches the target:

1. `dsh-feature-charter` — freeze the final user outcome and top-level acceptance; do not treat a kernel slice as feature completion.
2. `dsh-reuse` and `xia-pluginmaster` — establish reuse choice and exact current Definition/Provider/Consumer/Bridge/Profile contracts.
3. `dsh-issue-stack-planner` — turn the accepted outcome into a kernel/provider/bridge/composition/consumer/acceptance DAG.
4. Execute the approved bounded slice with the owning subsystem Skill. Use `dsh-task-queue` only after a typed WorkKind is composed; it is not a general self-development executor.
5. `dsh-change-verification` — select the required source, generated, composition, runtime, and behavior evidence.
6. `dsh-code-review` — obtain independent semantic review of the resulting diff and evidence gaps.
7. `dsh-pre-push-checks` — immediately before an authorized outgoing push or review-ready claim.

Use the approved snapshot of these controller Skills for the task. If a Skill itself is the subject, use its prior approved snapshot (or an explicitly approved external controller policy) for guidance and reserve the new content for subject tests only.

## 3. Build a two-world execution plan

Separate the controller and subject physically and at runtime. The controller may send typed input and inspect declared subject artifacts; it should not share module resolution, generated output, sockets, durable data, or hot-reloaded Skill directories with the subject.

| Concern | Controller world | Subject world |
| --- | --- | --- |
| Checkout/build | known-good revision and immutable build | target worktree and target build |
| Skills | approved snapshot/digests | live changed registry and candidate Skills |
| DSH runtime | isolated approved Profile/home | isolated candidate Profile/home |
| State | controller-only task metadata | disposable test data and task artifacts |
| Ports/logs | controller allocation | separate allocation and log root |
| Verdict | independent verifier | claim and evidence producer only |

Prefer a clean worktree and fresh subject build. If an existing user worktree must be the subject, make it read-only for controller purposes, record its WIP identity, and do not clean/reset it. Do not use the main user runtime as a convenience controller or subject.

For Queue or Workflow execution, the controller admits only a composed typed WorkKind with constrained input. It captures the admission identity, cancellation/retry behavior, and result artifact. The WorkKind still cannot decide that its own code change is accepted.

## 4. Require world evidence, not self-report

Define an assertion outside the subject's decision path. The verifier consumes evidence that the subject cannot forge merely by returning `success`:

- inspect a separately built artifact, generated declaration, or package export;
- start the subject through its intended Profile and observe a real service/tool/UI/ACP behavior;
- replay a recorded Session from the approved controller or run a controlled real request when separately authorized;
- verify durable state only after stopping and restarting the owning subject runtime;
- compare a bounded workspace/result artifact to deterministic expectations.

Select layers through `dsh-change-verification`. At minimum, self-hosted acceptance must have an independent `behavior-verified` assertion. Add `runtime-observed` whenever the promise includes scope, lifecycle, persistence, HMR, authority, or a live Profile. A unit test, task transcript, agent final message, or subject-written report alone is never world evidence.

When an independent verifier cannot run, report the highest genuinely proven layer and leave acceptance open. Do not let the subject downgrade the charter's closure condition.

## 5. Stop at human-authority operations

The self-hosted controller may draft commits, reports, PR text, migration plans, and commands, but must stop for explicit human approval before:

- any merge, including a fast-forward or merge known not to discard work, and any deletion of branches/worktrees;
- pushing, force-pushing, creating/releasing/publishing packages, or changing a remote setting;
- migrating, deleting, or reformatting durable user/shared data;
- injecting, resolving, or using any credential in the controller or subject without a recorded run-specific authorization: run id, target, provider/model, scope or usage limit, and expiry;
- spending money, including provider requests, paid graders, or external build capacity, without an accurate target and an approved budget or amount limit.

Record the approval and exact target operation. An earlier approval for a local test does not authorize a later publish or migration.

## 6. Report the boundary and outcome

Use this report shape:

```markdown
## Self-development run

Subject: <worktree, start/result revision, dirty identity if applicable>
Controller: <known-good revision and launch/Profile identity>
Policy snapshot: <Charter + Skills with content digests>
Verifier plan: <immutable controller-owned plan, input/expected-artifact identities, and manifest digest>
Isolation: <homes, ports, data, build/log roots>
Execution: <typed work/admission or bounded local action>
Independent verifier: <who/what, assertion, evidence location>
Evidence: <five-layer ledger or explicit omitted layers>
Authority stops: <any merge; credential run-id/target/provider-model/scope-limit/expiry; paid target/budget limit; operations not performed without approval>
Rollback: <known-good controller and subject/base references>
Result: <accepted / rejected / partial, with highest proven layer>
```

Do not say “DSH verified DSH” without identifying the independent controller snapshot and verifier. If controller and subject ever shared a live code, Skill, Profile, or state surface, mark the run contaminated and repeat it under isolation before accepting the result.
