---
description: "Local durable Personal Delivery records for maintainers composing the delivery profile."
kind: "package-reference"
---

# @changanhua/dsh-delivery-local

English | [中文](README.zh.md)

## Summary

`dsh-delivery-local` is the reserved local provider for `ctx.delivery`. Its storage boundary covers durable Delivery Cases, immutable Contract revisions, human requirement decisions, Issue publications, Work Packets, Queue dispatch bindings, and human acceptance decisions through Storage Domain while keeping Queue lifecycle and evidence bytes outside this store.

The provider opens the private `personal_delivery` domain at format version 2 through `storageDomain`, with one table per record family. Storage Domain has no data migration: a medium stamped with a different format version rejects at open with `version-mismatch`, so a version-1 root fails closed before any write and its bytes stay untouched; version-2 acceptance uses a separate DSH home. Every write is idempotent and durable before it returns, and synchronous reads rebuild from schema-validated records when the host restarts.

## Configuration and composition

Mount Storage and Storage Domain first, then load this provider. The provider deliberately has no Loader configuration: the private domain identity is a format fact, while backend routing belongs to Storage Domain composition.

## Ownership boundary

The provider owns only Delivery records and a restart-stable projection. It does not own Queue Work or Attempts, Git commits, executor processes, evidence bytes, verification results, or mutable UI lanes.

Case creation commits the Case and its root revision atomically, and Case revision moves the head through an expected-head compare-and-set inside the serialized write boundary: a stale head fails closed with `conflict`, and a replayed revision whose child is already durable finishes or refuses the head move instead of branching the Case. Packet creation and publication preparation share one approval boundary — the revision must belong to the Case, be ready, and carry the one `approved` requirement decision, or the write fails with `approval-required`. Publication transitions run inside the domain write chain, so the `prepared → publishing → published/failed/unknown` lifecycle, the failed-record reset to `prepared` under its existing id, and the human-only resolution of `unknown` records serialize against concurrent attempts. Packet creation resolves the Contract-owned verification source through the optional trusted Git-blob resolver, while acceptance decision recording resolves the exact bound Queue candidate and integrity-reads every referenced evidence object before commit. A repeated idempotency key returns the original record only when its operation and complete request match.

## Dev Note

Keep the synchronous read projection aligned with serialized durable writes; do not add a second Attempt or Queue lifecycle store.

## Model Experience

### No direct model context

#### What the model sees

Nothing directly. The provider only implements `ctx.delivery` host-side records and does not register prompts, tools, or resources.

#### Token effect

Zero direct tokens; the package never serializes Delivery records into model input.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **One host process owns the open domain** — Storage Domain change notifications are in-process; another process does not update this provider's synchronous projection.
- **Immutable history has no automatic retention** — this provider never deletes Cases, Contract revisions, requirement decisions, publications, Packets, bindings, or decisions, so the selected backend must accommodate their growth.
