---
description: "Work Observatory browser package for users viewing a local day or project, comparing human activity with Session-step time, and opening Session detail."
kind: "package-reference"
---

# @changanhua/dsh-client-ui-work-observatory

English | [中文](README.zh.md)

## Summary

This package gives the Web application a dedicated Work Observatory page and an automatic document-scoped activity producer. A user chooses a local calendar day, sees human-active, page-visible, Agent-step, overlap, and Agent-solo durations, then opens a contributing Session. A 24-hour evidence band makes the source intervals visible before the totals. The page states that its figures are evidence, not productivity or time-saved claims.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the browser package in a Client composition that also exposes the Work Observatory Remote and Session Controller.

### When to choose it

Choose it for the standard Web product when users need a local, inspectable view of human and Agent wall-clock evidence. Omit it from Client compositions without the Host service or Session navigation.

### Minimal configuration

```yaml
- name: '@changanhua/dsh-client-ui-work-observatory'
```

The package has no browser configuration. Its `dsh.client.inject` declaration requires Remotes, Session Controller, locale, layout, renderer, sidebar, and the Host Work Observatory package.

Open **Work Observatory** from the persistent sidebar, choose a date, refresh when needed, and select a Session row to return to that conversation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One app-scoped effect owns document listeners, the idle timer, the visible-page heartbeat, and a serialized Remote chain. It sends visibility, recent human activity, the current Session id, and a monotonic sequence; it sends no client timestamp. A separate controller converts the selected local date to epoch boundaries, loads the Host projection, rejects stale responses, and exposes one observable to the Slot renderer.

The exact owners are [`src/client/activity-tracker.ts`](src/client/activity-tracker.ts), [`src/client/controller.ts`](src/client/controller.ts), and [`src/client/WorkObservatoryWorkspace.tsx`](src/client/WorkObservatoryWorkspace.tsx).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Work Observatory subsystem](../../../docs/subsystems/work-observatory.md) — user flow and evidence meaning.
- [Host package](../../host/work-observatory/README.md) — durable records, bounds, and range algebra.
- [Web client subsystem](../../../docs/subsystems/web-client.md) — dynamic Client package loading.
- [Slots subsystem](../../../docs/subsystems/slots.md) — the workspace and sidebar insertion points.

-----

<a id="model-experience"></a>
## Model Experience

None, as this browser activity producer and read-only workspace register no model-facing Tool, prompt section, or Session event.

#### KV Cache effect

None; browser observations and range reads never enter model context or start a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Current-project filter** — project scope follows the selected Session's canonical `cwd`; the first version does not offer a separate project picker.
- **No causal attribution** — Skill, Queue, and Delivery records are not interpreted as causes of duration or productivity.
- **Visible-page evidence** — browser sleep, forced termination, and transport loss end evidence at the last Host-received heartbeat.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
