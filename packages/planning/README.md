---
description: "Project planning Boards with immutable revisions, controlled review, and optional Delivery handoff."
kind: "package-group"
---

# packages/planning

English | [中文](README.zh.md)

## Summary

Planning keeps project ideas, their evidence, revisions, order, dependencies, and reviews in one durable Board. It can hand one frozen revision to Delivery without granting Planning authority to approve, execute, verify, or accept that Delivery work.

## Packages

| Package | Responsibility |
| --- | --- |
| [`planning`](planning/README.md) | Defines `ctx.planning`, Board data, and CAS-fenced mutations. |
| [`planning-local`](planning-local/README.md) | Persists one Board per Workspace and captures trusted sources. |
| [`tool-planning`](tool-planning/README.md) | Gives the initiating Agent bounded Board tools. |
| [`planning-remote`](planning-remote/README.md) | Serves the authenticated browser projection and bounded commands. |
| [`planning-delivery-bridge`](planning-delivery-bridge/README.md) | Freezes one revision for a recoverable Delivery shaping Case. |

## Related documentation

- [Planning subsystem](../../docs/subsystems/planning.md) — lifecycle, authority, revisions, review, and Delivery boundary.
- [Delivery subsystem](../../docs/subsystems/delivery.md) — requirements, execution, verification, and acceptance after handoff.

## Dev Note

None.
