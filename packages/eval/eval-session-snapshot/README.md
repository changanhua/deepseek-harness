---
description: "Keyless ACP session-snapshot execution for DSH Eval suites, including route provenance checks and normalized persisted-log comparison."
kind: "package-library"
---

# @deepseek-ai/dsh-eval-session-snapshot

English | [中文](README.zh.md)

## Summary

`dsh-eval-session-snapshot` lets an Eval runner boot a configured ACP application and compare its persisted session logs with route-owned replay fixtures. It reuses the real session-snapshot subprocess harness, verifies recorded Provider/model provenance before launch, seeds fixture-owned Workspaces, and returns deterministic result codes plus Session identity, usage buckets, evidence references, and split Agent/evaluator latency. Startup, protocol, replay, and persistence exceptions remain available for `runEvalSuite()` to classify as infrastructure uncertainty.

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

Create one executor for a fixture root and application selection, then pass it to `runEvalSuite()`.

### When to use it

Use this adapter when an Eval case is an ACP text prompt whose expected result is the normalized persisted session log. Use the broader session-snapshot suite factory when stdout, workspace state, prompt pins, tool-schema pins, or multi-step ACP scripts are part of the oracle.

### Entry point

The adapter selects route-specific application/profile overrides and keeps every fixture under one root:

```text
const execute = createSessionSnapshotEvalExecutor({ fixtureRoot, agent, routes })
const result = await runEvalSuite(suite, execute, { signal })
```

A matching snapshot returns a deterministic `passed`. Content or session-count differences return stable failure codes. Missing or mismatched recorded route provenance returns `invalid` without launching the subprocess. Successful and task-failure evidence without a Session id is downgraded by the runner to infrastructure uncertainty.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The adapter resolves primary, override, child, and Workspace fixture paths, reads the primary request header, and checks its Provider/model against the route. It drives one ACP prompt with deterministic permission answers. The session-snapshot owner launches and tears down the subprocess; this adapter normalizes logs, reads Provider usage from durable assistant messages, marks retry usage unknown when a retry is present, and times Agent execution separately from evaluation.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Route selection, fixture confinement/provenance, ACP execution, and snapshot comparison |
| [`src/invariant.ts`](src/invariant.ts) | No-runtime-invariant companion registration |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Eval contract](../eval/README.md) — suite execution and report semantics consumed by this adapter.
- [Session snapshot](../../test-support/session-snapshot/README.md) — application launch, fixture recording, normalization, and cleanup.
- [Eval decision](../../../.agents/notes/implemented/architecture/2026-08-31-deterministic-eval-contract-and-snapshot-adapter.md) — adapter boundary and alternatives.
- [Minimal replay suite](suites/minimal-v1/suite.json) — two independent route fixture sets exercised by the adapter integration test.

-----

<a id="model-experience"></a>
## Model Experience

### Suite prompt

#### What the model sees

The executor submits the exact `EvalCase.prompt` as one ACP user prompt to the replay-backed Agent.

#### Token effect

One case contributes its prompt tokens plus the composed profile's normal system prompt and tool schemas; this adapter adds no evaluator prompt.

#### KV Cache effect

The case prompt is a new user-message suffix. Stable profile headers retain their normal prefix-cache behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The adapter compares persisted session logs only; stdout and workspace expected outputs remain owned by the broader session-snapshot suite factory.
- An AbortSignal prevents a new case from starting and prevents a returned score from being accepted, but the upstream subprocess harness does not expose mid-flight signal cancellation.
- Recording live Provider fixtures and selecting credentials remain explicit session-snapshot operations outside this package.
- Focused tests execute all ten cases keylessly, boot the real session-snapshot ACP subprocess harness for both routes, boot the shipped Loader/Profile through an ACP handshake, and replay a `recording: live` Provider fixture to verify usage buckets. A fresh live call remains an explicit credentialed operation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
