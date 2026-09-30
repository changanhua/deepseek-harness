---
description: "Project planning Board contracts with immutable revisions and CAS mutations."
kind: "package-library"
---

# @changanhua/dsh-planning

English | [中文](README.zh.md)

## Summary

Use this Definition to retain project plan cards, their immutable revisions, manual order, dependencies, review notes, and source provenance through a selected provider. Consumers can derive a deterministic evolution graph from any detached Board snapshot without a model call.

Proposal generations retain their trusted actor audit record and captured sources; accepting one never rewrites its prior generations.

## Use this package

Consumers use `ctx.planning` and pass trusted `PlanningAccess`. Inputs cannot provide authorization, observed source hashes, or durable receipts. Browser-safe consumers import the pure `@changanhua/dsh-planning/evolution` fold; that entry carries no Planning service or provider identity.

Optional `stateEntries` belong to the immutable revision, with stable entry ids for objective, accepted, and open content. Empty legacy fields remain empty; reads do not synthesize entries. `buildPlanningContext(board, subject)` resolves a Plan or optional Focus and returns current entries, legacy content, and opaque resource links without reading external transcripts. Resource kinds are extensible strings.

Focus changes and resource links share the Board transaction. A generation may carry a delta with subject, base revision, operations, origin, and evidence references. Exact-generation adoption checks the subject and base before applying the whole group and publishing a new revision. Failure leaves the entire Board unchanged. Completing a Focus does not complete its Plan or authorize Delivery or browser actions.

## Invariant policy

No invariant companion is published because the package defines contracts and schemas without an independently observable runtime projection.

## Model Experience

### No direct model context

#### What the model sees

Nothing directly. `ctx.planning` registers no prompt section, tool, or model resource.

#### Token effect

This Definition adds no direct tokens.

#### KV Cache effect

This Definition adds no direct KV-cache effect.

## Known Limitations and Deferred Work

- The evolution projection reconstructs retained object lineage and current relationships. It does not recreate historical lane positions or dependency values that the Board events do not retain.
- This package supplies no Provider, Remote, tool, Delivery execution state, or memory acceptance authority.
