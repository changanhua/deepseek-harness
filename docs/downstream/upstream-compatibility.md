# Upstream compatibility canary

English | [中文](upstream-compatibility.zh.md)

## Summary

The canary detects a new official upstream head before spending a full build. A changed head produces a synthetic-merge report, affected-package list, and private core-patch heatmap. A clean merge proceeds to a blocking hosted-Windows gate and a non-blocking hosted-Linux advisory. The workflow never admits a new supported base, pushes a ref, or modifies `master`.

## Table of Contents

- [Schedule and trust](#schedule-and-trust)
- [Report and heatmap](#report-and-heatmap)
- [Platform gates](#platform-gates)
- [Run the report locally](#run-the-report-locally)
- [Failure and recovery](#failure-and-recovery)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

<a id="schedule-and-trust"></a>

## Schedule and trust

`.github/workflows/ci-upstream-watch.yml` runs at 03:23 UTC every Monday and supports an owner-triggered manual run. It runs only in `changanhua/deepseek-harness`; manual runs additionally require the owner actor. Repository permissions are `contents: read`, every checkout disables credential persistence, and no job receives a secret.

The detect job checks out one commit, resolves the selected official branch with `git ls-remote`, and compares that SHA with `upstream-base.json.observedUpstreamHeadSha`. Equal SHAs skip dependency installation, merge analysis, and both platform jobs. A branch name that is invalid or cannot be resolved fails before heavy work starts.

<a id="report-and-heatmap"></a>

## Report and heatmap

A changed SHA starts the report job. The job fetches full official history, verifies that the fetched head still equals the detect-job SHA, installs immutable dependencies, validates the core patch registry with the observed upstream object present, and runs `git merge-tree` against the personal head. The synthetic merge may write temporary Git objects in the disposable runner, but it does not update a branch ref or the checkout.

The JSON artifact and GitHub step summary contain the personal head, supported and observed upstream SHAs, target SHA, merge status, conflict paths, changed upstream paths, affected packages, and affected active patch series. `upstream-base.json` remains the only owner of admitted baseline facts; the report never rewrites it.

Each heatmap row is sorted by `max(1, private path count) × max(1, upstream commit count) × architecture centrality × data migration risk`. The two judgment factors are integers from 1 to 4 in `core-patches.json`. Path count measures private modification density, while distinct upstream commits touching the matched paths measure upstream change frequency.

<a id="platform-gates"></a>

## Platform gates

A conflict report uploads its evidence and then fails, so neither platform job runs. A clean report checks package identities, builds an ephemeral merged checkout, verifies the personal source distribution, and typechecks contracts on `windows-latest`; any failure blocks the canary. The hosted runner is clean Windows compatibility evidence, not proof of the user's exact Windows 10 environment.

The clean report also checks package identities, runs the Host build, and typechecks contracts on `ubuntu-latest` with job-level `continue-on-error`. Linux is compatibility advice for this personal Windows product, not a deployment target or a hidden acceptance prerequisite.

<a id="run-the-report-locally"></a>

## Run the report locally

Run these commands from a checkout that already has the target upstream ref and complete history:

```powershell
pnpm run check:core-patches -- --require-observed-upstream
pnpm --silent run report:upstream-compatibility -- --upstream-ref upstream/master --format markdown --json-output "$env:TEMP\dsh-upstream-compatibility.json"
```

The first command proves the recorded registry and available Git history agree. The second prints the human summary and writes the same run's structured JSON. A `not-run` merge status means the target SHA equals the recorded observation; it does not mean a merge was tested.

<a id="failure-and-recovery"></a>

## Failure and recovery

If the official branch advances between detection and fetch, rerun the workflow so every job uses one target SHA. If the observed upstream object is missing, fetch complete official history before rerunning. If the report finds conflicts, inspect the uploaded JSON, classify the affected patch series, and use the upstream synchronization dry run; do not move the supported base from this workflow.

The workflow's local merge and report files live only in disposable runners. It has no write permission to the repository and contains no commit, push, force-update, release, or deployment step.

<a id="further-exploration"></a>

## Further Exploration

- [Downstream core patch registry](core-patch-registry.md)
- [Fork divergence record](../../FORK-DIVERGENCE.md)
- [Windows-first platform routing decision](../../.agents/notes/implemented/process/2026-09-05-personal-windows-platform-routing.md)
- [Read-only canary decision](../../.agents/notes/implemented/process/2026-09-05-read-only-upstream-compatibility-canary.md)

## Dev Note

The source and local report paths are verified in this change. A hosted run is still required before a completion report may claim that the scheduled or platform jobs executed successfully.
