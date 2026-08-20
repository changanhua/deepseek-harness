# Agent Note: Merge upstream dsh 0.1.0-rc.8 into the fork

Status: implemented

English | [中文](2026-08-21-merge-upstream-rc8.zh.md)

## Problem

The fork tracks `upstream/master` (`deepseek-ai/deepseek-harness`). Upstream released `dsh-v0.1.0-rc.8` (`141eb6fef8`) with 536 commits over the rc.7 base — large enough that manual merge-and-forget left the fork with stale generated catalogs, broken tests, and drifted docs. The previous rc.7 merge showed the pattern: conflicts appear in the FORK-DIVERGENCE-listed files plus every generated catalog, and tests must be synced to fork reality afterward.

## Decision

Merge and reconcile in two commits, as established for rc.7:

1. **Merge commit** `Merge remote-tracking branch 'upstream/master'`: resolves 22 conflict files. Fork-side entries (task-queue tools, capability-registry, sidebar.modules, ui-conversation deps, tsconfig task-queue refs) are kept beside upstream additions (experimental agent-team tools, brand slots, file/session-reference remotes, ui-renderer rename). `AGENTS.md` keeps the fork's condensed form. The `ui-settings-skills` dependency on the retired `web-react` package was retargeted to `ui-renderer` (its upstream rename).
2. **Reconcile commit** `fix: reconcile fork artifacts with merged upstream (rc.8)`: regenerates the cordis/client/config/doc-graphs/tool catalogs, adapts fork tests to upstream API changes (`commands.execute` gained an `images` param; web-app gained an `openBrowser` default; sidebar gained brand slots and module state), adds JSDoc to fork package exports, syncs the skills subsystem type-equiv docs, brings fork package READMEs into the model-experience/limitations gates, and raises the `docs/testing.md` doc budget for merged upstream content.

## Reconcile checklist (encoded in the dsh-merge-upstream skill)

- Regenerate every generated catalog (`gen-cordis-catalog`, `gen-client-catalog`, `gen-config-catalog`, `gen-doc-graphs`, `gen-tool-catalog`).
- Update the fork-only `ui-settings-skills` dependency and tsconfig reference when upstream renames a package the fork consumes (`web-react` → `ui-renderer`).
- Classify test failures: fork-reality assertion drift (update the test) vs environment (Windows symlink EPERM) vs parallel-run interference (rerun in isolation).
- Run `verify-export-jsdoc`, `verify-type-equiv`, `verify-doc-budgets`, and the package README gates; add JSDoc and README sections where the fork's packages fall short.
- Update FORK-DIVERGENCE.md: refresh the merge base and ahead count, and record newly confirmed divergences (web-app LAN publishing, task-queue capability, docs/specs).

## Verification

`pnpm run typecheck` and `pnpm run build` pass. Focused test suites for the adapted packages pass (command-task-queue 9, web-app startup 5, gen-tool-catalog 10, ui-sidebar 6). `verify-cordis-catalog --check`, `verify-type-equiv`, `verify-export-jsdoc`, `verify-doc-budgets`, and both package-README gates pass. The full `pnpm run test` still shows Windows-symlink EPERM and parallel-interference failures that predate this merge; the doc-sync markdown-wrap and documentation-site failures are pre-existing fork doc/environment issues, not merge regressions.

## Alternatives considered

**Auto-resolve conflicts with `-Xours`/`-Xtheirs`.** Rejected: every conflict in a divergence-listed file or generated catalog is a judgment call that must keep both sides' additive content.

**Regenerate catalogs only when the verify gate fails.** Rejected: the generated files encode merged source truth, so they must be regenerated after every merge regardless of gate state.

**Skip the FORK-DIVERGENCE update.** Rejected: the record is the reconciliation reference for the next merge; stale merge-base and missing divergences make the next conflict triage harder.

## Consequences

The fork is now 46 commits ahead of the rc.8 merge base with zero upstream commits missing. Future merges can run the `dsh-merge-upstream` skill end-to-end with human checkpoints at conflict resolution and test-assertion adjustment. The two pre-existing doc/environment gate failures (markdown-wrap on fork docs, symlink EPERM on Windows) remain out of the reconcile scope and should be addressed separately if the fork's CI starts gating on them.
