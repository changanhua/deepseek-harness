---
description: "Let an agent inspect supplied FC observations, build candidate plans and inspect their current status through three typed tools."
kind: "package-reference"
---

# @changanhua/dsh-tool-fc-sbc-domain

English | [中文](README.zh.md)

## Summary

Let an agent inspect supplied FC observations, build candidate plans and inspect their current status through three typed tools. Results contain immutable references and bounded summaries instead of large payloads. The tools do not fetch live observations, approve plans or execute FC actions. Mount them only when a session needs this offline FC workflow.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the plugin in an opt-in Cordis composition; it is not a profile bundle and is absent from shipped defaults. The [Loader composition fixture](../fc-sbc-domain/tests/fixtures/cordis.yml) owns the complete storage/service/tool wiring.

The plugin requires `tools` and `fcSbcDomain`. `fc_sbc_inspect` accepts typed existing observations, `fc_sbc_plan` accepts an exact Reality ref, and `fc_sbc_status` reads a compact summary. Validation occurs in execution even when the model schema omits a bound.

| Field | Default | Meaning |
|---|---|---|
| `maxOutputBytes` | `8192` | Complete rendered JSON result cap; accepts 1024–32768 |

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The tools register effect-scoped typed operations and delegate every domain decision to `fcSbcDomain`. Results shrink to reference, statuses and counts when the configured byte cap is reached; an oversized compact envelope rejects. Source inputs and payload persistence stay with the FC service. See [tool implementation](src/index.ts).

No runtime invariant companion is published; the plugin owns reversible tool registrations and no independent durable state.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Group map](../README.md) — package responsibilities.
- [Subsystem contract](../../../docs/subsystems/domain-runtime.md) — metadata and lineage.
- [Ownership decision](../../../.agents/notes/implemented/architecture/2026-09-30-domain-runtime-artifact-owners.md) — rejected alternatives and trade-offs.

<a id="model-experience"></a>
## Model Experience

### Mounted package context

#### What the model sees

The [generated tool catalog](../../../docs/tool-catalog.md#changanhuadsh-tool-fc-sbc-domain) owns tool descriptions and schemas. Data-dependent results contain refs and bounded coverage, freshness, issue and candidate/readiness summaries; full payloads are not injected.

#### Token effect

Mounted tools add their schemas; each result is capped by `maxOutputBytes`, which is a byte bound rather than a token guarantee.

#### KV Cache effect

Stable tool definitions can preserve an already-reusable prefix; mounting, removal or schema changes may change that prefix. Result appends and provider cache availability remain separate concerns.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No live refresh** — inspect compiles supplied evidence and status does not recapture it. Large artifacts are read through their owner, not inline tool results.
- **No execution authority** — these tools cannot buy, fill, submit, mutate Planning or invoke Safety; a plan reference is not approval.

<a id="dev-note"></a>
### Dev Note

None.
