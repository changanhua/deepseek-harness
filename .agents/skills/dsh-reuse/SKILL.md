---
name: dsh-reuse
description: Use when deciding whether DeepSeek Harness should gain a proposed feature, package, Service Definition, Provider, Consumer, Tool, WorkKind, workflow, state machine, scheduler, cache, dependency, or community Skill; when the user asks what DSH already has, whether a wheel is being reinvented, or how a new capability should reuse local and community work. Produce an evidence-backed direct-reuse, adapt, bridge, vendor/fork, or build decision before implementation planning. Do not use for an already-scoped mechanical edit or a bug whose owning implementation is known.
---

# DeepSeek Harness Feature Reuse Audit

Decide whether a proposed DSH capability should be built and identify the smallest justified change. Treat code, runtime composition, installed capabilities, and community projects as separate evidence classes. This workflow is read-only unless the user separately asks to implement or install something.

## Outcome

Finish with:

- the user outcome and non-negotiable semantics;
- existing DSH capabilities that directly or partially cover it;
- capabilities actually enabled in the relevant Profile or Agent scope;
- whether each internal candidate is committed, current-checkout WIP, or runtime-verified;
- community candidates, when local coverage leaves a real gap;
- one decision: `direct reuse`, `adapt`, `bridge`, `vendor/fork`, or `build`;
- the minimum new code, configuration, documentation, and verification justified by that decision;
- dependency direction and explicit non-goals.

Do not call package presence, a matching name, a test fixture, or a community repository proof that the capability is usable. Verify the owning interface, implementation, composition, consumer, and relevant lifecycle behavior.

## Keep the workflow proportionate

Use the fast path when the proposal is bounded and a local capability clearly owns it: read the owning definition, provider, consumer, one relevant decision record, and focused tests, then decide. Expand the audit when the proposal introduces persistence, authorization, external side effects, concurrency, a new public interface, or a new package family.

Stop community research once one candidate clearly wins or every plausible candidate fails the same required semantic. A reuse audit should reduce implementation cost, not become an open-ended ecosystem survey.

## 1. Write the need capsule

State the need without naming the proposed mechanism:

```text
User outcome:
Required inputs and outputs:
Lifecycle: foreground | live background | durable
Authority and visibility:
Side effects and recovery:
Performance or cost constraint:
Explicit non-goals:
```

If the user has already supplied these facts, do not interview them again. Ask only when a missing choice would change the owning subsystem or permit materially different side effects.

## 2. Search DSH by semantics

Read the applicable `AGENTS.md` files and use the sources in [search-sources.md](references/search-sources.md). Search for both nouns and behavior: service keys, request/result types, events, tools, WorkKinds, lifecycle states, authorization, persistence, cancellation, retry, and output artifacts.

Inspect the current branch and `git status` before treating source as shipped. Preserve all WIP. A candidate found only in an uncommitted diff is useful overlap evidence but remains `current-checkout WIP`; it is not a committed capability or runtime proof. Inspect another branch, pull request, or worktree only when the user names it or the current task explicitly requires that comparison.

For every plausible internal candidate, establish:

1. **Definition** — what API and obligations it owns.
2. **Provider** — whether a real implementation exists.
3. **Composition** — whether the target Profile mounts it.
4. **Consumer** — whether the required entry path actually uses it.
5. **Lifecycle fit** — foreground, process-local live, session-durable, or host-durable.
6. **Evidence** — source, tests, runtime inspection, or only design prose.

Prefer code, configuration, generated catalogs, runtime inspection, and focused tests over proposal text. Historical Agent Notes explain rationale but do not prove current availability.

## 3. Inspect installed and scoped capabilities

Repository support and deployment availability are different questions. Inspect the relevant Profile manifest and patches, current Cordis services where available, `ctx.skills` management projection, tool schemas, MCP projection, and Queue WorkKinds. Account for Agent scope: a global package may be absent from one preset, while a project or preset Skill may shadow a user-level name.

Report each candidate as one of:

- `runtime-verified and composed`;
- `committed but not runtime-verified`;
- `current-checkout WIP`;
- `installed candidate, not evaluated`;
- `design/proposal only`;
- `not found after named searches`.

Never turn a negative text search into proof of absence. Search adjacent subsystem names and inspect the generated capability map before concluding that DSH lacks the behavior.

## 4. Search the community only after the local gap is clear

Use primary sources: the upstream repository, release or package metadata, official documentation, and the actual `SKILL.md` or plugin manifest. Follow [community-intake.md](references/community-intake.md).

Discovery is read-only. Do not install, execute, update, or authenticate a community package or Skill without explicit user authorization. Do not run a candidate's bundled scripts merely to inspect it.

