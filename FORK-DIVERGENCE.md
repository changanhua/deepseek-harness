# Fork divergence record

A manually maintained record of current deliberate differences between this fork and the official upstream, used as the reconciliation reference when merging upstream. Owned by the repository owner; agents do not auto-update this file.

## Identity

- The official upstream tip and this fork share merge base `cd5ef81481` (upstream `dsh-v0.1.2-alpha.1`). After the reconciliation merge, the fork sits 96 commits ahead of that base; upstream has no commits this fork lacks.
- Official upstream: `https://github.com/deepseek-ai/deepseek-harness.git`
- This fork: `https://github.com/changanhua/deepseek-harness.git`

## Divergences

| # | Area | Difference |
|---|---|---|
| 1 | `AGENTS.md` root | Restructured from a 154-line development manual to a ~60-line operating constitution. Core invariants kept in root; TypeScript/convention/policy rules moved to `docs/development.md`, `docs/testing.md`, `docs/cordis-primer.md`. |
| 2 | `scripts/run-gates.ts` | `translation-pairing` gate removed from `docSyncLeafGates`; `verify-translation-pairing` not run in `doc-sync`/CI. |
| 3 | `lefthook.yml` | Pre-commit and pre-merge-commit `translation-pairing --cached` hooks removed. |
| 4 | Chinese pairing | Chinese counterparts may fall out of sync without blocking CI. English is the source of truth; Chinese is owner-only. Scheduled daily sync is a future-work candidate (see `docs/future-work-candidate.md`). |
| 5 | `docs/lesson.md` (+ `.zh.md`) | New; records environment-diagnosis lessons. |
| 6 | `docs/future-work-candidate.md` (+ `.zh.md`) | New; capability/policy candidates. |
| 7 | `docs/AGENTS-maintenance.md` (+ `.zh.md`) | New; owning/editing guide for root, global, and subtree AGENTS.md files. |
| 8 | `docs/development.md`, `docs/testing.md`, `docs/cordis-primer.md`, `docs/AGENTS.md` | Rules relocated out of root `AGENTS.md` into these secondary docs. |
| 9 | `.agents/skills/dsh-code-review/SKILL.md` | Removed a dead link to a removed AGENTS.md section. |
| 10 | `.agents/notes/implemented/feature/2026-07-30-web-read-card.{md,zh.md}` | Fixed a dead fragment anchor. |
| 11 | `packages/host/capability-registry/README.md` | Removed a dead link to a nonexistent `README.zh.md`. |
| 12 | `packages/bundle/web-app` | Fork allows `--host 0.0.0.0` (LAN publishing on a trusted network, warning only); upstream rejects it for safety. Kept as a deliberate fork choice. |
| 13 | `packages/task-queue/*`, `packages/client/ui-task-queue` | Fork-only durable cross-session task-queue capability: service seam, local/remote backends, ten `task_queue_*` tools, `/queue` command, and browser Queue workspace. Upstream has no equivalent. |
| 14 | `docs/specs/` | Fork-only design-spec documents (research baseline, task-queue design, UI prototypes). |
| 15 | `packages/context/runtime-facts*`, `packages/extensions/tool-runtime-inspect` | Fork-only owned runtime-fact registry, Host fact projection, and read-only inspection tool. |
| 16 | `packages/host/capability-registry`, `packages/client/ui-capability`, `packages/client/ui-settings-skills` | Fork-only read-only capability and Skills-management projection over the `capabilityRegistry` Remote. |
| 17 | `packages/client/ui-layout`, `packages/client/ui-sidebar` | Fork keeps the `shell.view`/`sidebar.modules` module ring so Queue and Capability views can replace the center view without unmounting conversation state. |

## Non-divergence workspace residue

Not fork divergences; uncommitted local reconstruction from an earlier incident, committed or discarded independently:

- `apps/cli/config/agent-presets/*/agent.cordis.yml`
- `packages/compaction/compaction-basic/src/summarizer.ts`
