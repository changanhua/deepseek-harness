---
description: "Delivery-specific Codex change runner over the supported parent-free app-server package boundary."
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-runner-codex

English | [中文](README.zh.md)

## Summary

`dsh-delivery-runner-codex` is the Delivery-specific adapter for one bounded code-change Attempt. It exports the pure `createCodexChangeRunner` factory and operation-local request/run types. Every request carries the exact `queueWorkId` and `queueAttemptId` that must identify its workspace lease, evidence, and completion claim. The package selects `@deepseek-ai/dsh-subagent-codex/app-server-run` as its only production transport boundary; it neither deep-imports provider source nor creates a generic executor registry or Cordis service.

## Use this package

The Queue bridge assembles a `CodeChangeRunRequest` from one durable Contract, Packet, resolved Queue specification, and the current Queue Work/Attempt pair. It binds workspace opening and evidence publication to that Attempt, then calls the returned `StartCodeChange` closure at the Queue side-effect boundary.

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

`CodeChangeRun` publishes `done` and `cancel(reason)` synchronously. DSH WorkKind registration, retries, workspace ownership, durable Queue state, and acceptance remain outside this package.

`disposeGraceMs` must be a positive integer no greater than the platform timer ceiling. `modelOutputBytes` must be a positive safe integer and cannot exceed `MAX_MODEL_OUTPUT_BYTES` (64 MiB). The Queue bridge supplies 64 KiB as its default retained Codex-output budget; this factory itself requires the deployment value explicitly.

## Understand the implementation

The public request carries durable Protocol values, `queueWorkId`, `queueAttemptId`, and two Attempt-bound capabilities: `openWorkspace(signal)` and a `BoundDeliveryEvidenceWriter`. Before executor startup, the concrete runner must require `lease.ownerAttemptId === request.queueAttemptId`. Every EvidenceRef returned by the bound writer and the final `CompletionClaim` must retain the exact request Work/Attempt pair; a mismatch is an infrastructure failure, not a claim. Absolute host paths therefore remain operation-local. The production dependency is the narrow app-server facade; the package root of `dsh-subagent-codex` stays unchanged, and Delivery never imports `subagent-codex/src/run.ts`.

## Model Experience

### Codex execution prompt

#### What the model sees

The runner contract limits model input to the bounded `ContractRevision`, `WorkPacket`, allowed and forbidden paths, stop conditions, and required completion-claim instructions; the unavailable implementation invokes no model.

#### Token effect

The runner contract permits one compact task prompt per Attempt; raw ChatGPT transcripts, Queue history, and unrelated repository documents are out of scope.

#### KV Cache effect

Stable framing and policy instructions can share a reusable prefix, while Packet objectives, scope, and resume evidence vary per Attempt and reduce suffix reuse.

## Known Limitations and Deferred Work

- **The concrete runner is unavailable** — `createCodexChangeRunner` returns a live handle whose `done` rejects with `DeliveryCodexRunnerError('unavailable')`; Queue identity checks, prompt compilation, transport settlement, checkpointing, evidence, and truthful completion claims are unsupported.
- **Codex is the only selected provider** — alternative providers and a shared executor registry are out of scope without a separate evidence-backed architecture decision.
- **No Queue ownership** — this package cannot register `code.change@1`, choose retries, or write Queue lifecycle state; `dsh-delivery-task-queue` owns that bridge.
