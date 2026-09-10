# DSH Eval independent-acceptance closure

English | [中文](2026-08-31-eval-independent-acceptance-closure.zh.md)

> This plan freezes the complete Eval product outcome. The existing replay kernel is the first prerequisite, not completion of the Epic.

## Global constraints

- The evaluated Agent, Goal, Workflow, Skill, Prompt, model, or subject DSH runtime never certifies its own success.
- Deterministic checks run before an independent model grader, and a grader cannot override a deterministic failure.
- Every run pins its Git revision, Suite version, Profile/configuration, Provider/model/Preset route, visible Tool/Skill set, and evidence identity.
- Live execution, recorded replay, and fixture-only tests remain separate evidence classes; none may be presented as another.
- Queue owns durable finite execution, Storage owns Eval records and reports, and Bridge packages connect domains without moving their ownership into Eval core.
- A model-facing Eval Tool is not part of the default composition. The first product entry is human- or Host-authorized.
- Private holdout prompts, rubrics, answers, and raw outputs never enter committed public suites or automatic knowledge promotion.
- When DSH develops DSH, a known-good controller, isolated subject, and independent verifier use frozen Skill and Verifier-plan identities; the changed runtime cannot certify itself.

## Feature Charter

### Epic outcome

A maintainer or approved DSH self-development controller selects a versioned Eval Suite, a fixed subject revision, and at least two Provider/model/Preset routes through a supported DSH entry. DSH executes real Agent/Session work durably, applies deterministic checks and an independent grader, preserves per-case evidence, and emits a durable report that can drive model selection, regression decisions, and Goal or Workflow acceptance.

The report, not the evaluated producer, owns the acceptance result. It distinguishes task failure, invalid evidence, and infrastructure uncertainty; retains failure samples instead of only averages; and records Token, latency, cost precision, revision, environment, Session, fixture, and visible-capability provenance.

### Capability boundary

| Concern | Frozen decision |
| --- | --- |
| Definition | `@deepseek-ai/dsh-eval` owns versioned Suite, Case, Route, Run, Outcome, Report, execution request/result, and run-lifecycle contracts. |
| Providers | A local durable provider owns Eval records; DSH execution and independent grader providers own their external calls and lifecycle; the existing Session Snapshot adapter remains the replay provider. |
| Consumers | A human/Host entry starts and inspects runs; CI and self-development consume reports; Goal and Workflow consume explicit acceptance policies through Bridges. |
| Bridges | Queue admission/execution, Goal/Workflow certification, Budget evidence, and optional UI/API projection remain separate Bridges. |
| Authority | Humans or trusted Hosts define Suites, routes, graders, baselines, credentials, cost ceilings, and acceptance policy. Evaluated Agents may produce evidence but cannot alter or approve those inputs during a run. |
| Lifecycle | Eval runs are host-durable, cancellable, restart-convergent, and idempotent. Unknown post-dispatch work remains pending review rather than being scored or silently retried. |
| Entry | The first Consumer is a supported human/Host DSH command or API in an explicit Eval-capable Profile; no package bin or default model Tool is added. |
| Artifacts | The durable provider owns EvalRun, per-case evidence references, EvalReport, baseline identity, price/cost precision, and terminal failure or uncertainty records. |

### DSH self-development boundary

| World | Required identity and isolation |
| --- | --- |
| Controller | Known-good checkout/build/Profile, immutable Skill snapshot and digests, separate `DSH_HOME`, data/log roots, and ports. |
| Subject | Fixed start/result revision, isolated worktree/build/Profile/home/data/log/ports, and no access to controller policy or durable state. |
| Verifier | Previously approved identity plus a controller-owned immutable Verifier plan frozen before subject execution. |
| Verifier plan | Assertions, commands, checker/parser, input fixtures, golden outputs, allowed environment inputs, and per-file/manifest digests live outside the subject worktree. |
| Credentials and cost | `none` or an explicit run authorization naming target, Provider/model, scope or usage limit, budget ceiling, and expiry. |
| Human authority | Any merge, push, publication, durable-data migration, credential use, or paid request stops at its recorded approval boundary. |

### Required real vertical

