---
name: dsh-merge-upstream
description: Use when merging, synchronizing, or reconciling official deepseek-harness updates into this personal fork. Pins one official SHA, rehearses it without touching user WIP, classifies conflicts against the private patch registry, and keeps admission, verification, commit, push, and release as separate decisions.
---

# Merge official upstream into the personal fork

Synchronize only through the repository-owned [upstream synchronization SOP](../../../docs/downstream/upstream-sync.md). The Skill orchestrates one exact target; the script performs mechanical rehearsal; the maintainer owns conflict meaning and base admission. Never merge a moving branch, overwrite a dirty checkout, auto-resolve a deliberate divergence, or treat a green merge-tree as acceptance.

## Sources of truth

- [`upstream-base.json`](../../../upstream-base.json) owns supported and observed official revisions, the audited personal head, merge base, divergence, and revalidation evidence.
- [`core-patches.json`](../../../core-patches.json) owns private core patch inventory, risk, evidence, expiry, and exit routes.
- [`downstream/package-identities.json`](../../../downstream/package-identities.json) owns personal npm package identity and publication policy.
- [`FORK-DIVERGENCE.md`](../../../FORK-DIVERGENCE.md) explains deliberate differences but owns no machine revision or patch fact.
- [Feature placement policy](../../../docs/downstream/feature-placement.md) decides where retained personal behavior belongs.

Read these owners and the latest canary report before acting. Historical merge Agent Notes explain earlier reconciliation but do not replace current facts.

## Preconditions

Use a dedicated clean worktree. Verify its path, branch, HEAD, remote URL, and lack of `MERGE_HEAD`, rebase, cherry-pick, or revert state. Preserve unrelated worktrees, branches, services, data, and user files. A dirty everyday checkout is not an invitation to stash, reset, clean, or move its changes.

The `upstream` remote must resolve to `upstream-base.json.officialRepository`. Do not add credentials to its URL. Do not use `pull`, `reset --hard`, raw `--force`, `-Xours`, or `-Xtheirs`.

## Phase 0 — Rehearse one pinned target

Run the dry run from the clean synchronization worktree:

```powershell
pnpm run dry-run:upstream-sync -- --format markdown
```

Use JSON output when another checker must consume the report. The command resolves and fetches one official branch head through its verified URL, uses a unique temporary ref, runs `merge-tree`, maps affected package and patch paths, optionally materializes a clean detached merge tree, then removes the exact ref and worktree before returning. It never updates the baseline or a branch.

Record the report's target SHA. All later Git operations use that SHA, not `upstream/master`. If the official branch advances, run a new dry run rather than silently widening the target.

## Phase 1 — Decide every conflict

For each conflict, read the script category, the affected `core-patches.json` entry, and the corresponding divergence or package owner.

- Remove a private patch when official behavior now satisfies its complete lifecycle, authority, data, and error semantics.
- Retain only the still-required delta when the official change is partial.
- Keep personal domain facts in their `@changanhua` Service or provider; adapt dependencies at the boundary.
- Resolve owner source before regenerating catalogs, bilingual records, snapshots, declarations, or lockfiles.
- Change a test assertion only when a named deliberate divergence makes the official assertion false for this fork.

Stop for an explicit human decision when resolution changes persistence format, migration, credential or authority policy, repository writes, public API, acceptance meaning, or an uncertain external side effect. Ordinary additive conflicts with an already recorded decision do not require repeating earlier choices.

## Phase 2 — Merge in an isolated branch

After target and conflict decisions are admitted, create a named branch and separate worktree from the snapshotted personal HEAD. Merge the exact target SHA with `--no-ff`. Never merge into the user's active checkout or directly into personal `master`.

If conflict resolution is required, show the affected files and decision mapping before staging. A non-trivial synchronization retains two review units:

1. merge commit — official tree plus conflict resolutions;
2. reconciliation commit — generated artifacts, test adjustments, metadata, baseline/registry updates, and documentation.

Before either commit, verify the staged paths and that no unrelated or vendor path entered the change.

## Phase 3 — Reconcile and verify

Run patch-specific commands from the dry-run report first. Reconcile only affected catalogs, declarations, pair records, lockfiles, and tests. Do not run generators speculatively or edit a derivative as its own source of truth.

Then run the DSH verification selected for the actual changed surface. The minimum personal Windows source gate is:

```powershell
pnpm run check:core-patches -- --require-observed-upstream
pnpm run check:package-identities
pnpm run build
pnpm run verify:personal-source
pnpm run typecheck:contracts-ready
```

Run documentation and Agent Note checks for changed prose. Run local Windows 10 behavior where the claim covers the user's runtime. GitHub-hosted Windows is the blocking clean compatibility carrier. Hosted Linux remains advisory unless the changed behavior owns a portable or Linux-specific contract. Never convert a known inherited failure into a pass; compare it with a trustworthy base on the same platform.

## Phase 4 — Update the owners

Only after acceptance, update `upstream-base.json` to the admitted supported base and current evidence. Recompute its merge base and divergence from Git; never copy an estimate. Update active patch revalidation fields, narrow or retire replaced entries, and keep the risk budget honest. Add a new patch only after the placement ladder proves every lower layer insufficient.

Update `FORK-DIVERGENCE.md` for current deliberate differences. Add or update one implemented process Agent Note when the synchronization required conflict decisions, generated reconciliation, test-semantic changes, or another rationale likely to guide later maintenance.

## Phase 5 — Commit and hand off

Commit only after selected checks pass or every inherited failure is explicitly bounded with same-base evidence. Inspect hook edits before continuing. A local commit is not publication.

Push, PR creation, merge into personal `master`, release, deployment, and branch/worktree cleanup are separate actions. Perform none unless the user requests that exact next action. When a push is authorized, use `dsh-pre-push-checks`, verify the live remote ref afterward, and report pending hosted checks as pending.

## Rollback and interruption

Before a merge commit, abort only inside the verified synchronization worktree. After a shared commit, revert rather than rewrite. A durable-format migration follows its own backup and restore contract; Git rollback alone is not data rollback.

After interruption, resume the exact worktree, branch, merge state, command handle, and evidence ledger. Do not rerun the dry run or reconstruct conflict decisions unless their target SHA or relevant source changed.

## Output

Return the pinned source and target SHAs, conflict classifications and decisions, affected patches and packages, exact commits, verification ledger by platform, owner-file updates, inherited failures, remaining human decisions, and the next unperformed external action. Do not call the synchronization complete from Agent self-report, merge mechanics, or one green build.
