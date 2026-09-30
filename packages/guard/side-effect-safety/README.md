---
description: "Durable approval, exclusive execution leases, bounded side-effect admission, and lookup-only UNKNOWN recovery."
kind: "package-reference"
---

# @changanhua/dsh-side-effect-safety

English | [中文](README.zh.md)

## Summary

Use this opt-in Host guard to admit approved side effects, retain their outcomes across restart, and stop when an outcome is unknown. A domain adapter supplies human-confirmation proof, scope validation, a private executor, and readback. The package does not ship a browser or business-domain executor. It never exposes a model tool or Remote mutation method.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the service beside Storage Domain, a configured backend, and user-approval. All limits are required deployment choices. The [built Loader fixture](tests/fixtures/runtime.mjs) is an executable configuration example with synthetic callbacks; shipped profiles do not activate this guard.

| Field | Default | Meaning |
|---|---|---|
| maxExecutions | required | Maximum retained executions |
| maxApprovals | required | Maximum retained approval artifacts |
| maxActionsPerExecution | required | Maximum retained actions in one execution |
| maxRecordBytes | required | UTF-8 bytes of a complete approval or execution |
| maxTotalBytes | required | UTF-8 bytes of the complete durable state |
| maxEvidenceRefs | required | References retained per approval or settlement |
| maxAdmissionMs | required | Upper bound on an admitted handle lifetime |

A trusted Host plugin calls `bindSafetyAdapter` using its own lifecycle context. Activation invokes `ctx.approval.request` and independently verifies human identity and evidence against the entire approval draft digest. One artifact funds exactly one execution. `prepare` stores intent without payload; `admit` returns an opaque single-use handle; only the originating binding can execute it. A copied handle or raw action cannot execute.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The [Storage Domain declaration](src/state.ts) owns one bounded atomic document. Its serialized read/modify/write lane commits before publishing snapshots. SENT and risk consumption commit together before the private executor is called. The budget counts attempted risk conservatively: NOT_APPLIED never refunds consumed risk. Runtime policy is checked at admission and again at send, including expiry after asynchronous validation. A conflicting idempotency request durably blocks the execution.

Restart invalidates old runtime leases and converts orphaned SENT or RECONCILING actions to UNKNOWN. Recovery passes only ledger metadata to lookup-only inspection. Verified evidence can terminate the original action; it never makes that identity executable again. Pause and abort preserve all possibly sent effects. Abort cancels only PREPARED actions and cannot be resumed.

[Public Host contracts](src/types.ts) distinguish the adapter capability from detached snapshots. The [subsystem reference](../../../docs/subsystems/side-effect-safety.md) owns state-machine and persistence semantics. No invariant companion is published: the package owns no independent event projection or duplicated mutable cache to compare; commit/open validation checks the one authoritative record.

</details>

<a id="model-experience"></a>
## Model Experience

### Host-only admission

#### What the model sees

This package registers no model tool or transcript event. Dynamic Cordis can inspect the bounded `ctx.sideEffectSafety.snapshot` result; mutation requires the private Host binding.

#### Token effect

No automatic model tokens. Explicit snapshot inspection adds the bounded projection requested by its consumer; the ledger stores digests and evidence references, not transcripts or domain payloads.

#### KV Cache effect

No prompt changes or KV-cache invalidation.

## Known Limitations and Deferred Work

- The Storage Domain has one Host writer. JSON storage does not arbitrate independent processes; shared roots require deployment-owned exclusive storage, such as the SQLite backend's exclusive mode. This package does not provide a distributed lease or sandbox trusted Host code.
- Human identity, scope correctness, and evidence validity are adapter authority. No production adapter is registered. An automation approval outcome without verified human proof cannot activate an artifact.
- The executor and inspector must settle their promises; disposal drains active operations. No timeout is interpreted as NOT_APPLIED. Failed settlement persistence leaves SENT or RECONCILING unresolved until restart and readback.
- Retention is bounded and fail-closed. Records are not automatically deleted, budgets are not refunded, and no UNKNOWN waiver exists.
- BrowserTask transport mapping, production UI, real domain writes, and FC adapters are outside this package. Existing BrowserTask and Delivery owners are not migrated.

<a id="dev-note"></a>
### Dev Note

[Durable admission decision](../../../.agents/notes/implemented/architecture/2026-09-30-side-effect-safety-kernel.md) explains ownership and the conservative risk trade-off.