1. An approved actor selects one fixed subject revision, one Suite with deterministic and grader-backed cases, and two real routes.
2. A supported DSH entry admits the route × case matrix as durable typed Queue work and returns a stable Eval run identity.
3. Each route starts the intended Profile and Agent/Session execution. One case changes or inspects Workspace state; one requires independent grading; at least one case fails by design.
4. The Host is stopped at a declared pre-dispatch or post-dispatch point and restarted. Recovery neither loses a case nor duplicates a model or Workspace side effect.
5. Deterministic checkers inspect external state, and the grader runs in a separate identity with a pinned prompt/rubric version. Missing or failed grading remains invalid or infrastructure-uncertain.
6. The durable report contains ordered per-case results, failure samples, Token, latency, cost precision, environment, visible Tool/Skill surface, Session/artifact references, and route provenance.
7. A Goal, Workflow, CI gate, or DSH self-development acceptance Consumer reads the report and makes an observed pass/block decision without trusting the evaluated Agent's declaration.
8. Replaying the recorded run without credentials produces the same normalized report bytes except fields explicitly declared live-only.

### Closure evidence

| Layer | Disposition | Required proof |
| --- | --- | --- |
| `source-contract` | required | Public contracts, providers, Bridges, authority, recovery, and negative paths pass focused tests. |
| `generated-declaration` | required | Package exports and affected Cordis/config/persistence/module surfaces are fresh. |
| `composed` | required | A real Loader/Profile selects the Eval provider, Queue Bridge, grader, and human/Host Consumer. |
| `runtime-observed` | required | The exact live Profile exposes the run, scope, durable state, cancellation, restart, and report lifecycle. |
| `behavior-verified` | required | The required real vertical produces the independent report and downstream pass/block decision. |

### Explicit non-goals

- No universal benchmark marketplace, training platform, generic Artifact Store, distributed scheduler, or second Queue/Storage registry.
- No automatic promotion from Eval failures into Skills, knowledge, prompts, training data, or accepted baselines.
- No requirement that every evaluator be an LLM; deterministic and domain-specific evaluators remain valid providers.
- No invoice-grade currency reconciliation in the first closure; cost records retain price identity and exact/estimated/unknown precision.
- No GUI is required for the first closure. A later UI must consume the same Definition and durable provider rather than own another Eval state.

## Requirement traceability

| ID | Requirement | Closing evidence |
| --- | --- | --- |
| R1 | Versioned Suite/Case/Route/Run/Outcome/Report contracts pin revision and provenance. | Strict parsing, public API tests, generated/export checks. |
| R2 | Real Agent/Session execution and keyless replay both exist without conflating their evidence. | Live Profile run plus byte-stable replay report. |
| R3 | Deterministic Workspace/output/Session checks run before any grader. | External-state assertions and deterministic-failure negative test. |
| R4 | An independent grader has pinned identity, prompt/rubric, usage, latency, and failure classification. | Separate grader invocation and missing/failing grader cases. |
| R5 | Queue executes route × case work durably with idempotency, cancellation, restart, and bounded concurrency. | Real Queue run with injected failure and no duplicate side effect. |
| R6 | Durable reports preserve per-case evidence, failure samples, Token, latency, cost precision, and baseline identity. | Store/reload and stable JSON/Markdown artifacts. |
| R7 | A supported human/Host entry starts, observes, cancels, and reads an Eval run. | Real command/API path through the selected Profile. |
| R8 | Goal, Workflow, CI, or self-development consumes an explicit Eval acceptance policy. | Independent observed pass/block decision. |
| R9 | Self-hosted Eval separates controller, subject, verifier, policy snapshot, credentials, cost, and rollback. | Fenced two-world run using a frozen Verifier plan. |
| R10 | The complete real vertical is reproducible and independently accepted. | Final acceptance record and retained artifacts. |

## Delivery DAG

```text
E1 kernel ───────────────┬→ E3 DSH executor/checkers ─┐
                        ├→ E4 independent grader ─────┼→ E5 Queue bridge → E6 composition → E7 human/Host consumer ─┐
E2 durable provider ────┘                            │                                                        ├→ E9 acceptance
                                                     └────────────────────────────→ E8 downstream Bridges ───┘
```

### E1 — Eval contract and replay kernel

- Role: `kernel`; current implementation is a prerequisite, not Epic closure.
- Owns: `packages/eval/eval` and `packages/eval/eval-session-snapshot` contracts, four outcomes, ordered reports, and replay provenance.
- DoD: preserve current focused tests while extending contracts only for proven Consumers; retain invalid and infrastructure-uncertain evidence.
- Does not close: live execution, generic checkers, grader Provider, Queue, durable run storage, product entry, or downstream acceptance.

### E2 — Durable Eval provider

- Role: `provider`; depends on E1.
- Owns: run/case lifecycle, canonical records, report persistence, baseline identity, evidence references, cost precision, cancellation, and restart reconciliation through the existing Storage Domain.
- DoD: a run survives provider restart; duplicate admission returns the same identity; post-dispatch ambiguity remains reviewable; no Eval state is stored only in Session history.
- Evidence: provider tests plus a real Storage restart and reload.

