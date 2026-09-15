---
description: "Independent fixed-plan verification for immutable Personal Delivery targets."
kind: "package-reference"
---

# @changanhua/dsh-delivery-verifier

English | [中文](README.zh.md)

## Summary

`dsh-delivery-verifier` exports the pure `createDeliveryVerifier` function for independently checking one immutable target commit. Its request contains the exact `ContractRevision`, `WorkPacket`, matching completed `CompletionClaim`, resolved trusted plan, current verification Queue Work and Attempt identities distinct from the producing change Attempt, an Attempt-bound verification workspace opener, an independent range inspector, integrity-checked evidence lookup/read functions, and per-check evidence writers. It owns no Queue state, Delivery records, repository identity, or evidence store.

A settled run returns a Protocol-validated `VerificationVerdict`. Check, path, ancestry, and evidence-integrity failures remain in the verdict; invalid authority, process or evidence infrastructure loss, cleanup failure, and cancellation reject `done` instead of manufacturing a verdict.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The Queue bridge creates one verifier function from trusted subprocess deployment inputs. At dispatch it supplies a `DeliveryVerificationRunRequest`; the returned `DeliveryVerificationRun` synchronously publishes `done` and `cancel(reason)`.

```text
const startVerification = createDeliveryVerifier({
  subprocess: ctx.subprocess,
  verifierVersion: 'delivery-verifier@1',
  disposeGraceMs: 5_000,
  verificationOutputBytes: 64 * 1024,
})

const run = startVerification(request, signal)
const verdict = await run.done
```

Only fixed `argv` already present in the trusted `WorkPacket` plan is eligible for execution. The verifier result is a durable `VerificationVerdict`; it is evidence for a human decision, never an automatic acceptance decision.

Checks run sequentially with no shell interpolation or verifier-supplied environment override. The Subprocess provider supplies its credential-scrubbed parent environment, enforces tree-scoped termination, and exposes independent exit results. Each saved `verification-output` record includes the process outcome plus retained `stdout` and `stderr`, and is clipped on a UTF-8 boundary to the configured total byte budget.

`disposeGraceMs` must be a positive integer no greater than the platform timer ceiling. `verificationOutputBytes` must be a positive safe integer and cannot exceed `MAX_VERIFICATION_OUTPUT_BYTES` (64 MiB). The Queue bridge supplies 64 KiB as its default per-check output budget; this function requires both deployment limits explicitly.

<a id="understand-the-implementation"></a>
## Understand the implementation

The Queue bridge first requires a `completed` claim, proves `claim.packetId === packet.id`, and proves `claim.checkpointCommit === resolved.targetCommit`, then supplies it as `CompletedChangeClaim`. It also supplies the current `verificationQueueWorkId` and `verificationQueueAttemptId`. Before execution, the verifier runtime-validates the Contract, Packet, claim, resolved target, trusted plan, and lease identities. It treats every id in `claim.evidenceIds` as required input; missing, size-mismatched, digest-mismatched, or wrongly provenanced objects produce Protocol findings and a failed verdict.

`inspectRange(signal)` independently derives ancestry and the complete changed-path set for the exact base and target. Immediately after it returns, the verifier validates the identities, ancestry flag, and normalized paths, removes duplicate paths, and freezes an owned snapshot before another asynchronous operation can mutate the provider object. `openWorkspace(signal)` opens a read/execute-only checkout pinned to that target. `resolveEvidence(id, signal)` and `readEvidence(ref, signal)` close the durable ID-to-bytes integrity path after restart. `evidenceFor(checkId)` supplies a bound writer; the verifier additionally requires each output reference to match the exact Packet, verification Queue Work, verification Attempt, and check. These are operation-local functions rather than new Cordis capabilities.

Before any process starts, the verifier requires the workspace `ownerAttemptId` to equal `verificationQueueAttemptId`, applies `lstat` and `realpath` to every repository-relative `VerificationCheck.cwd`, requires a physical directory inside the lease root, and rejects symlink or junction traversal outside it. It repeats no plan discovery in the target checkout; only the resolved Packet checks execute.

For each spawned check, the verifier records timeout independently from the eventual process exit and waits for `waitForExit()` whole-tree quiescence before settlement. A required timeout or unexpected exit fails the verdict; optional uncertainty yields `needs-human-review`. Cancellation terminates the active tree and rejects `done` with `canceled`. Cleanup removes a lease only after proven quiescence, preserves it when process ownership is uncertain, and reports cleanup failure explicitly. When cancellation and cleanup failure coincide, the cleanup error cause aggregates both facts and retains any earlier execution failure.

<a id="model-experience"></a>
## Model Experience

### Deterministic verification boundary

#### What the model sees

No model receives verifier input or output; the package consumes fixed `VerificationCheck.argv` values and returns a structured `VerificationVerdict` to trusted host code.

#### Token effect

Verification executes subprocesses and stores evidence without adding prompt tokens, tool schemas, messages, or another model request.

#### KV Cache effect

There is no model request and therefore no KV-cache contribution; deterministic command output remains evidence rather than prompt context.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Verification is isolation, not a code sandbox** — fixed commands can execute repository code inside the Attempt-owned checkout; deployment still owns the selected Subprocess provider and its operating-system confinement.
- **The plan is not discovered at runtime** — arbitrary shell text, repository-provided executable policy, and model-generated commands are outside this package.
- **Acceptance remains human-owned** — a passed verdict does not call `recordAcceptanceDecision` and cannot merge or accept delivery.

<a id="dev-note"></a>
### Dev Note

None.
