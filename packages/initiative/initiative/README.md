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
