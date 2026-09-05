---
name: dsh-feature-charter
description: Use when proposing, restarting, or reframing a new DeepSeek Harness capability, Epic, module family, or multi-Issue roadmap and the final user outcome, architecture boundary, acceptance vertical, or top-level definition of done is still unclear. Freeze the product charter before reuse analysis, implementation planning, Issue slicing, or code changes—especially when a small kernel slice could be mistaken for the completed product. Do not use for an already-scoped mechanical edit, a known-owner bug, a reuse decision, or an implementation plan.
---

# DSH Feature Charter

Turn a capability idea into a closed DSH product boundary. The charter answers what users can actually do when the capability is finished, where its DSH roles belong, and what observed behavior closes the Epic. It prevents a package, schema, or unit-tested kernel from being reported as the whole feature.

## Scope and handoff

This Skill owns the **why, final outcome, boundary, and top-level closure condition**. It does not decide whether an existing capability should be reused, write an implementation plan, create Issues, edit source, or repair a mechanical bug.

After the charter is accepted:

1. Use `dsh-reuse` to choose `direct reuse`, `adapt`, `bridge`, `vendor/fork`, or `build` from current evidence.
2. Use `xia-pluginmaster` to discover the exact checkout contracts and turn the selected design into packages, composition, and verification.
3. Only then use planning or Issue-slicing workflows to sequence the work.

Do not duplicate either Skill's repository search or package topology work. Record hypotheses here as decisions that need later confirmation.

## Inputs, reuse, and receipt

Require a capability idea plus its current approval state. If an approved `FeatureCharterReceipt` already names the same actor, entry, observable result, authority, lifecycle, non-goals, and top-level closure condition, reuse it and stop; implementation or documentation changes alone do not invalidate the product outcome.

Reopen only a changed Charter field. Changes to actor, supported entry, authority, durable semantics, required real vertical, non-goals, or closing condition invalidate the corresponding decision. Do not rerun repository discovery to refresh a Charter.

Produce a compact `FeatureCharterReceipt` using the common envelope in [the handoff protocol](../dsh-feature-delivery/references/handoff-evidence.md). Include only frozen Charter decisions, open facts delegated downstream, and explicit invalidation conditions.

Charter approval is serial and remains with the primary agent and user. Subagents may answer distinct read-only factual questions, but they do not draft competing Charters or approve the outcome.

## Start with the finished user experience

Describe the result in a present-tense scenario, not by naming a module:

```text
Actor → supported entry → observable result → durable/inspectable evidence → decision or next action
```

State the primary actor, any separate operator or reviewer, authority boundary, expected failure behavior, and what cannot be self-certified. If different actors see different evidence, name that separation.

## Add a self-hosting boundary only when DSH develops DSH

Apply this section only when a running DSH instance will execute development work on DSH itself, or will judge, admit, or release that work. It does **not** apply merely because a developer is editing the DSH repository with ordinary tools. Do not burden an external Bundle, Provider, or application charter with controller terminology.

When it applies, freeze the following identities before reuse analysis or Issue slicing:

- the **controller**: a known-good DSH checkout, build, Profile, and runtime that initiates or coordinates the work;
- the **subject**: the DSH checkout, build artifacts, configuration, and runtime being changed or evaluated;
- the **independent verifier**: the separately identified process, revision, or human review path that reads the subject's evidence and decides whether it passed;
- the exact Skill identity and revision used by controller and subject, including any local skill source that affects the result;
- human-only authority for merge, push, publish, migration, or any other irreversible external action;
- rollback and isolation: a recoverable subject checkout plus a distinct DSH home/data root so controller state, credentials, catalog, Sessions, and artifacts cannot be silently reused as subject proof.

The subject build, runtime, or a Skill changed by the subject cannot be its sole verifier. A self-hosted vertical may use the subject to generate artifacts, but its closing observation must come from the frozen independent verifier or a human with the stated authority. If the controller becomes modified during the run, it ceases to be known-good and cannot certify that run; bootstrap a fresh controller or mark the result uncertain.