### E3 — DSH live executor and deterministic checkers

- Role: `provider`; depends on E1 and consumes Agent, Session, Workspace/filesystem, and Profile launch contracts.
- Owns: fixed-revision subject execution; file existence/content/equality, structured output, Session fact, exit-state, and Workspace-diff checks; live-to-replay recording handoff.
- DoD: deterministic failure cannot be overridden; a real Profile produces external Workspace and Session evidence; live and replay artifacts name distinct evidence modes.
- Evidence: focused checker tests, REAL Loader/Profile execution, and one controlled live recording.

### E4 — Independent grader provider

- Role: `provider`; depends on E1.
- Owns: separate grader identity/Session, prompt and rubric versions, strict structured result, evidence visibility, usage/latency, cancellation, and error classification.
- DoD: the evaluated Agent cannot access the hidden rubric or grader authority; malformed, missing, canceled, or failed grading never becomes a task failure or pass.
- Evidence: strict protocol tests, leak negative test, and one separately authorized real grader request.

### E5 — Queue-to-Eval Bridge

- Role: `bridge`; depends on E2, E3, and E4.
- Owns: typed `eval.run@1` admission, route × case Batch expansion, bounded parallelism, Handler lifecycle, Result projection, cancellation/retry mapping, and report finalization.
- DoD: restart before and after dispatch converges without duplicate model or Workspace effects; result payloads contain trusted identities rather than raw untrusted model text.
- Evidence: fake Handler property tests followed by a real Queue-backed run.

### E6 — Eval composition

- Role: `composition`; depends on E5.
- Owns: Bundle/Profile rows selecting the Definition, durable provider, execution/checker provider, grader provider, Queue Bridge, Budget policy, and human/Host Consumer dependencies.
- DoD: the exact Profile passes REAL Loader composition, generated catalogs are fresh, HMR disposal removes registrations, and denied scopes cannot invoke Eval.
- Does not close: user reachability or final Eval behavior without E7 and E9.

### E7 — Human/Host Eval consumer

- Role: `consumer`; depends on E6.
- Owns: supported command or API operations for submit, inspect, cancel, report, baseline comparison, and failure-sample access without a default model Tool.
- DoD: an authorized actor starts and observes the required run through the shipped DSH entry; unauthorized or model-only callers fail before admission.
- Evidence: built entry-path test and real Profile invocation.

### E8 — Goal, Workflow, CI, and self-development Bridges

- Role: `bridge`; depends on E5 and E6.
- Owns: explicit acceptance-policy mapping from an immutable Eval report to pass/block/retry/manual-review decisions; no domain core imports a concrete Eval provider.
- DoD: at least one Goal or Workflow path and one DSH self-development path consume the same report semantics; a producer's self-declared completion is ignored.
- Evidence: composed policy tests plus an observed downstream state transition.

### E9 — Independent product acceptance

- Role: `acceptance`; depends on E7 and E8.
- Owns: the required real vertical, frozen self-hosting identities where applicable, retained report/evidence, failure injection, replay comparison, and operator recovery instructions.
- DoD: all R1–R10 evidence is present; the independent verifier records the downstream pass/block decision; omitted credentials, restart, or live Provider work remains `not run`, never `N/A`.
- Verification budget: run focused tests per owning task, the earliest real vertical before hardening, one complete Host/Client/Web build at freeze, one authorized two-route Provider/grader run, and one final keyless replay. Repeat a broad lane only after relevant code, environment, or evidence changes.

## Self-development execution record

Before DSH uses DSH to implement or verify any delivery card, freeze:

- controller, subject, and verifier checkout/build/Profile/Skill identities;
- separate worktrees, `DSH_HOME`, data/log roots, module outputs, and ports;
- the immutable Verifier plan and its assertion/checker/fixture/golden/environment-input digests outside the subject worktree;
- credential and cost authorization, or `none`;
- human authority stops for merge, push, publication, migration, credential use, and paid calls;
- the known-good rollback launch and subject base/result revisions.

Subject tests, reports, transcripts, Git diffs, and Workspace artifacts are candidate evidence only. The independent verifier applies the frozen plan to subject behavior and external state.

## Final gate

The Eval Epic is complete only when the required real vertical is `behavior-verified`, an authorized Consumer can use the durable report to make an independent pass/block decision, and R1–R10 remain traceable to retained evidence. A package, schema, replay fixture, unit suite, build, or kernel-only PR cannot close this plan.
