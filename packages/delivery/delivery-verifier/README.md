---
description: "Independent fixed-plan verification closure for immutable Personal Delivery targets."
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-verifier

English | [中文](README.zh.md)

## Summary

`dsh-delivery-verifier` exports the pure `createDeliveryVerifier` factory for independently checking one immutable target commit. Its request contains the exact Contract, Packet, matching successful `CompletionClaim`, resolved trusted plan, an Attempt-bound verification workspace opener, an independent range inspector, integrity-checked evidence lookup/read closures, and per-check evidence writers. It owns no Queue state, Delivery records, repository identity, or evidence store.

## Use this package

The Queue bridge creates one verifier closure from trusted subprocess deployment inputs. At dispatch it supplies a `DeliveryVerificationRunRequest`; the returned `DeliveryVerificationRun` synchronously publishes `done` and `cancel(reason)`.

```ts
const startVerification = createDeliveryVerifier({
  subprocess: ctx.subprocess,
  verifierVersion: 'delivery-verifier@1',
  disposeGraceMs: 5_000,
  verificationOutputBytes: 64 * 1024,
})

const run = startVerification(request, signal)
const verdict = await run.done
```

Only fixed argv already present in the trusted Packet plan is eligible for execution. The verifier result is a durable `VerificationVerdict`; it is evidence for a human decision, never an automatic acceptance decision.

`disposeGraceMs` must be a positive integer no greater than the platform timer ceiling. `verificationOutputBytes` must be a positive safe integer and cannot exceed `MAX_VERIFICATION_OUTPUT_BYTES` (64 MiB). The Queue bridge supplies 64 KiB as its default per-check output budget; this factory requires both deployment limits explicitly.

## Understand the implementation

The Queue bridge first requires a `completed` claim, proves `claim.packetId === packet.id`, and proves `claim.checkpointCommit === resolved.targetCommit`, then supplies it as `CompletedChangeClaim`. The verifier treats every id in `claim.evidenceIds` as required input. `inspectRange(signal)` independently derives ancestry and the complete changed-path set for the exact base and target. `openWorkspace(signal)` opens a read/execute-only checkout pinned to that target. `resolveEvidence(id, signal)` and `readEvidence(ref, signal)` close the durable ID-to-bytes integrity path after restart. `evidenceFor(checkId)` prevents a check from omitting or replacing its Queue Attempt and check provenance. These are operation-local closures rather than new Cordis capabilities.

Before spawning a check below a repository-relative `VerificationCheck.cwd`, the concrete verifier must resolve its physical path and prove it remains inside the lease root, or reject every symlink traversal. A lexical `join()` is insufficient because the target tree itself can redirect an intermediate directory outside the isolated checkout.

## Model Experience

### Deterministic verification boundary

#### What the model sees

No model receives verifier input or output; the package consumes fixed `VerificationCheck.argv` values and returns a structured `VerificationVerdict` to trusted host code.

#### Token effect

Verification executes subprocesses and stores evidence without adding prompt tokens, tool schemas, messages, or another model request.

#### KV Cache effect

There is no model request and therefore no KV-cache contribution; deterministic command output remains Evidence rather than prompt context.

## Known Limitations and Deferred Work

- **The concrete verifier is unavailable** — `createDeliveryVerifier` returns a live handle whose `done` rejects with `DeliveryVerifierError('unavailable')`; ancestry, scope, every `completionClaim.evidenceIds` lookup/read, command, timeout, and verdict logic are unsupported.
- **The plan is not discovered at runtime** — arbitrary shell text, repository-provided executable policy, and model-generated commands are outside this package.
- **Acceptance remains human-owned** — a passed verdict does not call `recordAcceptanceDecision` and cannot merge or accept delivery.
