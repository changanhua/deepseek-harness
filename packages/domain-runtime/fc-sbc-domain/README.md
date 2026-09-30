---
description: "Compile supplied FC read observations into durable Reality artifacts and derive candidate Plans from an exact Reality reference."
kind: "package-reference"
---

# @changanhua/dsh-fc-sbc-domain

English | [中文](README.zh.md)

## Summary

Compile supplied FC read observations into durable Reality artifacts and derive candidate Plans from an exact Reality reference. Stored artifacts survive owner restart and reads are detached. Partial observations, incomplete search and missing chemistry or quote evidence remain explicit blockers. No FC login, browser action or business write is performed.

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

The service requires `storageDomain` and `domainArtifacts`. It owns Storage Domain `fc_sbc_artifacts` version 1. Capacity failure rejects publication; no artifact eviction or live browser collection is implicit.

| Field | Default | Meaning |
|---|---|---|
| `maxArtifacts` | `256` | Maximum retained artifacts |
| `maxArtifactBytes` | `1048576` | Complete serialized artifact byte cap |
| `maxCards` | `2000` | Admitted observation card capacity |
| `maxChallenges` | `8` | Admitted challenge capacity |
| `maxCrossChallengeCombinations` | `10000` | Bounded cross-challenge candidate combinations |

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The compiler projects allowlisted existing read/probe fields, reuses the extension inventory/page/solver/quote helpers and publishes through one FC-owned serialized Storage Domain write. Canonical SHA-256 identities, request receipts and canonical-input receipts preserve immutable replay; reused request IDs with different input reject. Package-local bundling includes the existing pure algorithms without copying their source into a second owner. See [compiler](src/compiler.ts), [store](src/store.ts) and [typed bridge](src/algorithms.ts).

No runtime invariant companion is published; the Storage Domain value is the sole durable authority, and cold reads validate its artifact digests and receipt relations directly.

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

- **Evidence admission, not attestation** — capture validates supplied read/probe structure and coverage consistency; it does not authenticate a live Browser receipt or prove that model-supplied facts occurred. These artifacts alone cannot authorize future Safety execution.

- **Observation only** — callers supply existing observations and provenance; this package never logs in or refreshes a page. Unknown expiry means unknown freshness, and status evaluates expiry without rewriting historical artifacts.
- **Partial group evidence** — existing main-read can filter challenges without proving complete group traversal, so group coverage remains partial or unknown even when inventory is complete.
- **Candidate planning only** — live native chemistry, real quotes, approval and execution are absent. Bounded searches and missing evidence cannot produce ready-for-approval.
- **Build ownership** — pure FC algorithms remain in extension source and must be bundled into the Host artifact; public declarations and runtime cannot depend on a deployed extension checkout.

<a id="dev-note"></a>
### Dev Note

None.