For controller, subject, and verifier separately record checkout/revision, build artifact identity, Skill snapshot content digest, Profile/configuration identity, `DSH_HOME`, data root, log root, and port allocation. Freeze a controller-owned immutable **Verifier plan** before subject execution: its digest covers the assertion, command, checker identity, fixture/golden inputs, and non-secret environment inputs. Also freeze **Credential & cost authority** as either `none` or an approved run authorization ID with target, provider/model, allowed scope, budget ceiling, and expiry. These records are acceptance inputs, not details an executor may add after it has observed a result.

## Freeze the capability boundary

Fill [the charter template](references/charter-template.md). Keep one sentence for each decision that is known and mark uncertain facts as `to verify`, never as current DSH fact.

For any replaceable or cross-domain behavior, name these roles even when two temporarily live in one package:

- **Definition**: stable capability contract and obligations.
- **Provider**: concrete implementation, credentials, resources, and lifecycle.
- **Consumer**: Tool, UI, API, Goal, Workflow, or other caller using the Definition.
- **Bridge**: optional plugin joining two independent domains without coupling either core.

Also freeze:

- authority and visibility: human, Host, model, project, Session, and external-party boundaries;
- lifecycle and persistence: foreground, process-local, Session-durable, or host-durable; cancellation, retry, recovery, and retention expectations;
- supported entry: Profile, Tool, Client, API, Queue admission, or another user-visible path;
- required artifacts and the owner of each artifact;
- explicit non-goals and anti-goals that prevent speculative platform work.

For a self-hosting charter, also record controller/subject/verifier identities and isolation in the template. These are delivery-boundary facts, not new Definition/Provider/Consumer/Bridge roles.

Do not call a Skill, Tool, Service, Queue WorkKind, or database an answer unless it directly serves the finished scenario. A generic registry, scheduler, artifact store, or “future-proof” abstraction is a non-goal until a named user outcome needs it.

## Define the real vertical and closure

Write one smallest end-to-end demonstration that uses the intended entry and finishes with an independent observable result. It must name:

1. input and fixed identity where reproducibility matters (revision, suite, configuration, model, or authority);
2. Profile/Bundle composition that makes the capability available;
3. real work performed, including external side effects when in scope;
4. evidence retained or displayed to the relevant actor;
5. the decision made from that evidence: pass/fail, retry/block, accept/reject, or equivalent.

Classify every evidence layer as `required` or `N/A with reason`; a layer is `N/A` only when this capability cannot honestly generate or use that surface. `behavior-verified` is always `required` for Epic closure. The layers are not interchangeable:

| Layer | What it proves |
| --- | --- |
| `source-contract` | Definitions, types, and ownership exist in the checkout. |
| `generated-declaration` | Generated catalog, declarations, or artifacts expose the intended surface. |
| `composed` | The selected Profile/Bundle wires the concrete provider and consumer. |
| `runtime-observed` | The exact running process exposes the expected service, tool, scope, or UI. |
| `behavior-verified` | The user scenario produces the promised result and evidence. |

The first four layers support `behavior-verified` when they are required, but cannot replace it. State which portions are `N/A with reason` and which may remain intentionally unverified after a bounded slice; label that slice as a slice—not the Epic.

## Test the charter against premature completion

Before finalizing, ask:

- Could a caller still declare success without the promised independent result?
- Could the user reach the behavior from the stated entry in a composed Profile?
- Would a passing unit test, fixture replay, or schema alone falsely satisfy the charter?
- Are persistence, authority, cancellation, and recovery explicitly excluded or required?
- When self-hosting applies, could an unchanged controller and independently pinned Skill/revision reproduce the acceptance observation without reading subject-owned state as authority?
- Are merge, push, publish, and migration still human-authorized even if the subject reports success?
- Is every planned Issue traceable to either the finished scenario or its five-layer closure evidence?

If any answer is unclear, narrow the outcome or add a decision record. Do not invent package names to make the charter look complete.

## Output

Return the completed template. Lead with `Epic outcome` and end with `Top-level closure condition`. Distinguish:

- **Frozen now** — user outcome, hard boundaries, non-goals, and required vertical.
- **To verify next** — current-contract facts delegated to `dsh-reuse` or `xia-pluginmaster`.
- **Not part of this charter** — reuse choice, implementation sequence, code, and mechanical fixes.
