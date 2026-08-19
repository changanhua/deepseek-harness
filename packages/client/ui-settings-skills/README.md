# @deepseek-ai/dsh-client-ui-settings-skills

English | [中文](README.zh.md)

Skills management feature plugin: the session title-bar Popover and the Settings Skills section over the session-addressed read-only `skillManagement.snapshot` remote.

The feature owns three pieces:

- A **viewing state controller** (`createSkillsFeatureController`) that carries only interaction state surviving across the two registrations — the session deliberately adopted by the Popover's "Manage all" (§3.4 of the Skills management UI design). It exposes a bare `HostObservable` through the inject `hooks` compartment (the renderer-bound `useAdopted` hook) plus plain `adopt`/`followCurrent` callbacks. No `store` seat is used: the two slots live in different scopes (root settings section vs per-session header action), and the slot system pins a shared store handle to one scope. Snapshot data does not live here.
- An **apply-private snapshot controller** that owns the single response-addressable slot for `skillManagement.snapshot`, exposing a bare `HostObservable` (inject `hooks` compartment → the renderer-bound `useSnapshot` hook) plus plain `load`/`retry`/`reset` callbacks. Fetch/race state (generation guard, last-good retention) stays here, never in a component or a viewing store.
- The **Popover** (§5.1) and the **Settings section** (§5.2), both composed through their derived props shares. The derived target session comes from `useAdopted` adoption + `useSessions` ordinary-session facts via pure helpers; a blank/subagent or no-ordinary-session selection renders the empty state and never queries the host global registry.

The section shows the selected-first effective list, same-name shadow groups (reason + winner + provenance), model/user invocation, provider/layer/resource-kind/root labels, grouped diagnostics, incomplete/standing banners, and an explicit retry re-using the same session. `skills/change` invalidation is the global signal that drives refetch (§5.3); connection reset clears the snapshot slot.

## Model Experience

None, as this feature renders a read-only management UI; nothing here reaches a model request.

## Known Limitations and Deferred Work

- **P0 is read-only** — `actions.edit/remove/setInvocation` are informational only; no write RPC exists yet.
- **Adoption is process-local** — the adopted-session choice is not persisted; a reload falls back to following the current ordinary session.
- **Standing fidelity** — a cold composition's snapshot may silently omit realm-only providers; the UI shows the standing banner but cannot detect realm-only absence.
