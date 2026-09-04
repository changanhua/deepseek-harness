---
name: dsh-runtime-composition-debug
description: Use in the deepseek-harness repository when source, tests, generated declarations, Profile/Bundle wiring, Loader startup, built Host/Client artifacts, runtime scope, or a real DSH behavior disagree or are unexpectedly absent. Diagnose the first divergence in source-contract → generated-declaration → Profile/Bundle composition → Loader activation → built Host/Client artifacts → runtime scope → real behavior, defaulting to read-only evidence. Classify the result as contract-absent, generated-stale, composition-missing, activation-failed, artifact-stale, scope-mismatch, behavior-defect, or unverified. Do not use for a pure-function bug with no composition boundary, or to design a new plugin/capability.
---

# DSH Runtime Composition Debug

DSH is a composed product. A correct source edit may never reach the Profile a user runs; a correctly mounted contributor may be hidden in another scope; a rebuilt web shell may still serve an old dynamic Client bundle. This skill is `systematic-debugging` Phase 1 for DSH multi-component symptoms: establish reproducibility and recent changes, state one first-layer hypothesis, then collect layered evidence to diagnose the **first** divergence. Do not rebuild, restart, or change code before that diagnosis.

Default to read-only observation. Inspect source, generated files, config, process identity, logs, and supported status/dump commands before any mutation. Starting/stopping a Profile, changing configuration/data, clearing generated artifacts, rebuilding, restarting, killing processes, or making a real Provider request requires separate authorization when it changes user state, service availability, credentials, or durable data.

## Reuse prior evidence and bound parallel diagnosis

Consume fresh evidence records from [the handoff protocol](../dsh-feature-delivery/references/handoff-evidence.md) and begin at the earliest unproven layer. Do not rescan a layer whose subject identity and inputs still match. A new symptom or identity mismatch invalidates only that layer and dependent later observations.

The primary agent owns the single hypothesis, first-divergence decision, and classification. Subagents may inspect distinct read-only layers concurrently only when they use the same recorded subject identity and cannot mutate state; each returns evidence, not a competing diagnosis. Do not parallelize repairs or run later-layer behavior probes before earlier boundaries are established.

Produce a `DiagnosisReceipt` with identities, reused evidence, first divergence, primary classification, safe next action, and the evidence layers invalidated by the diagnosis. The repair and completion workflows consume this receipt without restarting the entire feature process.

## When DSH diagnoses DSH

Do not merge the diagnosing Agent's world with the target process merely because both are DSH. Record separately: the **diagnostic DSH identity** (its checkout/build/Profile/home/ports, Agent and authority), the **subject identity** (the checkout/build/Profile/home/ports and process whose symptom is reported), and any **controller/executor identity** that launched or modified the subject. A diagnostic Agent's own source, build, scope, logs, or successful Tool call is evidence only about that diagnostic DSH unless identity equality is explicitly proven — and equality is usually a reason to classify the target boundary as `unverified`, not a shortcut.

Prefer a known-good or previously approved diagnostic/verifier installation when the target changes runtime, Loader, composition, or verification logic. Keep target and diagnostic Profile homes and ports distinct. Never attach a config dump, status command, or browser to an unspecified process; confirm the exact subject process and its data root first. For a changed runtime/debug/verification Skill, its self-diagnosis cannot be the sole proof of the subject's behavior; obtain an independent world observation after diagnosis through the subject entry path.

## Boundaries

Use this skill for an observed DSH composition symptom, for example:

- a new Service/Tool/Skill exists in source but not in a selected Profile;
- the Loader rejects a package or the service is absent after startup;
- a Host/Client contract works in source tests but a built UI does not show it;
- the correct contributor is loaded but the target Agent/Preset/Session cannot see it;
- a user reaches the intended entry path and behavior is wrong.

Do not use it for a pure function or local type bug whose reproduction never crosses a DSH composition boundary; use `systematic-debugging` with focused debugging instead. Do not use it to choose a new service, Provider, Consumer, WorkKind, or package design; route that to `dsh-reuse` and DSH plugin architecture work. Do not treat it as completion verification; after Phase 1 classifies the divergence, return to `systematic-debugging` Phase 2–4 for pattern comparison, a single minimal test, and repair; once fixed, use `dsh-change-verification` to select proof.

## Establish the Phase 1 symptom and hypothesis

Read relevant `AGENTS.md` files. Before any repair, record a reproducible symptom and recent relevant changes. Record, without guessing:

