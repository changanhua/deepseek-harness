---
description: "Strict deterministic Eval suites, ordered execution, four-class outcome folding, and stable reports for DSH regression consumers."
kind: "package-library"
---

# @changanhua/dsh-eval

English | [中文](README.zh.md)

## Summary

`dsh-eval` lets a runner compare recorded Provider/model/Preset routes without letting the tested Agent certify itself. Callers validate versioned suites and route-specific runs, execute every route and case in deterministic order, and render stable JSON or Markdown reports. Runs retain a fixed source revision, environment, visible Tool/Skill surface, Session and fixture identity, Provider usage buckets, and separate Agent/evaluator latency. The library preserves invalid and incomplete evidence instead of converting it into a model score.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use the library at an evaluation boundary that already knows how to execute one case and return a deterministic result.

### When to use it

Use `dsh-eval` for strict suite/run interchange, first-call-order replay scheduling, cancellation-safe outcome classification, and reports. Use a concrete adapter when a case must boot DSH, call a model, read a fixture, or inspect world state.

### Entry point

The smallest runner validates the suite, supplies one executor, and serializes its report:

```text
const suite = parseEvalSuite(input)
const { report } = await runEvalSuite(suite, executeCase, { signal, routeContexts })
const json = formatEvalReportJson(report)
```

Success returns ordered `EvalRun[]` plus an `EvalReport`. Schema errors throw. Cancellation, Host or executor exceptions, missing Session facts, missing results, and malformed executor scores remain explicit non-pass outcomes. A model grader carries its own Provider/model/prompt version and cannot override a deterministic failure.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The schema requires a suite version, fixed hexadecimal source revision, default route matrix, at least two routes, and exactly one independent replay fixture per route and case. Each case declares deterministic Workspace preparation, success conditions, and its permitted evaluator. The runner executes route then case order so first-call-order replay stays deterministic. Reports retain per-case evidence, failure samples, success rate, split Token buckets, and separate Agent/evaluator latency without inventing values for unknown evidence.

| File | Role |
|---|---|
| [`src/schema.ts`](src/schema.ts) | Strict suite, route, case, and fixture schemas |
| [`src/run.ts`](src/run.ts) | Run schema and outcome folding |
| [`src/runner.ts`](src/runner.ts) | Sequential execution and cancellation/error classification |
| [`src/report.ts`](src/report.ts) | Cross-object validation and JSON/Markdown reports |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session-snapshot adapter](../eval-session-snapshot/README.md) — keyless ACP execution for this runner.
- [Eval decision](../../../.agents/notes/implemented/architecture/2026-08-31-deterministic-eval-contract-and-snapshot-adapter.md) — ownership and evidence rationale.
- [LLM replay](../../test-support/llm-replay/README.md) — first-call-order transcript binding.
- [Minimal replay suite](../eval-session-snapshot/suites/minimal-v1/suite.json) — ten cases and twenty route-owned fixtures used by the first keyless comparison.

-----

<a id="model-experience"></a>
## Model Experience

None, as this pure contract package performs no model call and owns no evaluator prompt.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This library owns the generic runner, not a DSH process adapter; use `dsh-eval-session-snapshot` for keyless ACP replay and normalized session-log comparison.
- Replay proves behavior against recorded evidence, not current Provider availability or current model quality; live Provider validation is a separate controlled operation.
- Every compared route needs an independently recorded fixture; the library does not record or synthesize one.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
