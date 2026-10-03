---
description: "Produce and retain bounded decisions from original Host evidence and a separate verifier Profile."
kind: "package-reference"
---

# @changanhua/dsh-eval-gates-local

English | [中文](README.zh.md)

## Summary

The producer reads original Queue, evidence and Budget records through createEvalGateSnapshotReader. It invokes a fixed checker in a separate dsh Profile and retains its exact report, source snapshot, input, Host observations and policy with the decision. Concurrent evaluations serialize by Workspace, run and policy.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Trusted Host composition supplies explicit policies, ledger/retention limits, the snapshot capability and createLocalVerifierExecution. The runner needs Subprocess. Each policy locks a complete physical core tree, its launcher and Profile. The pinned eval-core.json contains sourceCommit matching the approved build provenance; the artifact digest identifies all actual bytes, independently of that source checkpoint. Task repository commits are never substituted as verifier core provenance.

Reading a retained pass verifies its original input, approved report, complete cell coverage, derived manifests and evidence receipts against the stored source snapshot. Missing or mismatched material blocks the read instead of preserving an unsupported pass.

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

- The first checker supports output-equals and output-contains, with a captured Grader PASS where required. Baselines and session-snapshot criteria remain unsupported. Core provenance is supplied by the approved trusted build, not independently certified by this checker. Verifier worlds retain private files for inspection; neither automatic cleanup nor aggregate filesystem quotas are provided. The producer publishes no invariant companion because its public views derive directly from its one ledger and current source reads.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
