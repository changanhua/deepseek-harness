# Cookbook: reconciling a large upstream merge

English | [中文](merging-upstream.zh.md)

Use this guide when a downstream DSH fork must absorb a large `upstream/master` update while preserving fork-owned packages and local work. The outcome is a reviewable candidate branch with known ancestry, current generated artifacts, focused runtime evidence, and an explicit list of unresolved baseline debt; this guide does not authorize a push or release.

## 1. Freeze the scope before touching Git

Start by proving which checkout, branch, and upstream ref are in scope. A dirty root or personal worktree is protected input, not a merge target.

```powershell
git status --short --branch
git worktree list
git remote -v
```

Record the protected directories, active services, data roots, and any named dirty files. Do not reset, clean, force-switch, delete, or stop them as a shortcut for making the merge easier.

Fetch the intended upstream ref and record its object id, the merge base, and the ahead/behind counts before creating a candidate.

```powershell
git fetch upstream --prune
git rev-parse --verify upstream/master
git merge-base HEAD upstream/master
git rev-list --left-right --count HEAD...upstream/master
```

## 2. Create an isolated candidate and leave checkpoints

Create a fresh worktree from the verified source branch, then merge upstream there. Substitute the actual source ref and branch names after checking them; do not infer them from a stale task title.

```powershell
git worktree add .worktrees/upstream-merge -b codex/upstream-merge <source-ref>
git -C .worktrees/upstream-merge merge --no-ff upstream/master
```

Install dependencies in the candidate itself. Never junction or symlink one worktree's `node_modules` into another: pnpm may recreate the target and mutate the wrong checkout. When a non-interactive Windows install needs to recreate modules, set `CI=true` and keep the resulting install scoped to the candidate.

At the end of every session, save a short checkpoint containing the candidate path, branch, HEAD, merge base, completed waves, next exact command or file set, known failures, and whether a failure is baseline or change-related. Resume from the checkpoint and the existing terminal handle instead of repeating discovery or restarting a long command.

## 3. Classify conflicts by ownership

List unresolved paths and assign each to an owner before editing. The order matters because later layers depend on shared contracts.

```powershell
git diff --name-only --diff-filter=U
git status --short
```

- Shared contracts come first: Session and log format, Connection, LLM, Host/Client composition, and generated Remote declarations.
- Fork-owned capability families come next: Browser, Content, Queue, Runtime/Capability, UI, and vision-relay packages that upstream may not contain.
- Configuration, manifests, aliases, lockfiles, generated catalogs, docs, and snapshots come last and remain primary-owned integration files.
- If a bilingual sidecar stops the merge, let the pairing driver resolve safe records; after an already-stopped merge, run `pnpm run resolve-translation-pairing-conflicts` and handle remaining owner conflicts manually.

Do not resolve functional conflicts with blanket `ours` or `theirs`. Read the source, tests, package manifests, Loader rows, Profile or Bundle wiring, and the owning Agent Note; restore each capability deliberately. Remember that a whole-row bundle replacement must restate every required field.

## 4. Reconcile in bounded waves

Use small commits so a later session can identify the last trustworthy state and a reviewer can separate contract repair from generated churn.

1. Make the shared type and lifecycle contracts compile, including both Host and Client aggregate programs.
2. Repair Profile, Bundle, Loader, aliases, and package references so the intended composition can actually load.
3. Restore or adapt fork-owned packages and test doubles against the current shared contracts.
4. Regenerate catalogs and other derived files from their source owners; never hand-edit generated regions.
5. Refresh only the snapshots whose runtime contract changed, with platform-specific assertions where Bash and PowerShell differ.

For every restored package, trace the complete path from source and `package.json` through TypeScript references, Loader/Profile composition, built artifacts, and one runtime or replay test. A package directory, an HTTP 200 response, or a successful static configuration parse is not proof that the active product uses it.

## 5. Regenerate and verify derived artifacts

Run each generator after its source contracts settle, then run the corresponding freshness check. Typical DSH merge checks include:

```powershell
pnpm run gen-cordis-catalog
pnpm run gen-tool-catalog
pnpm run gen-client-catalog
pnpm run gen-persistence-catalog
pnpm run verify-cordis-catalog --check
pnpm run verify-tool-catalog
pnpm run verify-client-catalog
pnpm run verify-persistence-catalog
pnpm run verify-cordis-config
pnpm run verify-client-packages
```

Generated documentation is downstream of source JSDoc and type declarations. If a freshness or documentation gate exposes pre-existing missing prose, stale links, or type-equivalence drift, capture the exact output and compare it with the pre-merge candidate; do not weaken the generator or hide the failure by editing its output manually.

## 6. Validate from narrow evidence to broad evidence

Use a validation ladder that makes the first failure attributable.

1. Run `git diff --check` and the smallest package or contract tests for the changed wave.
2. Run the complete project-reference typecheck, not only a leaf project.
3. Run `npm run build` so Host, Client, generated contracts, and Web artifacts are rebuilt together.
4. Run focused Web or unit scenarios that exercise the repaired entry path, then inspect persisted session or snapshot evidence.
5. Run broad Web and documentation suites only after the built runtime closure is complete.

When a broad suite is red, reproduce the same gate on the pre-merge candidate or compare its exact failure class to the baseline. Label each result as change-related, baseline debt, or infrastructure uncertainty. A build can pass while Web startup, profile composition, persistence, or real provider behavior still fails; do not call a merge release-ready from build output alone.

Platform-specific snapshots need special care. Keep a canonical fixture when possible, make direct assertions platform-aware, normalize only transport noise such as an optional PTY completion marker, and never normalize away a real tool error or a changed capability.

## 7. Close the merge without losing the evidence

Before declaring the local integration complete:

- Update [`FORK-DIVERGENCE.md`](../../FORK-DIVERGENCE.md) with the supported upstream base and any deliberate fork-only behavior.
- Add or update an implemented process or testing Agent Note for non-trivial conflict resolution, including alternatives, consequences, verification, and named coverage gaps.
- Re-record every edited bilingual pair with `pnpm run verify-translation-pairing --write <pair>` and run the named-pair check.
- Confirm `git status --short --branch`, the final ahead/behind count, the exact commits, and `git diff --check`.
- Report unresolved baseline gates explicitly and keep the candidate unpushed unless publication was separately authorized.

## Lessons from a multi-session merge

- Session count is not the unit of progress; a committed checkpoint with an exact next action is.
- Worktree isolation protects both the merge candidate and the user's unrelated WIP, but shared dependency directories can defeat that isolation.
- Shared contracts and runtime composition must settle before personal package restoration and generated output refresh.
- Focused runtime evidence identifies a real regression faster than a long broad suite; broad failures still need a baseline comparison.
- “Local merge is reviewable” and “repository is release-ready” are different claims with different evidence.

## Further reading

- The [development guide](../development.md) owns the aggregate build and daily contributor workflow.
- The [testing policy](../testing.md) owns real-provider, profile, replay, and credential boundaries.
- The [fork divergence record](../../FORK-DIVERGENCE.md) owns deliberate downstream differences.
- The [upstream merge reconciliation Agent Note](../../.agents/notes/implemented/process/2026-09-14-upstream-merge-reconciliation.md) records the concrete checkpoint that motivated this guide.
