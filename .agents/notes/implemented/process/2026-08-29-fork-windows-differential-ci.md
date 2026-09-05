# Agent Note: Fork-owned Windows differential CI

Status: implemented

English | [中文](2026-08-29-fork-windows-differential-ci.zh.md)

## Problem

This fork supports ordinary application development on Windows, while its inherited repository-wide checks contain known foundation failures and upstream-only runner, release, deployment, and issue-management assumptions. Running the inherited pull-request matrix spends capacity without distinguishing a contribution regression from existing repository debt.

## Decision

Repository Actions settings keep `.github/workflows/ci.yml` and unrelated automatic workflows disabled. `.github/workflows/ci-fork-windows.yml` owns pull-request validation for the fork and runs only on GitHub-hosted Windows runners.

The blocking build job checks out complete fork history, validates package identity and the private core patch budget, then runs the repository build and client typecheck without building the documentation site. A separate C0 job detects Delivery-owned paths; when present, it builds the trusted base and head, runs the same Static, Knip, documentation, lint, and duplication definitions in both checkouts, and rejects diagnostics introduced by the head. The C0 job also runs focused Delivery tests with per-file 100% coverage thresholds.

The `fork checks passed` job runs for every pull request, rejects any actor, author, or head repository outside the owner-controlled same-repository boundary, and aggregates the build and C0 results. The base-branch ruleset requires that stable check name, so an untrusted identity or a failed, cancelled, or skipped blocking job prevents a merge.

## Alternatives considered

**Replace the inherited CI workflow.** Rewriting `.github/workflows/ci.yml` couples fork policy to upstream synchronization and makes feature pull requests carry repository-wide process changes.

**Run the complete inherited checks on the head only.** Known foundation failures keep the result red and cannot identify whether the contribution added a regression.

**Use local verification without a remote verdict.** Local evidence remains necessary, but it cannot enforce the merge boundary or prove behavior on a clean hosted Windows runner.

## Consequences

Ordinary pull requests get one stable blocking verdict without Linux, macOS, Wine, release, preview, or issue-automation jobs. Delivery C0 changes pay for two clean checkouts and two builds to obtain a trustworthy failure difference; pull requests outside C0 skip that differential work. Cross-platform and release evidence remains manual until its owning workflow is explicitly enabled.
