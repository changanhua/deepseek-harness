---
description: "Project-scoped reusable claims, source checks, and durable human memory decisions."
kind: "package-group"
---

# packages/memory

English | [中文](README.zh.md)

## Summary

This family stores short project claims with source identities, immutable revisions, and human decisions. Accepted claims remain subject to source, review-date, and conflict checks. Original files and Session logs stay with their existing owners.

## Packages

| Package | Responsibility |
| --- | --- |
| [memory](memory/README.md) | The `ctx.projectMemory` Definition and strict record schemas |
| [memory-local](memory-local/README.md) | Workspace authorization, source observation, local storage, and exclusive Host ownership |
| [tool-memory](tool-memory/README.md) | Model search, checked reads, and candidate proposals |
| [command-memory](command-memory/README.md) | Human inspection and exact-revision acceptance, rejection, and withdrawal |

## Related documentation

- [Project Memory subsystem](../../docs/subsystems/project-memory.md) owns record and operation semantics.
- [Storage](../storage/README.md) owns persistence backends and atomic domain updates.

## Dev Note

None.
