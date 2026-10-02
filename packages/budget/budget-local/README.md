---
description: "Reserve resources before a model call and retain actual usage after it finishes. Unknown usage remains held across restart until a human reconciles it. A one-call approval does not increase future limits."
kind: "package-reference"
---

# @changanhua/dsh-budget-local

English | [中文](README.zh.md)

## Summary

Reserve resources before a model call and retain actual usage after it finishes. Unknown usage remains held across restart until a human reconciles it. A one-call approval does not increase future limits.

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

Mount this provider with a Storage Domain routed to an exclusive, synchronous, owner-private backend. The [tested Profile overlay](tests/fixtures/profile/budget.patch.yml) supplies the complete composition; set `maxScopes`, `maxReservations` and `maxLedgerBytes` for the retained account.

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

- The account retains every decision and receipt up to its configured capacity; it does not silently prune evidence or reset limits. Input reservations can be estimates, and missing provider usage requires explicit reconciliation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
