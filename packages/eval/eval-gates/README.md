---
description: "Read independent Eval decisions and whether their evidence is still current."
kind: "package-reference"
---

# @changanhua/dsh-eval-gates

English | [中文](README.zh.md)

## Summary

This Service Definition exposes evaluate and get for an authorized Workspace. EvalGateView separates the retained decision from current or stale validity. Only the trusted producer can obtain original execution evidence; a parsed pass is not permission to continue.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount a producer such as [the local Gate owner](../eval-gates-local/README.md) and access it through the existing EvalRunAccess capability. The private GateSnapshotReader contract is for trusted Host composition, not wire input.

<a id="further-exploration"></a>
## Further Exploration

- [Package group](../README.md)
- [Eval contracts](../../../docs/subsystems/eval.md)
- [Architecture](../../../docs/architecture.md)

<a id="model-experience"></a>
## Model Experience

None, as this package adds no model prompt or tool.

#### KV Cache effect

Existing Session prefixes remain unchanged; continuation only appends this round’s input. The checker makes no model request.

## Known Limitations and Deferred Work

No invariant companion is published because public state derives from existing owners or one ledger without a separate cached projection.

<a id="known-limitations-and-deferred-work"></a>

- Historical decisions remain visible after expiry. Consumers that authorize an action must require current validity and recheck their own authority, resource and target bindings. This contract does not implement baseline statistics or certification of changed Harness code.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
