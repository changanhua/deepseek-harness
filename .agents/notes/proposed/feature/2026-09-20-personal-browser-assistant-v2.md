# Agent Note: Personal browser assistant V2

Status: proposed

English | [中文](2026-09-20-personal-browser-assistant-v2.zh.md)

## Problem

A personal assistant needs an unambiguous task target and a truthful view of what it has read. Foreground-tab lookup and one worker-wide selected Session cannot provide that guarantee across browser windows. A useful page function also outlives its creation request, while the current task contract requires visible-resource cleanup and the Cordis runner ties deletion to its defining Agent.

## Proposal

Use the accepted task-centered prototype as the UI specification. Keep page selection explicit and Session-owned; isolate each surface's selected Session and draft. Both Browser and Cordis operations consume the same Host target revision and exact document checks. Render page cognition from delivered evidence, not another automatic reader.

Promote only explicitly delivered functions into the existing Cordis registry's authenticated personal-installation ownership. Their origin Session remains provenance; later user commands capture a current authorized execution scope. Temporary plugins keep Agent ownership. Transfer a visible resource only with an exact, verified owner receipt and no pending write/cleanup; retained state alone cannot complete a task. Keep existing request reconciliation and cleanup fencing.

The extension creates Sessions on a dedicated `browser-assistant` preset. It keeps Browser, Dynamic Cordis and replay-aware compaction, including `/compact` and oversized tool-result pruning, while excluding the standard preset's shell, filesystem and delegation tools. Authenticated slash-command execution addresses the current Session directly without a model round trip; an unmatched command falls back to one ordinary prompt submission. The first implementation guarantees use across turns and conversations in one Host process, not restart persistence. Global discovery does not grant DOM authority. Refresh/navigation requires explicit rerun for page functions, not automatic injection. The [implementation plan](../../../../docs/superpowers/plans/2026-09-20-browser-assistant-v2.md) owns task boundaries, model allocation and acceptance commands.

## Semantic page atlas

Page cognition uses one semantic atlas per exact page document as its primary view. The atlas preserves broad observed layout, groups delivered content and current actions into regions, and exposes explicit coverage and omissions. It absorbs separate overview and actionable-element views; Structure and Evidence remain secondary inspection views.

The atlas is deterministic evidence presentation, not a screenshot replica or an authoritative model summary. Generic semantic roles and collection patterns work across sites; a site adapter may enrich labels only after repeated evidence shows that the generic projection loses important structure. No presenter changes target authority, locator validity, action policy or known-versus-unread state.

Future additions follow a placement rule: cross-page at-a-glance facts belong in the map, selected-region detail belongs in the inspector, and raw lifecycle or DOM facts belong in Evidence or Structure. A new top-level cognition view requires a distinct user job that none of those layers can express. The [semantic page atlas plan](../../../../docs/superpowers/plans/2026-09-21-browser-assistant-semantic-page-atlas.md) freezes the projection, interaction, delivery and evolution rules.

## Alternatives considered

**UI-only target and retained badges.** These cannot constrain Browser/Cordis dispatch or prove that another owner can still stop a delivered function.

**One global target or globally operable plugin inventory.** A second window or Session could redirect a task or gain control merely by discovering a function. Session binding and authenticated, explicit function commands preserve the personal workflow without a new authorization wizard.

**Complete every task only after destroying its page UI.** This fits temporary inspection but contradicts a deliverable intended for continued use. Verified responsibility transfer preserves cleanup accountability while permitting that outcome.

## Acceptance criteria

A real extension/model task operates on pinned A while the user browses B. Page cognition matches actually delivered content and remains unchanged after irrelevant mutations. A real created function remains usable after new chat, accepts an explicit authorized edit, and stops with observed cleanup. Session streaming, replacement and resync do not duplicate or replay work. The plan's five required layers and independent review decide completion.

## Risks

Incorrect promotion can weaken cross-Session authority or strand cleanup; exact installation/function/run ownership and negative tests are mandatory. Process-local state may disappear on Host loss and must not be presented as durable. This proposal supplements, but does not yet replace, the implemented [field-operation lifecycle](../../implemented/feature/2026-09-12-browser-field-operation-lifecycle.md), whose request and cleanup invariants remain active. No existing note is fully superseded or eligible for archival by this unimplemented proposal.
