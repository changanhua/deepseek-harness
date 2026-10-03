---
description: "Run the approved Eval CLI from a trusted DSH Profile, including safe evidence reads and explicit Queue recovery controls."
kind: "package-reference"
---

# @changanhua/dsh-eval-app

English | [中文](README.zh.md)

## Summary

`dsh --profile <eval-profile>` is the one-shot operator entrypoint for an approved Eval run. The Profile supplies the Workspace, operator identity, and allowed policy ids; command-line input supplies only stable run, Plan, cell, Attempt, request, and operation identities.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this function plugin in a startup-only Profile with `evalRuns`, `workspaceRegistry`, `cmdlineArgs`, `appReady`, and `appExit`; Gate commands additionally require `evalGates`, and continuation commands require `evalActivation`. Start a run with:

```text
dsh --profile eval start --request nightly-17 --plan regression --version 1 --policy approved --wait
```

Read a safe run projection with `show` or `list`. Use an operation id and the exact returned revision for `cancel`, `retry`, and `resolve-unknown`; retry and unknown resolution are explicit operator actions. Read one retained Attempt with `evidence <run> <cell> <attempt>`.

Use `gate evaluate <run> --policy <gate-policy>` only for a Gate policy listed in the Profile, then read it with `gate show <gate-id>`. The JSON result contains safe run, evidence, or Gate facts only. A `passed` run outcome is an execution observation and does not assert an independent Gate decision.

`continue <gate-id> --grant <policy-id> --request <operation-id>` is available only when the Profile installs an exact continuation policy and its Host request factory. The factory, rather than CLI input, reads the retained passing Gate and terminal Queue Attempt before creating the one-use activation. `activation show <id>` rechecks the current Profile authority and reads its safe durable status. The Profile must set `exclusiveGoalDriver: true` for the activation owner and must not compose another automatic goal-round driver.

The [operator guide](../../../docs/user/guide/eval.md) explains the result states. Its [optional overlay](../../../apps/cli/config/examples/eval.patch.yml) adds this CLI to an already configured Eval Profile; it does not supply execution authority. Replace its marked trusted values through Profile administration after registering the Workspace.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The [source](src/index.ts) parses an app-owned command grammar before application readiness, then calls the shared `evalRuns` owner once the Profile tree has committed. It bounds waiting and output, converts owner errors to stable codes, and asks the launcher for a bounded exit. It does not create a second run lifecycle, Queue interface, Evidence store, or Gate.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Eval contracts](../../../docs/subsystems/eval.md)
- [Run provider](../eval-runs-local/README.md)
- [Continuation provider](../eval-activation-local/README.md)

<a id="model-experience"></a>
## Model Experience

None, as this consumer adds no model context and delegates prompts to execution and continuation providers.

#### KV Cache effect

None. This package does not affect prompt prefixes or cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

No invariant companion is published because public state derives from existing owners or one ledger without a separate cached projection.

- A Profile administrator must register the Workspace and compose the approved execution policies before this app can operate.
- The CLI can request and read a configured Gate decision. The Web UI remains a separate consumer.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
