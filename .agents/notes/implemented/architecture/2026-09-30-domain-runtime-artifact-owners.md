# Agent Note: Domain-owned immutable Reality and Plan artifacts

Status: implemented

English | [中文](2026-09-30-domain-runtime-artifact-owners.zh.md)

## Problem

Existing FC browser helpers can observe inventory and compute candidates, but downstream consumers lack a durable, exact reference that preserves what was observed and how incomplete the result remains. Putting every domain payload into Planning or a central artifact store would transfer persistence ownership away from the domain that validates it.

## Decision

The domain-runtime family separates provider-routed metadata/reads, FC-owned Reality/Plan persistence and typed tool consumption. The generic registry understands identity, bounds and provider lifetime, not FC fields. FC stores immutable artifacts and idempotency receipts through its Storage Domain; a failed publication exposes no new artifact.

## Algorithm ownership and evidence

Existing extension JavaScript remains the algorithm source. A typed internal bridge and package-local bundling reuse pure modules without a second algorithm copy or runtime app-path dependency. The readiness observation facts are shared separately from the existing approval-preview/execution-dry-run orchestration. Native chemistry remains a live page-service operation and is not called by offline Phase A; absent evaluation stays provisional.

Inventory and group coverage are independent. Explicit complete inventory traversal does not prove that a filtered main-read contains every challenge. Group coverage therefore stays partial/unknown, and Plan lineage keeps the exact Reality digest rather than silently refreshing its source.

## Alternatives considered

**Browser or Planning ownership.** Browser owns transport/page authority and Planning owns canonical intent state. Neither should become the cross-domain payload owner; the new narrow family makes these dependencies explicit.

**A central artifact payload database.** It would need every domain schema and retention policy, despite the only current adapter being FC. Provider routing retains the useful common identity contract without moving payload ownership.

**Copying algorithms or calling the full readiness pipeline.** A copied solver drifts; the full pipeline brings approval and execution concepts into a read/plan-only capability. Source bundling and extracted pure readiness facts preserve reuse with a smaller reachable behavior set.

## Consequences

Consumers get stable refs, detached reads, restart-safe FC artifacts and explicit incomplete results without a generic workflow language. They must supply observations, respect capacity failures and treat all Phase A plans as candidates rather than approval. No live quote acquisition, FC write, Planning mutation, Safety execution or whole-group completeness claim is introduced.

The build must preserve the extension algorithms inside the published Host artifact while keeping app paths out of public declarations. The owning [tests](../../../../packages/domain-runtime/fc-sbc-domain/tests) cover the package boundary and persisted behavior; [registry tests](../../../../packages/domain-runtime/domain-runtime/tests) own unrelated-provider and lifecycle regressions. Full live FC behavior is deliberately not exercised.

Supplied observations and source references are caller claims, not authenticated Browser receipts. The owner validates and preserves admitted content; a future trusted capture transport and Safety authority boundary remain separate work.
