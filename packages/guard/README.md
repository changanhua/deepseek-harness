---
description: "Package map for the runtime guard family: the advisory repeat-tool reminder and the per-tool-call timeout policy, for users and maintainers choosing or composing the guards."
kind: "package-group"
---

# guard/ — runtime guard family

English | [中文](README.zh.md)

## Summary

The opt-in [side-effect safety subsystem](../../docs/subsystems/side-effect-safety.md) adds durable admission and unknown-effect recovery without changing existing guards.

The `guard/` group keeps the agent loop productive by watching for two common failure patterns. `repeat-tool-reminder` notices when the model repeats the exact same tool call and reminds it to change approach or finish, so a stuck loop stops burning time and tokens. `timeout-policy` puts a time limit on tool calls that declare one, so a hung call returns a clear timed-out error to the model instead of stalling the session. Both ship enabled in the `dsh` base bundle; a composition can tune or remove them.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Loop-hygiene plugins and the opt-in durable side-effect guard share this family; each README owns its contract.

| Package | What it provides |
|---|---|
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.md) | Reminds the model when it repeats the same tool call, so it changes approach or finishes |
| [`timeout-policy/`](timeout-policy/README.md) | Times out tool calls that declare a limit, so the model gets a clear error instead of waiting forever |
| [`side-effect-safety/`](side-effect-safety/README.md) | Durable approval, action admission, and UNKNOWN reconciliation; opt-in Host adapter only |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the tools subsystem reference for the tool-call pipeline, then the reminder's configuration and the timeout-library decision behind the policy.

- [Tools subsystem reference](../../docs/subsystems/tools.md) — the tool-call pipeline and decisions both guards build on.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-repeat-tool-reminder) — every accepted field of the repeat-call reminder.
- [Timeout deadline library Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md) — the timing/termination split `timeout-policy` enforces.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
