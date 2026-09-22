# Agent Note: Eval scenarios and a browser pilot

Status: proposed

English | [中文](2026-09-10-eval-scenarios-and-browser-pilot.zh.md)

## Problem

Maintainers need to compare whether an agent can complete a real task, how much assistance it needs, and what it costs. A browser task can require discovering a page, generating a plugin, clicking its entries, changing requirements, and stopping it while retaining results. A correct final sentence or a successful plugin-start response does not establish those outcomes.

The [implemented Eval decision](../../implemented/architecture/2026-08-31-deterministic-eval-contract-and-snapshot-adapter.md) provides useful deterministic infrastructure. The [case schema](../../../../packages/eval/eval/src/schema.ts) requires one prompt and one replay fixture per route; the [runner](../../../../packages/eval/eval/src/runner.ts) selects that fixture before invoking an executor; the [run schema](../../../../packages/eval/eval/src/run.ts) requires replay provenance. These constraints prevent a new live, multi-turn scenario from being expressed directly. Merely adding browser assertions leaves execution, authoring, and evidence ownership unresolved.

This proposal extends that MVP. It does not claim that scenario execution, a browser adapter, or independent autonomous browser acceptance is implemented. It contributes to [Eval's execution and acceptance epic](https://github.com/changanhua/deepseek-harness/issues/49) without changing or closing that epic's broader requirements.

## Proposal

Keep the existing Eval core, deterministic outcome folding, route comparison, and JSON/Markdown reporting. Add a versioned scenario contract and a browser adapter as the first live consumer. A task author chooses an environment template, writes user messages and expected effects, and sets bounded execution limits. Reusing the template for another page must not require changing Eval core or writing a new lifecycle script.

Four responsibilities describe the design; they do not require four new frameworks or packages:

| Responsibility | Owner | Browser example |
| --- | --- | --- |
| Scenario: task, steps, criteria, and budgets | Eval validates the common envelope; the adapter validates its payload | Create entries, click, change labels, stop |
| Adapter: prepare, execute, and release the environment | A composed adapter beside the existing snapshot adapter | Isolated DSH profile and browser, bounded lifecycle |
| Observer: collect facts about the external result | Trusted verifier code outside the subject's writable workspace | DOM state, actual sidebar records, plugin state |
| Oracle: decide whether observed facts satisfy criteria | Versioned deterministic checks selected by the trusted plan | Correct item/link, deduplication, retention, cleanup |

The core does not own browser selectors, DOM interpretation, a second agent loop, Queue recovery, or Git worktree management. The browser adapter initially owns its observer and oracle implementations. Extract a shared interface only when another real adapter needs the same behavior. Runtime registration follows DSH plugin composition; the pure Eval library does not start services.

### Contract changes

The names below are proposed fields, not callable APIs. The implementation must update schemas, the executor request, result validation, reports, and the snapshot adapter together.

1. Introduce schema version 2 with an explicit execution discriminator. `session-snapshot` retains its prompt, workspace, and per-route fixture rules; `scenario` carries an adapter id/version and a validated scenario payload. Live scenarios do not need a previously recorded transcript. Unknown kinds, fields, adapters, or criterion versions fail preflight.
2. Extend the existing `EvalCaseExecutor` request to carry the selected execution variant, resolved route, immutable plan identity, and cancellation signal. One executor invocation still owns one case/route/attempt; it may execute several steps before returning. Keep sequential scheduling and stable report ordering until the replay owner supports stronger binding.
3. A scenario contains ordered steps with stable ids: user message, adapter action, and checkpoint. Adapter actions and checkpoints use registered names and typed arguments, not arbitrary code from a suite. No loops, expressions, or general workflow language are needed for the pilot. A bounded condition wait belongs inside the adapter action.
4. Results retain the four existing outcomes and add per-step observations, criterion results, execution provenance, assistance classification, and typed metric/evidence references. A DSH execution still requires a real Session fact. The common result must distinguish live execution from replay instead of inventing a replay file for a live run.
5. Select live or replay through an explicit supported adapter mode. Snapshot replay keeps independent route recordings and its existing binding guarantees. Other adapters must declare which modes they actually implement; unsupported replay is rejected before launch.

Preserve the existing snapshot scenarios and their expected judgments during migration. Update repository-owned examples to version 2 in the implementation change; legacy version 1 input may receive a clear unsupported-version error under the repository's pre-release policy. A permanent compatibility layer is not part of this proposal. New reports must never reinterpret an old replay result as new live evidence.

### Authoring and execution flow

Provide a shipped browser scenario template and an adapter-owned authoring guide. The author supplies ordinary user requirements, a target environment, expected effects, route choices, and budgets. The author does not supply a correct selector or plugin implementation to an autonomy case. A template may reference private verifier fixtures, but those references are resolved by the trusted runner and excluded from model input and tool-readable subject files.

The same resolved scenario supports preflight, one-case trial, suite comparison, and report export through supported DSH entry points. Preflight checks schema, adapter capabilities, profile/build availability, environment isolation, credential authority, and budget support without making a model request. The one-case trial shows the failing step, expected effect, observed fact, and evidence link; it does not require navigating a complete session log first. CLI/UI syntax is defined when its owning consumer is implemented.

GitHub can identify a reviewed test revision and display the resulting check; a trusted DSH runner owns execution and durable evidence. Local execution supports authoring and the browser pilot. This increment does not require implementing a new server deployment, dashboard, webhook system, or generic artifact store. Existing Queue, Session, workspace, and budget owners remain authoritative when the corresponding execution integration is composed.

### Browser pilot

Use the user's task as a lifecycle scenario. Keep its instructions fixed across routes; inspect page structure through each route's permitted browser tools.

| Step | Input or action | Independent criterion |
| --- | --- | --- |
| Create | Ask for an entry beside each target list item that collects its title and link | Correct coverage and item association; no entries on distractor regions |
| Click | The verifier clicks a selected visible entry | The sidebar contains that item's actual title and absolute link |
| Update | Ask to rename entries to “加入清单”, deduplicate links, and mark collected items | Existing records survive; labels and collected state match records; another click adds no duplicate |
| Stop | Ask to stop the plugin while keeping collected results | All owned entries disappear, event admission stops, and collected records remain |
| Change page | Run a fresh case on a held-out page family with the same requirements | The route derives the new structure without receiving a previous solution |

The verifier derives the expected item set from an independently maintained fixture specification or checked source data, not from the plugin's own selected rows. Visual placement and correct region membership require browser observation; a successful mount response is supplementary evidence. Dynamic pages use bounded conditions rather than fixed sleeps. Controlled fixtures provide repeatable state; selected live sites test real integration and retain page/environment identity without pretending the site is deterministic.

Each case/route/attempt receives an isolated home, profile, session, and browser state. The adapter launches the selected DSH profile, records process ownership, and closes only its own resources. Reusable immutable builds may be cached by digest; mutable page state, collected records, conversations, credentials, and plugin instances never cross comparison cells. The adapter observes product cleanup before its own teardown so forcibly closing a browser cannot make a failed stop appear successful.

Cancellation propagates to subject execution. Teardown has its own bounded cleanup allowance after execution cancellation; if the subject does not cooperate, the trusted supervisor stops owned processes and records the unresolved product state. A deadline prevents indefinite waiting. Loss of the observer or environment makes the result uncertain; it must not silently become a model failure or pass.

### Independent evidence and failure attribution

Before execution, freeze the subject revision/build, suite and scenario digests, verifier code and expectation digests, adapter version, route configuration, and allowed environment inputs. Record observed provider/model, prompt/tool/skill identities, and the actual environment alongside the requested identities. An external Codex baseline must be labeled an external executor unless an actual Codex adapter exists; a handwritten result file is not native DSH route execution.

Keep verifier code, expectations, and credentials outside the subject's writable and tool-readable scope. The agent may inspect the target page, but cannot edit or read the grading implementation. An untrusted PR cannot replace the trusted oracle, enlarge its budget, or select credentials. When DSH evaluates changed DSH runtime code, controller, subject, and verifier also follow the repository's [independent verification requirements](../../../skills/dsh-change-verification/SKILL.md).

Each checkpoint records its step id, observed values, criterion version, result, timestamp, and content-addressed evidence reference. Capture enough DOM, screenshot, sidebar data, and session/tool events to explain the decision, with sensitive values redacted before export. Evidence bundles have an explicit retention owner; missing or corrupted required evidence invalidates a previously consumable result. Optional screenshots cannot replace required structured facts.

Preserve `invalid`, `infrastructure-uncertain`, `failed`, and `passed` with the existing precedence. Add reason codes and observed causes instead of merging all failures into “model incapable.” Bad criteria or schema are invalid; observer/network loss is infrastructure uncertainty; an observed wrong result in a functioning environment is failed. A runtime contract defect may fail the end-to-end task without proving a model capability defect. Ambiguous cause remains unclassified until investigated. A model grader may assess optional qualitative criteria, but cannot override deterministic failure or missing evidence.

Record prewritten-solution smoke tests, assisted debugging, and autonomous evaluation separately. Declared scripted user turns are part of the task. A person or stronger agent providing selectors, code, or repair hints is technical assistance. If assistance occurs, retain the original attempt and mark the new attempt assisted; do not overwrite a failure with a later repaired success. Agent self-repair remains autonomous but consumes the same attempt budget and is counted.

### Generalization and comparison

Partition scenarios by page structure and task family before tuning. Hacker News and other pages already used for repairs belong to the development set. Reserve a held-out structure family and a later live-site check. Cosmetic renaming of CSS classes on the same template is a robustness check, not independent evidence of generalization. Once a held-out case informs a repair, move it to development and reserve a new held-out case for the next version.

Use a small covering matrix rather than a full Cartesian product: table/list/card layouts; repeated or misleading regions; nested title/link fields; delayed content and navigation that refreshes document identity; duplicate links and update/stop behavior. Start with two development structure families and one held-out family, plus selected perturbations. Publish per-family sample counts and outcomes; a small pilot does not establish a population-wide success rate.

Compare a capable baseline, v4-flash with the same tool/skill exposure, and v4-flash with the proposed generic assistance as separate route configurations. Change one factor at a time, preserve initial state and criteria, and record model/version, skill digest, and tool contract digest. If the baseline uses a different executor or tool surface, report a system comparison rather than attributing the whole difference to the model. Declare repetition counts, quality floors, acceptable regressions, and comparison rules before running; retain all attempts, including failures and cancellations. Without a declared gate or sufficient samples, publish observations without a promotion decision.

Permit generic guidance such as refreshing stale page identity, reading tool schemas, inspecting page regions, and checking external effects. Reject site answers disguised as skills, fixed selectors, prewritten plugin solutions, and grading logic that accepts the implementation's own claims. Evaluate removal as well as addition of a guardrail: retain it only when held-out quality or cost improves without an unacceptable regression elsewhere. Eval provides evidence of generalization within the declared matrix, not a guarantee that the next task succeeds.

### Efficiency and budgets

Report first-attempt success, eventual autonomous success, assisted success, unresolved outcomes, self-repair count, and technical interventions separately. Show end-to-end elapsed time alongside model, tool, setup, and verifier time; durations may overlap and must not be summed without an accounting rule. Report input/output/cache tokens, requests including retries and delegated model calls, browser operations, and evidence size. Missing measurements remain unknown, never zero.

Declare request/token, wall-clock, and browser-operation limits before execution. Reuse the approved runtime budget authority for dispatch enforcement rather than adding an Eval-only estimate. Plugin-triggered and delegated calls belong to the same case cost scope. If the composed runtime cannot enforce a required limit, live preflight fails with an actionable reason. Reserve a bounded teardown allowance; admission stops when execution limits are exhausted. A functioning budget that ends an unfinished task is a failed completion criterion with reason `budget-exhausted`; cancellation by the operator and lost budget telemetry remain distinct uncertainty reasons.

Treat tokens as observed usage and money as an optional estimate with provider, currency, price version, and timestamp. Show unknown money when authoritative pricing is unavailable. Display agent, helper, verifier, failed-attempt, and setup costs separately so a cheaper model cannot appear cheaper by hiding assistance. Cost per successful autonomous task includes the declared cohort's failed attempts in its numerator and uses autonomous successes as its denominator; zero successes yields no finite value. Show the success fraction and sample count alongside it; do not pick a winner solely by token price.

Use preflight without model calls, targeted failure rechecks for diagnosis, bounded evidence capture, and immutable-build reuse to keep iteration inexpensive. Rechecks are diagnostic runs and never replace the original scored sample. Defer parallel cells until browser isolation and replay binding make them safe; the initial pilot favors understandable sequential evidence.

### Live execution and replay

Live execution tests current model and browser behavior. Snapshot replay tests the recorded session contract. Regrading a captured browser evidence bundle tests the checker against those captured facts. These are three distinct claims and appear separately in reports. Neither replay nor regrading proves that a new agent can rediscover the page or that today's live site still works.

The first browser increment supports live execution and deterministic regrading of frozen evidence. Full replay of browser actions requires a captured controllable environment and is deferred. Record the limitation explicitly; do not fabricate browser replay from a session log. A repaired oracle may regrade old complete evidence under a new oracle digest while preserving the original judgment; changed model behavior requires a fresh live attempt.

## Alternatives considered

**Build a separate browser evaluation tool.** This would duplicate route accounting, conservative outcomes, reports, and later integrations. An adapter extends their existing owner while retaining browser-specific details locally.

**Only add selectors and browser assertions to the current case.** The runner would still require a prior replay fixture and one prompt. It would also leave manual environment setup and assistance outside the scored case. The execution variant and lifecycle must change together.

**Build a generic workflow DSL, observer registry, and grading platform first.** One browser pilot cannot justify those abstractions. Typed adapter payloads and one executor invocation per attempt cover the concrete requirement; promote shared machinery only after a second real consumer demonstrates reuse.

**Make the agent's report or a model judge the acceptance authority.** Both can accept a plausible narrative when the page is wrong or cleanup is incomplete. Deterministic checks of independent observations remain mandatory; qualitative grading is supplementary.

**Guarantee success with a site-specific skill.** Such a skill can be useful product configuration, but it changes the evaluation claim. Keep that assisted configuration separate from held-out page discovery and account for its maintenance and helper cost.

## Acceptance criteria

The implementation is delivered in four bounded increments. This documentation PR completes none of their runtime criteria.

| Increment | Observable acceptance |
| --- | --- |
| Contract and authoring | Version 2 validates both execution variants; existing snapshot cases keep their judgments; unknown variants and unsupported modes fail preflight; a one-case trial shows the failing checkpoint and evidence |
| Browser lifecycle | The shipped template runs create/click/update/stop in an isolated environment with independent assertions; controlled wrong-link, duplicate, retained-button, missing-record, cancellation, and observer-loss cases produce the required failure or uncertainty |
| Trust and portability | The subject cannot read or mutate verifier expectations; changing to another page requires only case/environment data; no core edit is needed; required evidence tampering is rejected; teardown cannot conceal failed product cleanup |
| Comparative pilot | Fresh capable-baseline and v4-flash attempts use declared configurations, held-out families, repetitions, and budgets; the report retains original failures, assistance, unknown values, per-family results, and the distinction between live execution and regrading |

Readiness of the evaluation system is distinct from every evaluated model passing. A correctly detected v4-flash failure can satisfy evaluation acceptance; a green report without independent evidence cannot. A clean checkout must run the published single-case path with documented credentials and browser prerequisites, without private repair scripts or hand edits to storage. The broader epic retains its separate multi-case, recovery, and deployment obligations.

## Risks

Live sites change and browser automation can fail independently of the agent. Controlled fixtures and explicit uncertainty make comparisons interpretable, but cannot eliminate external variability. Insufficiently diverse cases still overfit; case-family reporting and held-out rotation expose the scope of the conclusion.

Rich observations increase latency, storage, and possible data exposure. Bound capture, redact secrets, and keep the retention owner explicit. Plugin-triggered calls and asynchronous cleanup can escape naive accounting; budget and teardown behavior must be proven through the real composed runtime before claiming enforcement.

Schema version 2 changes persisted evaluation formats and report consumers. Migrate repository-owned examples and consumers atomically and report unsupported old input clearly. Browser API details belong to the adapter implementation and must be checked against its actual target revision; this proposal does not freeze selectors or signatures from a development worktree.
