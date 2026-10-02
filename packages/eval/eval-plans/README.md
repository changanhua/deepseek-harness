---
description: "Discover an approved Plan version and obtain a fresh preflight result before reserving a run identity. Every Consumer uses the same source owner. A parsed JSON object is not an admission capability."
kind: "package-reference"
---

# @changanhua/dsh-eval-plans

English | [中文](README.zh.md)

## Summary

Discover an approved Plan version and obtain a fresh preflight result before reserving a run identity. Every Consumer uses the same source owner. A parsed JSON object is not an admission capability.

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

Use the [local provider](../eval-plans-local/README.md) for project files. Host Consumers supply the exact live Workspace and an authorization callback; browser and command input selects only id/version. The Host-only `resolvedRequirements` retains approved Tool/Skill id/source/digest sets, is deeply frozen and bound into `resolvedDigest`, and supplies expectations for comparison with actual execution observations. Its presence is not a GateDecision; `checks` and `ready` report current verification.

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

- Admission records an approved run identity, not execution or verifier evidence. Consumers still own dispatch-time authorization and observed execution facts.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
