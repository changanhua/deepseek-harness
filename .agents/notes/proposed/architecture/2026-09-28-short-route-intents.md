# Agent Note: Short route intents select existing capabilities

Status: proposed

English | [中文](2026-09-28-short-route-intents.zh.md)

## Problem

Users need a short way to choose the intended execution route without restating a long prompt on every task. Today that choice can be expressed only as ordinary natural language inside a model turn. The model can remember a local shorthand such as `DSH!:` in one conversation, but that does not make the route a DSH-owned contract and does not prove that DSH, GitHub, BrowserTask, or another capability actually performed the work.

The same visible task can have different reasons. A GitHub Issue flow is usually best served by a dedicated GitHub path, while the same flow can be useful as a DSH browser acceptance case because it exercises authenticated page reading, duplicate checks, submission, and readback. If these reasons share one vague "browser" instruction, the user cannot tell whether the result optimizes business completion or proves a DSH capability.

DSH already has the main engineering pieces: profile and preset composition, `ctx.tools` visibility and policy, the read-only capability registry, workflow tools, BrowserTask evidence, and session events. A new route system that bypasses those mechanisms would duplicate policy and make evidence harder to trust.

## Proposal

Add a narrow Route Intent layer that maps short user prefixes to existing DSH composition and evidence mechanisms. Route Intent is not a new execution plane. It classifies the task reason, selects or recommends a preset/tool/workflow set, and states the evidence contract that the selected path must return.

The first useful intents are intentionally small:

| Prefix | Intent | Default meaning |
| --- | --- | --- |
| `DSH!:` | Strict DSH acceptance | Use only DSH-exposed capabilities; report the missing capability rather than fall back. |
| `Browser:` | Browser task | Prefer the composed DSH browser path when it fits; return page observation and action evidence. |
| `GH:` | GitHub business task | Use the most direct GitHub-capable route available; DSH browser evidence is not required unless requested. |
| `Repo:` | Repository task | Use repository tools for worktree, diff, test, commit, and push work. |
| `Capability:` | Capability inspection | Read the live capability registry or equivalent profile surface before recommending a route. |
| `Evidence:` | Verification-only task | Do not continue product work; return which capability ran, what receipt it produced, and what was read back. |

`GH:` and `DSH!:` must remain separate. `GH:` optimizes for completing the GitHub job through the strongest GitHub route. `DSH!:` uses a GitHub page only when the point is to validate DSH browser or workflow capability. A result may satisfy both only when the evidence names the DSH capability and includes the durable or readback proof that the DSH path performed the work.

Route Intent should land through the existing composition stack:

- Agent presets or a routing skill recognize the prefix and set the task reason.
- `ctx.tools` and policy restrict the visible tool set for strict routes.
- The capability registry supplies the live "can this route run here" answer.
- Workflow tools hold fixed multi-step flows such as "search issue, create once, read back."
- BrowserTask and the session log provide receipts, readback, and acceptance evidence for browser tasks.

The layer should fail closed for strict prefixes. If a `DSH!:` task needs a DSH browser capability that is absent, stale, or not authorized, the route reports that missing capability and stops. It must not silently use computer-use, a generic browser UI driver, a direct GitHub connector, or a shell script and then summarize the result as DSH acceptance.

## Alternatives considered

**Keep prefixes as Codex-only chat conventions.** Rejected because it solves typing effort but not provenance. The user still has to trust that the current model remembered the convention and did not use a fallback route.

**Create a new generic DSH router service.** Rejected for the first slice because DSH already has profile composition, tool policy, capability inspection, workflows, and evidence records. A router service would need its own policy, discovery, failure, and evidence model before proving that the existing pieces are insufficient.

**Force all GitHub tasks through DSH browser workflows.** Rejected because daily GitHub work should use the most reliable GitHub route. GitHub is a good browser acceptance example, not the default reason to avoid a purpose-built GitHub channel.

**Let each workflow invent its own prefix and proof text.** Rejected because the value is a consistent route reason and evidence contract. Workflow-specific prompts can add details, but the top-level intent terms should stay small and stable.

## Acceptance criteria

- A strict `DSH!:` task exposes only DSH-approved tools or reports the missing DSH capability without fallback.
- A `GH:` task can use a direct GitHub route without being treated as DSH browser acceptance.
- A GitHub browser acceptance task can show the DSH capability used, the operation receipt, and a fresh readback of the destination.
- A capability inspection task reads the live profile or registry state before recommending a route.
- The implementation reuses presets, tool policy, workflow, capability registry, BrowserTask evidence, and session events before adding any new public routing service.
- Documentation and UI copy describe prefixes as route intents and evidence requirements, not magic words that guarantee completion.

## Risks

Short prefixes can hide important constraints if they become too broad. The first set therefore stays limited to common route choices, and task-specific details remain in the rest of the prompt.

Strict routes can frustrate business completion when the requested DSH capability is unavailable. That is the intended behavior for acceptance tasks, but daily work should use `GH:`, `Browser:`, or `Repo:` when completion matters more than proving DSH provenance.

The capability registry may show that a tool exists without proving that the current page, account, or grant can complete the requested action. Strict routes still need action receipts and readback evidence.

Adding a router service too early would centralize policy that current packages already own. The first implementation should remain a thin mapping until repeated routes show a real need for a runtime service.
