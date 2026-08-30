---
description: "Repository identity verification and Attempt-owned isolated Git checkout lifecycle for Personal Delivery."
kind: "package-reference"
---

# @deepseek-ai/dsh-repo-workspace

English | [中文](README.zh.md)

## Summary

`dsh-repo-workspace` is the Service Definition for `ctx.repoWorkspace`. It resolves a configured `RepositoryId` and a Contract `BaseSelectionRule` to a verified full commit, reads exact bounded Git blobs, compares Git ancestry and changed paths, and opens one isolated checkout owned by a Queue Attempt. A runtime `cwd` is an operation-local location, never persisted authority.

## Use this package

Inspection is side-effect free and may run during admission or Packet creation. Checkout creation happens only after a Queue handler crosses its start boundary and has live ownership.

```text
const base = await ctx.repoWorkspace.resolveBase({ repositoryId, selectionRule })
const planBlob = await ctx.repoWorkspace.readBlob({
  base,
  path: verificationSource.path,
  maxBytes: verificationPlanLimit,
})
const packetBase = await ctx.repoWorkspace.inspectRevision({
  repositoryId: packet.repositoryId,
  commit: packet.baseCommit,
})
const lease = await ctx.repoWorkspace.openChange({ ownerAttemptId, base: packetBase })
```

`resolveBase` verifies an explicit commit or captures the full commit observed at a `ref-head` at that instant. The branded proof retains the exact selection rule, so ref movement after proof creation cannot rewrite Packet authority. `readBlob` resolves the normalized path through that exact commit tree and returns the Git blob id plus a fresh detached byte copy. Expected failures use `reference-not-found`, `blob-not-found`, and `blob-too-large`; an invalid byte limit is programmer misuse. Cancellation propagates as the signal's abort reason rather than being wrapped as a workspace failure.

Once a Packet persists its exact `baseCommit`, change and verification execution re-establish only a `VerifiedRepositoryRevision` for that commit. Checkout opening deliberately does not re-resolve the Contract's original `ref-head`: after a restart, ref movement must not redirect already admitted work.

A change lease can create one governed checkpoint after the executor process tree is quiescent. A verification lease is pinned to an exact target commit. Every lease must be closed and awaited with `remove` after settled work or `preserve` when side effects remain uncertain. Cleanup rejection is part of the attempt outcome and must not be hidden.

## Understand the implementation

The abstract `RepositoryWorkspace` service owns the verified-revision, verified-base, and verified-blob tokens plus the lease contracts; it performs no Git or filesystem work itself. `dsh-repo-workspace-git-local` is the local Git Service Provider. Blob providers read the named object from Git object storage at the proven commit, never from an ambient checkout path. Runners and verifiers receive narrow operation-local open closures or leases, so they need no Queue dependency and cannot select the DSH control-center checkout by path.

See the [Personal Delivery subsystem](../../../docs/subsystems/delivery.md) for package topology and [Personal Delivery Protocol V1](../../../docs/specs/2026-08-29-delivery-protocol-v1.md) for commit and path rules.

## Dev Note

No open package-local design decisions. Provider-specific Git commands and directory layouts stay outside this Service Definition.

## Model Experience

### Host repository service

#### What the model sees

The model sees no content from `ctx.repoWorkspace`; the service exposes host Git facts and checkout ownership only.

#### Token effect

No tokens are added.

#### KV Cache effect

No request prefix is changed.

## Known Limitations and Deferred Work

- This contract defines local Git worktrees only; remote workspaces and multi-host leases are unsupported without another provider and lifecycle decision.
- Preserved uncertain workspaces require explicit operator handling; this service does not invent success or authorize Queue retry.
