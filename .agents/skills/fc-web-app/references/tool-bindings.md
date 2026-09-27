# Browser tool bindings

Choose the binding for the Agent's actual browser surface. The same extension can connect to Codex independently from DSH, yet both share an execution journal for a target. Their credentials, request IDs, and recovery calls remain channel-specific.

| Intent | Codex independent connection | DSH binding | Constraint |
| --- | --- | --- | --- |
| Discover an FC target | `browser_status`, `browser_tabs`, `browser_read_page` | `browser_instances`, `browser_tabs` | Read the live availability; a listed installation does not prove FC action support. |
| Read semantic page state | `browser_read_page` | `browser_snapshot` | DSH snapshot requires installation, tab, frame, and normally current document identity; use its returned `page` + `snapshotId` + `elementId` together. |
| Filter a current list | `browser_read_page` with a narrow current target | `browser_extract` | Extraction is bounded and read-only; it does not prove full collection coverage or select a target. |
| Execute one UI action | Codex browser action tool with the fresh page/control reference it returned | `browser_action` | Both require a fresh target. DSH accepts a closed action schema and submits an opaque prepared ticket only once. |
| Check an unresolved action | Codex request-status tool for the original Codex request | `browser_request_status` with the original DSH `installationId` and `requestId` | Never cross-check an ID through the other channel and never retry an `unknown` write automatically. |

## DSH action constraints

- `browser_snapshot` and `browser_extract` require the actual installation/tab/frame context; page/document identity can become stale. Re-observe and relocate after any document change.
- `browser_action` requires an initiating Agent and the closed provider action schema. Page/action mismatch, target changes, expiry, permissions, or a closed connection can prevent dispatch.
- `browser_action` feedback is a compact new observation. A successful dispatch or `valueSet` does not establish a business result; use the action template's readback condition.
- `browser_request_status` is a status read, never a replay. `unknown` means wait/continue reading or obtain the owner decision indicated by `nextStep`. `target_busy` is rejected and unsent; query the earlier in-flight or unknown request.
- A DSH fixed target restricts the accessible tab and rejects another installation. Do not work around it with an assumed foreground tab.
- Use a preset that actually exposes both Skill discovery/loading and Browser scope. Current `browser-assistant` source now mounts `skill-filesystem` and `tool-skill` alongside Browser support. Its running instance and installed build require separate verification; an older Session may still use the previous preset. `standard`, or another preset that mounts both capabilities, can also be used; these choices are not mutually exclusive product modes. The actual target Session still needs separate Skill/tool-scope checks and an explicit browser-target binding.

## Current dated evidence boundary

On 2026-09-26, the Codex independent connection read the FC Chinese SBC list. A click on a normal card returned `unknown` / `effect_unverified`; status also remained unknown. A subsequent action was rejected as `target_busy` and was not sent. A later read still showed the list. This is a recovery example only. It does not prove an FC navigation action, current target state, or DSH runtime behavior.

The DSH tool mapping above is source/contract evidence. A target DSH Session must separately prove that it discovers this Skill and has the required tool/permission scope.
