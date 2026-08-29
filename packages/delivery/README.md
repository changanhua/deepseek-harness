---
description: "Queue-independent Personal Delivery contracts, three host Service Definitions, test fakes, and fail-closed integration package boundaries."
kind: "package-group"
---

# packages/delivery

English | [中文](README.zh.md)

## Summary

The Delivery group provides a Queue-independent durable protocol, three abstract host Service Definitions, and contract-conformant test fakes for immutable requirements, bounded Packets, repository authority, evidence, and human decisions. The remaining packages reserve narrow provider and integration boundaries and fail closed where their concrete behavior is unavailable. This package set does not currently assemble a runnable Personal Delivery product.

## Table of Contents

- [Packages](#packages)
- [Product composition](#product-composition)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Only the three Service Definition packages declare Cordis context keys. A reserved provider can satisfy that key at composition time while still rejecting every operation; the status below therefore distinguishes package identity from working behavior.

| Package | Current surface | ctx key |
|---|---|---|
| [`delivery-protocol`](delivery-protocol/README.md) | Available Queue-independent durable types, strict schemas, canonical identities, readiness derivation, and fixtures | — |
| [`delivery`](delivery/README.md) | Available abstract domain operations for Contract revisions, derived Packets, dispatch bindings, and human decisions | `ctx.delivery` |
| [`repo-workspace`](repo-workspace/README.md) | Available abstract repository-base/blob proofs, revision/range inspection, and owned checkout leases | `ctx.repoWorkspace` |
| [`delivery-evidence`](delivery-evidence/README.md) | Available abstract immutable publication, id resolution, integrity-checked reads, and provenance binding | `ctx.deliveryEvidence` |
| [`delivery-testkit`](delivery-testkit/README.md) | Available concrete fakes and fresh Protocol fixtures for Consumer tests | — |
| [`delivery-local`](delivery-local/README.md) | Reserved Storage-backed provider; every read and write rejects as unavailable | provides `ctx.delivery` |
| [`repo-workspace-git-local`](repo-workspace-git-local/README.md) | Reserved Git/Subprocess provider and configuration; every repository operation rejects as unavailable | provides `ctx.repoWorkspace` |
| [`delivery-evidence-local`](delivery-evidence-local/README.md) | Reserved local evidence provider and configuration; save, resolve, and read reject as unavailable | provides `ctx.deliveryEvidence` |
| [`delivery-runner-codex`](delivery-runner-codex/README.md) | Typed factory fixed to the supported Codex app-server subpath; returned runs reject as unavailable | — |
| [`delivery-verifier`](delivery-verifier/README.md) | Typed fixed-plan verifier factory; returned runs reject as unavailable | — |
| [`delivery-github-intake`](delivery-github-intake/README.md) | Validates the exact public Issue URL grammar, then rejects snapshot import as unavailable | — |
| [`delivery-remote`](delivery-remote/README.md) | Reserves six typed `delivery` Remote methods; every method rejects as unavailable | — |
| [`delivery-task-queue`](delivery-task-queue/README.md) | Owns both WorkKind declarations and live pure admission helpers; plugin handler registration rejects as unavailable | — |

-----

<a id="product-composition"></a>
## Product composition

Two packages outside this group reserve the browser and composition identities without adding another Delivery authority. Neither makes the product runnable.

| Package | Current surface |
|---|---|
| [`client/ui-delivery`](../client/ui-delivery/README.md) | Empty node and browser plugins; registers no slot, Remote call, locale, or visible workbench |
| [`bundle/personal-delivery`](../bundle/personal-delivery/README.md) | Empty patch carrier; activates no provider, Queue bridge, Remote, or browser plugin |

-----

<a id="related-documentation"></a>
## Related documentation

- [Delivery subsystem](../../docs/subsystems/delivery.md) — public protocol objects, the three services, lifecycle ownership, readiness, and limitations.
- [Personal Delivery MVP](../../docs/specs/2026-08-29-personal-delivery-mvp.md) — the bounded user flow and acceptance scenarios.
- [Delivery Protocol V1](../../docs/specs/2026-08-29-delivery-protocol-v1.md) — the durable semantics and recovery rules that provider and integration implementations must preserve.
- [Personal Delivery architecture proposal](../../.agents/notes/proposed/architecture/2026-08-29-personal-delivery-above-queue.md) — why Delivery composes above Queue and why the packages remain separate.

-----

<a id="dev-note"></a>
## Dev Note

None.
