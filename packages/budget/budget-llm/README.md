---
description: "Apply resource admission to both ordinary and prepared model calls. Rejected requests never reach the selected adapter. Accepted calls settle their actual usage before publishing terminal output."
kind: "package-reference"
---

# @changanhua/dsh-budget-llm

English | [中文](README.zh.md)

## Summary

Apply resource admission to both ordinary and prepared model calls. Rejected requests never reach the selected adapter. Accepted calls settle their actual usage before publishing terminal output.

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

Mount this bridge beside the LLM runtime and [local budget owner](../budget-local/README.md). The [Profile example](../budget-local/tests/fixtures/profile/budget.patch.yml) installs the final dispatch guard; requests require a positive output Token limit and a Host-bound scope.

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

- Text input uses a labeled byte-based estimate. Images without a trustworthy Token bound are refused; missing cache usage fields are not treated as zero. This does not perform monetary billing.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
