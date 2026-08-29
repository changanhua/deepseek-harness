---
description: "Isolated local Git worktrees for maintainers running Personal Delivery changes and verification."
kind: "package-reference"
---

# @deepseek-ai/dsh-repo-workspace-git-local

English | [中文](README.zh.md)

## Summary

`dsh-repo-workspace-git-local` is the reserved local provider for `ctx.repoWorkspace`. Its ownership boundary covers configured repository identities, full Git commit verification, and one isolated change or verification worktree per Queue Attempt.

Its `subprocess` injection and Loader configuration are stable composition contracts. Every operation currently fails explicitly; no checkout, Git mutation, or process starts while worktree ownership is unavailable.

## Configuration

- `repositories` is a closed map from stable `repositoryId` strings to local Git checkout roots.
- `worktreeRoot` is the reserved parent for attempt-owned worktrees.

Host paths are deployment facts only. Durable Delivery objects retain the configured repository id and full commit, never a mutable absolute path as authority.

## Lifecycle boundary

Inspection creates no checkout. A change or verification lease owns its cwd until `close()` settles, and uncertain execution must preserve rather than silently remove the worktree.

## Dev Note

All Git commands must use `ctx.subprocess`; never execute in the DSH control-center checkout.

## Model Experience

### No direct model context

#### What the model sees

Nothing directly. The provider implements host-side `ctx.repoWorkspace` isolation and does not register prompts, tools, or resources.

#### Token effect

Zero direct tokens; repository inspection data remains outside model input unless a caller deliberately forwards it.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Git workspace operations are unavailable** — every operation fails with the stable `unavailable` classification while repository verification, idempotent lease recovery, checkpoints, cleanup, and process-tree-safe cancellation remain unimplemented.
