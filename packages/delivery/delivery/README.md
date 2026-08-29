---
description: "Personal Delivery domain records and idempotent writes for requirement adoption, bounded packets, Queue bindings, and human decisions."
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery

English | [中文](README.zh.md)

## Summary

`dsh-delivery` is the Service Definition for `ctx.delivery`. It owns immutable Contract revisions, Work Packets, Delivery-to-Queue dispatch bindings, and explicit human acceptance decisions. A provider allocates ids and timestamps, validates every durable Protocol V1 object, serializes writes, and returns stable snapshots. Queue Work and Attempt state, Git checkouts, evidence bytes, executor handles, verification execution, and UI lanes remain outside this service.

## Use this package

Consumers inject `delivery` and call one operation at the authority boundary they own. GitHub intake adopts a revision, the workbench creates a Packet and records a human decision, and the Queue bridge begins and binds a dispatch. Every create request carries a deterministic idempotency key: the same key and canonical input returns the prior record, while changed input fails.

```text
export const inject = ['delivery']

const packet = await ctx.delivery.createWorkPacket(request)
const binding = await ctx.delivery.beginDispatch(dispatch)
```

`adoptContractRevision` accepts a non-null `previousRevisionId` only when the previous and new `SourceRef` name the same provider, repository owner/name, and Issue number. A cross-Issue predecessor fails with the stable `invalid-reference` code; a different Issue starts a separate revision lineage.

`createWorkPacket` requires a `VerifiedRepositoryBase` minted from the Contract's selection rule by `ctx.repoWorkspace`; its ordinary request cannot supply a `VerificationPlan`. A contract-field source is derived inside the provider. For a git-blob source, Delivery gives the verified base, Contract-owned path, and a fixed byte limit to an operation-local host resolver, validates the returned `VerifiedRepositoryBlob`, strictly parses its UTF-8 `delivery-verification-plan@1` document, and derives provenance and digest itself.

`recordAcceptanceDecision` accepts only the human decision plus Delivery-owned change and verification binding ids. After validating that both bindings are bound Work for the same Packet, Delivery passes their Queue Work ids to an operation-local host resolver. It cross-checks the returned successful Attempt ids, completed claim, verification intent, and verdict against the Packet, checkpoint, plan, and Queue identities. For ordinary acceptance, Delivery then enumerates every claim and verdict evidence id itself and invokes a second host-only resolve-and-integrity-read capability for each one before checking Work/Attempt/check provenance. Neither callback is a browser DTO or durable record; only the resulting human `AcceptanceDecision` is persisted. Ordinary acceptance requires the exact matching passed, evidence-complete verdict, while a waiver remains explicit and human-authored.

## Understand the implementation

The package exports the abstract `Delivery` service and provider-independent request, error, and snapshot types. It contains no storage backend. `snapshot()` returns only Delivery-owned records and deliberately excludes Queue lifecycle and writable Ready/Running/Review lanes. A local provider belongs in `dsh-delivery-local`; Consumer packages depend on this definition, never on that provider.

See the [Personal Delivery subsystem](../../../docs/subsystems/delivery.md) for package topology, [Personal Delivery Protocol V1](../../../docs/specs/2026-08-29-delivery-protocol-v1.md) for durable meanings, and the [MVP contract](../../../docs/specs/2026-08-29-personal-delivery-mvp.md) for fact ownership.

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
