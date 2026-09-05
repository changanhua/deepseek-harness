# Agent Note: Deterministic Eval contract and snapshot adapter

Status: implemented

English | [中文](2026-08-31-deterministic-eval-contract-and-snapshot-adapter.zh.md)

## Problem

DSH has recorded-session replay and snapshot infrastructure, but it has no package-owned vocabulary for comparing Provider/model/Preset routes, preserving incomplete-run uncertainty, or emitting one stable machine and human report. A caller can otherwise treat a canceled run as a model failure, compare routes through one shared transcript, or build reports whose order follows nondeterministic completion.

The existing [ACP snapshot decision](../testing/2026-06-19-acp-snapshot-tests.md) owns recording, replay, fixture projection, application launch, and snapshot normalization. Eval needs to consume that mechanism without duplicating it or turning a test-support package into a product service.

## Decision

`@deepseek-ai/dsh-eval` owns strict `EvalSuite` and `EvalRun` schemas, the four `EvalOutcome` values, deterministic folding, ordered suite execution, and JSON/Markdown report construction. It is a pure library with an invariant companion and publishes no Cordis service, tool, profile, persistence layer, or evaluator prompt.

Every suite pins its schema version, suite version, source revision, and default route matrix, then compares at least two explicit Provider/model/Preset routes. Each case names deterministic Workspace preparation, success conditions, its permitted evaluator, and exactly one independent `first-call-order` fixture per route. Duplicate identities, unknown fields, missing route fixtures, and a session file shared by compared routes are invalid suite evidence.

The generic runner executes route then case order sequentially. This preserves `llm-replay` first-call-order binding and keeps report order independent of process completion. A concrete executor receives the exact route, case, fixture, permission answers, and AbortSignal; it cannot replace the provenance recorded in the resulting `EvalRun`.

Outcomes fold with the precedence `invalid` over `infrastructure-uncertain` over `failed` over `passed`. An empty fold, missing result, cancellation, Host/executor exception, or missing Session fact cannot become a model failure or pass. A model grader records an independent Provider/model/prompt version and cannot override a deterministic failure.

`@deepseek-ai/dsh-eval-session-snapshot` adapts the generic runner to the existing ACP snapshot harness. It confines fixture and Workspace paths beneath one root, validates recorded Provider/model provenance before launch, forwards replay inputs, boots the selected application/profile, and compares normalized persisted session logs. It also returns Session and fixture evidence, durable Provider usage buckets, and separate Agent/evaluator latency while allowing runtime exceptions to remain infrastructure uncertainty.

Machine and Markdown reports use suite route/case order, retain source revision, environment, visible Tool/Skill surface, Session and fixture provenance, count all four outcomes, aggregate success/failure samples and split Token/latency metrics, and synthesize explicit uncertainty rather than dropping absent evidence.

## Alternatives considered

**Use a model judge or embedding score.** Rejected because the first gate must be keyless, transparent, deterministic, and replayable. Semantic or factual evaluators may consume the same run records later without redefining this result vocabulary.

**Put replay and snapshot mechanics inside the Eval package.** Rejected because the snapshot subsystem already owns recording, first-call-order replay, application launch, normalization, and cleanup. A thin adapter preserves that owner and keeps the Eval contract usable by other executors.

**Reuse one transcript for every compared route.** Rejected because one fixture cannot prove route provenance and hides the recording cost of each Provider/model/Preset combination. The adapter rejects a fixture whose recorded Provider/model differs from the requested route.

**Execute routes and cases concurrently.** Rejected because replay binds live sessions to recorded scripts by first-call order. Sequential route/case execution is the deterministic baseline until replay owns a stronger stable binding key.

**Collapse invalid and infrastructure uncertainty into failure.** Rejected because malformed evidence and an interrupted harness say nothing about model behavior. Keeping both classes prevents false regression claims and false passes.

## Consequences

Eval reports can be reproduced without a key after every compared route has its own recorded fixture. Adding a route multiplies recording and review work, and a copied or mislabeled fixture fails before execution.

Package tests pin strict parsing, fixture coverage, route provenance, outcome precedence, cancellation, executor exceptions, deterministic order, report formats, snapshot comparison, and the real session-snapshot subprocess path. The checked-in `minimal-v1` suite contains ten cases and twenty independent route fixtures; its keyless report is byte-stable and contains success, task-failure, grader-failure, and infrastructure-uncertain samples.

The suite boots the snapshot harness's scripted ACP agent for both routes. Separate focused evidence boots the shipped Loader/Profile through ACP and replays a fixture whose manifest records a live Provider capture, verifying the durable Session usage buckets without credentials. A fresh live call remains an explicit credentialed operation rather than a default test.

This note retains the package topology, evidence classes, and losing alternatives because future evaluators and runner adapters must preserve them. The ACP snapshot decision remains active and is not superseded or archived.
