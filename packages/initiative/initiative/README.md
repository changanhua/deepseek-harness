---
description: "Shared Candidate service definition and strict durable schemas."
kind: "package-library"
---

# @changanhua/dsh-initiative

English | [中文](README.zh.md)

## Summary

Shared Candidate service definition and strict durable schemas.

## Use this package

Consumers call ctx.initiative with the exact live Agent. Human calls additionally carry an active command identity; no input can supply actor, Workspace or verification authority. CandidateId is a branded cross-boundary identity. Read projections use a separate CandidateSummary type, the selected revision, its investigation, revision count and latest disposition; request earlier versions explicitly.

See [setup and commands](../README.md) and the [Initiative subsystem](../../../docs/subsystems/initiative.md).

Read pages carry `snapshotDigest` for every Candidate record in the Workspace, regardless of filters or pagination; external RIR relations are excluded. Propose and investigate optionally carry `expectedSnapshotDigest`, checked inside the owner queue after durable receipt replay. A trusted Host may pass `invocation.validateIntake` to reject a new intake commit after validating another owner; the callback cannot grant authority and must not reenter Initiative. Model JSON cannot supply that callback.

## Invariant policy

No invariant companion is published because it owns definitions and schemas, not a runtime projection.

## Model Experience

### No direct model context

#### What the model sees

Nothing directly; `ctx.initiative` adds no model prompt or tool through this package.

#### Token effect

No direct token effect.

#### KV Cache effect

No direct KV-cache effect.

## Known Limitations and Deferred Work

- The Definition has no provider or evaluator. Candidate assessment subjects retain an exact revision and content digest; opaque source references do not prove their contents.
