---
name: dsh-issue-stack-planner
description: Use after an approved DeepSeek Harness Feature Charter or explicitly approved final product outcome needs delivery through dependent Issues, PRs, or implementation slices. Convert it into an evidence-backed kernel/provider/bridge/composition/consumer/acceptance Issue DAG, maintain requirement-to-Issue-to-evidence traceability, and prevent a reusable kernel slice from being presented as top-level completion. Do not use to decide whether DSH should build a capability (use dsh-reuse), to invent architecture before a charter is approved, to create or update GitHub Issues without separate authorization, or to land a PR stack (use dsh-merging-stacked-prs).
---

# DSH Issue Stack Planner

Turn an approved DSH Feature Charter into the smallest delivery DAG that can prove its user outcome. This is planning and traceability only: do not create GitHub Issues, branches, PRs, or runtime configuration unless separately authorized.

## Preconditions and scope

Require either an approved Feature Charter with final outcome, non-goals, entry path, acceptance evidence, and closing condition, or an explicitly approved equivalent whose missing detail cannot change package ownership, durable semantics, or authority.

If the request is still a proposal, route first to `dsh-feature-charter` to freeze and obtain approval for the final outcome. Then use `dsh-reuse`; use `xia-pluginmaster` when current-checkout plugin/Definition/Provider/Consumer/Profile evidence is needed; return to this skill only after that sequence. Do not reconstruct a final goal from a convenient first implementation slice.

Read root and applicable package `AGENTS.md`, the charter, and current repository state. Treat WIP, branch-only source, generated artifacts, and runtime observations as distinct evidence. Preserve unrelated WIP.

## Inputs, reuse, and receipt

Consume a valid `FeatureCharterReceipt` and available reuse/current-contract receipts. Do not restate or rediscover their decisions. If identities or required fields do not match, reopen only the affected ownership or dependency question through its owning Skill.

Each delivery card includes conditional documentation and derivative obligations when its changed surface reaches them: package README, subsystem owner, public JSDoc/Cordis catalog, config/persistence/module catalogs, bilingual pairing, and the owning Agent Note. Do not defer these until final verification, and do not add them to cards whose surface cannot affect them.

Produce an `IssueStackReceipt` using [the handoff protocol](../dsh-feature-delivery/references/handoff-evidence.md). It records frozen shared contracts, requirement-to-Issue-to-evidence mapping, parallelizable implementation lanes, exclusive package/file ownership, integration checks, and the final acceptance dependency.

The primary agent owns the DAG and shared-contract decisions. Read-only evidence questions may run concurrently when distinct. Implementation cards may be marked parallel only after their shared contracts are frozen and their file/package ownership is disjoint; final integration and acceptance remain serial.

## Add self-hosting execution separation only when the charter says it applies

For an ordinary external capability, do not add controller/bootstrap vocabulary. For a charter that explicitly says DSH will develop, judge, admit, or release DSH itself, carry its controller, subject, verifier, Skill revision, isolated-home, rollback, and human-authority decisions into the DAG.

Every delivery card in such a DAG records all three execution identities:

- **Executed by**: the known-good controller, subject runtime, bootstrap procedure, or human that performs the card;
- **Subject**: the checkout/build/runtime/artifact the card changes or evaluates; and
- **Verified by**: an independent verifier identity, or a named human-only authority for merge, push, publish, or migration.

These are evidence and execution fields, not new card roles: each card remains exactly one of `kernel`, `provider`, `bridge`, `composition`, `consumer`, or `acceptance`.

Model controller bootstrap and isolated acceptance as explicit prerequisites. In particular, the subject may not verify a changed subject build or changed Skill as the sole acceptance evidence. The final `acceptance` card depends on a known-good controller/bootstrap card, the subject work it evaluates, and the isolated verifier path. Human merge/push/publish/migration remains outside the automated close condition and needs explicit human evidence.

