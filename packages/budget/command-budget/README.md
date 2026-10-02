---
description: "Set and inspect resource limits without asking a model to edit policy. The Human command can revoke a scope or reconcile one unknown receipt. It does not launch work."
kind: "package-reference"
---

# @changanhua/dsh-command-budget

English | [中文](README.zh.md)

## Summary

Set and inspect resource limits without asking a model to edit policy. The Human command can revoke a scope or reconcile one unknown receipt. It does not launch work.

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

Mount this command beside Commands, Agent Registry and Budget. Use `/budget {"action":"read","scope":"session"}`; the [setup guide](../../../docs/cookbook/trusted-eval-and-budget.md) gives the complete set command. `maxOutputBytes` defaults to 65536.

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

- Only the exact active Human command on a live root Agent can mutate limits. Existing scope definitions are immutable; Goal scopes require a Session parent.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
