# Planning UI

English | [中文](README.zh.md)

## Summary

Use this browser UI to arrange project plans, inspect their sources and execution summaries, and submit explicitly chosen planning changes. It renders Host-owned data and retains no planning authority.

Overview lists current plans, the idea inbox, pending Proposals and archives. Opening a Plan shows current state, work and discussion, thinking desk, and history and sources. Focus selection, search and navigation survive module changes within the Client lifetime. Continue work opens a native Session available for the exact subject, or starts one when none remains; existing bindings retain their original base revision. Proposal review opens separately and adopts only an explicitly selected generation.

The personal entry prefers the unique deepseek-harness workspace when no project is selected. A newly opened Plan defaults to the thinking desk; explicit project choices and each Plan's selected tab remain retained for the Client lifetime.

Delegate stewardship explicitly creates a native Session with the shipped `work-steward` preset. This preset uses the standard coding composition; the optional Planning bundle supplies the stewardship Skill, and existing approval and Delivery owners retain execution authority. It requires the shipped preset root, needs no personal preset file, and does not change the deployment default. Ordinary discussion continues to use that default. Delegate stewardship creates and binds the same native Session, then submits an investigation request that names the packaged `project-steward` Skill. The request preserves the whole selected goal, asks for an evidence-backed recommendation, and leaves execution authorization with its existing owners. Concurrent clicks share one admission. An explicit retry after an uncertain reply retains the Session, binding command, and prompt request identity; a definitely rejected Board conflict can bind a refreshed version without creating another Session.

## Use this package

`@changanhua/dsh-client-ui-planning` renders the personal Planning Remote projection as a workspace-scoped planning pool. A short capture becomes a pending Proposal with empty optional detail; only explicit acceptance creates an active item. The selected item shows a deterministic evolution graph built from retained sources, proposal generations, revisions, reviews, dependencies, and handoffs.

The UI sends every mutation with the current board version. A failed attempt remains available for an explicit retry with its original request identity; it never silently overwrites a newer board. It displays captured Session excerpts and opens their conversation, reads the exact captured Content version when composed, and identifies manual notes and links as unverified sources. Arrangement and Delivery progress appear separately.

The thinking desk reads generic summaries of existing Design Cases without creating exploration. FC27 SBC opens a separate owner view, starts a native `thinking-desk` Session only after the user enters a question, and restores the same prepared Session, Planning binding, and kickoff request after an interrupted start. Its frozen Planning and Case inputs, selection, layout, exploration notes, Design Context, and movement undo remain in the Case record; returning preserves Plan/Focus selection and rereads current Planning facts.

Result review keeps Agent output separate from canonical Planning and shows the actual exploration notes, Design Context, and delta before three independent human actions save notes, save context, or create a Proposal. Case drift requires an explicit acknowledgement for an applicable candidate; Planning drift blocks Proposal creation. Proposal review shows one exact generation's state-entry, Focus, resource, origin, and evidence differences, and disables adoption when immutable or generation-bound prior material is absent.

The canvas toolbar and blank-area context menu create manual exploration cards at the chosen position. Select a card to edit it from the toolbar, or right-click or double-click it. Card titles and bodies persist in the Case and join the next Thinking context. Frozen Planning projection cards remain read-only; movement undo applies only to surviving cards.

## Invariant policy

No invariant companion is published because the workbench holds only disposable browser state over Host-owned records.

## Model Experience

### Delegated investigation request

#### What the model sees

Ordinary Session creation stays blank. Delegate stewardship sends one native user message beginning with `Please take stewardship of the bound Planning subject. Load the project-steward Skill and read planning_context first.` The remaining [request template](src/client/session-start.ts) asks for prior findings, a recommendation, and the next action, and names the exact subject. The original binding and base revision come from Planning context. The optional Planning bundle owns the Skill body.

#### Token effect

Delegation adds one user message and the Skill text when the Agent loads it. Ordinary Session creation adds no prompt tokens.

#### KV Cache effect

The delegated message starts a new Session; later turns use its ordinary persisted history.

## Known Limitations and Deferred Work

- Planning lanes do not indicate execution outcomes; Delivery contracts and decisions continue in the Delivery workbench.
- The evolution graph shows retained lineage and current relationships, not historical lane or dependency values that were never stored.
- Background notification and atomic review follow-ups remain incomplete.
- Admission retry state belongs to the mounted UI. After browser reload, inspect the retained Session and Planning binding before starting new work. This entry does not install a background monitor or approve Delivery work.
- The thinking panel creates a Proposal but delegates its adoption to the existing Planning review.

The `planning.subject.actions` slot supplies only workspace id, owning Plan id, and the selected Plan/Focus identity to optional consumers. It owns no assessment state and grants no mutation capability. Unloading a consumer removes its entry without changing Planning.
