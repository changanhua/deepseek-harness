---
description: "Load approved project Plans without trusting a file to authorize its own credentials or budget exemption. Discover safe summaries, inspect current preflight checks and recover the same admitted run after restart. Source reload publishes a complete generation."
kind: "package-reference"
---

# @changanhua/dsh-eval-plans-local

English | [中文](README.zh.md)

## Summary

Load approved project Plans without trusting a file to authorize its own credentials or budget exemption. Discover safe summaries, inspect current preflight checks and recover the same admitted run after restart. Source reload publishes a complete generation.

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

Start from [the versioned example](examples/minimal-v1.plan.json) and the [setup guide](../../../docs/cookbook/trusted-eval-and-budget.md). Mount this provider with Workspace Registry and a private synchronous Storage Domain; the [tested Profile](tests/fixtures/profile/plans.patch.yml) contains explicit source and capacity configuration. Live sources require owner-verified finite budget authority with expiry and an explicit positive `maxTokens` on every route. A pinned Plan can exempt only keyless replay from budget admission.

Historical recovery returns the original admitted Plan, Suite, requirements and preflight snapshot after current read authorization. It needs neither a current model Provider nor remaining budget, and the recovered object cannot mint a new admission. The version-2 admission domain rejects older stored formats instead of silently upgrading them.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The [source](src/index.ts) owns the behavioral and lifecycle contract. No invariant companion is published because this package has no independently cached business projection to compare against its owner.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Package group](../README.md)
- [Setup guide](../../../docs/cookbook/trusted-eval-and-budget.md)
- [Architecture](../../../docs/architecture.md)

<a id="model-experience"></a>
## Model Experience

None, as this package adds no model prompt and its Consumers own rendered results.

#### KV Cache effect

This package does not directly rewrite prompt prefixes; its Consumers own prompt construction and cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Preflight proves configured availability and content identity, not completed execution. Tool checks cover the registered contract, not implementation bytes. Verifier execution and trusted GateDecision production belong to their respective owners.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
