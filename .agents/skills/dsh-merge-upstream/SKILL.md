---
name: dsh-merge-upstream
description: Use when merging official upstream deepseek-harness updates into this fork, after a `git fetch upstream` shows new commits, when the user says "merge upstream", "sync upstream", "pull upstream", or "reconcile fork", or before a fork release that must include upstream changes. Orchestrates the full merge-reconcile-verify cycle with human checkpoints at conflict resolution and test-assertion adjustment.
---

# Merge Upstream into the Fork

This fork tracks `upstream/master` (`https://github.com/deepseek-ai/deepseek-harness.git`). Upstream releases frequently (rc cadence); this skill makes the merge-reconcile cycle repeatable while keeping a human in control of the two judgment-heavy steps: **conflict resolution** and **test-assertion reconciliation**.

The reference for deliberate fork differences is [FORK-DIVERGENCE.md](../../../FORK-DIVERGENCE.md). Read it before starting; it lists every file this fork intentionally diverges on, which is where conflicts will appear.

## Prerequisites

1. Clean working tree: `git status --short` returns nothing (or only the documented non-divergence residue in FORK-DIVERGENCE.md).
2. The `upstream` remote exists: `git remote get-url upstream`.
3. No other merge in progress: `git rev-parse --git-dir` has no `MERGE_HEAD`.

## Phase 0 — Assess the gap

Fetch and measure before touching the working tree.

```sh
git fetch upstream
```

Record the upstream tip and the last merge commit, then inspect what is incoming:

```sh
# how far ahead/behind each side is
git rev-list --left-right --count master...upstream/master

# incoming commits since the last merge
git log --oneline <last-merge-commit>..upstream/master
```

Predict conflicts by intersecting the incoming file set with the FORK-DIVERGENCE.md table:

```sh
# files changed by upstream since the last merge
git diff --name-only <last-merge-commit>..upstream/master
```

Cross-reference each changed file against the divergence table. Files listed there (notably `AGENTS.md`, `docs/testing.md`, `lefthook.yml`, `scripts/run-gates.ts`) are the likely conflict sites. Report the predicted conflict list to the user before proceeding.

## Phase 1 — Merge and resolve conflicts (human checkpoint)

```sh
git merge upstream/master
```

If the merge is clean, skip to Phase 2. If conflicts occur:

1. **Stop and report every conflicting file** with a summary of what each side changed.
2. **Resolve each conflict** following the fork's structural choices documented in FORK-DIVERGENCE.md:
   - **`AGENTS.md`**: keep the fork's condensed constitution + secondary-docs split; absorb upstream rules that still apply, routing them to the correct secondary doc (`docs/development.md`, `docs/testing.md`, etc.) rather than bloating the root.
   - **`docs/testing.md`**: keep fork-appended sections (host sandbox, tests-describe-behavior, coverage planning); merge upstream's rewritten sections alongside.
   - **`lefthook.yml` / `scripts/run-gates.ts`**: keep fork's removal of `translation-pairing`; absorb unrelated upstream hook/gate changes.
   - Any other divergence-listed file: prefer the fork's deliberate structure, absorb upstream's additive content.
3. **Present the resolved files to the user for approval** before staging.
4. After approval, stage and commit the merge:

```sh
git add <resolved-files>
git commit --no-edit
```

Do not auto-resolve with `-Xours` or `-Xtheirs`; every conflict in a divergence-listed file is a judgment call.

## Phase 2 — Reconcile generated catalogs (semi-automatic)

Upstream may add or rename service methods, types, or tools that the fork's generated catalogs and exemption registries must absorb.

### 2a. Cordis API catalog

```sh
pnpm run verify-cordis-catalog --check
```

If this passes, the catalog is already consistent — skip to 2b. If it fails, read the violations:

- **Missing JSDoc on a service method** — the fork or upstream added a method without JSDoc. Add concise JSDoc (`@param`/`@returns`) to the method in its source file.
- **Unresolved type link** — a new type appears in a service signature but is not in `TYPE_LINK_EXEMPTIONS`. Register it in `scripts/gen-cordis-catalog.ts` with the owning README or source file as the exemption reason.
- **Unwalked service** — a new service is not in `SERVICE_WALK_EXEMPTIONS`. Register it with the owning README as the reason.

After fixes, regenerate:

```sh
pnpm run gen-cordis-catalog
```

### 2b. Tool catalog

If the fork or upstream added tools (e.g. `task_queue_*` methods), regenerate:

