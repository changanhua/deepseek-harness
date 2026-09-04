---
description: "Local Git identity checks, bounded blob reads, and Attempt-owned worktree leases for Personal Delivery changes and verification."
kind: "package-reference"
---

# @changanhua/dsh-repo-workspace-git-local

English | [中文](README.zh.md)

## Summary

`dsh-repo-workspace-git-local` lets a trusted host verify configured local Git repositories, capture full commits from Contract base rules, read exact bounded blobs, compare immutable revisions, and give each Queue Attempt an isolated change or verification worktree. Change leases create one governed checkpoint after executor quiescence; every lease either removes its checkout or preserves it for operator recovery. Git commands run through `ctx.subprocess`, and a mutable host path never becomes durable authority.

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

Mount this provider beside one `ctx.subprocess` provider when Personal Delivery targets repositories and worktrees in the same execution world.

### When to choose it

Choose this provider for one-host repositories whose configured path is the exact Git toplevel. `resolveBase()` captures a full commit without creating a checkout; `readBlob()` reads Git object storage under the caller's complete-byte limit; change and verification worktrees begin only when a Queue Attempt owns their lease.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `repositories` | required | Closed map from stable `repositoryId` values to exact local Git checkout roots. |
| `worktreeRoot` | required | Real directory that contains hashed Attempt ownership directories and isolated checkouts. |
| `graceMs` | `5000` | TERM-to-KILL grace used by each governed Git subprocess. |
| `maxGitOutputBytes` | `4 MiB` | Complete per-stream Git diagnostic limit; configuration cannot exceed `64 MiB`. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-repo-workspace-git-local) is the exhaustive field reference.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider checks every configured path against Git's physical toplevel before minting revision proofs. Blob reads resolve `commit:path`, verify object type and size, then collect raw piped bytes. Attempt ids become SHA-256 directory names; a crash-durable ownership marker binds purpose, repository, base, and target across provider reconstruction. POSIX publication syncs the marker and affected directories, while Windows uses a write-through namespace move and supplies `core.longpaths=true` to every Git invocation. A failed worktree creation reports a whitespace-normalized Git diagnostic capped at 512 characters. Cleanup re-proves the root, owner directory, checkout identity, and exact regular marker before mutation; it removes only the exact Git registration and never prunes unrelated worktrees. `lstat` traversal does not follow link-shaped descendants, and every Git process reaches whole-tree exit before its operation settles.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Repository workspace Service Definition](../repo-workspace/README.md) — provider-independent proofs and lease contracts.
- [Personal Delivery subsystem](../../../docs/subsystems/delivery.md) — package topology and authority ownership.
- [Personal Delivery Protocol V1](../../../docs/specs/2026-08-29-delivery-protocol-v1.md) — full commit, evidence, and recovery semantics.

-----

<a id="model-experience"></a>
## Model Experience

### No direct model context

#### What the model sees

Nothing directly. `ctx.repoWorkspace` supplies host-side Git facts and operation-local worktree paths only; a runner decides whether any derived content reaches a model.

#### Token effect

Zero direct tokens.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Local execution world only** — remote workspaces and multi-host leases require another provider and lifecycle decision.
- **Preserved worktrees require operator action** — an uncertain Attempt keeps its checkout; this provider does not authorize retry or invent success.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
