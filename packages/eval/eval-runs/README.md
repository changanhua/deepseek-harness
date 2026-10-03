---
description: "Start, inspect and control one durable Eval run through the same authorized contract across Consumers."
kind: "package-reference"
---

# @changanhua/dsh-eval-runs

English | [中文](README.zh.md)

## Summary

Start and find the same evaluation after a restart. Inspect cell Attempts, evidence availability and bounded role/accounting facts without exposing private prompts or Host paths. Current Workspace authority applies to every operation; a run outcome does not grant a trusted Gate pass or another model call.

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

Depend on this contract when implementing a CLI, Web or trusted Host Consumer. Mount [the local provider](../eval-runs-local/README.md) with the existing Plan, Queue and Workspace owners; this abstract service has no standalone deployment configuration.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The [service contract](src/index.ts) separates safe views from operator intent. Queue owns Attempt lifecycle; the provider derives every run projection from Queue and retained evidence. Host-private verifier input is obtained through the local provider’s code capability, not this public evidence view. This package has no independently cached business projection and publishes no invariant companion.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Package group](../README.md)
- [Eval contracts](../../../docs/subsystems/eval.md)
- [Architecture](../../../docs/architecture.md)

<a id="model-experience"></a>
## Model Experience

None, as this package adds no model prompt or tool. Consumers own rendering and execution prompts.

#### KV Cache effect

This package does not rewrite prompt prefixes; the execution and continuation owners control model requests.

## Known Limitations and Deferred Work

No invariant companion is published because public state derives from existing owners or one ledger without a separate cached projection.

<a id="known-limitations-and-deferred-work"></a>

- Retry applies to failed Works; unknown execution requires explicit operator resolution. Canceled Work retry is not part of the Queue contract.
- A reported passed outcome is an execution result. Trusted Gate decisions, retained-source verification and Activation authority have separate owners.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
