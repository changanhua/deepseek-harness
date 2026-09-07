---
name: dsh-find-simplifications
description: Find and assess evidence-backed simplifications in DeepSeek Harness code and documentation, or implement an authorized cleanup. Use for duplicated mechanisms, unused behavior, unnecessary complexity, or comparing simplification proposals; general Agent Note maintenance belongs to its own workflow.
---

# Finding DeepSeek Harness Simplifications

Find changes that reduce maintenance cost while preserving required behavior. Follow the evidence and the requested scope; these are decision criteria, not a mandatory sequence.

## Match The Requested Work

- For a review or survey, report candidates, evidence, trade-offs, and unresolved questions. A finding does not itself request a file edit, TODO, Agent Note, or PR.
- For an authorized cleanup, implement clear changes within that scope and verify their effects. Reuse existing authorization; ask only when a necessary decision would materially change the agreed behavior or scope.
- For a durable proposal or implemented decision that needs an Agent Note, follow the [owning rules](../../notes/README.md#when-to-write-one). Update an existing owner where appropriate; do not create a note for every finding.
- Enter note consolidation or branch integration only when requested or necessary for the authorized change. Creating, updating, or closing a PR must stay within the user's existing authorization; ownership of a branch is not permission for those actions.

## Start With Repo Context

- Resolve the target checkout, requested files or domain, and applicable `AGENTS.md`. Read [defensive patterns](../../../docs/defensive-patterns.md) when judging ownership or failure handling, and [testing rules](../../../docs/testing.md) when judging test obligations.
- Skim [docs/architecture.md](../../../docs/architecture.md) before judging anything under `packages/`; simplifications that fight the service map or event taxonomy need extra evidence.
- Consult the current code, configuration, and owning Agent Notes for the candidate's rationale. A test or historical decision is evidence to assess, not proof that the current implementation is necessary.
- Treat dual LLM adapters and dual persistence backends as intentional by default. Do not propose deleting either twin/backend as "low effort" unless the user explicitly overrides that constraint. Removing an unused method or hook inside a protected seam can still be valid if it does not collapse the protected design.

## What Counts As A Strong Candidate

A strong simplification removes, folds, or demotes something real and has clear evidence that the current design costs more than it buys:

- A public method, event, config knob, registry notification, helper, package, durable event, or test artifact has no production consumer.
- Tests or docs are the only consumers, and the behavior they pin is not load-bearing.
- Two representations mirror the same fact, especially across durable session events and transient `agent/*` events.
- A seam has methods every implementation must support but no consumer uses.
- A separate package exists only for test/demo/support code and adds publish or dependency overhead.
- A feature adds generality with no demonstrated use or product owner; establish that absence before classifying it as speculative.
- An invariant, rollback path, set of expected outputs, or special-case test exists only to protect an unused API.
- Hand-rolled code reimplements what a well-maintained external package or a Node builtin at the engine floor already provides, and the swap would delete the implementation plus its dedicated tests ([dependency policy](../../notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md)).
- A simpler behavior may be worth proposing; identify the observable difference and confirm it fits the authorized change before implementing it.

Thin candidates are not enough for an Agent Note: deleting one typo, running `knip` once, removing an intentionally documented backend/adapter, or flagging "this looks complex" without call-site proof.

## Choose Survey Breadth

When the user asks for breadth, parallel subagents can inspect independent domains if available and permitted. Give each agent bounded ownership and require evidence. Useful domains include:

- Agent loop and session log: turn/step boundaries, steering, abort/cancel, durable events, replay, load/resume.
- ACP automation and human UI APIs: prompt settlement and teardown on the protocol side; transcript rendering and interaction state on the UI side.
- LLM/tools/system prompt: stream/generate APIs, assemblers, registries, tool schema defaults, presentation hooks.
- Bash and tool execution: foreground/background split, job ownership, output spill files, executor methods.
- Packages/examples/scripts/tests: package splits, static inventories, redundant snapshot expected outputs, support packages.

If subagents are unavailable, inspect the requested domains yourself. Finish when the requested coverage has been examined or a material evidence gap prevents further conclusions; report that gap instead of treating uninspected areas as clean. Do not expand a focused request into a whole-repository survey.

Start with the largest production-code deltas. A broad simplification audit that stops after obvious unused symbols can miss the files where duplicated lifecycle or defensive machinery carries most of the cost.

## Simplify Prose With The Code

Treat comments and documentation as maintained surface area. Apply [dsh-prose-standard](../dsh-prose-standard/SKILL.md) when a survey includes prose.

- Identify comments that restate code or explain behavior owned elsewhere; remove them when edits are authorized, keeping required local contracts.
- Keep docs at their owning level; omit implementation details and rare cases unless they change a maintained contract.

## Audit Trust And Lifecycle Boundaries

For every defensive copy, freeze, validator, and callback capture, name where the value came from and who owns it next. Same-process typed service/plugin calls ordinarily borrow readonly values; parsers, config loaders, queues, model/tool JSON, durable files, workers, processes, and wire decoders own or validate their data. Tests built around hostile getters, fake typed objects, callback replacement, or mutation after a same-process handoff are evidence of a potentially speculative contract, not automatic justification for keeping it.

For complex asynchronous code, draw the ownership graph and map each sentinel, readiness promise, cancellation path, disposer, and state flag to a distinct owner or transition. When several mechanisms mirror the same liveness or settlement fact, propose one transaction or lifecycle controller instead. Preserve separate machinery where it protects synchronous publication and rollback, callback containment, first-terminal-outcome arbitration, worker/process ownership, or dispose-to-quiescence.

## Hand-Rolled Code Versus A Dependency

Introducing a dependency is a valid simplification move, not a policy exception: the [dependency policy](../../notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md) owns the bar. When surveying, ask of protocol parsers, framers, retry/backoff loops, glob matchers, diff engines, and similar infrastructure: does a well-maintained npm package or a Node builtin at the repo's engine floor already do this?

Prove a dependency-swap candidate like any other, plus:

- Read the hand-rolled implementation and name the exact surface the package covers; residual semantics the package does not cover count against the swap and remain explicit in the finding or proposal.
- Check the package's health honestly (maintenance, adoption, transitive footprint) and prefer builtins when the engine floor has them.
- Check the Agent Note tree first: schemastery, vendored Cordis, the twin adapters, and other recorded seams are settled — a swap that collapses one needs to beat the recorded rationale, not just cite the policy.
- Weigh net deletion: implementation plus dedicated tests plus docs, minus the glue that remains. A wrapper that relocates the same complexity is not a win.

## Prove Or Reject Each Candidate

Determine the search scope from the target checkout's workspace manifests, application entrypoints, and loader/configuration paths. The current layout includes `packages/*/*/src` and `apps/*/src`; these examples are not an exhaustive allowlist. For each symbol or behavior, classify actual use:

- Runtime consumers: application and package source, production scripts, and configuration or dynamic registration paths.
- Supporting evidence: tests, documentation, Agent Notes, snapshots, generated expected outputs, and comments. They can establish a required contract even when they do not execute in production.
- Ambiguous uses: examples and scripts whose role depends on how they are launched. Trace their entrypoints before classifying them.

Use `rg` first. Search exact symbols, event names, package names, config keys, method calls, and wire strings, then read the call sites. Check public exports and documented external consumers before claiming there are no users. `knip` and an empty text search cannot prove absence through dynamic registration, external use, or retained data formats.

Reject or downgrade a candidate when:

- A production caller exists and the simplification would be a feature decision rather than a cleanup.
- The API is explicitly justified by an implemented Agent Note or a hard-won defensive pattern, and the new evidence does not beat that reason.
- The removal would force unrelated churn without actually reducing the public API or required behavior.
- The idea is correct but tiny. Report it briefly during review; fix it when in scope. Add a TODO/FIXME/XXX only when a useful deferred action belongs in the authorized edit, following [development rules](../../../docs/development.md).

## Coalesce Superseded Agent Notes

Audit the Agent Note tree when the user asks to reduce or coalesce it, or when the simplification being implemented makes an owning note obsolete. Do not expand every code-simplification survey into a repository-wide note audit.

Use [dsh-archive-agent-notes](../dsh-archive-agent-notes/SKILL.md) for retention and archive mechanics, and the [Agent Note consolidation rules](../../notes/README.md#when-to-write-one) for full versus partial supersession. Those owners define the required rationale transfer, evidence, inbound-link repairs, and complete-triplet handling. Identify the current owner from shipped behavior and references, not dates. Preserve active contracts and never edit frozen archived notes.

## Write The Agent Note

When a note is required, use the [canonical lifecycle-specific format](../../notes/README.md#the-file-format), including the mandatory `Alternatives considered` section. Keep the strongest alternative and the capability given up explicit. State the current consumer evidence, exact proposed removal or replacement, affected contracts and derivatives, and observable acceptance criteria for proposed work. Keep paragraphs on one physical line and use relative Markdown links. Reuse the existing decision owner where appropriate.

## Inline TODO Notes

Within authorized edits, use inline TODO/FIXME/XXX only for useful deferred local cleanups that do not need a durable design decision. Keep them short and actionable:

- Name the smell with a stable tag, e.g. `TODO(double-default)` or `XXX(unused-default)`.
- Explain why it is safe to revisit and what action would simplify it.
- Do not add TODOs for speculative complaints or for behavior that needs an Agent Note-level decision.

## When Folding Another PR Or Branch

Resolve each branch's actual PR base or stack parent before comparing it. Inspect its independent contribution against that base, then compare candidate changes with the destination to find overlap. Do not assume a default branch or silently use a stale remote ref; when remote freshness cannot be verified, label the comparison local-only.

- Port non-overlapping Agent Notes or TODOs that meet the quality bar.
- Consolidate overlapping material into the existing Agent Note that owns the topic.
- Do not port duplicate or lower-confidence proposals just to preserve the count.
- Update a PR body or close a duplicate only when the user's existing authorization covers that action. A comparison request produces findings without publishing them.

## Validation And PR Hygiene

A review without edits needs evidence for its findings, not a build or publication workflow. For edits, use the target checkout's [development rules](../../../docs/development.md) and [dsh-change-verification](../dsh-change-verification/SKILL.md) to select checks for the affected behavior. Documentation and Agent Note changes retain their required documentation checks, including `doc-sync` where applicable; use [dsh-doc](../dsh-doc/SKILL.md) for pairing and format obligations. Skill edits need the applicable validator and repository invocation-metadata check. Run `git diff --check` for edited files. Full lint or build is required only when an affected check or integration rule needs it, not simply because documentation changed.

When opening or updating a PR, summarize:

- How many Agent Notes and inline notes were added, consolidated, retained as partial supersessions, or deleted.
- The main areas surveyed.
- What was intentionally excluded.
- Which checks passed.

For each consolidation group, name the old and current owners, state the evidence for full supersession, and explain why deletion is safe. If an added-then-removed scan finds no qualifying note, report that result and the representative partial cases retained.

When publication is authorized, use [dsh-pre-push-checks](../dsh-pre-push-checks/SKILL.md) for the actual outgoing diff. A requested draft can carry unresolved candidates; readiness requires the relevant findings and checks to be settled.
