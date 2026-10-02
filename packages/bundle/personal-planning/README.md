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

The optional `initiative.patch.yml` adds shared Human/Agent Candidate intake and explicit Human-only promotion to pending Planning Proposals. See [Candidate setup and commands](../../initiative/README.md).

## Investment review opt-in

The packaged `investment-review.patch.yml` adds the Assessment provider, bounded Quick Review runner, Remote, and UI after this bundle. Apply it as an explicit profile patch, not a default bundle layer. Set `DSH_RIR_PROVIDER` and `DSH_RIR_MODEL` to an already configured model route; missing values prevent activation instead of guessing a provider. Set `DSH_RIR_BASELINE` only to a known build/commit identity, otherwise it remains `unknown`. No credentials are stored in this patch.

The sample policy allows 256 KiB per serialized request and streamed response, up to 12,000 output tokens, and 120 seconds per review. These are editable deployment bounds, not a quality guarantee or domain invariant. No model call occurs at boot. In the UI, use Investment review for a manual subject or the Plan / Focus action. A real review incurs the configured model's usage; history reads do not. See the [WP1 specification](../../../docs/specs/2026-10-01-requirement-investment-review-wp1.md) for the three required quality cases.
