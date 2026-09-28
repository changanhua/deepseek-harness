---
description: "Project planning Board contracts with immutable revisions and CAS mutations."
kind: "package-library"
---

# @changanhua/dsh-planning

English | [中文](README.zh.md)

## Summary

Use this Definition to retain project plan cards, their immutable revisions, manual order, dependencies, review notes, and source provenance through a selected provider.

Proposal generations retain their trusted actor audit record and captured sources; accepting one never rewrites its prior generations.

## Use this package

Consumers use `ctx.planning` and pass trusted `PlanningAccess`. Inputs cannot provide authorization, observed source hashes, or durable receipts.

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

- This package supplies no Provider, Remote, tool, Delivery execution state, or memory acceptance authority.
