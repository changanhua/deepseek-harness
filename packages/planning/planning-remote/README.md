---
description: "Authenticated browser access to project planning, handoff preparation, and Delivery status."
kind: "package-reference"
---

# @changanhua/dsh-planning-remote

English | [中文](README.zh.md)

## Summary

Use this Remote to list projects, read a planning Board, apply a bounded planning command, prepare an exact revision for Delivery, and read linked Delivery status and packet-declared evidence. The Host fixes the browser actor identity and rejects unknown or malformed wire fields.

The context operation returns the selected Plan or Focus projection without expanding resource contents. Existing execute calls also carry workspace changes and Session bindings; the provider checks that a bound Session belongs to the project. `designCases` returns only retained case summaries for one Plan, with subject, ResourceRef, frozen base revision and current drift; disabled exploration reports an unavailable owner rather than a verified empty list. The summary operation creates no case and changes no canonical state.

## Use this package

The Remote exposes `workspaces`, `snapshot`, `execute`, `handoff`, `execution`, and `evidence`; it also reads, prepares, advances, applies, and submits a Thinking Case. `snapshot` adds read-only linked execution summaries and Proposal-keyed Thinking review snapshots when composed. A Thinking run freezes its Planning revision, Case version, Context Pack, Session identity, binding command, and kickoff request; recovery reuses those identities instead of creating another run. `handoff` prepares a shaping Case from the selected revision; it does not approve requirements, dispatch work, verify changes, or accept results. `execution` joins durable handoff references to the existing Delivery read model. `evidence` accepts only an evidence id already declared by a packet in the selected Plan's linked Case, then uses Delivery's existing checked reader; another Plan cannot read it.

The browser path uses the configured local human identity and checks the selected project and exact revision. A Thinking tool resolves the live Agent, its `thinking-desk` preset, its bound Session, Workspace, and exact run before it can read context or submit a result; restricted tools exclude `planning_update`. Result validation and Case byte limits bound stored context and output. Only the browser's explicit submit action creates a Planning Proposal, with the frozen subject, base revision, origin, evidence, and review snapshot; the Agent cannot mutate Planning. Intent recognition belongs to the Agent and Skill; these Host checks enforce identity and version facts rather than interpreting natural language.

## Invariant policy

No invariant companion is published because canonical revisions remain provider-owned and drift is derived on each read. Exploratory records have one StorageDomain owner rather than a second live canonical cache.

## SBC exploration

The opt-in `enableSbcDesignCase` configuration enables frozen Plan/Focus projections with separate selection, coordinates, exploration notes, Design Context, Thinking runs, and the last 30 spatial undo steps. Ordinary Planning operations do not require exploratory storage. The personal-planning bundle enables this option and selects its existing web-host StorageDomain. Opening a case creates exploration only; neither opening nor exploring executes a Planning command.

The JSON backend saves one record under `sbc_design_cases/cases/<sha256>.json` relative to its configured storage root. The key hashes the project and subject identity. Each move stores its inverse coordinates; selecting a node does not consume spatial undo history. A consumer submits one move when a drag ends, not each pointer event. The `maxSbcCases` and `maxSbcCaseBytes` settings reject additions or writes before committing when their limits are exceeded. A failed storage initialization can be retried explicitly.

Reads compare the saved Plan revision and optional Focus version with fresh Planning data. Drift preserves the frozen projection and all exploratory state. Concurrent edits use a separate case version; conflicts require rereading the case. The immediately preceding request can be retried with its original identity; older requests conflict after another edit.

## Dev Note

None.

## Model Experience

### No direct model context

#### What the model sees

This package registers no prompt or tool. The optional `tool-planning` consumer owns model guidance and result rendering.

#### Token effect

The Remote adds no direct tokens. The optional `tool-planning` consumer owns any model-visible handoff tool.

#### KV Cache effect

The Remote adds no direct KV-cache effect.

## Known Limitations and Deferred Work

- An unavailable Delivery composition returns an unavailable execution view without changing planning data.
- Automatic reconciliation and promotion into Planning are not provided; Proposal adoption remains a separate human Planning action.
