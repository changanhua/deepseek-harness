---
description: "Run one bounded Personal Delivery code-change Attempt through the parent-free Codex app-server transport, with truthful cancellation, checkpoint, evidence, and cleanup outcomes."
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-runner-codex

English | [中文](README.zh.md)

## Summary

`dsh-delivery-runner-codex` runs one bounded code-change Attempt in its caller-supplied worktree and returns a Protocol-valid `CompletionClaim`. Every request carries the exact `queueWorkId` and `queueAttemptId` that identify its workspace lease, evidence, and claim. The package selects `@deepseek-ai/dsh-subagent-codex/app-server-run` as its only production transport; it neither deep-imports provider source nor creates a generic executor registry or Cordis service.

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

The Queue bridge assembles a `CodeChangeRunRequest` from one durable Contract, Packet, resolved Queue specification, and current Queue Work/Attempt pair. It binds workspace opening and evidence publication to that Attempt, then calls the returned `StartCodeChange` closure at the Queue side-effect boundary.

```text
const startChange = createCodexChangeRunner({
  spawn: ctx.subprocess.spawn.bind(ctx.subprocess),
  permissionMode: 'never',
  env: {},
  disposeGraceMs: 5_000,
  modelOutputBytes: 64 * 1024,
})

const run = startChange(request, signal)
const claim = await run.done
```

`CodeChangeRun` publishes `done` and `cancel(reason)` synchronously before workspace work starts. Cancellation reaches the selected transport; `cancel()` waits for runner settlement and whole-process-tree cleanup, and it rejects when cleanup fails. DSH WorkKind registration, retries, workspace creation, durable Queue state, and acceptance remain outside this package.

`disposeGraceMs` must be a positive integer no greater than the platform timer ceiling. `modelOutputBytes` must be a positive safe integer and cannot exceed `MAX_MODEL_OUTPUT_BYTES` (64 MiB). The prompt declares UTF-8 head retention before execution. A final response that exceeds the configured head cannot form a complete JSON envelope, so the run fails with `completion` and preserves the worktree instead of parsing truncated output.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The runner validates Contract, Packet, resolved specification, lease, and evidence identities before it publishes a claim. It opens the worktree through `openWorkspace(signal)`, supplies only `lease.cwd` to the parent-free app-server transport, and disposes the complete subprocess tree before it parses the model envelope or asks the lease to checkpoint. A `completed` envelope requires a clean descendant checkpoint and publishes bounded model-output plus checkpoint-metadata evidence before the lease is removed. `blocked`, `needs-decision`, and `needs-scope-change` claims carry no invented checkpoint facts and preserve the lease. `DeliveryCodexRunnerError` distinguishes `invalid-request`, `startup`, `product`, `canceled`, `completion`, `ownership-lost`, and `cleanup`; a cleanup failure retains the earlier failure as an `AggregateError` cause.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Delivery Protocol](../delivery-protocol/README.md) — durable claim and evidence meanings.
- [Repository Workspace](../repo-workspace/README.md) — Attempt-owned worktree and checkpoint contract.
- [Delivery Evidence](../delivery-evidence/README.md) — provenance-bound immutable evidence publication.
- [Codex subagent](../../subagent/subagent-codex/README.md) — the supported parent-free app-server transport.

-----

<a id="model-experience"></a>
## Model Experience

### Codex execution prompt

#### What the model sees

The model receives one authoritative JSON projection of the exact `ContractRevision`, `WorkPacket`, and resolved code-change specification, followed by the four allowed completion dispositions and the configured UTF-8 head-retention rule. It receives no Queue history, Agent or Session object, evidence writer, or absolute control-center path.

#### Token effect

The runner adds one task prompt per Attempt. Contract and Packet text contribute input tokens; the strict final JSON envelope and retained model output contribute output tokens only up to the configured byte budget.

#### KV Cache effect

Stable framing, disposition instructions, and retention wording can share a reusable prefix, while Contract, Packet, resolved policy, and byte-budget values vary per Attempt and reduce suffix reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The final response is a strict protocol** — Codex must return exactly one JSON object in one text result; extra prose, extra fields, missing fields, or an over-budget envelope fails completion and preserves the worktree.
- **Codex is the only selected provider** — alternative providers and a shared executor registry are out of scope without a separate evidence-backed architecture decision.
- **No Queue ownership** — this package cannot register `code.change@1`, choose retries, or write Queue lifecycle state; `dsh-delivery-task-queue` owns that bridge.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
