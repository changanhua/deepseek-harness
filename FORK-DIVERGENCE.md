# Fork divergence record

A human-readable record of deliberate differences between this fork and the official upstream, used as the reconciliation reference when merging upstream. The machine-checked [package identity registry](downstream/package-identities.json) owns npm scope, repository identity, and the explicit personal-package set.

## Identity

- Supported upstream base: `cd5ef8148158c3a752a658978873241fdf8e2bbc` (`dsh-v0.1.2-alpha.1`).
- Observed upstream tip on 2026-09-04: `76fda729799fe9b3848dbe2c211d4b231032b81e`.
- Official upstream: `https://github.com/deepseek-ai/deepseek-harness.git`
- This fork: `https://github.com/changanhua/deepseek-harness.git`
- Official packages retain `@deepseek-ai/*`; repository publication tooling permits them only from a GitHub Actions run for `deepseek-ai/deepseek-harness`. Personal packages target `@changanhua/*` and remain blocked until their registry policy is promoted from `blocked-until-rescoped` to `personal`. npm credentials and trusted-publisher policy remain the external authority.

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
| 18 | `downstream/package-identities.json`, publication scripts and workflows | Forty-one explicit personal packages target `@changanhua/*`; repository tooling rejects cross-repository npm publication before registry access, and public Python publication remains official-repository-only. These checks prevent accidental use of repository release paths; registry credentials remain the security authority. Package names remain unchanged until a separate rescope change closes their dependency and configuration references. |

## Non-divergence workspace residue

Not fork divergences; uncommitted local reconstruction from an earlier incident, committed or discarded independently:

- `apps/cli/config/agent-presets/*/agent.cordis.yml`
- `packages/compaction/compaction-basic/src/summarizer.ts`
