---
description: "Discover and preflight an approved Plan from the Human command interface. An explicit admission request records a reusable run identity. None of these commands dispatches Queue work or calls a model."
kind: "package-reference"
---

# @changanhua/dsh-command-eval-plan

English | [中文](README.zh.md)

## Summary

Discover and preflight an approved Plan from the Human command interface. An explicit admission request records a reusable run identity. None of these commands dispatches Queue work or calls a model.

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

Mount with `entrypoint` set by the deployment to `web`, `cli` or `ci`, and an explicit `maxOutputBytes`. Use `/eval-plan {"action":"discover"}` and the [setup guide](../../../docs/cookbook/trusted-eval-and-budget.md) for preflight and admission.

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

- The command requires a live Agent in a registered Workspace and its exact active Human command evidence. It does not expose full Host Plans over the command result.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
