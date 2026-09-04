---
description: "Host Work Observatory accounting for deployments and maintainers configuring durable browser-activity and Session-step evidence, retention, and bounded range reads."
kind: "package-reference"
---

# @changanhua/dsh-host-work-observatory

English | [中文](README.zh.md)

## Summary

This package lets the Web product retain local evidence of human activity and open Session-step wall time, then read one bounded day or project range. The Host stamps browser observations with its own clock, rejects repeated sequence numbers, and stores all non-Session records through `ctx.storageDomain`. Concurrent tabs and Sessions are unioned before totals are calculated, so one wall-clock moment is counted once. The result describes observed intervals; it does not measure productivity, CPU use, or time saved.

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

Mount the service beside Session storage and the storage-domain form; the shipped Web bundle already supplies this composition.

### When to choose it

Choose this package when a local Web deployment needs inspectable human/Agent wall-clock evidence across Sessions. Omit it from headless or SDK compositions that do not present the Work Observatory browser view.

### Minimal configuration

```yaml
- name: '@changanhua/dsh-host-work-observatory'
  config:
    retentionDays: 90
    maxClients: 128
    maxQueryRecords: 10000
```

| Field | Default | Meaning |
|---|---:|---|
| `retentionDays` | `90` | Whole days for retained browser transitions and closed steps. |
| `maxClients` | `128` | Maximum browser document identities retained concurrently. |
| `maxQueryRecords` | `10000` | Maximum stored transition and step records one range read may consume. |

`observeClient` accepts one monotonic browser state and records only Host time; `readRange` accepts finite `from < to`, rejects spans above 31 days, and optionally filters by canonical project path. The [configuration catalog](../../../docs/config-catalog.md#changanhuadsh-host-work-observatory) is the generated source for accepted fields.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Browser heartbeats update one compact client state; only state or Session changes add transition records. Session `step/start` and `step/end` events produce durable step rows. Range reads reconstruct half-open intervals, clip them to the request, union concurrent rows, and derive overlap from the normalized sets. The storage domain uses path-safe hashed record keys so JSON and SQLite backends share one format.

The exact owners are [`src/index.ts`](src/index.ts) for lifecycle and Remote methods, [`src/spec.ts`](src/spec.ts) for durable schemas, and [`src/projection.ts`](src/projection.ts) for interval algebra.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Work Observatory subsystem](../../../docs/subsystems/work-observatory.md) — end-to-end semantics and package ownership.
- [Storage subsystem](../../../docs/subsystems/storage.md) — the only persistence path used by this package.
- [Session subsystem](../../../docs/subsystems/session.md) — the durable step events projected here.
- [Client package](../../client/ui-work-observatory/README.md) — browser producer and user view.

-----

<a id="model-experience"></a>
## Model Experience

None, as this Host-only time evidence service registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; Work Observatory reads and writes remain outside model input and do not start model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Agent time is Session-step wall time** — it can include provider, tool, subagent, or human-wait intervals inside an open step; it is not CPU time.
- **Local evidence only** — the package does not combine several Hosts or claim causal productivity and time savings.
- **Optional domain bridges are absent** — Queue, Delivery, and Skill invocation facts remain independent until a dedicated bridge contributes them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
