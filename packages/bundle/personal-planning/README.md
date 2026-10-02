---
description: "Optional Personal Planning composition for durable project plans in DSH."
kind: "package-bundle"
---

# @changanhua/dsh-personal-planning

English | [中文](README.zh.md)

## Summary

This optional patch composes local Planning persistence, Agent-scoped planning tools, the browser Planning Remote, and the Planning UI over the existing base and Web bundles. It does not change any default profile.

## Composition

The base layer continues to provide Storage Domain, Workspace Registry, Session Query, the skill registry, model runtime, and the Web shell. This patch adds a separate `planning-skills` filesystem provider with only this Bundle's packaged `skills/` root, then `planning-local` with its ownership lock below `DSH_HOME/storages/planning-ownership`, `tool-planning`, `planning-remote`, and `ui-planning`. The optional `memory.patch.yml` and `knowledge.patch.yml` layers add source-backed memory candidates and Knowledge source snapshots for planning lessons.

## Investment review opt-in

The packaged `investment-review.patch.yml` adds the Assessment provider, bounded Quick Review runner, Remote, and UI after this bundle. Apply it as an explicit profile patch, not a default bundle layer. Set `DSH_RIR_PROVIDER` and `DSH_RIR_MODEL` to an already configured model route; missing values prevent activation instead of guessing a provider. Set `DSH_RIR_BASELINE` only to a known build/commit identity, otherwise it remains `unknown`. No credentials are stored in this patch.

The sample policy allows 256 KiB per serialized request and streamed response, up to 12,000 output tokens, and 120 seconds per review. These are editable deployment bounds, not a quality guarantee or domain invariant. No model call occurs at boot. In the UI, use Investment review for a manual subject or the Plan / Focus action. A real review incurs the configured model's usage; history reads do not. See the [WP1 specification](../../../docs/specs/2026-10-01-requirement-investment-review-wp1.md) for the three required quality cases.

## Invariant policy

No invariant companion is published because the bundle composes existing owners and has no independent runtime state.

## Model Experience

### Planning guidance and tools

#### What the model sees

`tool-planning` adds the bounded `planning_list`, `planning_read`, and `planning_update` schemas and guidance. `planning_list` can filter the current project by keywords; the bundled `planning-maintenance` Skill directs the Agent to read stable identities and ask the user to resolve ambiguous matches before changing an item. The Skill appears in an Agent preset that mounts `tool-skill`; the UI and Remote add no model context.

#### Token effect

The Planning guidance, tool schemas, and selected Skill text add prompt tokens when their consumers are composed. Result tokens remain bounded by `tool-planning`.

#### KV Cache effect

The guidance and schemas remain prefix-stable while the composed Planning tools and Skill catalog are unchanged.

## Known Limitations and Deferred Work

- Apply `delivery.patch.yml` only with the separate personal-delivery bundle; its shaping Case does not approve requirements, run Queue work, verify changes, or accept an outcome.
- Memory capture remains a candidate until a human accepts it, and Knowledge source capture preserves a readable snapshot without generating, reviewing, adopting, or publishing an entry.
- Planning lanes express personal arrangement only; Delivery execution, verified source capture beyond existing Host services, and browser acceptance remain separately composed capabilities.