- claimed behavior, actual observable symptom, exact reproduction steps, and consistency or known variance;
- recent source/config/build/Profile/launch changes and the last known working comparison when available;
- exact entry path: Profile, Bundle, Host/Client, Agent/Preset/Session, endpoint or UI;
- diagnostic DSH identity and subject identity: checkout/commit, dirty state, build artifact, Profile/home/ports, process identity, and launch command when observable without secrets; identify controller/executor separately when present;
- whether evidence comes from source checkout, generated output, built artifact, or a running process.

State one initial layer hypothesis, for example: `The source contract exists; the first divergence is probably Profile/Bundle composition because the selected Profile lacks the contributor.` It is a testable starting point, not a diagnosis. Collect the ordered evidence below before changing code, config, artifacts, or a running process.

A source test passing is useful only at source-contract. A package name in a lockfile or a manual `ctx.plugin()` test does not prove it belongs to the real Profile.

## Trace in order and stop at the first divergence

Use [triage-map.md](references/triage-map.md). Start with the earliest layer not already proven for the claimed entry path. At every layer ask: does this exact **subject** version, config, build, Profile/home/ports, and process identity flow to the next one? If not, classify it, report evidence and the safe next action, then stop. Do not substitute the diagnostic Agent's source/build/runtime for the subject, and do not call a later layer broken merely because it has not yet been observed.

1. **source-contract** — named exports, types, config schema, package contract, and local behavior exist for the intended capability.
2. **generated-declaration** — generated Remote/client declarations, catalogs, manifests, package exports, or build metadata correspond to that source tree.
3. **Profile/Bundle composition** — the exact selected Profile and its layered config select the Bundle/plugin/provider and intended defaults.
4. **Loader activation** — the launched Loader resolves the named export/config and activates it without lifecycle/config errors.
5. **built Host/Client artifacts** — the runtime consumes artifacts built from the intended tree; dynamic Client bundles, Host/Client declarations, and static files agree.
6. **runtime scope** — the active Agent/Preset/Session/Remote has visibility and authority to discover and invoke the mounted capability.
7. **real behavior** — the shipped entry path produces the wrong external result after all prior layers are observed.

For Host/Client contract changes, `pnpm run build:web` alone does **not** refresh all dynamic Client bundles. It can establish only the web artifact it produced; use the repository's full build when the real path consumes generated Client packages or dynamic extensions. Do not rebuild just to erase evidence of an older artifact; first identify which artifact/process the user actually runs.

## Classify precisely

After ordered evidence supports the first divergence, return one primary classification. Then return to `systematic-debugging` for Phase 2 pattern analysis and Phase 3–4 minimal test and repair; classification alone is not permission to fix.

Return one primary classification:

| Classification | Meaning |
| --- | --- |
| `contract-absent` | required source API, named export, schema, or behavior is absent or incompatible |
| `generated-stale` | source is correct but generated declaration/catalog/manifest/export is older or mismatched |
| `composition-missing` | generated capability exists but exact Profile/Bundle/config does not select it |
| `activation-failed` | composition selects it but Loader cannot resolve, configure, or activate it |
| `artifact-stale` | live Host/Client/static artifact does not derive from the inspected source/generated tree |
| `scope-mismatch` | active runtime loads it but target Agent/Preset/Session/Remote lacks visibility or authority |
| `behavior-defect` | all prior layers are observed and real entry behavior violates the contract |
| `unverified` | required boundary could not be observed safely or evidence identifies no first divergence |

Report only one primary class. Mention secondary possibilities as unverified, not as additional diagnoses.

## Report format

```markdown
# Runtime composition diagnosis

Claim and symptom: <...>
Diagnostic identity: <checkout/build, Profile/home/ports, process, Agent/authority; omit secrets>
Subject identity: <checkout/build, Profile/home/ports, process/artifact, scope; omit secrets>
Controller/executor identity: <if distinct; otherwise explicitly not observed>

| Layer | Evidence | Result | Next boundary |
| --- | --- | --- | --- |
| source-contract | ... | proven/diverged/not observed | ... |
| generated-declaration | ... | ... | ... |
| Profile/Bundle composition | ... | ... | ... |
| Loader activation | ... | ... | ... |
| built Host/Client artifacts | ... | ... | ... |
| runtime scope | ... | ... | ... |
| real behavior | ... | ... | ... |

Primary classification: `<one value>`
First divergence: <layer and evidence, or not observed>
Safe next action: <read-only check or separately authorized mutation>
Unverified conditions: <...>
```

Never report "fixed" from a diagnosis. If a mutation is authorized and made, restart the trace at the earliest layer it can change, then hand final proof to `dsh-change-verification`. For self-hosted DSH, that final proof must use a known-good/previously approved verifier plus independent world evidence; the changed diagnostic or verification Skill cannot be the sole acceptance witness.
