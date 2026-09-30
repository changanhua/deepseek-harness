---
description: "Discover domain providers and read immutable artifacts by reference."
kind: "package-reference"
---

# @changanhua/dsh-domain-runtime

English | [中文](README.zh.md)

## Summary

Discover domain providers and read immutable artifacts by reference. Metadata-only reads avoid loading payloads when the provider supports that separation. Unknown domains, unsupported kinds and mismatched identities reject instead of routing to a fallback. Providers retain payload persistence and business semantics.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the plugin in an opt-in Cordis composition; it is not a profile bundle and is absent from shipped defaults. The [Loader composition fixture](../fc-sbc-domain/tests/fixtures/cordis.yml) owns the complete storage/service/tool wiring.

There are no package-specific configuration fields. Register one provider per domain through `ctx.domainArtifacts`; the contributing fiber owns its lifetime. Duplicate registrations reject; disposal removes routing and invalidates in-flight reads from that registration.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The registry validates the complete metadata envelope and exact requested identity, then snapshots JSON payloads without interpreting their fields. It retains provider registrations, not domain artifacts. Schema parsing and detached reads prevent callers from changing owner state. See [registry](src/index.ts) and [metadata schemas](src/schema.ts).

No runtime invariant companion is published; registrations are process-local and reads validate the provider boundary rather than comparing separately owned durable observations.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Group map](../README.md) — package responsibilities.
- [Subsystem contract](../../../docs/subsystems/domain-runtime.md) — metadata and lineage.
- [Ownership decision](../../../.agents/notes/implemented/architecture/2026-09-30-domain-runtime-artifact-owners.md) — rejected alternatives and trade-offs.

<a id="model-experience"></a>
## Model Experience

### Mounted package context

#### What the model sees

This package injects no model prompt or tool schema. The `tool-fc-sbc-domain` consumer decides whether artifact references and summaries enter a model request.

#### Token effect

Zero direct model tokens; consumer rendering is outside this package.

#### KV Cache effect

The package does not replace request-prefix content or start an independent model request; cache reuse follows the consuming prompt/tool path.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No storage or execution** — providers own payload retention, durability and domain actions; the registry has no fallback provider.
- **Bounded metadata** — one header or descriptor is limited to 32,768 UTF-8 bytes; lineage exposes direct parents rather than recursive graph traversal.

<a id="dev-note"></a>
### Dev Note

None.
