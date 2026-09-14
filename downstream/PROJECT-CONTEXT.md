# Personal DSH Project Context

This file is a downstream analysis cache for `changanhua/deepseek-harness`. It helps humans and agents reuse project understanding across sessions without turning cached conclusions into a second source of truth.

## Authority boundary

Repository source and its owning documentation remain authoritative. This file records what has already been reviewed, the cross-cutting conclusions derived from that review, unresolved questions, and the smallest scope that should be rechecked after code changes.

When this file disagrees with source, generated catalogs, subsystem references, package READMEs, or an active implemented Agent Note, the owning source wins and this file must be corrected.

Start with these repository-owned maps instead of rediscovering the tree:

- [`../docs/architecture.md`](../docs/architecture.md) — composition, core runtime, turn flow, seams, and extension points.
- [`../docs/graph-atlas.md`](../docs/graph-atlas.md) — generated/hybrid navigation for dependencies, tools, capabilities, composition, events, and lifecycle.
- [`../FORK-DIVERGENCE.md`](../FORK-DIVERGENCE.md) — deliberate differences from upstream.
- [`../packages/README.md`](../packages/README.md) — package-group ownership.
- [`../.agents/notes/README.md`](../.agents/notes/README.md) — rationale and shipped decision records.

## Review baseline

The first review covered the personal work-loop slice on `codex/personal-mainline-integration` at `ae2fa15c1289aa3161feccf422ba4abb3857daec`. It was a static source/document review, not a whole-repository audit and not runtime validation of a local profile.

A recorded review commit is a cache-validation boundary, not a claim that later commits are unsafe. Reuse conclusions whose owners and dependencies have not changed.

| Area | Reviewed through | Primary owners | Recheck when |
| --- | --- | --- | --- |
| Core composition and model-visible context | `ae2fa15c` | `docs/architecture.md`, `packages/core/**`, `packages/context/**` | session-event semantics, prompt assembly, injection, tool/runtime contracts, or app composition changes |
| Browser and monitoring | `ae2fa15c` | `packages/browser/**` | browser Definition/provider/tool contracts, grants, Queue integration, page model, or monitor persistence changes |
| Content library | `ae2fa15c` | `packages/content/**`, `packages/client/ui-content/**` | Content schema/service, persistence, source capture, Remote, or model-facing consumers change |
| Queue and durable work | `ae2fa15c` | `packages/task-queue/**` | Work/Attempt/result/receipt semantics, admission authority, retries, recovery, or handler registration change |
| Goals and long-running objectives | `ae2fa15c` | `packages/goal/**` | goal scope, persistence, continuation, or lifecycle semantics change |
| Session retrieval | `ae2fa15c` | `packages/session-query/**` | search/index provider, workspace authorization, read/search tools, or default composition changes |
| Delegation and external agents | `ae2fa15c` | `packages/subagent/**` | provider contracts, Codex/Claude/ACP execution, continuation, result or cancellation semantics change |
| Delivery and independent verification | `ae2fa15c` | `packages/delivery/**` | protocol, evidence, runner, verifier, Queue bridge, Remote/UI, or acceptance authority changes |
| Human feedback and deterministic eval | `ae2fa15c` | `packages/feedback/**`, `packages/eval/**` | feedback visibility/consumption or eval evidence semantics change |

## Reusable cross-cutting conclusions

These are navigation conclusions, not replacements for the owning contracts.

1. **Browser Monitor is not a personal information-feed loop.** Browser and Monitor already provide authenticated page access, durable observation plans, bounded Queue checks, and notification delivery; selection, semantic processing, consumption feedback, and learning remain separate product concerns.
2. **Content is a durable source/content library, not yet the whole knowledge-reuse loop.** The reviewed Content surface owns originals, drafts, immutable versions, source identity, revisions, and receipts. Do not equate successful capture with factual validation or automatic future model context.
3. **Queue is the durable work/recovery substrate.** Do not introduce another generic scheduler merely to implement a product workflow; compose product semantics above Queue unless new evidence requires a lower-level primitive.
4. **Goal is a same-session objective, not a cross-session project/problem database.** Reuse it for the lifecycle it owns instead of widening it into every long-lived state concept.
5. **Delegation capability already exists.** New cross-model workflows should first solve handoff state, evidence, acceptance, and continuation requirements before inventing another agent-team abstraction.
6. **Delivery is a code-delivery specialization.** Reuse its evidence and human-acceptance ideas where appropriate, but do not force research, reading, or knowledge work into code-delivery contracts.
7. **Feedback is not implicitly model memory.** Existing human feedback signals have their own storage and visibility semantics; a personal learning loop needs an explicit contract before feedback may affect future behavior.
8. **The five personal value loops are product feedback paths, not five runtime entities.** Prefer existing services, events, Storage Domain, Queue, tools, context injection, and UI extension points over adding `Loop`-style orchestration primitives.

## Current personal-product direction

The current high-leverage path is:

`capture useful material -> retrieve with provenance in a later session -> produce a knowledge candidate -> human review/correction -> reuse the corrected knowledge after restart`

After that vertical slice is proven, extend toward topic-based information feeds, cross-session inquiry state, one explicit external-model handoff path, and finally budgeted/authorized automation with experience reuse.

This direction is a personal downstream priority, not a statement that upstream DSH must adopt the same product roadmap.

## Open uncertainties

Do not silently convert these into facts. Resolve them only when a task depends on them.

- Whether a user's actual local Profile enables optional search/providers cannot be inferred from repository source alone.
- Codex continuation/resume behavior must be checked against the exact provider path used by the task; do not infer it from generic subagent capability.
- Runtime availability, credentials, connected browser installations, current CI health, and external-provider quotas are observations, not durable architecture facts.
- Areas outside the table above may not have received a deep source review even when their README or generated catalog was seen.

## Incremental review protocol

For repository-wide or cross-package analysis:

1. Identify the exact target ref; do not default to `master` when the user names another branch or commit.
2. Read only the relevant rows and conclusions in this file.
3. Compare the target ref against the recorded review boundary for those areas. If histories diverge, establish merge-base/ancestry before interpreting a one-way diff.
4. Map changed files to owning packages, contracts, composition, persistence, authority, and recovery boundaries.
5. Re-read changed owners and the dependency boundaries they can invalidate. Do not rescan unaffected package families.
6. Preserve unaffected conclusions and their original review boundary; update only the areas actually revalidated.
7. Separate source facts, documentation claims, runtime observations, and design recommendations in the result.
8. Update this file when a durable cross-cutting conclusion or its review boundary changes; keep detailed contracts in their existing authoritative homes.

A tiny commit can require a broad recheck if it changes a shared contract. A large commit can require no recheck for an unrelated question. Review scope follows semantic impact, not commit count.

## Maintenance rule

Keep this file short enough to read before analysis. Prefer links and compact conclusions over copied inventories. Do not paste generated catalogs, module graphs, package lists, implementation walkthroughs, or historical transcripts here. If a conclusion grows into an architectural decision, move the rationale to an Agent Note and leave only the navigation consequence here.
