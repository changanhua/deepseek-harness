---
description: "Claim a single-use Grant durably and deliver at most one authorized Goal round."
kind: "package-reference"
---

# @changanhua/dsh-eval-activation-local

English | [中文](README.zh.md)

## Summary

The private ledger reserves a Grant before resuming a Session. The Host request factory and verifier read the actual Gate, terminal Queue Attempt, Session workspace and session Budget with its ancestors. Checks run again before followup. Only the exact persisted message id, Goal revision and round can settle a receipt.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the service with Agents, Goals, Sessions and private synchronous Storage Domain. Supply createActivationHost and createActivationRequestFactory from trusted code. Use a dedicated Profile with exclusiveGoalDriver=true and no goal-round-driver. Cold Agents need the Profile to supply a model route through the normal Agent request seam. The grant Budget must belong to the target Session and match the Eval Plan authorization.

Operations targeting the same Session serialize even when their Grant ids differ. After asynchronous authorization, the owner rechecks Grant expiry, Goal identity and revision, and Agent idleness immediately before delivery. Unloading the owner cancels its active round and waits for quiescence before closing the ledger.

<a id="further-exploration"></a>
## Further Exploration

- [Package group](../README.md)
- [Eval contracts](../../../docs/subsystems/eval.md)
- [Architecture](../../../docs/architecture.md)

<a id="model-experience"></a>
## Model Experience

### Goal continuation prompt

#### What the model sees

An authorized round appends the canonical `<goal_round>` prompt and Host-fixed followup to the same Session, preserving existing history.

#### Token effect

Each round adds the objective, fixed instructions and continuation text; model and tool requests in that round remain subject to the original budget.

#### KV Cache effect

Existing Session prefixes remain unchanged; continuation only appends this round’s input. The checker makes no model request.

## Known Limitations and Deferred Work

No invariant companion is published because public state derives from existing owners or one ledger without a separate cached projection.

<a id="known-limitations-and-deferred-work"></a>

- A restart during resume or with an unproven delivery remains needs-attention and never resends automatically. Receipt reads do not wake an Agent. The owner releases cold handles after quiescence and reports missing persistence as uncertainty. Shared automatic Goal drivers, general Artifact storage and self-development authorization remain outside this provider. Views derive from the ledger; no invariant companion is published.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
