# Agent Note: Merge upstream dsh 0.1.1-rc.2 into the fork

Status: implemented

English | [中文](2026-08-22-merge-upstream-rc2.zh.md)

## Problem

The fork tracks `upstream/master` (`deepseek-ai/deepseek-harness`). Upstream released `dsh-v0.1.1-rc.2` (`b150a551b8`) with 207 commits over the rc.8 merge base: the image/Files request-pipeline unification (PR #2676), the revert of the #2608 permission fix (PR #2903), i18n link localization, CI workflow splitting, and session-projection refactors. The fork was 207 commits behind across 2,668 files, with no generated catalog or bilingual pairing record in step.

## Decision

Merge and reconcile in two commits, as established for rc.7/rc.8:

1. **Merge commit** `Merge remote-tracking branch 'upstream/master'`: resolves 16 conflict files. `AGENTS.md` keeps the fork's condensed constitution (divergence #1). `slot-catalog.ts` keeps the fork-only `ui-settings-skills` occupant while the `client-ui-subagent SubagentCatalogAction` occupant drops with upstream's ui-subagent refactor (SubagentHeaderLineage replaces it). Generated catalogs (`skills`/`typert` `.md`/`.zh.md`) follow upstream in dropping Source line numbers (PR #1373). Bilingual pairings merge both sides: `subsystems/README.zh.md` adopts upstream's `.zh.md` link localization while keeping the fork's task-queue index row, and `tool-catalog.zh.md` keeps the fork's task-queue tool catalog beside upstream's `experimental-tool-agent-team`, ordered to match the regenerated English source. The eight `.i18n.yaml` pairing records take the upstream blobs as placeholders, re-recorded in Phase 2/3.
2. **Reconcile commit** `fix: reconcile fork artifacts with merged upstream (rc.2)`: regenerates `gen-cordis-catalog` (stale `task-queue.md`), `gen-config-catalog` (stale `config-catalog.md`), and `gen-client-catalog` (stale `slot-catalog.ts`). Repairs a merge regression that re-added the `translation-pairing` leaf gate to `docSyncLeafGates` and its assertion in `run-gates.spec.ts` — the fork removed both (divergence #2), so they are cut again. Runs `pnpm install` to materialize ui-subagent's new `react-dom` devDependency and the upstream `credentials/authorization` workspace. Updates FORK-DIVERGENCE.md.

## Verification

`pnpm run typecheck`, `pnpm run build`, `pnpm run doc-sync`, and `pnpm run verify-doc-budgets` pass. All catalog verifiers pass (`verify-cordis-catalog`, `verify-tool-catalog`, `verify-config-catalog`, `verify-persistence-catalog`, `verify-client-catalog`). The full `pnpm run test` shows the two merge-introduced failures fixed (run-gates assertion, ui-subagent `react-dom` resolution) and only pre-existing Windows environment failures remain (symlink EPERM across fs/lsp/skill/workspace/doc-site suites, the schedule runtime boundary case whose source, tests, and dependencies are unchanged by this merge, and the pwsh-persistent timeout); the one `acp-snapshot` failure in the second run is flaky and passes in isolation.

## Alternatives considered

**Auto-resolve conflicts with `-Xours`/`-Xtheirs`.** Rejected: every conflict in a divergence-listed file or generated catalog is a judgment call that must keep both sides' additive content.

**Regenerate catalogs only when the verify gate fails.** Rejected: the generated files encode merged source truth, so they must be regenerated after every merge regardless of gate state.

**Skip the FORK-DIVERGENCE update.** Rejected: the record is the reconciliation reference for the next merge; stale merge-base and missing divergences make the next conflict triage harder.

## Consequences

The fork is now 48 commits ahead of the rc.2 merge base with zero upstream commits missing (the merge base is the upstream tip itself). Future merges can run the `dsh-merge-upstream` skill end-to-end with human checkpoints at conflict resolution and test-assertion adjustment. The pre-existing Windows symlink-EPERM environment failures remain outside reconcile scope and should be addressed separately if the fork's CI starts gating on them.
