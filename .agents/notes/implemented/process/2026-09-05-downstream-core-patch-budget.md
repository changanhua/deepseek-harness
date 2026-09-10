# Agent Note: Downstream core patch inventory and budget

Status: implemented

English | [中文](2026-09-05-downstream-core-patch-budget.zh.md)

## Problem

The fork divergence document explains deliberate differences but cannot prove that every new edit to an upstream-owned runtime or build file belongs to a reviewed patch series. Git history alone also cannot infer whether a change is a personal product, a compatibility adapter, a generally useful upstream candidate, or an accidental core edit. Without a machine owner, private patches can spread across shared files, exceed one maintainer's review capacity, and survive after upstream provides an equivalent capability.

The package identity registry owns npm provenance. Reusing it for Git baselines or runtime patches would combine unrelated authority and let package classification changes rewrite the supported upstream decision.

## Decision

[`upstream-base.json`](../../../../upstream-base.json) is the only machine owner of the supported upstream commit, last observed upstream commit, recorded personal head, merge base, ahead/behind counts, revalidation time, and bounded runtime evidence. The recorded personal head is the audited input revision rather than a self-reference to the commit that contains the JSON file; it must remain an ancestor of the checked head. [`downstream/package-identities.json`](../../../../downstream/package-identities.json) uses schema version 3 and contains no upstream revision fields.

[`core-patches.json`](../../../../core-patches.json) owns the active private core patch inventory and three ceilings: active patch count, aggregate risk points, and critical patch count. One entry represents one named patch series and records its owner, introducing commits, affected upstream paths and packages, placement rationale, fact/data/security effects, tests, canary commands, migration and rollback, replacement condition, upstream reference, review expiry, conflict sites, last revalidated upstream revision, and risk.

[`scripts/check-core-patch-budget.ts`](../../../../scripts/check-core-patch-budget.ts) compares the supported base with the requested personal head. Added, modified, deleted, renamed, and type-changed upstream-owned runtime, build, workflow, and repository-control paths require coverage by an active entry. The check excludes `vendor/`, documentation, Agent Notes, package READMEs, bilingual sidecars, registered personal packages, and bounded downstream-owned additions because their existing owners and checks govern them; an unregistered addition inside an upstream-owned package remains in scope.

The checker rejects missing required fields, duplicate ids, cross-package wildcard patterns, evidence paths outside the repository, absent evidence files, absent or unreachable introducing commits, expired reviews, baseline-history disagreement, uncovered upstream paths, and exceeded budgets. A compatibility adapter must state `factOwnershipEffect: "none"`; adapters cannot become business-state owners. An ordinary fork checkout reports whether the observed upstream object was available, while an upstream-aware caller uses `--require-observed-upstream` to make absence an error. The initial inventory contains ten active series at 66 of 70 risk points, with one critical series; the structured report owns the current covered-path count.

## Alternatives considered

**Keep only `FORK-DIVERGENCE.md`.** Rejected because human prose cannot reliably detect a newly modified core path, enforce expiry, or calculate a risk budget.

**Generate patch ownership automatically from Git commits.** Rejected because commit topology proves ancestry, not product ownership, placement rationale, security impact, or replacement conditions. A maintainer must make those decisions explicitly.

**Compare every change only with the latest upstream tip.** Rejected because the personal distribution supports a deliberate stable base. Latest-upstream compatibility is an advisory canary until a separate admission decision moves the supported base.

**Allow one broad `packages/**` registry entry.** Rejected because it would make the check green while hiding exactly the new cross-domain core edits the registry exists to expose.

## Consequences

Every retained upstream core edit has a searchable patch-series owner and an explicit removal path. New core work either fits an existing bounded series or requires a visible registry and budget decision. The remaining four risk points deliberately leave little capacity: another high-risk or critical patch requires removal, replacement, upstream contribution, or an explicit budget revision rather than silent accumulation.

The registry is governance evidence, not proof that a patch is correct, that its test command passed in the current environment, or that the latest upstream can merge. Focused tests, Windows acceptance, the latest-upstream canary, data migration checks, and human decisions retain those responsibilities. The related [repository-owned npm identity](2026-09-04-repository-owned-npm-scope.md) remains active because package provenance and publication authority are independent decisions.
