# @deepseek-ai/dsh-client-ui-work-observatory

English | [中文](README.zh.md)

The browser half is an app-scope activity producer for Work Observatory plus a read-only **Work Observatory** settings section. Its `apply()` installs one tracker against the DSH main document and registers the section; the producer itself does not read iframe activity or change application state.

Each document lifecycle gets one in-memory `clientId` and a monotonic `seq`. The tracker sends an initial snapshot, sends `active: true` after main-document interaction while the page is visible and focused, ends active state locally after 60 seconds without interaction, and sends a visible heartbeat every 15 seconds. Visibility, focus, blur, pagehide, keyboard, pointer, wheel, and touch signals are handled; pointer movement is throttled to one accepted signal per 5 seconds.

Observations call `ctx.remote.workObservatory.observeClient` in sequence. A failed call does not poison later observations, and the effect disposer removes listeners and timers. The producer keeps no durable outbox and does not expose an independent cross-tab identity.

The package also registers a read-only **Work Observatory** settings section. The section loads one normalized Host range through the BFF `readRange` callback, picks a local calendar date (resolved to local-midnight `[from, to)` epochs, DST-safe), and renders the five accounting metrics plus the three normalized timelines with loading, error, and retry states. It never recomputes a business metric and never listens to document activity itself: the tracker stays app-scope and independent of the section lifecycle.

## Model Experience

None, as browser activity observations are operational telemetry for Work Observatory and never enter the append-only Session log or model context.

#### KV Cache effect

None; the tracker does not modify conversation history or prompt inputs.

## Known Limitations and Deferred Work

- **Main document only** — iframe and cross-tab activity are not observed by this package.
- **In-memory lifecycle state** — reloads and new tabs receive new identities; no durable outbox or local persistence is provided.
