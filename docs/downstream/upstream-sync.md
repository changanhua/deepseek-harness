# Upstream synchronization SOP

English | [中文](upstream-sync.zh.md)

## Summary

Synchronize the personal fork only from a fixed official commit through an isolated branch and worktree. The dry run records the Git snapshot, predicts conflicts, maps affected private patches, proves a clean synthetic tree can be materialized, and removes all temporary refs and worktrees. It never admits a base, resolves a conflict, commits, pushes, publishes, or touches the user's dirty checkout.

## Table of Contents

- [Preconditions](#preconditions)
- [Run the dry run](#run-the-dry-run)
- [Classify the result](#classify-the-result)
- [Perform an admitted synchronization](#perform-an-admitted-synchronization)
- [Verification and evidence](#verification-and-evidence)
- [Rollback](#rollback)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

<a id="preconditions"></a>

## Preconditions

Start from a clean synchronization worktree, not the user's everyday checkout. No merge, cherry-pick, revert, or rebase may be active. The `upstream` remote must resolve to the repository recorded by `upstream-base.json.officialRepository`; a different URL fails before fetch. Preserve the current branch name, HEAD, `upstream-base.json`, `core-patches.json`, `FORK-DIVERGENCE.md`, and the latest canary report as the synchronization snapshot.

The latest-upstream canary is observation, not admission. A green synthetic merge means Git found no textual conflict; it does not prove personal behavior, persisted data, security policy, or acceptance.

<a id="run-the-dry-run"></a>

## Run the dry run

Run the repository command from the clean synchronization worktree:

```powershell
pnpm run dry-run:upstream-sync -- --format markdown
```

Use `--upstream-branch <branch>` only for a reviewed official branch. Use `--format json` for evidence automation. The script validates arguments and branch syntax, resolves the official SHA before fetch, fetches that exact branch through the verified URL into a unique `refs/dsh/upstream-sync-dry-run/*` ref, and rejects a branch that advances between resolution and fetch.

The script compares the supported official base with the pinned target, runs `git merge-tree` against the personal HEAD, groups changed package paths, maps them to active `core-patches.json` entries, and recommends patch-specific plus platform checks. A clean merge tree is wrapped in an unreferenced two-parent commit, checked out once as a detached worktree under the system temporary directory, verified clean, and removed. The temporary ref is deleted before the report returns. Git objects may remain until ordinary garbage collection; no branch, remote-tracking ref, `FETCH_HEAD`, source file, index, or user data is changed.

<a id="classify-the-result"></a>

## Classify the result

Classify every conflict before editing. The script supplies the mechanical category; the maintainer supplies the product decision.

| Category | Required decision |
|---|---|
| `registered-core-patch` | Compare the named patch's reason, safety/data effect, tests, and exit condition with the official change. Remove the private patch when official behavior is equivalent; otherwise preserve only the still-required delta. |
| `personal-product` | Keep the personal package's domain and fact ownership. Adapt only its dependency on the changed official interface. |
| `generated-artifact` | Resolve the owner source first, then regenerate and re-record the derivative; never hand-merge the output as authority. |
| `documentation` | Merge current behavior and unique rationale, preserve bilingual structure, then re-record the pair. |
| `test` | Decide whether the failure exposes a fork regression or asserts behavior the fork deliberately replaces. Change an assertion only with a named divergence. |
| `other-upstream` | Inspect ownership and the [feature placement policy](feature-placement.md) before retaining any personal edit. |

Any conflict involving persistence format, migration, credentials, authority, repository writes, acceptance, or uncertain external side effects stops automatic progress for an explicit human decision.

<a id="perform-an-admitted-synchronization"></a>

## Perform an admitted synchronization

After the target SHA and conflict decisions are accepted, create a named synchronization branch in a separate worktree from the snapshotted personal HEAD. Merge the exact reported SHA, never a moving `upstream/master`. Do not use `-Xours`, `-Xtheirs`, `reset --hard`, or an automatic conflict resolver for divergence-listed files.

Keep two review units when reconciliation is non-trivial: the merge commit contains the official tree and conflict resolutions; a following reconciliation commit contains generated artifacts, test adjustments, package metadata, registry updates, and documentation. Do not push, merge the personal `master`, or publish unless the user separately requests that action after verification.

Update each owner only after the merged behavior is accepted. `upstream-base.json` receives the supported base, observed head, merge base, divergence, revalidation time, and bounded evidence. `core-patches.json` removes replaced patches, narrows retained paths, and updates revalidation fields without hiding new risk. `FORK-DIVERGENCE.md` summarizes deliberate differences; it does not replace either machine owner.

<a id="verification-and-evidence"></a>

## Verification and evidence

Run the dry-run report's patch-specific commands first. Then validate the core patch registry against complete official history. On the admitted merged tree, GitHub-hosted Windows is the clean blocking compatibility carrier; local Windows 10 remains the primary environment for personal runtime behavior. The minimum Windows source gate is package identity, full build, personal source-distribution verification, and contract typecheck. Hosted Linux remains advisory unless the changed claim owns a portable or Linux-specific contract.

Record the target SHA, source HEAD, merge commit, reconciliation commit, conflict decisions, commands, platform, outputs or artifact references, known inherited failures, and human acceptance. An Agent report, a merge-tree result, or a green build alone does not admit the base.

<a id="rollback"></a>

## Rollback

Before a merge commit, abort only inside the dedicated synchronization worktree and verify its branch and path first. The default dry run needs no rollback because it deletes its exact temporary ref and worktree before returning. If cleanup fails, preserve the reported path and stop; do not recursively delete an unresolved target.

After a local merge commit but before sharing, retain the old personal branch and remove the exact isolated synchronization branch or worktree only under explicit cleanup scope. After a shared commit, revert the merge or reconciliation commit; do not rewrite shared history. If the synchronization includes a durable-format migration, follow the separate backup, forward-migration, and restore contract before changing production data.

<a id="further-exploration"></a>

## Further Exploration

- [Upstream compatibility canary](upstream-compatibility.md)
- [Feature placement policy](feature-placement.md)
- [Downstream core patch registry](core-patch-registry.md)
- [Fork divergence record](../../FORK-DIVERGENCE.md)

## Dev Note

The dry run deliberately cleans its worktree instead of becoming the actual merge workspace. This keeps observation repeatable and makes the later named synchronization worktree an explicit admission action.
