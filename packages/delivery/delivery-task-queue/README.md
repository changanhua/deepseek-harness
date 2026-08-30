---
description: "Personal Delivery admission bridge and exclusive owner of the code.change@1 and code.verify@1 Queue declarations."
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-task-queue

English | [中文](README.zh.md)

## Summary

`dsh-delivery-task-queue` is the only package that augments Queue `WorkKindMap` with `code.change@1` and `code.verify@1`. It bridges durable Delivery Packets to ownerless operator Queue WorkItems, adapts operation-local Codex and verifier closures into Queue `LiveAttempt` ownership, and keeps Prepared values outside the durable Delivery Protocol.

## Use this package

Trusted host Consumers call the pure admission functions. Neither browser request accepts an idempotency key. Before either store is mutated, change admission resolves the Packet and enforces any required executor; verification admission resolves the selected bound change, its exact successful Queue result, and repository ancestry. Only then does the bridge derive the canonical intent digest and stable cross-store key, begin the Delivery binding, admit the Queue WorkItem, and compare-and-set bind the returned Queue identity.

```text
const queue = ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
const dependencies = {
  delivery: ctx.delivery,
  queue,
  repoWorkspace: ctx.repoWorkspace,
}

const binding = await startCodeChange(
  dependencies,
  { packetId, executorId },
)

const verification = await startVerification(
  dependencies,
  { packetId, changeBindingId: binding.id },
)
```

The code-change key is exactly `delivery:<packetId>:code.change@1`. A required Packet executor must match the host selection before `beginDispatch`. For verification, the caller selects only a Packet and its bound code-change dispatch. Before repository reads or either admission write, the bridge parses the Queue Work intent, recomputes its canonical digest, matches the binding input digest, and parses the resolved value against the Packet's Contract, repository, base, and bound executor. It then requires that exact Queue Work to be `succeeded`, parses its output as `codeChangeOutputSchema`, requires a completed claim with matching Packet, Work, and Attempt identities, and proves that its checkpoint descends from the Packet base. The immutable target comes from that claim and the trusted plan digest comes from the Packet; neither is caller-controlled. The verification key includes both derived values. Retrying after a crash reuses Queue admission idempotency and finishes the same Delivery binding.

Plugin activation obtains a trusted operator facade inside the Host and registers both handlers behind a closed execution barrier. Recovery admission can therefore enqueue a missing Work or find an existing Queue receipt. Before opening execution, activation scans the complete Delivery snapshot, cross-checks each bound Work through matching Queue `list()` and `get()` views, validates canonical intent and state linkage, and resumes every `submitting` binding from an exactly reconstructed key and input. A reconciliation failure rejects blocked preparation, disposes both registrations, and cannot start a runner or verifier. Disposal continues through every registration even when one disposer fails. Activation creates no recovery cache, acceptance decision, or browser-visible Queue authority.

## Understand the implementation

The package owns declaration merging because it is the sole adapter that can resolve Delivery records, derive the current Queue Work/Attempt pair, bind verified repository operations and evidence provenance to that Attempt, and map the two runner settlements into typed Queue outputs. Its prepared `CodeChangeRunRequest` must carry both Queue identities; the bound workspace owner, evidence provenance, and resulting claim must agree. `dsh-delivery-protocol` remains Queue-independent; `dsh-delivery-runner-codex` and `dsh-delivery-verifier` remain pure factories with no Queue import.

Both handlers persist strict Packet, Contract, repository, target, executor, and policy facts during admission. Verification admission requires the selected bound change's exact Work, successful Result/Attempt, resolved facts, and completion claim before Queue persists the verification Work. Preparation requires the requested Attempt to be the Work's active starting Attempt and compares every parsed resolved fact against the prepared admission. Preparation then materializes only provider proofs and operation-local closures, and performs no checkout or process side effect. Queue classifies a thrown `prepare()` as retriable `prepare-threw`; the default `maxAttempts: 1` still prevents an automatic second Attempt. `start()` synchronously returns Queue live ownership. Cancellation propagates to the runner or verifier; runner validation and startup failures settle `failed/not-started`, quiescent product or completion failures settle `failed/started`, and ownership or cleanup uncertainty settles `unknown/unknown`.

The plugin is a function plugin, not a new service. It consumes `ctx.delivery`, `ctx.deliveryEvidence`, `ctx.repoWorkspace`, `ctx.subprocess`, and `ctx.taskQueue`; it does not publish `ctx.codeExecutors` or another bridge registry.

The package exports the Loader `Config` schema that composes both handlers. Its stable defaults are `executorId: 'codex'`, no model override, `permissionMode: 'never'`, `env: {}`, `disposeGraceMs: 5_000`, 64 KiB each for `modelOutputBytes` and `verificationOutputBytes`, `resource: 'agent-run'`, `maxAttempts: 1`, and `verifierVersion: 'personal-delivery-v1'`. This Bridge owns only the Codex provider, so `executorId` accepts only `codex`; another provider requires a separate adapter decision. Both output budgets are positive safe integers capped at 64 MiB; the grace is a positive integer capped by the platform timer ceiling. The code-change policy digest covers every execution-affecting runner setting, so preparation fails before side effects if persisted policy facts do not match the running Host.

`Config.env` is for explicit non-secret child-process overrides. The Bridge persists only their digest, never the keys or values, but an ordinary SHA-256 digest can still fingerprint a low-entropy secret. Keep secrets in the runner's credential or authentication mechanism instead of this field.

## Model Experience

### Queue admission metadata

#### What the model sees

No model directly sees Queue admission or DispatchBinding records; `CodeChangeRunRequest` is delivered only to the selected Codex runner, whose package owns the model prompt.

#### Token effect

The bridge adds no prompt tokens or tool schemas and does not copy Queue history into the runner request; it passes bounded Contract, Packet, and operation-local capabilities.

#### KV Cache effect

There is no direct KV-cache contribution; keeping admission metadata out of prompts avoids volatile Work and Attempt identities fragmenting the Codex prefix.

## Known Limitations and Deferred Work

- **Bundle and profile activation remain an integration concern** — this package owns handler behavior and Host activation reconciliation; the Personal Delivery bundle and vertical product scenarios are verified separately.
- **No automatic acceptance** — Queue success records only a typed claim or verdict. No handler, activation path, or recovery operation creates a human decision.
- **No generic executor capability** — one Codex provider and one caller do not justify a registry; alternative providers require a separate evidence-backed architecture decision.
- **No client authority escalation** — browsers may select a Packet, executor, and existing change binding only through trusted Remote validation. They cannot supply verification target or plan identity, Queue ownership, idempotency keys, evidence provenance, or acceptance.
