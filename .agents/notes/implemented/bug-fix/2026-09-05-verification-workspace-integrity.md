# Agent Note: Verification verdicts require unchanged Git inputs

Status: implemented

English | [中文](2026-09-05-verification-workspace-integrity.zh.md)

## Problem

A verification checkout is writable by the commands it executes. A successful exit does not prove that the checked code still corresponds to the Packet's target commit. Checking only the initial commit lets changed source, index state, or HEAD acquire a verdict naming the original target.

## Decision

The [repository lease](../../../../packages/delivery/repo-workspace/src/types.ts) owns a provider-independent `assertUnchanged()` operation. The [Git provider](../../../../packages/delivery/repo-workspace-git-local/README.md) rechecks checkout ownership, Git identity, HEAD, index, tracked content, and flags that hide tracked changes. The verifier awaits it before and after each quiescent check, rejects unproven inputs without a Verdict, and preserves the checkout. The existing [Queue settlement owner](../architecture/2026-08-30-delivery-queue-bridge.md) maps `workspace-integrity` to a non-retriable started failure; acceptance and persistence formats remain unchanged.

## Alternatives considered

**Trust exit codes or inspect only after the whole plan.** Neither binds every check to the target: a later check can restore an earlier check's modified inputs. Each check therefore has its own observations.

**Reject every filesystem write.** Builds need untracked and ignored outputs. Protected inputs are the Git index and tracked tree, including tracked generated files; output writes alone do not invalidate the target.

**Add an OS sandbox in this patch.** Windows confinement and hostile same-user writers need a separate execution policy. Git point checks close this concrete false-verdict path without claiming continuous or raw-byte isolation.

## Consequences

Each check adds bounded Git inspections. Git comparison semantics, including clean filters, remain authoritative. Modifications restored within one check are not detectable, and execution or evidence-publication failure can bypass the post-check inspection while still preventing any Verdict. Those failure paths retain their existing quiescent cleanup behavior.

The guarantee applies to runs using this implementation. Stored historical Verdicts are neither revalidated nor invalidated by an update. The Host-configured verifier identity is unchanged; it is not a historical revalidation policy.

Real Git regressions cover tracked edits, staged-only edits, hidden index flags, HEAD changes, preservation, later-check suppression, and acceptance refusal after restart. Normal checks and untracked build outputs remain acceptable. Built-module checks independently assert rejection/preservation and success/removal using the production Git, Subprocess, and evidence providers; they require no Codex or model call.
