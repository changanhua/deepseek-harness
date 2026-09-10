# Resolve the checkout and package owner

Use this reference for personal packages, upstream integration, or a capability whose location or scope may have changed. Pure product discussion does not require this discovery. Resolve the identity once and pass it to the next workflow.

## Establish the target

Record the editing checkout, branch/HEAD, dirty paths, and subject checkout or runtime if different. The directory from which this Skill was loaded is not proof that it contains the latest personal implementation. When the user reports a refactor absent from the editing checkout, inspect `git worktree list --porcelain` and the specifically relevant local targets. Distinguish their results; do not switch, merge, cherry-pick, or copy files across worktrees as a discovery step. If multiple candidates leave the write target ambiguous, resolve it with the user before editing.

## Resolve ownership from the target's source

1. If the target has `downstream/package-identities.json`, read its schema and relevant records together with owning package manifests. The personal scope can be `@changanhua` while directories remain under `packages/<group>/<package>`; directory position and an old `@deepseek-ai` example do not establish ownership.
2. Read the target's identity checker and workspace manifest to establish listed, default, and exceptional ownership. Do not hard-code package counts, registry schemas, or a second personal-package list in Skills.
3. Trace the specific dependency and Bundle/Profile patch exposing the capability. Personal package ownership does not make the CLI, base Bundle, shared core, or active runtime personal. A renamed manifest does not prove that a Profile loads it.
4. If the registry is absent, use the target's manifests, source and composition. Report its absence in that checkout, not absence of the personal implementation from other identified targets. Checks found in another worktree are not commands available in this one.

Historical reports, generated inventories, and divergence notes are discovery hints until their relevant claims agree with current source. When instructions and source disagree, report the precise discrepancy; do not silently substitute a stale package name or treat source as permission to disregard applicable instructions.

## Select the change and evidence

Classify the affected responsibility as personal package, upstream-owned component, or their integration. Inspect only applicable instructions, contracts, scripts, and affected consumers. Personal ownership does not exempt a package from instructions applying to its directory, nor make every upstream validation command necessary for every edit.

Use package-owned tests for a confined change; add composition, generated declarations, shared-consumer tests, and runtime evidence when the changed promise crosses those boundaries. Resolve commands from the target's scripts. On Windows, separate runnable local checks from genuinely Linux-only checks and identify their CI owner; do not require Linux deployment or claim unrun checks passed.

Personal development may change core when the benefit and affected contract justify it. Compare that option with an adapter or Bridge on semantics and maintenance cost, not fewest edited files. Treat upstream as a selective source of useful parts, not a required merge destination for personal changes.

Pass a compact result: target identity; relevant registry record and manifest; Definition/Provider/Consumer/Bundle owners where applicable; affected boundary; selected checks and unverified runtime. Reuse it until those inputs change.
