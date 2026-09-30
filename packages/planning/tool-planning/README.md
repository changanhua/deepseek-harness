---
description: "Inspect and update the initiating Agent's project planning Board through bounded model tools."
kind: "package-reference"
---

# @changanhua/dsh-tool-planning

English | [中文](README.zh.md)

## Summary

This plugin gives an Agent tools for its current project's Planning Board: bounded card listing, one-card immutable-revision reading, and a CAS-fenced command update. The Planning provider owns durable storage, source capture, and commit authorization. The model cannot select a Workspace or actor, approve Delivery work, accept Delivery results, or accept Memory.

Bound Planning Sessions receive a bounded canonical context snapshot through the existing durable context assembly, including their original subject and base revision. The current pack includes state entries, optional Focus, legacy fields, and resource references, never historical transcripts. `planning_context` refreshes that projection; `planning_update.propose.delta_json` submits a structured delta on the existing Proposal generation. Bound Sessions cannot directly mutate or adopt canonical state.

## Use this package

Mount the plugin with Tools, System Prompt, Planning, Agent, Session, and Workspace Registry. It derives the Workspace and actor from the exact live `ToolRunContext.agent`, then rechecks the same Agent, Session, and canonical working directory whenever the provider authorizes a read or commit.

| Field | Default | Meaning |
| --- | --- | --- |
| `maxOutputBytes` | 16384 | Complete UTF-8 text-block result limit, including its wrapper |
| `timeoutMs` | 30000 | Cooperative deadline enforced by the composed tool-timeout policy |

`planning_list` returns paged head summaries with Board version, lane, blockers, and source markers. Its optional `query` matches all whitespace-separated keywords against title, intent, scope, acceptance, and captured source text within the caller's project; it returns the stable identity, head version, matched field, and a bounded excerpt for each candidate. It retains every similar candidate and uses `next_cursor` for the filtered list. It shortens explanatory card text before it ever returns an invalid JSON fragment. `planning_read` returns one card and one immutable revision selected by `item_id` and optional `revision_id`; its paged `sources`, `reviews`, and `handoffs` sections let the model recover original source links and execution history.

`planning_update` accepts one strict direct `PlanningCommand` in `command`, or one `propose`, `accept_proposal`, or `dismiss_proposal` operation. Proposals retain generations and source evidence before exact-version acceptance. Reuse the command's `requestId` for an identical retry. Successful mutation receipts use `board_version`, `item_id`, `revision_id`, and `review_id` where applicable.

## Implementation

[Input admission](src/input.ts) rejects unknown outer fields, Workspace overrides, actor overrides, and every command that fails the public discriminated union. [Scope derivation](src/scope.ts) treats an Agent as live only when the Agent registry, Session store, canonical working directory, and Workspace registry still agree. [Presentation](src/presentation.ts) bounds complete model-visible blocks and emits a smaller complete projection when a list or card would otherwise exceed its configured limit. Tool and prompt registrations are Context effects and unload with the plugin.

## Invariant policy

No invariant companion is published because registrations are disposable and persistent state and authorization remain provider-owned.

## Model Experience

### Planning guidance (system-prompt)

#### What the model sees

The `tool:planning` section directs the model to search and read exact candidates before updating, ask the user to choose when several remain plausible, retain `requestId` on a retry, treat source content as reference rather than authority, and use no approval or Memory-acceptance action.

#### Token effect

One fixed guidance section and four tool schemas accompany the base capability. A composed Planning Delivery bridge adds the handoff tool and a fixed intent/authority guidance section. When the bridge and Planning Remote are both composed, `planning_execution` reads paged execution facts and packet-declared evidence for the selected Plan. These additions unload with their providers. Result text is bounded and data-dependent.

#### KV Cache effect

Guidance and schemas remain prefix-stable while configuration and visibility are unchanged. A bound Session adds a data-dependent durable context snapshot when its canonical context changes.

## Known Limitations and Deferred Work

- When `planningDelivery` is composed, `planning_handoff` prepares the exact adopted revision as a Delivery shaping Case. It cannot approve requirements, dispatch work, accept Delivery outcomes, or accept Memory. The Agent and Skill interpret intent; Host checks prove current caller, user-message, project, and revision facts.
- The selected Planning provider owns source resolution, durable receipt replay, Board capacity, and cross-session recovery.
- List, proposal, and selected-card sections resume with `next_cursor`; an item overview exposes one selected revision while `reviews` and `handoffs` retain their matching history.
