---
name: dsh-change-verification
description: Use in the deepseek-harness repository before declaring a change, integrated milestone, or user-visible behavior complete. Select and run the smallest credible set of DSH-specific evidence across source-contract, generated-declaration, composed, runtime-observed, and behavior-verified layers; use it for Loader/Profile, HMR, Session snapshot, built Host/Client, Provider E2E, restart/recovery, and GUI changes. Do not use it merely to choose pre-push checks for an outgoing diff, or as a substitute for diagnosing a known failure.
---

# DSH Change Verification

DSH is a composed product, not merely a TypeScript workspace. A source edit can type-check while its generated Remote declaration is stale; a mounted package can exist while no shipped Profile selects it; and a loaded service can differ from the built Host/Client process users actually run. Completion evidence must cover the changed promise all the way to the user or machine-observable result, but no change earns credibility by reflexively running every repository lane.

Use this skill when the question is whether a change or milestone is *actually complete*. It selects the evidence. Use `dsh-pre-push-checks` after that selection when preparing an outgoing branch: it scopes the published diff and push procedure. Use `verification-before-completion` as the general honesty rule: it requires fresh evidence before a claim, but does not know which DSH composition layers can falsify that claim. For a failing test or live symptom, diagnose first; do not turn this into a broad test ritual.

## Outcome

Before a completion claim, produce a short evidence ledger with:

- the changed promise and entry path;
- the required and deliberately omitted layers;
- exact commands or observations, commit/tree identity, and result;
- what each result proves and does not prove;
- remaining unverified conditions, including missing credentials, unavailable GUI, or a restart not performed.

Do not say that a package, feature, Profile, Provider, or UI is complete when the ledger proves only a lower layer.

## Inputs, evidence reuse, and verification ownership

Consume available Charter, Issue, Change, Diagnosis, and Verification receipts through [the handoff protocol](../dsh-feature-delivery/references/handoff-evidence.md). Validate each evidence record against the current claim, subject identity, relevant environment, HEAD/dirty-diff or narrower input digest, and its invalidation rules. A comparison identity recorded as `not-observed` cannot establish freshness, and time-bound evidence is fresh only before its finite `validUntil`. Reuse fresh evidence; rerun only stale or missing proof.

Keep verification levels separate. Implementation workers own focused authoring checks. The slice integrator owns package and required derivative checks. The primary agent runs shared cross-package/composition checks once after integration. An independent verifier owns Charter-closing evidence when authority or self-hosting requires it. Do not make every worker run broad repository lanes.

Treat verification commands by side effect. Prefer repository-owned scripts or already-installed direct binaries for read-only checks. In this workspace, a package-manager execution can first reconcile dependency state and run install hooks when manifests or the lockfile changed; inspect that state and use `--ignore-scripts` for an authorized lockfile-only reconciliation rather than allowing a nominal test command to mutate Git hooks or dependency state unexpectedly.

A documentation-only edit invalidates documentation/link/pairing/metadata evidence, not unchanged behavior tests. A known failure stops expansion: diagnose the first cause, then invalidate only the changed layer and dependent later evidence.

## Self-hosting: keep the judge outside the changed loop


When DSH is helping develop, launch, test, or verify DSH itself, record four identities before selecting evidence. The controller and mutable subject must not share a worktree, module-resolution path, build output, or live Skill registry. They may share a machine only when the controller is an isolated immutable approved artifact with separate home, ports, data, and process identity. The controller and executor may use that same approved controller artifact only when the executor does not load subject code.

- **controller DSH identity** — the Harness/Profile/home/process that admits or coordinates the work;
- **executor DSH identity** — the Agent/worker/Tool authority that changes source or runs the requested work;
- **subject identity** — the checkout, commit/tree, build artifact, Profile/home/ports, and target runtime whose behavior the claim concerns;
- **verifier identity** — the known-good or previously approved Harness/Profile/toolchain that runs the acceptance observation.

The controller and executor prove orchestration and attempted work, not correctness of their own output. Before the subject starts, the controller must freeze an immutable **Verifier plan** outside the subject worktree. Record its controller-owned identity and digests for its assertions, commands, checker/parser, input fixtures, golden/expected artifacts, and allowed environment inputs. The verifier executes that snapshot read-only against subject artifacts; the subject cannot rewrite the plan, checker, fixtures, expectations, or allowed environment while it is being judged.

If a runtime or verification Skill is being changed, it cannot be its own sole acceptance mechanism: use a known-good or previously approved verifier identity and its frozen Verifier plan, then observe a result through the subject entry path. Subject unit tests, a report written by the subject, `git diff`, and a workspace artifact produced by the subject are candidate evidence only. They can help locate or corroborate a result, but cannot alone constitute independent world evidence. A process-bound protocol response independently checked by the verifier, a browser-visible result, or an external Provider record can be independent world evidence when the frozen plan defines the expected result and the verifier reads it without subject-controlled parsing.

