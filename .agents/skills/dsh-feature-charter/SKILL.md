---
name: dsh-feature-charter
description: Clarify materially undecided user outcomes and boundaries of a new or reframed DSH capability. Use a formal Charter when explicitly requested or when a substantial multi-stage capability needs shared scope and acceptance decisions. Do not use merely to begin implementation of a bounded outcome already clear from the conversation.
---

# DSH Feature Charter

Turn a capability idea into a closed DSH product boundary. The charter answers what users can actually do when the capability is finished, where its DSH roles belong, and what observed behavior closes the Epic. It prevents a package, schema, or unit-tested kernel from being reported as the whole feature.

## Match the requested stage

- **Explore or explain:** discuss concrete user scenarios, content-bearing objects, alternatives, and unresolved choices. Use the supplied conversation. Do not demand a receipt, template, repository audit, self-hosting identity, or written file merely to answer a product question.
- **Draft a design:** produce the requested scenario/object/operation design. Separate accepted direction from proposed details and open facts. A local discussion draft is not implemented-product documentation; do not route it through package README, bilingual publication, build, or runtime gates unless its actual destination or claim requires them.
- **Prepare implementation:** use accepted conversation decisions directly for a bounded change. Use a formal template only when requested or when a substantial multi-stage capability needs shared scope and acceptance decisions. Resolve only missing choices that could change the deliverable or authority; drafting alone does not authorize implementation.

Keep the long-term outcome separate from the first acceptance slice. Do not turn an initial human-controlled relay into a permanent manual approval pipeline, or an eventual automation goal into current execution permission. Ask only about an unresolved choice that changes the next deliverable; otherwise continue the requested design.

## Scope and handoff

This Skill owns the **why, final outcome, boundary, and top-level closure condition**. It does not decide whether an existing capability should be reused, write an implementation plan, create Issues, edit source, or repair a mechanical bug.

After the outcome is accepted, continue with the known owner. Use `dsh-reuse` only for an unresolved reuse choice, `xia-pluginmaster` for missing current plugin/composition facts, and Issue planning only for genuinely dependent delivery stages. These are conditional routes, not mandatory successors.

Do not duplicate either Skill's repository search or package topology work. Record hypotheses here as decisions that need later confirmation.

## Inputs, reuse, and receipt

Use the capability idea and its approval state from the current task. If the conversation, plan, or existing receipt already establishes the same outcome and boundaries, reuse it and stop. Do not demand a named receipt or another approval merely to restate accepted facts; implementation or documentation changes alone do not invalidate the outcome.

Reopen only a changed Charter field. Changes to actor, supported entry, authority, durable semantics, required real vertical, non-goals, or closing condition invalidate the corresponding decision. Do not rerun repository discovery to refresh a Charter.

At an actual handoff, provide only decisions, constraints, open facts, and the evidence locations the recipient needs. Use a structured `FeatureCharterReceipt` from [the handoff protocol](../dsh-feature-delivery/references/handoff-evidence.md) only when the recipient or requested deliverable requires it. Continuous work reuses current context.

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

When a formal Charter is needed, use [the charter template](references/charter-template.md). For a bounded outcome, a short description of result, relevant constraints, and acceptance is sufficient. Mark uncertain facts as `to verify`, never current DSH fact. Defer unresolved package selection to discovery using [checkout ownership](../dsh-reuse/references/checkout-ownership.md).

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

For exploration or design, return the requested scenarios, objects, operations, and alternatives. For a formal Charter, return the template once; a separate receipt is unnecessary when it would repeat the same facts. For bounded work, report only the outcome, relevant boundaries, acceptance, and unresolved choices. Where useful, distinguish:

- **Frozen now** — user outcome, hard boundaries, non-goals, and required vertical.
- **To verify next** — current-contract facts delegated to `dsh-reuse` or `xia-pluginmaster`.
- **Not part of this charter** — reuse choice, implementation sequence, code, and mechanical fixes.
