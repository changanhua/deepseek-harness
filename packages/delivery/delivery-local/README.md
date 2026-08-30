---
description: "Local durable Personal Delivery records for maintainers composing the delivery profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-local

English | [中文](README.zh.md)

## Summary

`dsh-delivery-local` is the reserved local provider for `ctx.delivery`. Its storage boundary covers immutable Contract revisions, Work Packets, Queue dispatch bindings, and human acceptance decisions through Storage Domain while keeping Queue lifecycle and evidence bytes outside this store.

The provider opens the private `personal_delivery` format through `storageDomain`. Every write is idempotent and durable before it returns, and synchronous reads rebuild from schema-validated records when the host restarts.

## Configuration and composition

Mount Storage and Storage Domain first, then load this provider. The provider deliberately has no Loader configuration: the private domain identity is a format fact, while backend routing belongs to Storage Domain composition.

## Ownership boundary

The provider owns only Delivery records and a restart-stable projection. It does not own Queue Work or Attempts, Git commits, executor processes, evidence bytes, verification results, or mutable UI lanes.

Contract adoption validates source snapshots and revision lineage. Packet creation resolves the Contract-owned verification source through the optional trusted Git-blob resolver, while decision recording resolves the exact bound Queue candidate and integrity-reads every referenced evidence object before commit. A repeated idempotency key returns the original record only when its operation and complete request match.

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
- **Immutable history has no automatic retention** — this provider never deletes Contract revisions, Packets, bindings, or decisions, so the selected backend must accommodate their growth.
