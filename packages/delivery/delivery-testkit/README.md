---
description: "Deterministic fake Delivery providers and golden fixture builders for isolated Consumer tests."
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-testkit

English | [中文](README.zh.md)

## Summary

`dsh-delivery-testkit` supports isolated Delivery Consumer tests without importing local providers. It supplies concrete `FakeDelivery`, `FakeRepositoryWorkspace`, and `FakeDeliveryEvidence` Service Providers plus fresh Protocol V1 fixture builders. The fakes preserve production obligations: exact idempotency, provider-derived verification plans, host-only acceptance candidates and evidence reads, cross-binding checks, binding compare-and-set, repository owner conflicts, awaited cleanup, real SHA-256 evidence verification, and fail-loud unstubbed calls.

## Use this package

Mount all three fakes for a Consumer integration test, or mount one class directly when service topology is the subject.

```text
const harness = await mountDeliveryTestkit(ctx)
const packet = readyWorkPacketFixture()
```

Repository behavior is explicit: allow the revisions, ref heads, exact blobs, and ranges a test needs, then queue a change or verification lease. Base resolution captures point-in-time commits, and blob reads enforce exact commit/path/object-id provenance, complete byte limits, abort propagation, and fresh detached bytes. `FakeDelivery` keeps every previous Contract revision in the same canonical GitHub Issue lineage, derives contract-field plans itself, and accepts a strict git-blob plan only through an operation-local branded-blob resolver with a Delivery-selected byte limit. It invokes the acceptance candidate only after validating both stored bindings, then asks a second host capability to resolve and integrity-read every evidence id it derives from the exact Queue claim and verdict. Evidence corruption controls remove or replace stored bytes without rewriting the durable reference. Every fixture builder parses a golden value through the production schema and returns a fresh clone, so one test cannot mutate another test's input.

Awaited Delivery writes are serialized per idempotency key. Concurrent exact retries return one durable object, a concurrent changed DTO conflicts after the winning write commits, and a failed resolver releases the key so retry remains possible.

Packet-creation tests use `resolveBase`; resumed execution tests use `inspectRevision` on the Packet's persisted full base commit. Fake checkout opening accepts that exact revision without replaying a possibly moved Contract ref.

## Understand the implementation

This package depends only on Protocol and the three Service Definitions. It does not import Queue, Git, Codex, GitHub, or any local provider. Consumer tests therefore prove their declared service requirements and cannot accidentally rely on a provider path or imagined `ctx.codeExecutors` API.

See the [Personal Delivery subsystem](../../../docs/subsystems/delivery.md) for the provider and Consumer topology these fakes preserve.

## Dev Note

Add a helper only when at least two Consumer packages need the same valid Protocol object or provider behavior. Negative raw JSON remains in Protocol fixtures so a typed builder cannot normalize invalid input.

## Model Experience

### Test-only providers

#### What the model sees

The model sees no content from `mountDeliveryTestkit`; this test support is not mounted in production profiles.

#### Token effect

No tokens are added.

#### KV Cache effect

No request prefix is changed.

## Known Limitations and Deferred Work

- Fake repository leases model declared lifecycle outcomes; real Git behavior belongs to the local provider's own contract and vertical tests.
- The testkit does not fake Queue scheduling or Codex transport; those owners retain their own test infrastructure.
