# Agent Note: Read-only upstream compatibility canary

Status: implemented

English | [中文](2026-09-05-read-only-upstream-compatibility-canary.zh.md)

## Problem

The personal fork deliberately follows a stable official base instead of continuously merging official `master`. A static baseline and patch registry expose current divergence, but they do not detect a new official head, show which registered patch series it touches, or distinguish an ordinary upstream change from a merge conflict before a maintainer starts synchronization work.

Running every cross-platform build on every timer wastes hosted capacity when the official SHA has not changed. Treating Linux as the only convenient gate would also contradict the personal Windows 10 operating target, while automatic merging would turn an advisory observation into an unauthorized admission decision.

## Decision

`.github/workflows/ci-upstream-watch.yml` performs a weekly and owner-triggered manual check in the personal repository with `contents: read`, non-persistent checkout credentials, and no secrets. A lightweight detect job reads `upstream-base.json.observedUpstreamHeadSha` and resolves the selected official branch with `git ls-remote`. Equal SHAs end the run without dependency installation or platform jobs.

A changed SHA starts one report job against a pinned fetched head. [`scripts/generate-divergence-report.ts`](../../../../scripts/generate-divergence-report.ts) compares the recorded and target official histories, runs `git merge-tree` against the personal head, groups changed package paths, maps upstream paths to active entries in `core-patches.json`, and writes one JSON artifact plus a Markdown summary. A report with conflicts uploads evidence and fails before platform jobs. The workflow does not update `upstream-base.json`; moving the supported base remains a separate reviewed decision.

Heatmap score is `max(1, private path count) × max(1, distinct upstream commit count) × architecture centrality × data migration risk`. The registry owns the two 1-to-4 judgment factors. Git history owns the two measured factors. Sorting by this score identifies patch series that combine broad private modification, repeated upstream activity, architectural reach, and data risk without presenting the score as compatibility proof.

A clean report runs the ephemeral merge, package-identity check, full repository build, personal-source verification, and contract typecheck on GitHub-hosted Windows as the blocking compatibility gate. GitHub-hosted Linux checks package identities and runs the Host build and contract typecheck as job-level `continue-on-error` advice. This extends the [Windows-first platform routing decision](2026-09-05-personal-windows-platform-routing.md): hosted Windows does not replace exact local Windows 10 evidence, and hosted Linux does not become a personal deployment target.

## Alternatives considered

**Automatically merge a clean official head.** Rejected because merge mechanics cannot decide whether a new base preserves personal product behavior, data, evidence, and accepted private patches. The canary may observe and report but cannot admit or publish.

**Run the full matrix on every schedule.** Rejected because the official SHA is the cheapest complete invalidation key for this canary. Heavy work adds no evidence when that input is unchanged.

**Use Linux as the required gate.** Rejected because the personal product runs on Windows 10. Linux remains useful for portable behavior, but its availability does not make it authoritative for Windows paths, processes, Profiles, credentials, or interactive operation.

**Store the latest observation in workflow state or an Issue comment.** Rejected because `upstream-base.json` already owns reviewed Git baseline facts. Workflow-local or GitHub discussion state would create a second, weaker owner and could silently advance the observation without admitting a base.

## Consequences

Official drift becomes visible within one weekly interval or on demand, while unchanged weeks consume only a shallow checkout and one read-only remote query. A changed week leaves machine-readable conflict, package, patch, and heatmap evidence before any synchronization branch is created.

The workflow writes temporary merge objects and report files inside disposable runners and uploads the JSON artifact, but it has no repository write permission and no ref update, merge commit, push, release, or deployment action. A hosted run is still required to prove the GitHub jobs themselves execute; local tests prove the report and declarative workflow contracts only.

The [downstream core patch decision](2026-09-05-downstream-core-patch-budget.md) remains active and is not superseded: it owns admitted baseline and patch inventory. This note owns latest-upstream observation and canary-specific platform routing. Neither note makes Agent-reported completion a delivery fact or authorizes a new supported base.
