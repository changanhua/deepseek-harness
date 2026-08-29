---
description: "Local durable Personal Delivery records for maintainers composing the delivery profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-delivery-local

English | [中文](README.zh.md)

## Summary

`dsh-delivery-local` is the reserved local provider for `ctx.delivery`. Its storage boundary covers immutable Contract revisions, Work Packets, Queue dispatch bindings, and human acceptance decisions through Storage Domain while keeping Queue lifecycle and evidence bytes outside this store.

The provider name and `storageDomain` injection are stable composition contracts. Every operation currently fails with an explicit unavailable error; the package does not claim persistence until durable storage and restart behavior are implemented and tested.

## Configuration and composition

Mount Storage and Storage Domain first, then load this provider. The provider deliberately has no Loader configuration: the private domain identity is a format fact, while backend routing belongs to Storage Domain composition.

## Ownership boundary

The provider owns only Delivery records and a restart-stable projection. It does not own Queue Work or Attempts, Git commits, executor processes, evidence bytes, verification results, or mutable UI lanes.

Even as an unavailable scaffold, every concrete public method preserves the Service Definition's operation-local authority. Packet creation accepts the optional trusted verification-source resolver, while decision recording requires the exact Queue-candidate resolver and integrity-reading evidence resolver. The provider neither narrows nor silently ignores these callbacks.

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

- **Persistence is unavailable** — all methods fail closed with the stable `unavailable` classification until idempotent Storage Domain persistence and restart recovery are implemented and tested.
