# Planning UI

English | [中文](README.zh.md)

## Summary

Use this browser UI to arrange project plans, inspect their sources and execution summaries, and submit explicitly chosen planning changes. It renders Host-owned data and retains no planning authority.

Overview lists current plans, the idea inbox, pending Proposals and archives. Opening a Plan shows current state, work and discussion, thinking desk, and history and sources. Focus selection, search and navigation survive module changes within the Client lifetime. Continue work opens a native Session available for the exact subject, or starts one when none remains; existing bindings retain their original base revision. Proposal review opens separately and adopts only an explicitly selected generation.

## Use this package

`@changanhua/dsh-client-ui-planning` renders the personal Planning Remote projection as a workspace-scoped planning pool. A short capture becomes a pending Proposal with empty optional detail; only explicit acceptance creates an active item. The selected item shows a deterministic evolution graph built from retained sources, proposal generations, revisions, reviews, dependencies, and handoffs.

The UI sends every mutation with the current board version. A failed attempt remains available for an explicit retry with its original request identity; it never silently overwrites a newer board. It displays captured Session excerpts and opens their conversation, reads the exact captured Content version when composed, and identifies manual notes and links as unverified sources. Arrangement and Delivery progress appear separately.

The thinking desk reads generic summaries of existing Design Cases without creating exploration. FC27 SBC is the first owner adapter: its frozen projection, selection, layout and movement undo remain in the existing exploration store. Opening its separate owner view and returning preserves the Plan/Focus selection and rereads current Planning facts. Revision drift is explicit; failed reads cannot imply alignment. A failed or unknown exploratory write requires reload and is never automatically replayed.

Planning-local styles use shared theme tokens and controls. The thinking desk keeps canonical goals and decisions visible beside existing Case summaries; its revision diagram shows retained baselines and current revisions, not invented exploration nodes. Full revision identifiers and infrequent management actions are available in disclosures.

## Invariant policy

No invariant companion is published because the workbench holds only disposable browser state over Host-owned records.

## Model Experience

### No direct model context

#### What the model sees

Nothing directly. `PlanningWorkbench` renders browser state and does not register prompts, tools, or model resources.

#### Token effect

The UI adds no direct tokens.

#### KV Cache effect

The UI adds no direct KV-cache effect.

## Known Limitations and Deferred Work

- Planning lanes do not indicate execution outcomes; Delivery contracts and decisions continue in the Delivery workbench.
- The evolution graph shows retained lineage and current relationships, not historical lane or dependency values that were never stored.
- Background notification and atomic review follow-ups remain incomplete.
