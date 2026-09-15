---
description: "Durable Queue execution and recovery for prepared knowledge-base stages using the native Codex app-server provider."
kind: "package-reference"
---

# @changanhua/dsh-knowledge-base-task-queue

English | [中文](README.zh.md)

## Summary

`dsh-knowledge-base-task-queue` runs a prepared knowledge stage through the local Queue and native Codex provider. Each work item claims exactly one `knowledge-base` unit and one `codex` unit, so the containing Queue configuration must provide both capacities at least once. It persists a received response before cleanup and hands verified business completion back to the Queue; an interrupted or uncertain side effect remains `unknown` until an explicit recovery action proves it is safe. Choose it for durable stage execution, not as a general Codex scheduler.

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

Mount this service after the knowledge repository, local Queue, and subprocess provider; its configuration selects the native Codex run model, permission mode, and disposal grace period.

### Failure recovery

`resumeStage` accepts only an `unknown` work item with a verified completed stage or a recoverable response receipt. `retryStage` accepts only a known `failed` item whose side effect is `not-started`, and retries the original Queue work. `correctStage` accepts only a `failed` `knowledge-validation` item, preserves its rejected response, and creates a bounded corrective stage. A stopped generation control prevents new, retried, and corrective model calls until the human `/knowledge` command or trusted Host request resumes generation; the model tool rejects `resume-generation`.

### Queue capacity

The handler's claims are fixed: `knowledge-base: 1` and `codex: 1`, which serializes knowledge starts under the bundle defaults. A profile-local replacement of the `task-queue` configuration replaces the whole row, so retain both resource capacities when overriding it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Admission resolves a previously prepared business stage, binds its Queue work identity, and replays a completed stage without starting Codex. The service uses an operator view only for its own `knowledge.stage@1` bindings; it does not manage other Queue kinds. After the runner awaits the configured cwd and before it starts Codex, it rechecks the persistent stop and cancellation state. The runner captures a completed response before provider cleanup, then asks the repository to accept it. Post-start failures and cleanup uncertainty produce Queue `unknown`; recovery validates the stored response or candidate before authorizing Queue settlement.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Queue service, stage admission, retry, correction, and explicit recovery. |
| [`src/runner.ts`](src/runner.ts) | Native Codex lifecycle, response capture, cleanup, and outcome classification. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge package map](../README.md) — content and tool owners.
- [Knowledge business repository](../knowledge-base/README.md) — response receipts, candidates, and durable project state.
- [Knowledge tool bundle](../tool-knowledge-base/README.md) — user-facing operations.
- [Local Task Queue](../../task-queue/task-queue-local/README.md) — Queue work and Attempt semantics.

-----

<a id="model-experience"></a>
## Model Experience

### Native knowledge stage

#### What the model sees

The native Codex run receives the repository's prepared `prompt`. Queue work ids, attempt ids, capacity claims, recovery state, and provider cleanup diagnostics stay outside the prompt.

#### Token effect

The prompt contributes the selected sources, prerequisites, and requested generation or review task. Queue bookkeeping adds no model tokens.

#### KV Cache effect

Prepared inputs are immutable for one stage. A changed source, prerequisite, correction, or model route changes the request and may prevent cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints preserve a conservative side-effect boundary.

- **Unknown never auto-retries** — a killed or otherwise uncertain native run needs verified recovery and explicit authorization.
- **Recovery needs a receipt** — no response receipt, completed stage, or durable candidate means the Queue cannot safely resume the work.
- **Fixed capacity names** — every mounted Queue needs both `knowledge-base` and `codex` capacity declarations.
- **Native provider only** — this bridge uses the Codex app-server run path and its existing local authentication.

<a id="dev-note"></a>
### Dev Note

None.
