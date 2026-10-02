---
description: "Apply Session and Goal budgets to a real Agent and its live ancestors. Human turns can ask the existing approval interface for one additional request. Autonomous Goal continuation stops with a durable budget-exhausted reason."
kind: "package-reference"
---

# @changanhua/dsh-budget-agent

English | [中文](README.zh.md)

## Summary

Apply Session and Goal budgets to a real Agent and its live ancestors. Human turns can ask the existing approval interface for one additional request. Autonomous Goal continuation stops with a durable budget-exhausted reason.

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

Mount this bridge with Agent Registry and Budget, together with [the LLM bridge](../budget-llm/README.md). Set limits through [the Human command](../command-budget/README.md); request metadata such as a claimed session id is not authority.

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

- Interactive exceptions require a live root Agent in a direct Human turn. Missing answerers and unattended work fail closed. Cold continuation must retain a durable scope binding.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
