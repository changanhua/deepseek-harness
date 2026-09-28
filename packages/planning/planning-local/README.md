---
description: "Local durable planning Board provider with ownership, source capture, and recovery."
kind: "package-reference"
---

# @changanhua/dsh-planning-local

English | [中文](README.zh.md)

## Summary

Mount this Provider to persist one CAS-protected planning Board per Workspace in a Storage Domain. It captures manual and link sources as unverified, validates Workspace-owned session events, and reads exact saved Content versions when Content is composed.

For a direct Agent create or revise, the Provider also attaches the verified current user message as a session-event source when it is missing. A full 20-source input is rejected instead of dropping that message; replay keeps the original request identity.

## Configuration

`ownershipRoot` is a required absolute local directory used for the single-Host owner lock. `maxBoardBytes` bounds one serialized Board and rejects writes before data is lost.

On Windows the lock is an in-process named-pipe listener and on POSIX it is a kernel `flock`; a crash releases either OS resource, while graceful shutdown only closes the held resource.

## Invariant policy

No invariant companion is published because each Board is read and validated through its sole Storage Domain record; there is no independent cached projection to compare.

## Model Experience

### No direct model context

#### What the model sees

Nothing directly. `planning-local` captures sources and commits Boards only after a trusted consumer invokes it.

#### Token effect

This Provider adds no direct tokens.

#### KV Cache effect

This Provider adds no direct KV-cache effect.

## Known Limitations and Deferred Work

- Content sources reject when no Content provider is composed.
- The provider does not execute Delivery or accept review outcomes as proof of delivery acceptance.
