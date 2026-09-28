---
description: "Host-only bridge that freezes a planning revision and recovers its Delivery Case handoff."
kind: "package-reference"
---

# @changanhua/dsh-planning-delivery-bridge

English | [中文](README.zh.md)

## Summary

Use this Host service to turn one exact planning revision into one recoverable Delivery shaping Case. It selects a configured Workspace-to-repository route, freezes the revision source, and retains a stable mapping digest and idempotency key before creating or linking the Delivery Case.

## Configuration

`routes` maps canonical Workspace paths to repository ids. `operatorId` identifies the fixed Delivery origin actor. A Workspace without an exact route rejects handoff.

## Behavior

The bridge prepares, creates, and links in recoverable steps. A retry reconstructs the Delivery request from the frozen handoff and uses the same stable key. The mapped `allowedScope` retains agreed product scope only: a later Delivery packet owns actual path authorization through `allowedPaths`. The bridge leaves `baseSelectionRule` and `verificationSource` null. The Host checks current direct-user evidence and exact revision identity; it does not use NLP to decide whether the user intended execution. Model calls reach this service only through the conditional `tool-planning` handoff path.

A handoff creates only a shaping Case. Delivery remains the owner of requirement approval, dispatch, verification, and human acceptance.

## Invariant policy

No invariant companion is published because recovery is owned by Planning handoff records and Delivery receipts, with no bridge-owned state copy.

## Dev Note

None.

## Model Experience

### No direct model context

#### What the model sees

This package registers no prompt or tool. The optional `tool-planning` consumer owns model guidance and result rendering.

#### Token effect

The bridge adds no direct tokens.

#### KV Cache effect

The bridge adds no direct KV-cache effect.

## Known Limitations and Deferred Work

- Delivery readiness can reject the mapped Case because planning scope does not supply Delivery execution boundaries.
