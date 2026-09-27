---
description: "Run a local MCP capability profile that discovers a small fixed catalog and mounts each configured preset only when called."
kind: "package-bundle"
---

# `@changanhua/dsh-capabilities`

English | [中文](README.zh.md)

## Summary

The capabilities profile gives local MCP clients a fixed catalog of `dsh_capabilities`, `choose_candidate`, and `glob`. It keeps provider-backed and filesystem-search presets unloaded until a matching call needs them. This profile is for the local work center; it does not make every installed DSH capability available.

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

The verified profile entry is `node apps/cli/lib/bin.js --profile capabilities`. The exposed MCP tools are `dsh_capabilities`, `choose_candidate`, and `glob`; `grep` remains private to the search preset and is not an external catalog entry. The first choice call mounts its provider-owning preset, while the first glob call mounts the local search preset.

Before launch, set `DSH_HOME` to a dedicated Harness home, `DSH_MCP_WORKSPACE` to the absolute working directory, and `DSH_MCP_TOKEN` to a local secret. `DSH_MCP_PORT` defaults to `8765`. Model-backed selection uses the existing `DEEPSEEK_API_KEY`; an all-disabled candidate set abstains without calling the model. Keep the Host running while clients use it.

Connect a Streamable HTTP MCP client to `http://127.0.0.1:8765/mcp` with `Authorization: Bearer <DSH_MCP_TOKEN>` and no `Origin` header. When the client uses an HTTP proxy, include `127.0.0.1,localhost` in `NO_PROXY`. Configure the client's tool approval policy separately. The workspace sets relative-path resolution; it does not install a filesystem sandbox.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle owns a closed lazy-preset roster and one MCP-facing catalog. Discovery reads declarations without mounting presets. The choice preset owns model configuration, and the search preset owns local filesystem search; their implementations remain isolated from the base Host until loaded.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Choice tool](../../llm/tool-choice/README.md) — bounded model selection.
- [Architecture](../../../docs/architecture.md) — Profile composition.

-----

<a id="model-experience"></a>
## Model Experience

### Lazy capability catalog

#### What the model sees

The root Host sends no model request. A `choose_candidate` call creates one bounded choice request in a real Agent session; `dsh_capabilities` and `glob` send none.

#### Token effect

Only `choose_candidate` consumes model tokens, bounded by its preset configuration.

#### KV Cache effect

Choice calls are independent auxiliary requests and do not create an Agent-turn cache prefix.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The catalog is fixed, presets remain available after mounting for the Host lifetime, and this bundle does not route calls across Profiles.

No runtime invariant companion is published because this bundle owns composition only and its observable behavior is covered by profile tests.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
