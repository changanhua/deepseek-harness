---
description: "Personal content packages for saving original text, editing drafts, and recovering committed versions."
kind: "package-group"
---

# content/ — Personal content library

English | [中文](README.zh.md)

## Summary

This family preserves useful text independently of its source conversation. The definition owns the shared record and editing contract; the provider commits records through Storage Domain. Source bridges and human interfaces consume that contract without owning another copy of the library.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

Both packages use the personal namespace.

| Package | Role |
|---|---|
| [`content`](content/README.md) | Content schemas and Service Definition |
| [`content-domain`](content-domain/README.md) | Durable aggregates, revision checks and retry receipts |

<a id="related-documentation"></a>
## Related documentation

- [Content subsystem](../../docs/subsystems/content.md) — shared data and authority contract.
- [Storage group](../storage/README.md) — persistence mechanisms.

<a id="dev-note"></a>
## Dev Note

None.
