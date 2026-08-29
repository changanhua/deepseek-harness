---
description: "Personal Delivery add-on composition for users running the complete Issue-to-acceptance workflow in DSH."
kind: "package-bundle"
---

# @deepseek-ai/dsh-personal-delivery

English | [中文](README.zh.md)

## Summary

`dsh-personal-delivery` is the add-on bundle carrier for the Personal Delivery vertical slice: GitHub Issue intake, durable Delivery records, isolated Git worktrees, governed Codex execution, immutable evidence, independent verification, Queue bridging, Remote projection, UI, and human acceptance.

The published patch is deliberately empty. This is an explicit unavailable state rather than a runnable profile; no provider, bridge, Remote, or UI row is activated without complete composition and end-to-end proof.

## Composition

The bundle boundary is a patch layer over the existing base and Web application bundles. Its manifest carries the Personal Delivery runtime packages, while the empty `cordis.patch.yml` activates none of them.

The bundle contains composition only. It does not implement a scheduler, duplicate Queue state, parse Issues, execute Git, verify evidence, or accept a delivery.

## Dev Note

Keep this package a static patch carrier. Runtime behavior belongs in the independently owned Delivery plugins.

## Model Experience

### No direct model context

#### What the model sees

Nothing directly. The `cordis.patch.yml` file is intentionally empty and registers no prompts, tools, or resources.

#### Token effect

Zero direct tokens; this package only reserves an empty composition boundary.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **The bundle is intentionally unavailable** — provider, bridge, Remote, and UI rows plus complete acceptance scenarios are required before any profile can name this bundle.
