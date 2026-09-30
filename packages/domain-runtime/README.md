---
description: "Domain artifacts, provider discovery and FC27 read-only candidate planning."
kind: "package-group"
---

# packages/domain-runtime

English | [中文](README.zh.md)

## Summary

Read immutable domain observations and build candidate plans without performing business writes. The generic package routes artifacts to their owners; the FC package compiles and persists FC observations and plans. The tool package exposes the typed FC operations to agents. No package in this group grants approval or executes a plan.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`domain-runtime`](domain-runtime/README.md) | Provider-routed metadata and artifact reads | `ctx.domainArtifacts` |
| [`fc-sbc-domain`](fc-sbc-domain/README.md) | FC-owned immutable Reality and Plan persistence | `ctx.fcSbcDomain` |
| [`tool-fc-sbc-domain`](tool-fc-sbc-domain/README.md) | Typed inspect, plan and status model tools | `ctx.tools` consumer |

<a id="related-documentation"></a>
## Related documentation

- [Domain Runtime subsystem](../../docs/subsystems/domain-runtime.md) — identity, coverage and lineage contracts.
- [Storage subsystem](../../docs/subsystems/storage.md) — owner persistence.
- [Ownership decision](../../.agents/notes/implemented/architecture/2026-09-30-domain-runtime-artifact-owners.md) — boundaries and alternatives.

<a id="dev-note"></a>
## Dev Note

None.
