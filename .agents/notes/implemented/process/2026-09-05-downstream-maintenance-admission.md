# Agent Note: Downstream maintenance admission

Status: implemented

English | [中文](2026-09-05-downstream-maintenance-admission.zh.md)

## Problem

The upstream canary detects official drift but does not authorize a synchronization. The earlier merge procedure could fetch and merge a moving remote-tracking branch before one machine report fixed the target, patch impact, cleanup state, and evidence plan. A technically clean merge could therefore widen while being reviewed or contaminate the user's everyday checkout.

New personal behavior had a similar ambiguity. DSH offers official services, Profiles, plugins, slots, personal packages, Bundles, adapters, and upstream extension seams, while `core-patches.json` guards only the final core-edit boundary. Without one placement order, a convenience patch could bypass a lower extension point or an adapter could quietly become a second fact owner.

## Decision

[`scripts/upstream-sync-dry-run.ts`](../../../../scripts/upstream-sync-dry-run.ts) is the mechanical pre-admission rehearsal. It requires a clean source checkout with no in-progress Git operation, validates the upstream remote against `upstream-base.json`, resolves one official branch SHA, fetches through the verified URL into a unique temporary ref, and rejects target drift. It compares the supported base with that target, runs `merge-tree` against the personal HEAD, groups package paths, maps active patches, and classifies conflicts.

A clean synthetic tree is wrapped in an unreferenced two-parent commit and materialized once in a detached system-temporary worktree. The script verifies that checkout is clean, removes it, deletes the exact temporary ref, and proves no temporary or remote-tracking ref remains. It may add unreachable Git objects that ordinary garbage collection later removes. It does not resolve, admit, commit, push, publish, update `FETCH_HEAD`, or modify the source worktree.

The [feature placement policy](../../../../docs/downstream/feature-placement.md) uses this first-fit order: official capability, configuration/Profile, Plugin/Slot, `@changanhua` package, Bundle, compatibility adapter, general upstream seam, then private core patch. The first layer must satisfy the complete lifecycle, authority, fact ownership, side effects, recovery, and verification need; smaller code is not a reason to select a weaker owner.

Bundles remain composition only. Compatibility adapters retain `factOwnershipEffect: "none"`. Queue, Delivery, repository workspace, evidence, and other domains keep their existing fact owners. The personal-increment matrix is explanatory and derived from `downstream/package-identities.json`, `core-patches.json`, package source, and current composition; it is not a new durable placement registry or control plane.

The `dsh-merge-upstream` Skill consumes the [synchronization SOP](../../../../docs/downstream/upstream-sync.md), carries the pinned target into a separate named worktree, and keeps conflict decisions, base admission, commit, push, release, and cleanup as distinct actions. Windows is the blocking personal compatibility carrier; Linux stays advisory unless the changed claim owns a portable or Linux-specific contract.

## Alternatives considered

**Merge `upstream/master` after a quick fetch.** Rejected because the target can move between assessment, conflict resolution, and verification. A synchronization decision names one commit.

**Use `merge-tree` output without materializing it.** Rejected because a clean tree hash alone does not prove that Git can check out the resulting tree as a clean worktree. The temporary checkout adds that bounded mechanical proof without becoming the real merge workspace.

**Place all personal behavior in one downstream package or Bundle.** Rejected because Queue, Delivery, runtime facts, evidence, repository workspace, UI, and adapters have different authority and lifecycle. A Bundle may select them but cannot own their state machines.

**Turn the placement matrix into another JSON registry.** Rejected because package origin and core-patch inventory already have machine owners, while domain services own runtime facts. A third registry would duplicate those truths and drift.

**Automatically remove or retain a patch from conflict classification.** Rejected because a path match cannot establish semantic equivalence, data compatibility, authority, or accepted product behavior. The script classifies; a maintainer decides.

## Consequences

Every synchronization starts with a reproducible target and a report that leaves the source branch, index, working files, remote-tracking refs, and user data unchanged. Clean mechanical rehearsal is cheaper to repeat, while the later named merge worktree remains an explicit admission action.

Every personal feature must justify why each lower placement layer fails before consuming private core budget. General reliability fixes can remain `upstream-candidate`; personal state and workflows stay in `@changanhua` packages; adapters and Bundles cannot absorb facts they do not own.

The release-specific merge Agent Notes remain active records of their actual reconciliations and are not superseded by this process decision. The [core patch budget](2026-09-05-downstream-core-patch-budget.md), [upstream canary](2026-09-05-read-only-upstream-compatibility-canary.md), and [Windows platform routing](2026-09-05-personal-windows-platform-routing.md) also retain their independent ownership. This decision adds no authority to push, merge personal `master`, deploy, or release.
