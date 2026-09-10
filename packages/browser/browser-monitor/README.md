---
description: "Host-owned durable browser monitor plans that schedule finite observation checks through the typed Queue."
kind: "package-reference"
---

# @changanhua/dsh-browser-monitor

English | [中文](README.zh.md)

## Summary

Use this package to keep a bounded, durable plan for one browser observation and notify an owning surface when its summary changes. A plan records its URL, cadence, match rule, fixed grant epoch, and a digest plus match result instead of captured page text. One-time plans run once; recurring plans coalesce overdue work to `latest` or skip it. This package owns Host plans and Queue admission, not a complete Chrome monitoring UI.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose the monitor with `ctx.browser`, `ctx.storageDomain`, and `ctx.taskQueue` when a trusted Gateway creates plans under an installation's current observation authority.

`browser.monitor.check@1` receives only monitor id, revision, and due slot. Pause invalidates queued and running work; resume binds fresh current authority before it schedules another slot. The outbox reserves every notification slot that a check can produce and removes a notice only after explicit acknowledgement. Defaults permit 64 monitors, poll every 1,000 ms, and limit a finite read to 30 seconds.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`BrowserMonitor` persists records through its storage domain and uses a verified Queue operator authority. Samples retain SHA-256 digest, match state, time, and page identity, never page body text. The Gateway facade exposes `monitor.list`, `monitor.create`, `monitor.pause`, `monitor.resume`, and `monitor.acknowledge`; it remains separate from the extension UI. [Engine](src/engine.ts) owns scheduling and recovery, while [records](src/records.ts) owns notification capacity and acknowledgement.

Each accepted result atomically retains a settlement linking its Queue work, revision and slot. No later check is admitted until Queue confirms that terminal outcome. If the Host stops between the two commits, recovery settles the cached success or failure without another browser read, including for paused and one-time plans.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None. This package registers no model tools, prompt sections, or model context, and it does not make model requests.

#### KV Cache Impact

None. Monitor plans and notices do not enter model context through this package.

## Known Limitations and Deferred Work

- Browser checks require exactly one open top-level tab matching the original URL; closed pages and ambiguous targets produce failures.
- Notification capacity pauses admission until the receiving surface acknowledges existing notifications. This package does not implement a continuous DOM observer.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
