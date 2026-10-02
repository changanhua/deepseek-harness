# Planning UI

English | [中文](README.zh.md)

## Summary

Use this browser UI to arrange project plans, inspect their sources and execution summaries, and submit explicitly chosen planning changes. It renders Host-owned data and retains no planning authority.

An object workspace shows current state entries, optional Focus selection and status, Session bindings, and related resource references. Starting a Session creates an ordinary native conversation and durably binds its subject and base revision before opening it. The native composer retains model, attachment, preset and permission controls. Proposal changes remain visible for explicit exact-generation adoption. HTTP(S) resource identities open their owning pages; opaque identities remain references until an owning application supplies a navigable URL.

## Use this package

`@changanhua/dsh-client-ui-planning` renders the personal Planning Remote projection as a workspace-scoped planning pool. A short capture becomes a pending Proposal with empty optional detail; only explicit acceptance creates an active item. The selected item shows a deterministic evolution graph built from retained sources, proposal generations, revisions, reviews, dependencies, and handoffs.

The UI sends every mutation with the current board version. A failed attempt remains available for an explicit retry with its original request identity; it never silently overwrites a newer board. It displays captured Session excerpts and opens their conversation, reads the exact captured Content version when composed, and identifies manual notes and links as unverified sources. Arrangement and Delivery progress appear separately.

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

The `planning.subject.actions` slot supplies only workspace id, owning Plan id, and the selected Plan/Focus identity to optional consumers. It owns no assessment state and grants no mutation capability. Unloading a consumer removes its entry without changing Planning.
