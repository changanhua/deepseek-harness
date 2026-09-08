---
description: "The knowledge package group for source-grounded editable libraries, their durable generation Queue bridge, and the DSH tool and command surface."
kind: "package-group"
---

# knowledge/ — source-grounded knowledge libraries

English | [中文](README.zh.md)

## Summary

This group lets a DSH profile build an editable knowledge library from versioned sources, inspect the result, and publish a checked release when the user chooses. The business package owns Domain records, working Markdown, and releases; the Queue bridge owns durable Codex-stage execution; the bundle exposes the tool and `/knowledge` command. Projects in one trusted Profile are shared across its sessions; this group provides no session-private ACL. Open the package pages for configuration, failure handling, and model-facing details.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The packages divide durable content, execution recovery, and human or model requests.

| Package | Role |
|---|---|
| [`knowledge-base`](knowledge-base/README.md) | Stores project facts, editable entries, immutable artifacts, checks, and releases. |
| [`knowledge-base-task-queue`](knowledge-base-task-queue/README.md) | Runs prepared knowledge stages through the durable local Queue and recovers verified results. |
| [`tool-knowledge-base`](tool-knowledge-base/README.md) | Adds the knowledge bundle, `knowledge_base` model tool, and optional `/knowledge` command. |

<a id="related-documentation"></a>
## Related documentation

- [Package map](../README.md) — the repository's package families and composition conventions.
- [Storage subsystem](../../docs/subsystems/storage.md) — Domain persistence and backend selection.
- [Knowledge subsystem](../../docs/subsystems/knowledge.md) — business values and stage/release identities.
- [Application launch](../../docs/architecture.md) — supported `dsh --profile` entry points.

<a id="dev-note"></a>
## Dev Note

[Knowledge libraries with native Codex execution](../../.agents/notes/implemented/feature/2026-09-08-knowledge-base-native-codex.md).
