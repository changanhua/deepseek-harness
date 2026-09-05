# Downstream core patch registry

English | [中文](core-patch-registry.zh.md)

## Summary

The downstream governance check makes every retained edit to upstream-owned code visible, bounded, and removable. It ties the personal branch to one supported upstream base, requires an owner and an exit condition for each patch series, and stops new unregistered edits before they merge. It does not decide whether an upstream implementation is equivalent or prove that the latest upstream revision is compatible.

## Table of Contents

- [Sources of truth](#sources-of-truth)
- [Checked boundary](#checked-boundary)
- [Run the check](#run-the-check)
- [Failure and recovery](#failure-and-recovery)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

<a id="sources-of-truth"></a>

## Sources of truth

[`upstream-base.json`](../../upstream-base.json) owns the supported upstream commit, the last observed upstream commit, the recorded personal head, their merge base and divergence, and the revalidation timestamp. `recordedPersonalHeadSha` is the audited input commit and may remain an ancestor of the commit that updates the record; the checker rejects a value outside the checked history.

[`core-patches.json`](../../core-patches.json) owns the active patch inventory and its count, risk, and critical-patch budgets. Each entry records the upstream files, introducing commits, responsible domain, reason, failed lower placement options, fact/data/security effects, evidence, rollback, replacement condition, review expiry, known conflicts, and last upstream revision against which the patch was revalidated.

[`downstream/package-identities.json`](../../downstream/package-identities.json) owns npm provenance only. It does not repeat Git baseline revisions.

<a id="checked-boundary"></a>

## Checked boundary

The checker compares the supported upstream base with the requested personal head and selects added, modified, deleted, renamed, or type-changed upstream-owned core paths. It excludes `vendor/`, documentation, Agent Notes, package READMEs, and bilingual sidecars because their ownership is governed by their existing repositories and documentation checks. An addition is excluded only when the package identity registry or the bounded `downstreamOwnedAdditions` list identifies its downstream owner; a new file inside an upstream-owned package still requires a patch entry.

Every selected path must match an active registry entry. The checker also requires existing evidence files, valid and reachable introducing commits, a non-expired review date, the complete migration and rollback fields, and an in-budget active inventory. A `compatibility-adapter` entry must declare `factOwnershipEffect: "none"`; an adapter that owns business state fails validation.

<a id="run-the-check"></a>

## Run the check

Run the repository command from the checkout under review:

```sh
pnpm run check:core-patches
```

The command exits with zero only when the supported baseline, registry, available Git history, path coverage, evidence references, expiry dates, and budgets agree. Its structured report sets `observedUpstreamVerified` only when the recorded upstream object is present and its merge base and divergence match. Use `pnpm run check:core-patches -- --format json` for an ordinary fork checkout and add `--require-observed-upstream` in the upstream-aware canary so a missing upstream object fails closed.

<a id="failure-and-recovery"></a>

## Failure and recovery

An unregistered path stops the change. Place the behavior through an upstream capability, configuration, Profile, Plugin, Provider, Slot, personal package, Bundle, or compatibility adapter before adding a private core patch. If none suffices, add one registry entry with its real risk and exit route; never widen an existing path pattern merely to hide the new edit.

An expired or over-budget registry pauses new private core work. Remove or replace a patch, contribute a general fix upstream, or make an explicit budget decision with updated rationale and tests. The checker does not resolve merge conflicts, change the supported base, write Git state, or modify user data.

<a id="further-exploration"></a>

## Further Exploration

- [Fork divergence record](../../FORK-DIVERGENCE.md)
- [Repository-owned npm identity](../../.agents/notes/implemented/process/2026-09-04-repository-owned-npm-scope.md)
- [Core patch budget decision](../../.agents/notes/implemented/process/2026-09-05-downstream-core-patch-budget.md)

## Dev Note

The latest-upstream canary and compatibility heatmap consume this registry in the next governance phase; they are not evidence that the current supported base has changed.
