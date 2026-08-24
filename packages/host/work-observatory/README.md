# @deepseek-ai/dsh-host-work-observatory

English | [中文](README.zh.md)

Host-owned Human and Agent wall-clock accounting. `WorkObservatoryGateway` registers the `workObservatory` service and publishes the generated direct Remotes `workObservatory/observeClient` and `workObservatory/range`.

## Configuration

`path` selects the independently versioned SQLite database; `:memory:` is supported for tests. `staleAfterMs` defaults to 30 seconds and controls when missing browser evidence resets producer state. `sweepIntervalMs` defaults to 15 seconds and controls only stale-state materialization; it never extends credited time. Unknown database schema versions fail service activation without rebuilding the file.

## Accounting semantics

Browser documents send `visible` and `active` snapshots with a document-lifecycle id and monotonic sequence. The Host validates `active => visible`, timestamps accepted snapshots with its receive clock, and ignores duplicate or older sequences without updating state or evidence. Normal transitions close at receive time; missing producers close at their last accepted evidence. Open Human intervals also end at last evidence during queries, even before a stale sweep runs.

The service projects canonical `step/start` through `step/end` Session events into rows keyed by `(session_id, turn, step)`. `step/end` is the authoritative close; `assistant/message`, `tool/call`, and `tool/result` update crash evidence, while token-level `assistant/chunk` events do not write SQLite. Replay is idempotent, child replay skips events before `SessionHeader.seedLength`, and startup closes historic open rows to their last evidence before replay can reopen a currently live step.

`range` returns normalized half-open `[start,end)` timelines for Page Visible, Human Active, and Agent Running. It unions overlapping browser clients and Sessions, then derives `Together = Human Active ∩ Agent Running` and `Agent Solo = Agent Running - Human Active`. Summary durations and timeline arrays come from the same interval algebra and enforce `Human Active ⊆ Page Visible` and `Agent Running = Agent Solo + Together` before publication.

Observer and stale-sweep failures are logged and contained so this telemetry service cannot reject Session publication. Disposing the service stops the sweep, detaches Session listeners through their Cordis fiber, and closes SQLite after those effects unwind.

## Model Experience

None, as this Host telemetry service registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Human Active is a behavioral proxy** — visibility, focus, and recent interaction cannot prove attention; missing browser evidence is conservatively undercounted.
- **Agent Running is step wall time** — it can include model execution, tools, waiting for a user, and waiting for a child Agent; it is not compute time or saved human time.
- **One Host represents one user** — intervals from every browser client attached to the Host are unioned without user or tenant identity.
