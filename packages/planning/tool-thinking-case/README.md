---
description: "Bounded Thinking Desk model tools for reading a frozen design context and saving a reviewable candidate without Planning mutation."
kind: "package-reference"
---

# @changanhua/dsh-tool-thinking-case

English | [中文](README.zh.md)

## Summary

This package lets a Thinking Desk Agent read the frozen context of its active run and save a structured design candidate for human review. The candidate can contain exploration notes, design context, and a Planning delta, but it cannot create, adopt, or execute a Planning proposal. Choose it for an explicitly started design-thinking Session that must preserve provenance and keep Planning canonical state under human control.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the tools and their restriction row in the `thinking-desk` Agent preset.

### When to choose it

Use this package only with a Host `thinkingCase` owner that binds a live Agent and Session to a prepared Thinking Run. Use [`tool-planning`](../tool-planning/README.md) for ordinary Planning work; it has different authority and may create Planning proposals.

### Minimal configuration

```yaml
- id: thinking-tools
  name: '@changanhua/dsh-tool-thinking-case'

- id: thinking-tool-restriction
  name: '@changanhua/dsh-tool-thinking-case/restrict'
```

| Field | Default | Meaning |
| --- | --- | --- |
| `maxOutputBytes` | `65536` | Maximum complete UTF-8 JSON result, including its wrapper. |
| `timeoutMs` | `30000` | Cooperative deadline enforced by the composed tool timeout policy. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`thinking_context` and `thinking_submit_result` derive identity from `ToolRunContext.agent`; the Host owner supplies the run context and persists versioned candidates. The result schema accepts no model-chosen case, run, subject, or Planning identity. The preset's standing restriction listens for `agent/created` and installs an allow-list in each child `agent.ctx`, so inherited execution and Planning tools are absent while the standing Thinking tools remain visible. The restriction is a Context effect and leaves with that Agent scope.

No invariant companion is published. Tool registrations are disposable, while persistent records, Agent identity, and authorization remain owned by the Thinking Case Host service.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`thinking-desk` preset](../../preset/agent-presets/presets/thinking-desk/agent.cordis.yml) — Agent composition and restriction row.
- [`tool-planning`](../tool-planning/README.md) — canonical Planning tools and proposal authority.
- [Planning subsystem](../../../docs/subsystems/planning.md) — Board lifecycle and canonical state.

-----

<a id="model-experience"></a>
## Model Experience

### What the model sees

The model receives two tools. `thinking_context` returns the bounded context frozen for its active run. `thinking_submit_result` requires `expected_result_version`, using `0` for the first candidate, a stable `request_id`, and a strict structured draft; it returns a saved candidate record rather than Assistant prose being parsed as a result.

### Token effect

Two tool schemas add a fixed request prefix. Context and candidate JSON are bounded and add data-dependent history tokens only after the tool runs.

### KV Cache effect

The schemas stay prefix-stable while the preset and configuration remain unchanged. The frozen context and saved result are data-dependent tool results, so they do not alter the preceding schema prefix.

## Known Limitations and Deferred Work

This package owns only bounded model-tool access for a bound Thinking Run.

- The first preset has no repository or web research capability; it uses the frozen Context Pack.
- The Host `thinkingCase` owner validates the live run binding and persists candidates; this package does not own case storage or retry recovery.
- A candidate remains non-canonical until a human separately applies exploration, saves design context, or submits and adopts a Planning proposal.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

[Thinking Desk Agent loop](../../../.agents/notes/implemented/feature/2026-09-30-thinking-desk-agent-loop.md) owns the decision to keep these tools in a restricted Agent scope and to retain their candidates in the Case owner.

</details>
