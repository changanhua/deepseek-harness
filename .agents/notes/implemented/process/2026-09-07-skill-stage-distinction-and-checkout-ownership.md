# Agent Note: Skill stage distinction and checkout ownership

Status: implemented

English | [中文](2026-09-07-skill-stage-distinction-and-checkout-ownership.zh.md)

## Problem

The documentation and charter Skills treated a conversational product question, a local design draft, and implementation preparation as the same work: any Markdown could trigger package README templates, bilingual pairing, full `test:docs`/`doc-sync`/lint lanes, and Charter receipts with repository discovery. Exploration and local prototypes paid the cost of maintained documentation, and no rule said which checkout or package owns the target before those obligations were inferred.

## Decision

Skills that gate documentation and feature planning distinguish three requested stages before loading templates or running checks: explore or explain (answer in conversation), draft a design (produce the requested scenario/object/operation design separating accepted direction from proposed details), and prepare implementation (freeze only decisions the approved scope needs, through the full template and evidence rules). Approval of a direction is not approval of every detail or of implementation.

A local design draft — for example the `ui-prototype/` interaction prototypes — is not implemented-product documentation merely because it is Markdown. It preserves the user's language, the proposed/current distinction, provenance, and open questions; commits may retain its version history without a README skeleton, bilingual counterpart, or repository build lanes. Maintained files resolve [checkout and package ownership](../../../skills/dsh-reuse/references/checkout-ownership.md) first: a personal checkout owns its own pairing exclusions and commands, and placement follows the artifact's real lifetime and audience rather than a desire to evade required checks.

Checks are selected from the target's scripts and the actually affected corpus. A focused check does not prove broader lanes passed, and comprehensive lanes are not default prerequisites for a local draft or focused prose edit. Fact-checking separates a declared source contract from observed operation: source can establish a declared default, only the identified runtime establishes that it is active, and a verification requirement never authorizes installation, credential use, spending, publication, or a service restart; unverified operations are named with their verification owner instead of being asserted.

The [simplification Skill](../../../skills/dsh-find-simplifications/SKILL.md) applies this distinction to review, cleanup, and publication. Reviews report evidence without creating notes or TODOs; authorized changes use the current workspace and actual branch base, and follow the canonical Agent Note format and retention rules. Branch ownership does not grant permission to publish or close a PR. Consumer discovery follows manifests, entrypoints, dynamic registrations, and public contracts instead of a fixed directory list; required lifecycle protections remain part of candidate evaluation.

## Alternatives considered

**Keep one strict workflow for everything Markdown.** Rejected because it charges exploration and local drafts the full cost of maintained documentation, which either suppresses design discussion or floods the repository with ceremonial artifacts.

**Let each Skill define its own draft exceptions.** Rejected because stage distinction is a cross-cutting standard; per-Skill copies of the same relaxation drift and re-diverge over time.

**Keep drafts out of the repository entirely.** Rejected because committing a prototype preserves reviewable history and cheap revert, while its non-authoritative status stays visible through the draft rules themselves.

## Consequences

Exploration answers in conversation and design drafts stay lightweight; maintained documentation keeps its full gates, and a focused check no longer silently claims comprehensive validation. The `dsh-doc` trigger narrows to maintained documentation under actual owner rules, and `dsh-feature-charter` supports exploration without demanding a receipt, repository audit, or written file. Placement questions consult checkout ownership before package selection, so an upstream example or another checkout's skill cannot decide what this implementation owns. Unverified operations are reported as such with a named verification owner, so the absence of authority or an environment no longer produces invented evidence.
