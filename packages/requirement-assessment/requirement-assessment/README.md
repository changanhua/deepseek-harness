---
description: "Defines immutable Quick Review records and the trusted Host assessment service."
kind: "package-library"
---

# @changanhua/dsh-requirement-assessment

English | [中文](README.zh.md)

## Summary

Defines immutable Quick Review records and the trusted Host assessment service.

## Use this package

Consumers pass Host-derived Workspace and actor authority. Strict schemas require eight distinct dimensions, three distinct stress tests, all three allocation owners, and one of five advisory routes. No total score or execution command is accepted. Completed records retain the exact input, baseline, evaluator identity and raw response; superseding creates a new record. Resource references remain opaque and never authorize retrieval. `reserve` distinguishes a newly acquired evaluation, an unresolved request, and an already completed assessment. `get` and `snapshot` return detached data.

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

- This definition does not resolve references or calculate current Planning drift. The review consumer owns authorized subject capture and read-time comparison. Unknown baseline identities remain explicit strings rather than fabricated versions.
