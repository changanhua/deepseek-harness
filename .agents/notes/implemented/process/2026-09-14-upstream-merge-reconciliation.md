# Agent Note: Reconcile the upstream merge with fork-owned runtime contracts

Status: implemented

English | [中文](2026-09-14-upstream-merge-reconciliation.zh.md)

## Problem

The fork had a completed upstream merge commit, but the merged tree still needed reconciliation at the seams that upstream does not own: personal package catalogs, Queue and browser composition, Windows Web replay fixtures, and the fork's connection and settings behavior. Without an explicit record, a later sync could mistake generated drift or platform-specific replay details for either upstream behavior or a new fork divergence.

## Decision

The fork keeps merge commit `70a90814cb` and records `c291e7961a515f6d7af9304e7fd1d257929aef26` as the supported upstream base. Reconciliation restores the upstream `present` row in the standard preset, preserves the fork's connection-recovery indicator, isolates the settings scaffold queues, and makes the minimal preset use the current single persistent-shell composition on Windows and POSIX. Cordis and tool catalogs now enumerate the merged personal services and task-queue tools; client and persistence catalogs are regenerated from source. Web replay expectations are refreshed only where the current runtime contract changed, with Windows-specific shell and path handling kept in the owned tests.

The minimal shell assertion compares the persisted path and normalizes the optional PTY completion marker so platform transport noise cannot change the contract.

The full documentation gate is treated as a baseline report rather than a waiver: targeted generated-catalog checks, typecheck, build, and owned Web scenarios are evidence for this merge, while pre-existing documentation debt remains separately listed for future cleanup.

## Alternatives considered

**Rewrite the merge commit.** Rewriting would discard the conflict-resolution ancestry and make the upstream base harder to audit.

**Copy every failing documentation expectation into this merge.** That would mix unrelated README, link, JSDoc, and type-equivalence debt into a runtime reconciliation and obscure which behavior the merge actually changed.

**Keep the old minimal two-tool preset and Bash-only fixtures.** That preserves stale behavior on Windows and hides the current upstream single-shell contract; platform-aware assertions are the smaller compatibility surface.

## Consequences

The candidate branch remains ahead of upstream with no upstream commits behind, and it is not pushed. Generated catalogs and the standard/minimal preset now match the merged source, while the fork-specific Queue, browser, runtime-facts, capability, and delivery surfaces remain deliberate divergences recorded above. The repository-wide `doc-sync` command still reports baseline failures; future documentation work must compare against this reconciliation rather than attribute those failures to the merge.