The self-hosting preflight/bootstrap card and every self-hosting `acceptance` card must carry the frozen record before execution: controller/subject/verifier checkout and revision, build identity, Skill snapshot digest, Profile/runtime, `DSH_HOME`, data root, log root, and ports; controller-owned immutable Verifier plan digest (assertion, command, checker, fixtures/golden inputs, environment inputs); Credential & cost authority (`none` or authorization ID, target, provider/model, scope/budget ceiling, expiry); rollback; and human authority stops. Do not defer any of these to an execution transcript or a later Issue.

This skill does not replace:

- `dsh-reuse` for build/adapt/bridge decisions;
- `xia-pluginmaster` for current-checkout Definition/Provider/Consumer/Profile discovery;
- `dsh-merging-stacked-prs` for GitHub-native PR stack operations;
- `dsh-task-queue` for submitting composed durable work;
- `dsh-code-review` for implementation review.

## Plan from final proof backwards

Start with the charter's closing condition. List the user-observable behavior that proves it, then trace every upstream capability needed. This prevents a library package or test fixture from becoming the definition of done.

Classify each slice once. A slice may depend on several earlier slices but has one primary role:

| Role | Owns | Cannot prove by itself |
| --- | --- | --- |
| `kernel` | stable types, deterministic mechanisms, shared invariants | composition, entry path, or charter outcome |
| `provider` | replaceable implementation, external boundary, lifecycle/error mapping | model or user reachability |
| `bridge` | narrow connection between independent capability families | ownership of either domain core |
| `composition` | Bundle/Profile/catalog wiring and deployment defaults | useful behavior without a consumer |
| `consumer` | Tool, API, UI, CLI/Profile path, or downstream gate | correctness of hidden provider behavior |
| `acceptance` | real vertical proof, baseline policy, operational documentation | production capability without upstream implementation |

A `kernel` Issue may be independently mergeable, but its close statement must say it is only a prerequisite. Do not label a non-`acceptance` Issue “feature complete” unless the charter says that slice is the whole feature.

## Build the DAG

1. Extract numbered charter requirements: user outcome, authority, durability/recovery, entry path, artifacts, observability, and relevant non-goals.
2. Map each to the smallest package boundary and owning role. Consumers depend on Definitions, not concrete Providers; Bridge plugins consume both Definitions; Bundles select Providers and defaults.
3. Draw prerequisite-to-dependent edges. Separate durable/public contract changes from optional convenience work.
4. Give every Issue a bounded DoD, minimum evidence, and an explicit statement of what remains impossible when it closes.
5. Identify the first end-to-end path; it includes composition and a real consumer. Acceptance follows that path, not library coverage alone.
6. Mark merge order only where required by the DAG. Logical dependency does not authorize GitHub stack creation or base changes.

Use [issue-stack-template.md](references/issue-stack-template.md) for the report and Issue cards.

## Evidence rules

Each requirement has one current status: `not started`, `source only`, `tested in isolation`, `composed, not observed`, `runtime observed`, or `accepted against charter`.

Evidence must match the assertion. Package tests prove local behavior; generated catalogs prove artifact freshness; Profile inspection proves composition; a real request or UI run proves reachability; a recorded report/artifact proves the user-visible outcome. A fixture, README, or planned Issue is never acceptance evidence.

For every Issue, record requirements advanced and still blocked, owner/dependency direction, preconditions, DoD, verification and artifact, failure/uncertainty semantics, and whether it changes charter status. When self-hosting applies, also record executed-by, subject, verified-by, controller/bootstrap dependencies, and isolated-home boundary.

## Stop and escalate

Request a decision when an unresolved choice changes durable format/versioning, authority, external side effects, retention, public API, or kernel-versus-bridge ownership. Do not conceal it in an Issue title.

Do not create, edit, label, close, assign, or comment on GitHub Issues. If separately authorized later, translate approved cards verbatim and report created links separately.

## Completion report

Return the template with a dependency-ordered DAG, requirement → Issue → evidence traceability, charter status, earliest vertical slice, final acceptance Issue, risks, decisions, and non-goals.

End with exactly one statement:

- `Charter outcome is not yet complete; only the listed acceptance evidence can close it.`
- `Charter outcome is complete only after the listed acceptance evidence is observed.`

Use the latter only for an implementation plan whose acceptance work has not run. Never claim charter completion from the plan alone.
