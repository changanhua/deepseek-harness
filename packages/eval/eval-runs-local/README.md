---
description: "Recover Eval run admission and control across process exits while retaining exact private execution evidence."
kind: "package-reference"
---

# @changanhua/dsh-eval-runs-local

English | [中文](README.zh.md)

## Summary

Submit an approved Plan once and recover its original run and Queue Batch after restart. Keep unknown Attempts uncertain and persist operator controls before applying them. Read checked evidence identities, actual role Sessions, model usage and latency without exposing raw prompts or filesystem locations.

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

Mount this provider in a trusted Profile with [the Plan provider](../eval-plans-local/README.md), Queue, Workspace Registry and a private synchronous Storage Domain. Explicit capacity, retention and execution policies are required. The [real Profile recovery fixture](tests/profile-crash.e2e.ts) binds an existing Workspace and frozen core; the [CLI Consumer](../eval-app/README.md) owns user commands.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The ledger stores admission/control intent and the receiving Host’s acknowledged materials; it never copies Queue’s Attempt state machine. Submission uses the original Plan and Queue idempotency identities. Conditional Queue mutations fence controls to observed Attempts. The [private snapshot factory](src/host-snapshot.ts) rechecks the original tuple, material digests and Budget owner before trusted verification. Execution services are separately injected so historical reads do not require a usable model route. Views are derived rather than independently cached, so this package publishes no invariant companion.

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

- Evidence is unavailable after its explicit retention deadline. Capacity refusal and uncertain persistence prevent further writes until the owner is reopened.
- Private materials remain bounded by the ledger limits; this provider does not implement general artifact storage, public raw-evidence downloads or automatic expiry deletion.
- The executor’s Windows and pinned-core restrictions apply to new Attempts. Historical recovery does not authorize reuse of uncertain directories or bypass current Plan/Budget checks.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
