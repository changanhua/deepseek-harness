---
description: "Execute an admitted Eval cell with isolated Subject and Grader Agents, authenticated core observations, Budget receipts and acknowledged evidence transfer on Windows."
kind: "package-library"
---

# @changanhua/dsh-eval-isolated

English | [中文](README.zh.md)

## Summary

A trusted Host can run an approved Eval cell with separate Subject and Grader Agents. The library binds Plan admission, a real Queue Attempt, its repository lease and Budget authority to Windows AppContainer execution. It returns observed identities and bounded evidence after the receiving Host acknowledges retention. Unknown execution or handoff retains the workspace and becomes Queue Attention.

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

Import `admitIsolatedEval` into a trusted Host that composes EvalPlans, TaskQueue, RepoWorkspace, LLM and Budget with its final dispatch bridge. Supply the original Plan resolution, current Workspace authorization, pinned core artifacts, explicit bounds and a receiver that durably retains every offered material before returning its exact digest. A copied resolution or caller-supplied digest grants no authority. The [Host integration](tests/host.e2e.ts) demonstrates the typed Queue wiring.

```text
const run = await admitIsolatedEval(ctx, access, resolution, requestId, config, signal)
const binding = run.bind({ caseId, routeId, repeatIndex })
// Store { eval: binding } as the existing typed Queue Work's resolved data.
const prepared = await run.prepare(binding, signal)
// Inside that WorkKind's start handler, with the Queue's actual StartContext:
return prepared.start(context, (cell, workspace) => ({ cell, workspace }))
```

Each role's approved core directory contains `node.exe`, a complete physical `node_modules` graph including the built `@deepseek-ai/dsh/lib/bin.js`, this package's built `worker.js` and `startup.js` at the directory root, approved plugins and `presets/<id>/agent.cordis.yml`. Resolve package links while assembling this artifact: image admission rejects symlinks, junctions and hardlinks. Pin its complete tree digest using the same bounded tree observation in [build.ts](src/build.ts); the Host owns artifact approval. Configure Subject and Grader core directories, digests and plugin configurations separately. The fixed core is the trusted Harness; the leased repository is task material, never implicitly imported as core code.

`runtime.root` is a private Host directory on the case workspace's DOS volume. Bounds cover image files/bytes, protocol frames/exchanges, model attempts/output, execution and shutdown time, and evidence material/bytes. Approved tools execute task code through the private `eval-isolated/task` event with the current Session id and JavaScript source; the Host launches that code under another AppContainer identity. Core plugins must not evaluate untrusted code in their own process. Direct child creation from the core Job is prohibited. Only the Host broker holds model credentials or network access.

An `output-equals` or `output-contains` case runs the Subject once. A model-grader case additionally needs Host-approved grader prompt/version, a Plan route matching the Suite evaluator and exact expected capabilities. The Grader gets its own writable directory and only a read-only copy of the Subject output; it returns `PASS` or `FAIL`. Deterministic criteria and grading must both pass. Execution completion is separate from this business outcome and never grants continuation.

Plan parameters must fix effective model settings, including a provider's default reasoning effort when it materializes one. The worker proxy exposes only the approved reasoning choice and forwards the pinned controls; the real Host adapter still validates support. A final dispatch that adds or changes an unapproved parameter is refused before HTTP.

Evidence references resolve within the admitted run until acknowledged transfer and release. The receiver owns retained materials thereafter. A failed receiver leaves `resolveEvidence` available on the live run owner. The acknowledgement wait uses `stopMs` and caller cancellation; a pending receiver cannot trigger redelivery, automatic cleanup or promotion of an unknown result. Cancellation first requests Agent stop and Session flush, then waits for the process Job; a finite grace period ends in forced termination. Missing usage, uncertain process exit, flush failure or uncertain cleanup preserves evidence and the lease. There is no automatic retry.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The Host copies and verifies read-only images once per run, role and verified revision, then boots every role through `dsh --profile eval-isolated` with private home, storage and logs. A random per-execution key travels through a private inherited startup handle and is erased before Agent input. The locked core authenticates registry observations and protocol frames; Agent text is never an observation. The Host validates sequences, process identity, full image/config identities, actual Tool/Skill/Preset snapshots and final model dispatch facts. A mismatch retains actual values and refuses completion. A Manifest is emitted only when sufficient actual identity exists; an early refusal retains evidence without inventing a model route.

Task Jobs use different AppContainer SIDs, no network capabilities and only explicit directory ACLs. The core's process/thread ACLs and single-process Job prevent task code from stealing observer memory. Model requests cross the authenticated channel to the existing Budget guard, which validates the final route before HTTP and returns owner receipts. Session events, task results and dispatch identities remain execution evidence, separate from the Manifest schema. The [decision record](../../../.agents/notes/implemented/architecture/2026-10-03-pinned-core-isolated-eval.md) owns the threat model and alternatives.

No runtime invariant companion is published: this library owns live execution custody, not an independently cached business projection.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Eval contracts](../../../docs/subsystems/eval.md)
- [Attempt workspace bridge](../eval-repo-workspace/README.md)
- [Budget final dispatch](../../budget/budget-llm/README.md)

<a id="model-experience"></a>
## Model Experience

### Subject and Grader input

#### What the model sees

The Subject receives the exact case prompt with its approved Preset and visible Tool/Skill contracts. The Grader receives its approved prompt, JSON-encoded untrusted Subject output and the instruction to return exactly `PASS` or `FAIL`. Credentials and observer authentication keys never enter model messages.

#### Token effect

Each role consumes its own prompt, tools and response tokens. Grading adds a separate model turn containing the Subject output. The Host's existing Budget scope accounts for actual usage; missing usage remains unknown.

#### KV Cache effect

Role prompts and histories are independent. Stable Preset prefixes can retain normal provider caching; the output appended to each Grader prompt is case-specific. This library does not rewrite or combine model caches.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Execution requires Windows x64 AppContainer and Job APIs, and a common DOS volume for private runtime and case workspace. Unsupported platforms fail closed.
- The Host, pinned Harness core, approved plugins and operating system are trusted. Arbitrarily malicious core modifications and independent self-development certification need a separate verifier; Agent reports cannot certify this infrastructure.
- Session-snapshot criteria belong to the existing replay executor. Attachments and images lack a cross-runtime material/budget contract and are rejected. Task execution currently accepts bounded Node source through approved tools.
- Protocol and evidence have finite memory/output bounds. Required diskLimits sample writable worlds, temporary data and stdio; excess growth or uncertain observation requests graceful cancellation and then forces Job quiescence. Sampling is not a filesystem quota and does not bound the overshoot within one interval or aggregate retained history. Recovery uses a fresh Host world without reusing uncertain directories. Run retention, aggregation, decisions and user control belong to the downstream owners.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
