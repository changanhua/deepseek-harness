---
description: "Represent one explicit Host-approved continuation from an Eval decision to a Goal round."
kind: "package-reference"
---

# @changanhua/dsh-eval-activation

English | [中文](README.zh.md)

## Summary

ContinuationPolicy fixes the target Session, Goal revision, Budget, expiry and followup in trusted Host composition. CLI callers select a policy and Gate; ActivationRequestFactory derives the current terminal Work and Attempt from their real owners.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The provider exposes activate, get and reconcile. A grant can be consumed at most once. A consumed receipt proves durable admission of the continuation message, not completion of the Goal objective or correctness of a later model answer.

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

- The supported local provider requires a dedicated Profile without goal-round-driver. This contract does not authorize actions from Queue notifications, model text or an unvalidated decision.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
