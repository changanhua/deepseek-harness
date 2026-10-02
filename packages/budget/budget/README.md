---
description: "Define one resource account for Session, Goal and Workflow work. Consumers can query usage and keep parent limits authoritative across child requests. The service definition does not grant a model permission to change its budget."
kind: "package-reference"
---

# @changanhua/dsh-budget

English | [中文](README.zh.md)

## Summary

Define one resource account for Session, Goal and Workflow work. Consumers can query usage and keep parent limits authoritative across child requests. The service definition does not grant a model permission to change its budget.

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

Use the [local provider](../budget-local/README.md) and the bridges in this group; do not mount the abstract definition alone.

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

- Scope definitions are immutable; another limit requires a new explicitly authorized scope.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
