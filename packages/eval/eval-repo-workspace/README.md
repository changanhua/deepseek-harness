---
description: "Run each Eval cell in an isolated checkout of a verified full commit. Known completion removes its checkout; uncertain execution preserves the exact Attempt lease. The Queue adapter records unknown Attention instead of retrying uncertain work."
kind: "package-library"
---

# @changanhua/dsh-eval-repo-workspace

English | [中文](README.zh.md)

## Summary

Run each Eval cell in an isolated checkout of a verified full commit. Known completion removes its checkout; uncertain execution preserves the exact Attempt lease. The Queue adapter records unknown Attention instead of retrying uncertain work.

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

Import `resolveEvalWorkspace` from this library in a typed Queue handler. Resolve at admission, reconstruct at preparation after restart, and call the returned `start` at the Queue side-effect boundary; the [real Queue test](tests/workspace.spec.ts) demonstrates the contract.

The executor's third argument contains the actual lease's repository, verified commit, Attempt owner, checkout root and preparation digest. The checkout root remains Host-only and differs from an empty/fixture case's writable directory. Consumers can bind observed execution evidence to these facts without inventing a lease identity or taking over cleanup.

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

- The executor must report known completion only after its children quiesce. The bridge does not supply an isolated subject, grader or verifier, and does not certify model quality.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
