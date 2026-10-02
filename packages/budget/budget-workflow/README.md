---
description: "Give every configured Workflow run a shared parent budget. Concurrent children reserve from the same account and retain their Session binding before a model call. Canceling a run keeps uncertain usage accounted for."
kind: "package-reference"
---

# @changanhua/dsh-budget-workflow

English | [中文](README.zh.md)

## Summary

Give every configured Workflow run a shared parent budget. Concurrent children reserve from the same account and retain their Session binding before a model call. Canceling a run keeps uncertain usage accounted for.

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

Configure `workflows` with an exact `name`, `limits` and `onExhausted`, and mount the Agent and LLM budget bridges. A Workflow without a matching Host policy or an authorized parent scope cannot start a child.

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

Indirectly, through the Agent, LLM and Workflow Consumers that render resource refusals and approved results.

#### KV Cache effect

This package does not directly rewrite prompt prefixes; its Consumers own prompt construction and cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This bridge covers the in-process Workflow child path. It does not authorize external Agent services that bypass the local LLM runtime or add automatic Activation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
