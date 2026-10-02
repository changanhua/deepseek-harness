---
description: "Single-Host Candidate persistence and Human-only pending Planning promotion."
kind: "package-service"
---

# @changanhua/dsh-initiative-local

English | [中文](README.zh.md)

## Summary

Single-Host Candidate persistence and Human-only pending Planning promotion.

## Use this package

Configure ownershipRoot and stable operatorId explicitly; maxWorkspaceBytes bounds the complete Workspace record, including history, receipts and reserved promotion settlement. maxCandidateViewBytes defaults to 48 KiB and rejects writes whose complete single-revision projection could not fit; keep entry output limits above this bound. Storage Domain owns atomic publication; the local provider holds an OS-released ownership lock and serializes commits. It rechecks live Session, Agent, Workspace and exact active Human command or open Agent turn. A flush error aborts persistence. Origin references remain unverified even when the flush succeeds.

See [setup and commands](../README.md) and the [Initiative subsystem](../../../docs/subsystems/initiative.md).

## Invariant policy

No invariant companion is published because all exposed Candidate facts derive from one schema-validated atomic record, with no independent projection to reconcile.

## Model Experience

### No direct model context

#### What the model sees

Nothing directly; `ctx.initiative` adds no model prompt or tool through this package.

#### Token effect

No direct token effect.

#### KV Cache effect

No direct KV-cache effect.

## Known Limitations and Deferred Work

- Prepared promotion freezes the Candidate until its original key recovers. Only Planning propose is called: the aggregate Board version changes but canonical items and Delivery state do not. Real RIR is unavailable. No automatic external-reference resolution, secret detection or investigation execution is supplied.
