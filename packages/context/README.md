# context/ — request-context extensions

English | [中文](README.zh.md)

Product plugins that add model-visible request context without defining a tool. `agent-instructions` is included by the default `dsh-agent-spine-demo` bundle and can be disabled through bundle config; the other packages are opt-in Service Definitions, Service Providers, or context contributors.

| Package | Role | ctx key |
|---|---|---|
| [`runtime-facts/`](runtime-facts/README.md) | Owned runtime-fact registry and synchronous baseline projection | `ctx.runtimeFacts` |
| [`runtime-facts-host/`](runtime-facts-host/README.md) | Host-process runtime-fact provider | — |
| [`command-profile/`](command-profile/README.md) | Command-knowledge registry: contributions, merge, and lexical query | `ctx.commandProfiles` |
| [`session-reference/`](session-reference/README.md) | Bounded snapshots of other sessions | `ctx.sessionReferenceResolver` |
| [`file-reference/`](file-reference/README.md) | File-reference discovery seam and `@file` grammar | `ctx.fileReferences` |
| [`file-reference-local/`](file-reference-local/README.md) | Local-filesystem file-reference provider | — |
| [`time-context/`](time-context/README.md) | Current-time and elapsed-time context | — |
| [`tmux-context/`](tmux-context/README.md) | tmux location context | — |
| [`agent-instructions/`](agent-instructions/README.md) | Workspace-instruction context | — |

Runtime facts are documented in [docs/subsystems/runtime-facts.md](../../docs/subsystems/runtime-facts.md), and Session references in [docs/subsystems/session-reference.md](../../docs/subsystems/session-reference.md); the [`agent-instructions` decision record](../../.agents/notes/implemented/feature/2026-06-24-workspace-context.md) owns its per-agent/session isolation and lifecycle split.
