# Agent Note: Evidence-led feature reuse audits before DSH design

Status: implemented

English | [中文](2026-08-27-feature-reuse-audit.zh.md)

## Problem

Feature design can begin from the requested mechanism before checking DSH's existing Service Definitions, Providers, Consumers, WorkKinds, Skills, runtime composition, and active decisions. A package name or source search then becomes an unreliable proxy for capability coverage, while community repositories are either overlooked or treated as ready dependencies without checking their lifecycle, authority, scripts, license, or provider assumptions. The result is avoidable duplicate runtime behavior or an oversized abstraction introduced to connect capabilities that already have stable owners.

## Decision

The repository provides the [`dsh-reuse`](../../../skills/dsh-reuse/SKILL.md) workflow for uncertain feature proposals before implementation planning. It starts from the user outcome, searches current DSH definitions, implementations, composition, consumers, tests, and active rationale by semantics, then inspects the relevant Profile and scoped Skills, Tools, MCP entries, and WorkKinds. Community search begins only after the local semantic gap is explicit and remains read-only until the user authorizes an installation or implementation.

The workflow produces one `direct reuse`, `adapt`, `bridge`, `vendor/fork`, or `build` decision with evidence classes, dependency direction, minimum justified code, non-goals, verification, confidence, and freshness. It records the current branch and worktree state and distinguishes committed source, current-checkout WIP, installed-but-unevaluated candidates, proposals, and verified runtime capability. Negative text search is not absence proof, and uncommitted source is overlap evidence rather than proof of a shipped capability.

Reuse preserves DSH's capability ownership. Consumers depend on Service Definitions rather than concrete Providers; a cross-domain integration is a reversible Bridge plugin; Bundles select Providers and deployment configuration. The audit's generated or textual capability inventory is a development projection, never a second runtime registry or a dependency of product plugins.

Community intake records a fixed version, license, scripts, network and credential behavior, filesystem writes, output validation, model assumptions, evaluation evidence, and update procedure. Search results, stars, and installation counts identify candidates but grant no adoption authority. A useful instruction bundle may be pinned and constrained without importing unrelated provider scripts.

The workflow is not selected for already-scoped mechanical work or a defect with a known owner. [`dsh-find-simplifications`](../../../skills/dsh-find-simplifications/SKILL.md) continues to own broad audits of shipped duplication, dead behavior, and over-built implementation; the reuse audit prevents uncertain new surface before it lands.

## Alternatives considered

- **Add only a standing root instruction to search before building** — rejected because a short standing rule cannot carry the source map, community intake checks, lifecycle comparison, dependency test, report format, and calibrated example, while loading all of that in every session would waste context.
- **Create a central runtime capability registry that every plugin consults** — rejected because Cordis services and `inject` already own runtime discovery. Another authority would duplicate registration and couple otherwise independent product plugins to development-time intelligence.
- **Search community registries before reading DSH** — rejected because names and popularity do not reveal local ownership, composition, durability, or authorization, and an external candidate can reproduce behavior DSH already ships behind another term.
- **Extend `dsh-find-simplifications` to cover proposed features** — rejected because its broad post-implementation survey, deletion evidence, and Agent Note consolidation workflow are materially heavier than a time-bounded pre-design decision and have different completion conditions.

## Consequences

Uncertain new features pay a bounded evidence cost before implementation, and the report makes a new package or state machine justify the exact semantics existing capabilities lack. Direct reuse and Bridge decisions become visible alternatives instead of incidental discoveries during coding. Community adoption gains provenance and review cost, but avoids unpinned execution and hidden side effects. Mechanical changes retain the repository fast path, and product plugins acquire no dependency on the audit workflow or its disposable search projections.
