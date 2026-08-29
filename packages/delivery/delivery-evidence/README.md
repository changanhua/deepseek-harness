---
description: "Immutable content-addressed evidence publication and verified reads for Personal Delivery."
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-evidence

English | [中文](README.zh.md)

## Summary

`dsh-delivery-evidence` is the Service Definition for `ctx.deliveryEvidence`. Runners and verifiers publish bounded logs, Git metadata, patches, checkpoint metadata, verification output, screenshots, and Resume Capsules. The provider derives the durable id, URI, byte length, SHA-256 digest, and creation time, and returns a reference only after immutable bytes are committed.

## Use this package

Bind Work/Attempt or verification-check provenance before handing a writer to an execution component. The resulting writer cannot omit or replace that provenance.

```ts
const writer = ctx.deliveryEvidence.bind(provenance)
const ref = await writer.save({ kind: 'log', mediaType: 'text/plain', data })
```

Claims, Verdicts, and Resume Capsules retain durable `EvidenceId` values, so `resolve(id)` recovers a fresh immutable reference after restart and returns `undefined` when it is absent. `read(ref)` then returns detached bytes only after checking the supplied reference identity, byte length, and digest. Missing or changed objects fail with stable `DeliveryEvidenceError` codes, allowing the verifier to produce evidence-integrity findings rather than treating corrupt bytes as success.

## Understand the implementation

The abstract `DeliveryEvidence` service owns publication and verified-read semantics, not a filesystem layout or retention policy. `dsh-delivery-evidence-local` supplies the local immutable store. Queue records retain typed `EvidenceRef` values only; bytes never enter Queue state.

See the [Personal Delivery subsystem](../../../docs/subsystems/delivery.md) for package topology and [Personal Delivery Protocol V1](../../../docs/specs/2026-08-29-delivery-protocol-v1.md) for evidence kinds and provenance.

## Dev Note

No open package-local design decisions. A new evidence kind belongs in Delivery Protocol and requires a current producer and Consumer.

## Model Experience

### Host evidence service

#### What the model sees

The model receives no content directly from `ctx.deliveryEvidence`. A runner may summarize evidence, but this service itself adds no prompt or message content.

#### Token effect

None from this service. A Consumer owns the cost of any summary it chooses to render.

#### KV Cache effect

None from this service.

## Known Limitations and Deferred Work

- Automatic retention and garbage collection are unsupported; references may outlive Packets and Attempts.
- This contract is restricted to code-delivery evidence and is not a generic artifact platform.