Isolate controller, executor, subject, and verifier Profiles when they can coexist: use distinct `DSH_HOME` data roots, explicit non-overlapping ports, and recorded launch commands. Store the Verifier plan outside the subject worktree and freeze it before the subject process starts. Do not point an acceptance run at the controller's home, reuse its port, or silently attach to an already-running subject. If a distinct verifier or pre-start frozen plan cannot be made available, report the upper acceptance layer as `not run`; source and composition evidence may still be useful but do not establish self-hosted completion.

## 1. Establish the claim and delivery surface

Read the root and nearest `AGENTS.md`, then inspect the relevant current diff, owning package, config rows, tests, and entry path. Preserve unrelated WIP. Record whether the target is source checkout, built artifact, a specific `dsh` Profile, or a deployed process.

State the claim in one observable sentence. Examples:

- “The web Profile exposes the new session action and it survives an HMR reload.”
- “The provider maps model-level reasoning options in a real request.”
- “A Queue handler recovers its durable reservation after restart.”

Reject vague claims such as “the module works.” They cannot select evidence.

Classify the changed surface; more than one row may apply. Read the corresponding rows in [evidence-matrix.md](references/evidence-matrix.md) before selecting commands.

| Surface | Usually reaches |
| --- | --- |
| Pure internal algorithm or local type | source-contract |
| Public export, `Context`/Remote type, generated catalog | generated-declaration |
| Cordis plugin, Bundle, config row, Profile selection | composed |
| Live service, HMR, Session projection, durable state, recovery, or Agent/Preset/Session/Remote scope and authority | runtime-observed |
| CLI, ACP, SDK, Web, Provider, user-visible workflow | behavior-verified |

## 2. Build a proportionate five-layer proof plan

Treat the layers as different failure classes, not a mandatory ladder. A layer is required only when the changed promise crosses it. If the answer is unknown, inspect composition and the real entry path before omitting it.

1. **source-contract** — types, unit behavior, lifecycle/error/negative paths, and source-owned invariants. A focused test should fail for the regression rather than merely call the new code. Use exact Vitest tests and relevant coverage scope where required.
2. **generated-declaration** — generated Remote/client declarations, catalogs, manifests, config schemas, package exports, and build-consumed metadata match source. Run the owning generator or verifier; generated text on disk alone is not proof of freshness.
3. **composed** — Loader resolves the real named exports and config, and the intended Bundle/Profile selects the contributor. A hand-mounted `ctx.plugin(...)` test cannot establish this layer. Composition alone does not prove that a particular Agent, Preset, Session, or Remote scope can see or invoke it. Use a test-only Loader/Profile composition, a preflighted config dump, or the owning composed test.
4. **runtime-observed** — a running process exposes the expected service, registration, durable projection, event, or state transition. For HMR, unload/reload and prove registrations disappear then return without duplication. For persistence, stop and restart through the real owner, then inspect reconstructed state.
5. **behavior-verified** — the shipped entry path produces an external result: a built CLI/worker/ACP/SDK call, browser interaction, workspace tree, Session snapshot, or real Provider result. Assert the world independently; do not trust an Agent's self-report or a response keyword.

The default minimum for a product-visible plugin is source-contract + composed + behavior-verified. Add generated-declaration when generated seams or artifacts change, and runtime-observed when the claim includes reload, state, visibility, authority, a particular Agent/Preset/Session/Remote scope, or live lifecycle.
For self-hosted changes, make the final behavior-verified row an observation made by the verifier identity against the subject identity, under the controller-owned Verifier plan frozen before subject startup. Include the plan identity and digests plus an independently inspectable world result. Do not let the same changed Skill both select the evidence and be the only component that declares it passed.

## 3. Choose the narrowest proof that reaches the promise

Use the matrix’s smallest sufficient row. Typical selections:

- **HMR or disposable registrations:** focused lifecycle test plus Loader composition; dispose the contributing fiber, assert cleanup, reload, and assert one restored contribution. Use a live reload only when the claim is about the shipped live Profile.
- **Loader/Profile/Bundle:** test the exact config with Loader and verify required named exports; inspect the final layered config only after preflighting the exact launcher, `DSH_HOME`, and Profile existence. Package presence or a standalone plugin unit test does not prove composition. If the claim is that a particular Agent, Preset, Session, or Remote scope sees or is authorized for the capability, add runtime observation in that exact scope.
- **Model/protocol/human-visible transcript:** add or update a recorded-session snapshot. Replay is keyless, deterministic evidence for assembled behavior; it does not prove a current provider’s network behavior.
- **Host/Client or Remote contract:** verify generated declarations and run the full build when a Client bundle, dynamic extension, package export, or built runtime is consumed. `build:web` alone cannot refresh all dynamic Client bundles after Host/Client contract changes.
- **Provider:** exercise the model-specific configuration in a real Provider request when credentials are available. Record the selected model, non-secret configuration identity, request outcome, and mapped usage/error. A mock proves the adapter contract, not Provider reality.
- **Durable work, cancellation, restart, or recovery:** include the exact admission/dispatch/commit or failure point, stop the owning runtime, restart it, and assert durable state and absence of duplicate side effects. FIFO admission is not proof of serialized execution.
- **GUI:** build the relevant artifact, run the real server and user flow, then assert browser-visible state. A GIF is required for a PR changing product-user-visible GUI under `record-browser-gif`; a unit or DOM-only test cannot demonstrate a real model-backed flow.