Record commit or version, license, maintenance evidence, required tools and credentials, network and write behavior, output form, model/provider assumptions, batch support, and update policy. Installation counts and stars are discovery hints, not quality evidence.

## 5. Choose the reuse unit

Use the owning DSH concept rather than a generic plugin dependency:

| Need | Preferred reuse unit |
| --- | --- |
| Domain instructions, methods, or prompt expertise | Skill |
| Stable callable behavior with replaceable implementations | Service Definition + Provider |
| Model-facing invocation | Tool Consumer |
| Cross-domain integration | Bridge plugin consuming both Service Definitions |
| Durable finite work | Queue WorkKind + Handler |
| Process-local live control | Jobs |
| Child Agent identity and continuation | Subagent |
| Parallel or dependent orchestration | Workflow |
| Same-session objective continuation | Goal |
| Later conversation delivery | Schedule |
| Team assignment, claims, dependencies, and mailbox | Agent Teams |
| Pure stateless mechanism with identical semantics | Owning utility package or local helper |

Similar method names do not establish shared ownership. Compare durability, authority, cancellation, teardown, result meaning, and recovery before extracting a common abstraction.

## 6. Decide with the rubric

Read [decision-rubric.md](references/decision-rubric.md) for ambiguous cases.

- **Direct reuse** — the existing capability owns the required semantics and only composition or caller work is needed.
- **Adapt** — one existing capability owns the semantics; a thin format or protocol adapter closes the gap.
- **Bridge** — two existing capability families remain independent and a small plugin connects them.
- **Vendor/Fork** — a community implementation or Skill contains valuable behavior, but DSH needs a pinned, reviewed, locally constrained copy.
- **Build** — no candidate owns the essential semantics, and an adapter would relocate rather than remove the missing behavior.

Prefer a Bridge over teaching either domain core about the other. Consumers depend on Service Definitions, never concrete Providers; Bundles select Providers and deployment defaults. A read-only capability index may aid development, but it must not become a second runtime service registry or a dependency of product plugins.

## 7. Define the minimum change

For `adapt`, `bridge`, `vendor/fork`, or `build`, list only what the selected decision requires:

- owning package or new package role;
- exact Service Definition or registry consumed;
- provider and consumer dependency direction;
- configuration owned by each plugin;
- public types, durable or wire fields, and version changes;
- user/model entry path;
- focused tests and a real vertical when external behavior matters;
- README, subsystem reference, and Agent Note ownership.

Separate required work from optional generalization. Do not propose a capability manager, generic artifact store, distributed scheduler, vector index, or other platform merely because it could support a future consumer.

## Report format

Answer in the user's language using this structure. Omit empty rows rather than adding speculative filler.

```markdown
# Feature reuse decision

## Verdict
<direct reuse | adapt | bridge | vendor/fork | build> — <one-sentence reason>

## Need capsule
<outcome and non-negotiable semantics>

## Existing DSH evidence
| Candidate | Coverage | Missing | Availability | Evidence status and location |

## Community evidence
| Candidate | Useful parts | Risks/gaps | Pin/license | Decision |

## Dependency design
<small text graph showing Service Definitions, Providers, Consumers, Bridges, and Bundle selection>

## Minimum justified change
- ...

## Explicit non-goals
- ...

## Verification
- ...

## Confidence and freshness
<verified current code/runtime, community snapshot date, and remaining inference>
```

When the audit will accompany an implementation plan or Agent Note, also emit the compact block in [reuse-audit-template.md](references/reuse-audit-template.md).

## Guardrails

- Do not implement, install, update, enable, or remove anything during an analysis-only request.
- Preserve user WIP and inspect only the current checkout and named Profiles.
- Never report uncommitted source or generated drift as shipped; label it `current-checkout WIP` and state whether a live runtime consumes that exact checkout.
- Do not treat a Skill as a stable runtime API. Repeated deterministic calls with typed consumers may justify promotion from a Skill to a Service or compiler.
- Do not place community execution scripts on a Queue worker path merely because their prompting guidance is useful.
- Do not make Queue core depend on a domain Provider; register a Handler from a Bridge plugin.
- Do not use a central `common` package to hide unclear ownership.
- Do not recommend compatibility shims in this pre-release repository unless a more specific contract requires one.
- State when online community evidence could not be refreshed.

## Example

Read [image-prompt-batch.md](examples/image-prompt-batch.md) when evaluating prompt expertise, batch compilation, image generation, or Queue integration. It demonstrates how a community Skill contributes knowledge once while typed Queue work reuses the local image Provider without one Agent cold start per item.
