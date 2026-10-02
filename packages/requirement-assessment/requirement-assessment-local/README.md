---
description: "Persists bounded immutable assessment histories with the existing Storage Domain service."
kind: "package-reference"
---

# @changanhua/dsh-requirement-assessment-local

English | [中文](README.zh.md)

## Summary

Persists bounded immutable assessment histories with the existing Storage Domain service.

## Use this package

Mount with `storageDomain` and `workspaceRegistry`. Set `ownershipRoot` to the same absolute local directory for every Host sharing the storage namespace; `maxWorkspaceBytes` defaults to 4 MiB and bounds the complete retained record, including reservations and metadata. An OS-released exclusive ownership lock protects against competing Hosts. Per-provider serialization commits an assessment and removes its reservation in one Workspace record. The provider rechecks authorization and Workspace availability before writes and returned reads. A rejected write publishes no partial result. An identical completed input replays the original assessment; conflicting digests or changed completed records reject. Reservation recovery matches the request id and digest before another model call. Superseding must retain the same Workspace and subject. Caller mutations cannot rewrite committed input, and cancellation before persistence prevents publication.

## Invariant policy

No invariant companion is published: the persisted record is the sole authoritative observation, and this package maintains no independently diverging projection. Strict validation and atomic writes enforce the owned relation at its commit point.

## Model Experience

### No direct model context

#### What the model sees

Nothing directly. `ctx.requirementAssessment` registers no model prompt or tool; the review consumer chooses assessment inputs.

#### Token effect

Zero direct tokens. Retaining assessment history does not inject it into a model request.

#### KV Cache effect

No direct cache effect. This package neither creates nor rewrites model requests.

## Known Limitations and Deferred Work

- This provider is single-Host, with at most 200 completed records and 200 unresolved reservations per Workspace. An unresolved reservation survives crashes and prevents automatic duplicate evaluator calls. Recovery requires an explicitly new request id after reviewing the uncertain operation. There is no automatic pruning, distributed writer protocol, or archival operation. The ownership directory must identify the actual storage namespace; a different directory cannot protect the same backend.
