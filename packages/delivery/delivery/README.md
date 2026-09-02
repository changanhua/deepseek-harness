---
description: "Personal Delivery domain records and idempotent writes for Cases, requirement decisions, Issue publications, bounded packets, and human acceptance."
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery

English | [中文](README.zh.md)

## Summary

`dsh-delivery` is the Service Definition for `ctx.delivery`. It owns durable Delivery Cases, immutable Contract revisions, human requirement decisions, Issue publications, Work Packets, Delivery-to-Queue dispatch bindings, and explicit human acceptance decisions. A provider allocates ids and timestamps, validates every durable Protocol V2 object at the storage boundary, serializes writes, and returns stable snapshots. Queue Work and Attempt state, Git checkouts, evidence bytes, executor handles, verification execution, and UI lanes remain outside this service.

## Use this package

Consumers inject `delivery` and call one operation at the authority boundary they own. Case authoring creates and revises requirement content, the workbench records human decisions and prepares publications, the publisher drives publication transitions, and the Queue bridge begins and binds a dispatch. Every write request carries a deterministic idempotency key: the same key and canonical input returns the prior record, while changed input fails with `idempotency-conflict`.

```text
export const inject = ['delivery']

const { case: deliveryCase, revision } = await ctx.delivery.createCase(request)
const packet = await ctx.delivery.createWorkPacket(packetRequest)
```

`createCase()` atomically commits one Case and its root revision, and `reviseCase()` requires `expectedHeadRevisionId` and fails with `conflict` when the Case head has already moved, so concurrent revisions cannot silently branch one Case. A revision has at most one requirement decision: repeating identical decision content returns the existing record, and different content under the same revision fails closed with `idempotency-conflict`.

`createWorkPacket()` and `prepareIssuePublication()` require the selected revision to be the named Case revision, ready, and approved; missing approval fails with `approval-required`. `createWorkPacket` requires a `VerifiedRepositoryBase` minted from the Contract's selection rule by `ctx.repoWorkspace`; its ordinary request cannot supply a `VerificationPlan`. A contract-field source is derived inside the provider. For a git-blob source, Delivery gives the verified base, Contract-owned path, and a fixed byte limit to an operation-local host resolver, validates the returned `VerifiedRepositoryBlob`, strictly parses its UTF-8 `delivery-verification-plan@1` document, and derives provenance and digest itself.

One revision owns at most one IssuePublication, so one revision can never yield a duplicate Issue: a repeated `prepareIssuePublication()` returns the existing record, a `failed` record returns to `prepared` under its existing id for a new attempt, and an `unknown` record refuses preparation until human resolution. `markIssuePublicationStarted()` moves a `prepared` record to `publishing` before any external request crosses the side-effect boundary, and `completeIssuePublication()` or `failIssuePublication()` fails closed with `invalid-transition` unless the record is still `publishing`. A `not-started` failure lands in `failed`; an uncertain side effect lands in `unknown` and is never retried automatically. `resolveIssuePublication()` is human-authorized: `confirm-published` requires the verified exact Issue coordinates, `confirm-not-created` requires an explicit verification basis proving the Issue was never created, and both apply only to `unknown` or stalled `publishing` records.

`recordAcceptanceDecision` accepts only the human decision plus Delivery-owned change and verification binding ids. After validating that both bindings are bound Work for the same Packet, Delivery passes their Queue Work ids to an operation-local host resolver. It cross-checks the returned successful Attempt ids, completed claim, verification intent, and verdict against the Packet, checkpoint, plan, and Queue identities. For ordinary acceptance, Delivery then enumerates every claim and verdict evidence id itself and invokes a second host-only resolve-and-integrity-read capability for each one before checking Work/Attempt/check provenance. Neither callback is a browser DTO or durable record; only the resulting human `AcceptanceDecision` is persisted. Ordinary acceptance requires the exact matching passed, evidence-complete verdict, while a waiver remains explicit and human-authored.

## Understand the implementation

The package exports the abstract `Delivery` service and provider-independent request, error, and snapshot types. Providers report failures with the stable `DeliveryErrorCode` classifications: `unavailable`, `not-found`, `idempotency-conflict`, `invalid-reference`, `invalid-transition`, `conflict`, `approval-required`, and `acceptance-denied`. `snapshot()` returns only Delivery-owned records — revisions, Packets, bindings, acceptance decisions, Cases, requirement decisions, and publications — and deliberately excludes Queue lifecycle and writable Ready/Running/Review lanes. A local provider belongs in `dsh-delivery-local`; Consumer packages depend on this definition, never on that provider.

See the [Personal Delivery subsystem](../../../docs/subsystems/delivery.md) for package topology and the [MVP contract](../../../docs/specs/2026-08-29-personal-delivery-mvp.md) for fact ownership.

## Dev Note

No open package-local design decisions. Protocol changes must return to `dsh-delivery-protocol` rather than widening one provider or Consumer locally.

## Model Experience

### Host domain service

#### What the model sees

The model sees no content from `ctx.delivery`; this host-side domain service adds no prompt, tool, message, or model request.

#### Token effect

No tokens are added.

#### KV Cache effect

No request prefix is changed.

## Known Limitations and Deferred Work

- The first service contract covers one local-repository delivery flow and manual human decisions; planning, Batch/DAG orchestration, and multi-host leases are outside it.
- Completion claims and verification verdicts remain Queue results rather than duplicated Delivery records; host-only resolvers expose them for one Packet creation or decision operation.
