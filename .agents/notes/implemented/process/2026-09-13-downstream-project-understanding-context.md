# Agent Note: Downstream project understanding context

Status: implemented

English | [中文](2026-09-13-downstream-project-understanding-context.zh.md)

## Problem

Cross-package analysis of the personal fork repeatedly rediscovered stable repository structure even when only a small part of the code had changed. External chat or assistant storage could cache an analysis, but that cache was detached from Git history, unavailable to other repository agents by default, and easy to confuse with current repository authority. Copying architecture facts into another large baseline document inside `docs/` would instead create duplicate ownership beside the existing architecture, subsystem, package, generated-catalog, and Agent Note tiers.

## Decision

The downstream fork keeps a small analysis cache at [`downstream/PROJECT-CONTEXT.md`](../../../../downstream/PROJECT-CONTEXT.md). It records reviewed areas and their review commits, cross-cutting navigation conclusions, open uncertainties, and an incremental-review protocol. It links to the repository-owned authority for details and explicitly loses every conflict with source, generated catalogs, subsystem references, package READMEs, and active implemented Agent Notes.

The root [`AGENTS.md`](../../../../AGENTS.md) directs repository-wide and cross-package analysis to read the downstream context first. When a target ref differs from a recorded review boundary, analysis compares the relevant history, maps changes to owning contracts and dependencies, and re-reads only conclusions that can be invalidated by those changes. Review scope follows semantic impact rather than commit count.

The context is not a generated catalog, an Agent Note index, a runtime-state cache, or a project-management database. It does not duplicate exhaustive package inventories or implementation walkthroughs. Runtime facts such as local profile composition, credentials, browser connections, CI health, and provider quotas remain observations that must be checked when a task depends on them.

## Alternatives considered

**Keep the baseline only in an assistant or external knowledge library.** Rejected as the primary home because the cache would not travel with the code, would not participate in review, and would not be automatically available to Codex, DSH, or other repository agents.

**Put a large baseline in `docs/`.** Rejected because `docs/architecture.md`, subsystem references, package READMEs, generated catalogs, and active Agent Notes already own repository facts and rationale. A second narrative baseline would drift and violate one-home-per-fact discipline.

**Rely only on root `AGENTS.md`.** Rejected because standing orders should stay short and always-in-context; storing reviewed domains, invalidation triggers, uncertainties, and review boundaries there would turn the root file into a growing analysis transcript.

**Re-scan the repository on every cross-package question.** Rejected because unchanged, already-evidenced conclusions do not become more reliable through repeated rediscovery. Revalidation should target new uncertainty introduced by relevant changes.

## Consequences

Cross-session and cross-agent analysis can reuse a repository-versioned understanding cache while repository-owned documents remain authoritative. Small unrelated changes no longer justify a whole-repository survey; shared-contract changes can still trigger a broad recheck when their semantic impact requires it.

Maintainers must update the affected review boundaries or conclusions when durable cross-cutting understanding changes. Stale cache entries remain possible, so every entry carries an authority boundary and the analysis protocol requires target-ref comparison before reuse. The extra context file is deliberately small; detailed design decisions continue to belong in Agent Notes and detailed contracts continue to belong in their existing documentation tiers.
