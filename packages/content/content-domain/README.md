---
description: "Durable personal content provider: configure byte limits, diagnose unavailable storage and recover original text and drafts."
kind: "package-reference"
---

# @changanhua/dsh-content-domain

English | [中文](README.zh.md)

## Summary

Save original text, edit a separate draft and recover committed versions after reopening the library. Each successful command commits its receipt with the complete entry, including an unverified provided-text or web-page source. Conflicting text edits reject rather than overwriting another draft. The provider uses Storage Domain and requires a dedicated backend with single-writer, synchronized-commit and private-directory guarantees.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this provider alongside Storage and Storage Domain. Route `content_library` to the dedicated backend; the domain requires `single-writer`, `commit-sync` and `private-root`. The existing SQLite provider enforces these with exclusive ownership, explicit synchronization and a private directory. This package does not choose a filesystem path or register a transport.

The configuration owns all size policy:

| Field | Default | Meaning |
|---|---|---|
| `bodyBytes` | 1048576 | UTF-8 bytes of each retained draft or version body |
| `entryBytes` | 8388608 | Serialized entry, including every version, receipt and metadata field |
| `libraryBytes` | 134217728 | Serialized logical Domain envelope, including record keys |

Limits apply before writes. Lowering a limit below existing usage leaves the library readable and exportable with `ready/capacity_exceeded`; all new writes reject until a suitable configuration is restored. History is never truncated. No-op retries of known commands remain queryable.

The provider checks source digests and record identities on open. A bad record makes content unavailable without removing the Storage Domain service or blocking an ordinary domain. A write failure with uncertain commit status discards the content read view and closes its Domain handle. Recreate the provider and its dedicated backend to recover, then query or retry the original operation identity. The backend plugin owns the physical connection and closes it on disposal.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One activation owns a Domain handle, admitted source preparations and the short write chain. Disposal stops new admission, settles preparations, drains writes and closes the handle. `get`, `snapshot` and `receipt` return detached data after authorization. The logical export includes original versions and the current draft.

The provider keeps the last 256 mutation receipts in each entry. Creation and version operations retain their own permanent receipts. Exact retries return the original result; different payloads under a retained identity reject. Evicted transient requests must still satisfy their expected revision. Capturing the same source returns its original creation result, while different sources containing identical text remain separate entries.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Content definition](../content/README.md) — schemas and trusted caller responsibilities.
- [Content subsystem](../../../docs/subsystems/content.md) — shared record semantics.
- [SQLite provider](../../storage/storage-sqlite/README.md) — private database ownership.

<a id="model-experience"></a>
## Model Experience

None, as this provider stores human content without registering model tools or context.

#### KV Cache effect

No direct effect: these storage operations make no model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The provider supplies a content backend, with these current limits:

- Human Remote, real Session-source authorization, UI and browser import are not supplied by this package.
- Whole-domain loading and aggregate replacement require bounded libraries; there is no attachment storage, physical deletion, indexing or cross-device synchronization.
- Logical snapshots are available to trusted consumers; restore import and automatic backup are not implemented.
- Closing a Domain handle does not release the backend's exclusive SQLite connection. Recovery must dispose the dedicated backend too; it must never close a shared backend through this provider.

<a id="dev-note"></a>
### Dev Note

None.
