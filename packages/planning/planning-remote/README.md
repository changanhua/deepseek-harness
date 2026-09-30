---
description: "Authenticated browser access to project planning, handoff preparation, and Delivery status."
kind: "package-reference"
---

# @changanhua/dsh-planning-remote

English | [中文](README.zh.md)

## Summary

Use this Remote to list projects, read a planning Board, apply a bounded planning command, prepare an exact revision for Delivery, and read linked Delivery status and packet-declared evidence. The Host fixes the browser actor identity and rejects unknown or malformed wire fields.

The context operation returns the selected Plan or Focus projection without expanding resource contents. Existing execute calls also carry workspace changes and Session bindings; the provider checks that a bound Session belongs to the project.

## Use this package

The Remote exposes `workspaces`, `snapshot`, `execute`, `handoff`, `execution`, and `evidence`. `snapshot` adds read-only linked execution summaries when Delivery is composed. `handoff` prepares a shaping Case from the selected revision; it does not approve requirements, dispatch work, verify changes, or accept results. `execution` joins durable handoff references to the existing Delivery read model. `evidence` accepts only an evidence id already declared by a packet in the selected Plan's linked Case, then uses Delivery's existing checked reader; another Plan cannot read it.

The browser path uses the configured local human identity and checks the selected project and exact revision. Model tools derive Agent authority separately and Planning checks their current direct-user evidence. Intent recognition belongs to the Agent and Skill; these Host checks enforce identity and version facts rather than interpreting natural language.

## Invariant policy

No invariant companion is published because the Remote reads provider-owned facts and retains no independent durable projection.

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
