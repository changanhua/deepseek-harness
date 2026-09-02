---
description: "Queue-independent Personal Delivery contracts, local providers, Queue integration, and browser workbench packages."
kind: "package-group"
---

# packages/delivery

English | [中文](README.zh.md)

## Summary

The Delivery group provides a Queue-independent durable protocol, three host Service Definitions, local providers, governed Codex execution, independent verification, Queue integration, GitHub Issue intake, and a browser Remote for immutable requirements, bounded Packets, repository authority, evidence, and human decisions. The Personal Delivery bundle composes these packages into the local Windows product.

## Table of Contents

- [Packages](#packages)
- [Product composition](#product-composition)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Only the three Service Definition packages declare Cordis context keys. Concrete providers satisfy those keys; Consumers keep Queue, Git, evidence, browser, and executor authority in their owning packages.

| Package | Current surface | ctx key |
|---|---|---|
| [`delivery-protocol`](delivery-protocol/README.md) | Available Queue-independent durable types, strict schemas, canonical identities, readiness derivation, and fixtures | — |
| [`delivery`](delivery/README.md) | Available abstract domain operations for Contract revisions, derived Packets, dispatch bindings, and human decisions | `ctx.delivery` |
| [`repo-workspace`](repo-workspace/README.md) | Available abstract repository-base/blob proofs, revision/range inspection, and owned checkout leases | `ctx.repoWorkspace` |
| [`delivery-evidence`](delivery-evidence/README.md) | Available abstract immutable publication, id resolution, integrity-checked reads, and provenance binding | `ctx.deliveryEvidence` |
| [`delivery-testkit`](delivery-testkit/README.md) | Available concrete fakes and fresh Protocol fixtures for Consumer tests | — |
| [`delivery-local`](delivery-local/README.md) | Storage Domain-backed immutable records, projections, bindings, and decisions | provides `ctx.delivery` |
| [`repo-workspace-git-local`](repo-workspace-git-local/README.md) | Git/Subprocess repository proofs and Attempt-owned change/verification worktrees | provides `ctx.repoWorkspace` |
| [`delivery-evidence-local`](delivery-evidence-local/README.md) | Local content-addressed publication and integrity-checked evidence reads | provides `ctx.deliveryEvidence` |
| [`delivery-runner-codex`](delivery-runner-codex/README.md) | Governed Codex app-server change runner with checkpoint and evidence production | — |
| [`delivery-verifier`](delivery-verifier/README.md) | Independent fixed-argv verifier with path and evidence findings | — |
| [`delivery-github-intake`](delivery-github-intake/README.md) | Strict Work Brief parsing plus explicit GitHub Issue-to-Case imports | — |
| [`delivery-github-publisher`](delivery-github-publisher/README.md) | Host-only Issue rendering, publication, uncertainty, and GET reconciliation | — |
| [`delivery-remote`](delivery-remote/README.md) | Browser-safe projection and explicit import, publish, run, verify, evidence, and decision operations | `remote.delivery` |
| [`delivery-task-queue`](delivery-task-queue/README.md) | Owns both WorkKinds, durable cross-store admission, recovery, and handler registration | — |

-----

<a id="product-composition"></a>
## Product composition

Two packages outside this group render and compose the product without adding another Delivery authority.

| Package | Current surface |
|---|---|
| [`client/ui-delivery`](../client/ui-delivery/README.md) | Five-lane Delivery workbench over the browser-safe Remote projection |
| [`bundle/personal-delivery`](../bundle/personal-delivery/README.md) | Local Windows composition for the complete host, Queue, Remote, and UI chain |

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
