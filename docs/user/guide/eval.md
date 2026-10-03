---
description: "Run an approved Eval Plan, inspect its independent decision, and consume a configured continuation grant from the CLI."
---

# Run an approved evaluation

English | [中文](eval.zh.md)

## Summary

An Eval Profile can execute an approved Plan, retain its evidence, ask a separate verifier for a decision, and deliver one authorized Goal round. The Profile administrator must configure the Workspace, Plan, isolated runtime, credentials and bounded Budget before these commands are available. This guide starts with that configured Profile; the [optional CLI overlay](../../../apps/cli/config/examples/eval.patch.yml) only adds the command interface.

## Table of Contents

- [Execute and verify](#execute-and-verify)
- [Continue once](#continue-once)
- [Read and recover](#read-and-recover)
- [Dev Note](#dev-note)

<a id="execute-and-verify"></a>
## Execute and verify

Use the Profile's approved Plan and execution policy. Keep the request id stable when repeating the same submission:

```text
dsh --profile eval start --request nightly-17 --plan regression --version 1 --policy approved --wait
```

The JSON result identifies the run. A settled run with outcome `passed` records successful execution; it does not authorize continuation. Submit that returned run id to the Profile's independent verification policy:

```text
dsh --profile eval gate evaluate <run-id> --policy release
dsh --profile eval gate show <gate-id>
```

A Gate may retain a historical pass while its current validity is stale. Continuation requires a current pass whose original report, input, manifests and receipts remain intact. The fixed checker supports output equality and containment, plus a captured Grader PASS when the case requires it.

<a id="continue-once"></a>
## Continue once

The administrator must also install an explicit continuation policy that fixes the target Session, Goal, Budget and followup. In a dedicated Profile without another automatic Goal round driver, consume that policy once:

```text
dsh --profile eval continue <gate-id> --grant approved --request continue-17
dsh --profile eval activation show <activation-id>
```

`consumed` means the exact authorized Goal message has a durable Session receipt. Repeating that operation or reading it after a restart does not deliver another round. It does not mean the entire Goal has finished. A revoked Budget or expired authorization blocks a new continuation.

<a id="read-and-recover"></a>
## Read and recover

Use `show <run-id>` to inspect the run without dispatching work. An uncertain Attempt or `needs-attention` activation requires inspection of retained evidence; do not change request ids to force a repeat. The [CLI contract](../../../packages/eval/eval-app/README.md) describes explicit Queue recovery controls. The [continuation provider](../../../packages/eval/eval-activation-local/README.md) defines its current deployment limits.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
