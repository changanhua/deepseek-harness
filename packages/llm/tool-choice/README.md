---
description: "Choose one eligible item from bounded candidates through a configured model route, or abstain without executing an action."
kind: "package-reference"
---

# `@changanhua/dsh-tool-choice`

English | [中文](README.zh.md)

## Summary

Use `choose_candidate` when an agent already has finite alternatives and needs one constrained selection. It filters disabled candidates, returns a listed id or abstention, and never performs the selected action. It uses the configured LLM route with reasoning disabled, so callers retain action authority.

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

Mount this plugin in the lazy `choice` preset with explicit `provider`, `model`, `maxInputBytes`, `maxCandidates`, `maxOutputTokens`, and `timeoutMs` values. The tool accepts `goal`, `facts`, optional `constraints`, and `id`/description candidates. It rejects invalid input, non-text or malformed output, extra response fields, unknown or disabled ids, truncation, and missing terminal frames.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Native registration and `./declaration` share one DSH schema DSL, name, and description. A real Agent owns every invocation and receives paired auxiliary request and terminal records for success, failure, timeout, or cancellation.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Capabilities bundle](../../bundle/capabilities/README.md) — lazy MCP profile.
- [Tool subsystem](../../../docs/subsystems/tools.md) — execution pipeline.

-----

<a id="model-experience"></a>
## Model Experience

### Bounded candidate selection

#### What the model sees

The model receives one bounded JSON prompt with the goal, facts, eligible candidates, and constraints. Disabled candidates are absent, and the system instruction requires one JSON selection or abstention.

#### Token effect

Input tokens scale with bounded caller data; output tokens are capped by `maxOutputTokens`.

#### KV Cache effect

Each call is an independent auxiliary request and does not reuse an Agent-turn conversational prefix.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The tool does not discover candidates, verify observations, execute actions, or guarantee that a model selection is correct.

No runtime invariant companion is published. Each call validates candidate IDs and model output before returning; there is no independently maintained replica to reconcile.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