```sh
pnpm run gen-cordis-api
```

### 2c. Verify catalog consistency

```sh
pnpm run verify-cordis-catalog --check
```

Must pass before proceeding.

## Phase 3 — Reconcile tests to fork reality (human checkpoint)

This is the judgment-heavy step. Upstream changes test assertions; the fork has local behavior that those assertions may not match.

```sh
pnpm run test
```

For each failure, classify it:

| Failure cause | Action |
|---|---|
| Upstream changed an assertion that conflicts with a **fork deliberate behavior** (listed in FORK-DIVERGENCE.md or evident from fork-specific code) | Adjust the test assertion to match fork reality. This is "syncing tests to fork reality". |
| Upstream changed an assertion that reveals a **genuine regression** in fork code | Fix the code, not the test. |
| Upstream added a new test for a feature the fork does not have | Skip or adapt the test to fork scope. |
| Unrelated flaky or environment failure | Retry once; if still failing, report to the user. |

**Present every test-assertion change to the user for approval** before committing. Each change must state which divergence it serves.

Common fork-reality patterns from prior merges:

- **Base bundle membership**: upstream may add or remove bundled plugins (e.g. product subagents). Fork tests assert the fork's actual bundle composition.
- **Compaction summarizer**: the fork appends a Chinese language directive to compacted summaries. Tests must assert that directive's presence.
- **Lefthook hook configuration**: the fork replaced `translation-pairing` hooks with `archived-agent-notes`. CI-workflow tests assert the fork's hook names and globs.

## Phase 4 — Verify

Run the full validation gate. These must all pass:

```sh
pnpm run typecheck
pnpm run build
pnpm run doc-sync
pnpm run verify-doc-budgets
```

If `doc-sync` reports documentation drift, fix the affected docs (see [dsh-doc-standards](../dsh-doc-standards/SKILL.md) and [dsh-prose-standard](../dsh-prose-standard/SKILL.md)).

If `typecheck` or `build` fails on a fork-specific file, the merge likely introduced an API change the fork code depends on. Fix the fork code to match the new upstream API; do not revert the upstream change.

## Phase 5 — Update the fork divergence record

Update [FORK-DIVERGENCE.md](../../../FORK-DIVERGENCE.md):

1. **Identity section**: update the merge-base SHA, upstream tip SHA, and ahead/behind counts.
2. **Divergences table**: add any new deliberate divergence introduced or discovered during this merge; mark resolved divergences as removed (do not delete the row — note "resolved in <upstream-version>").
3. **Non-divergence residue**: update if the local reconstruction state changed.

Present the updated file to the user for approval before committing.

## Phase 6 — Agent Note (if non-trivial)

Per the root AGENTS.md rule, a non-trivial merge earns an Agent Note in the same change. A merge that required conflict resolution, catalog reconciliation, or test-assertion adjustment is non-trivial. File the note under `.agents/notes/implemented/process/<date>-merge-upstream-<version>.md` following [.agents/notes/README.md](../../notes/README.md).

If the merge was a clean fast-forward or trivial merge with no reconciliation, no note is needed.

## Commit structure

Prefer two commits, matching the established pattern:

1. **Merge commit**: `Merge remote-tracking branch 'upstream/master'` — contains the merge and conflict resolutions. The commit message lists conflicted files in the `# Conflicts:` block (Git writes this automatically).
2. **Reconcile commit**: `fix: reconcile fork artifacts with merged upstream` — contains catalog regeneration, test-assertion syncs, and FORK-DIVERGENCE.md updates. The commit message bullet-points each reconciliation category.

If the merge is clean and no reconciliation is needed, a single merge commit suffices.

## Quick reference — command matrix

| Phase | Command | Automatic? |
|---|---|---|
| 0 | `git fetch upstream` | yes |
| 0 | `git log --oneline <base>..upstream/master` | yes |
| 1 | `git merge upstream/master` | yes (conflict resolution: **human**) |
| 2a | `pnpm run verify-cordis-catalog --check` | yes |
| 2a | `pnpm run gen-cordis-catalog` | yes |
| 2b | `pnpm run gen-cordis-api` | yes |
| 3 | `pnpm run test` | yes (assertion changes: **human**) |
| 4 | `pnpm run typecheck && pnpm run build && pnpm run doc-sync && pnpm run verify-doc-budgets` | yes |
| 5 | edit FORK-DIVERGENCE.md | **human** |