Never add a with-key, browser, restart, or full build merely as ceremony. Add it when a lower layer leaves the stated behavior falsifiable. Conversely, do not omit it because unit tests are green when the promise crosses that boundary.

## 4. Run, inspect, and record evidence

Start with the narrowest check that can fail on the change. Expand only after identifying the next unproven boundary. For each command, capture the exit result and inspect the relevant output rather than treating a command invocation as evidence.

When tests or builds consume built output, establish a current complete build first. Source-path tests intentionally resolve `src`; they cannot prove `lib/`, generated remote artifacts, or Web dynamic bundles. Before `--dump-config`, establish whether the claim concerns the current source checkout or an installed runtime; identify the exact launcher, read the intended `DSH_HOME`, and confirm the Profile exists there. `pnpm dsh` proves only this source checkout, never a separately installed running DSH. If that Profile is absent, inspect its static Bundle/manifest layers instead, or obtain authorization to create an isolated Harness home; do not silently dump or mutate a different home. For user-facing applications, launch through the selected `dsh --profile <name>` entry rather than a package bin or ad hoc Node entry.

If credentials, a GUI-capable environment, or restart permission is unavailable, do not synthesize a substitute and do not call the highest layer passed. Report the missing layer and the safe next command. Never print secrets.

Use this ledger in the final report or implementation handoff:

```markdown
## Verification ledger

Claim: <observable outcome>
Tree: <commit, branch, and dirty/WIP status>
Identities: controller=<Profile/home/process>; executor=<Agent/worker authority>; subject=<checkout/build/Profile/home/ports>; verifier=<known-good checkout/Profile/toolchain>
Verifier plan: controller-owned <identity/path outside subject worktree>; frozen-before-subject-start=<yes/no>; digests=<assertions, commands, checker/parser, fixtures, golden/expected artifacts, allowed env inputs>

| Layer | Evidence | Result | Proves | Does not prove |
| --- | --- | --- | --- | --- |
| source-contract | `<exact command>` | pass/fail | ... | ... |
| generated-declaration | ... | ... | ... | ... |
| composed | ... | ... | ... | ... |
| runtime-observed | ... | ... | ... | ... |
| behavior-verified | ... | ... | ... | ... |

Omitted layers and reason: ...
Remaining conditions: ...
```
For a self-hosted change, also name the immutable Verifier plan, its controller-owned digests, and the independent world evidence in the behavior-verified row. Explain why the verifier is not the modified subject and why the verifier reads subject artifacts without subject-controlled parsing. Do not treat subject tests, subject reports, `git diff`, or subject workspace artifacts as independently sufficient. Omit secrets while retaining non-secret profile, build, process, home, port, and plan identities.

Use `not applicable` only when the promise demonstrably never crosses the layer. Use `not run` when it does cross but evidence is missing.

## 5. Interpret results honestly

- A green source test does not prove the Loader, Profile, generated artifacts, built app, or live provider.
- A green generated verifier does not prove a Profile selects the contributor.
- A green composition test does not prove cancellation, persistence, HMR, or user-visible behavior unless it exercised them.
- A keyless snapshot proves recorded assembled behavior, not external availability or current model quality.
- A real Provider smoke proves only its observed model/configuration/time window; retain replay and deterministic coverage for regressions.
- A complete build proves artifacts were generated for that tree, not that a user flow works.

When a higher layer fails, report the highest layer actually proven and diagnose the boundary. Do not downgrade the claim silently or rerun unrelated repository-wide checks in hope of a different signal.

## Handoff to adjacent skills

After this skill selects evidence:

- invoke `dsh-pre-push-checks` for a branch about to be pushed or marked review-ready; it reassesses the outgoing diff, stack/base state, and push mechanics;
- invoke `dsh-code-review` for independent semantic review, especially ownership, authority, concurrency, and evidence gaps;
- invoke `record-browser-gif` for a product-visible GUI PR;
- invoke `verification-before-completion` before any passing or completion assertion, using this ledger as its DSH-specific input.

Do not use this skill to choose a feature architecture (`dsh-reuse` / plugin architecture work), to submit Queue work (`dsh-task-queue`), or to diagnose a known failing symptom (`systematic-debugging`).

Produce a `VerificationReceipt` that distinguishes reused, rerun, failed, omitted, and still-unverified evidence. It never upgrades a worker or subject self-report into independent acceptance.
