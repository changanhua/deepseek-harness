---
description: "Local immutable, content-addressed evidence publication and integrity-checked byte reads for Personal Delivery."
kind: "package-reference"
---

# @changanhua/dsh-delivery-evidence-local

English | [中文](README.zh.md)

## Summary

`dsh-delivery-evidence-local` lets runners and verifiers publish bounded code-delivery evidence as immutable local bytes. It derives a stable evidence id from kind, media type, provenance, byte length, and SHA-256; identical envelopes converge on one reference across provider reconstruction. `save()` returns only after atomic publication, while `resolve()` and `read()` reject changed metadata, length, digest, and link-shaped storage paths.

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

Mount this provider when Personal Delivery evidence must remain on one host and Queue records should retain references rather than byte payloads.

### When to choose it

Choose this provider for bounded logs, Git metadata, patches, checkpoint metadata, verification output, screenshots, and Resume Capsules stored on a private local filesystem. Bind provenance through `ctx.deliveryEvidence.bind()` before giving a writer to a runner or verifier; the caller cannot replace that provenance through the bound writer.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `root` | required | Private directory containing content-addressed byte objects and immutable references. |
| `maxBytes` | `64 MiB` | Positive complete-payload publication limit; configuration cannot exceed the P0 `64 MiB` ceiling. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-delivery-evidence-local) is the exhaustive field reference.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider copies caller bytes and provenance before asynchronous work. It writes each object or reference to a private exclusive temporary file and syncs the file. POSIX publication uses a no-overwrite hard link plus parent-directory sync; Windows uses a no-replace write-through namespace move. Concurrent observers repeat the file and namespace durability barrier before returning an existing object or reference. Byte objects use their SHA-256 URI, while reference ids address the complete semantic envelope. Reads re-prove the physical root and every ancestor, reject link-shaped paths, enforce the configured object limit and a `64 KiB` metadata limit before allocation, and verify file identity, exact length, and SHA-256 through a bounded open handle. Every returned byte array and metadata object is detached from stored state.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Delivery evidence Service Definition](../delivery-evidence/README.md) — publication, binding, resolve, and read contracts.
- [Personal Delivery subsystem](../../../docs/subsystems/delivery.md) — package topology and authority ownership.
- [Personal Delivery Protocol V1](../../../docs/specs/2026-08-29-delivery-protocol-v1.md) — evidence kinds, digests, and provenance semantics.

-----

<a id="model-experience"></a>
## Model Experience

### No direct model context

#### What the model sees

Nothing directly. `ctx.deliveryEvidence` keeps evidence bytes as host artifacts unless another caller deliberately selects and renders them.

#### Token effect

Zero direct tokens.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No automatic retention or garbage collection** — references may outlive Packets and Attempts until an operator manages the configured root.
- **Local filesystem publication primitives are required** — a filesystem that cannot create private exclusive files and hard links fails publication with `write-failed`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
