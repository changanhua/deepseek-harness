# Diagnose Browser Resource Cleanup

Use this reference when a live DSH browser resource or delivered Cordis function appears stopped, removed, missing, or stuck in cleanup. It identifies the evidence needed to distinguish Agent-owned definitions, installation-owned functions, and page resources. It does not authorize a write or prove the current process loaded source from this checkout.

## Read the owning evidence first

1. Read the original DSH Session around the create, mount, handoff, stop, or remove operation. Record the Session id, exact inner browser request id, action, resource id, target page identity, outcome, delivery, quiescence, reason, and settlement event. An outer UI click or connector request has a different id and cannot replace the operation receipt.
2. Query the original request through its owning Browser connection and installation when status lookup is available. Keep `requestId`, `sessionId`, and `installationId` together. A status-query failure, `unknown` result, or `unknown + not-sent` says nothing conclusive about the original write and never authorizes replay under a new id.
3. Read the live registry through its supported management entry. `dynamicCordisRunner.inventory()` reports process-local definitions and run state; `ownerKind` is optional in older producers. The authenticated extension `function.list` and `function.inspect` report functions owned by that installation. Do not infer installation ownership from a missing field or compare IDs from different authority channels.
4. Identify the exact Host process, checkout/build artifact, Profile/home, and extension version behind each read. Source code and an inventory from another process do not establish the subject's runtime state.

## Interpret cleanup receipts

| Evidence | What it establishes | Safe conclusion |
| --- | --- | --- |
| `observed/sent`, `unmounted: true`, `remaining: 0` | The exact mount was removed | Cleanup confirmed |
| `failed/sent/document_replaced` | The exact target document no longer exists | Its page resource can be released; the original operation remains failed |
| `unknown/sent/quiescent:true/document_replaced` from the original request status | The original request cannot continue on its old document | Its page resource can be released; the original operation remains unknown |
| `failed/sent/page_unavailable`, generic tab/read failure, offline, or permission loss | The operation or read ended without a positive document-loss proof | Keep cleanup pending |
| Tab absent from a bounded or differently scoped tab list, URL now in another tab, or `unknown` status | No exact document-loss proof | Keep the original target and request identity; do not replay |

A fresh read-only `page_map` may confirm that the original `documentId` was replaced. The check must use the original installation and exact `tabId`, `frameId`, `documentId`, and URL. A failed read is not a successful cleanup. The Chrome executor treats only its exact missing-tab result or a different observed document as positive replacement evidence; lost permission and generic lookup errors stay inconclusive.

## Respect the owner and preserve the live ledger

- Agent-owned definitions use `cordis_stop` to stop a run and `cordis_undefine` to remove the definition. Installation-owned definitions must use the authenticated extension Functions controls; Agent-owned stop/remove calls must report `owner-transferred`.
- Installation `function.stop` stops a run and leaves its definition. A stopped inventory row is not a removal receipt and does not prove its page resource was released.
- Before changing code, establish how the repair can reach the exact running Host and extension while preserving their in-memory definition, owner, original request identity, and cleanup ledger. A source edit, package build, page reload, reconnect, or DSH restart alone does not prove a live cleanup; replacing a process that owns process-local state can erase the evidence needed to finish it.
- If the current management path cannot preserve or expose the required state, record the precise gap as `unverified` and stop before restarting, re-defining, re-running, or retrying the page write.

## Completion record

Report one row per plugin: current owner evidence, current package/run state, page-resource state, exact cleanup receipt or request-status evidence, and remaining proof. Keep these claims separate: `stopped` means no active run; `removed` means the definition is absent from the authoritative owner registry; `cleaned` means the exact page resource has a conclusive release receipt or positive document-loss proof.

For the owning source contracts, see the [Cordis Host runner](../../../../packages/extensions/cordis-host-runner/README.md), [Browser provider](../../../../packages/browser/browser-extension/README.md), [extension Functions controls](../../../../apps/chrome-extension/src/assistant-functions.js), and [Cordis management panel](../../../../packages/extensions/ui-cordis/src/client/index.ts). When changing Chrome API or Manifest V3 code, also consult Google's [Chrome Extensions Skill](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/chrome-extensions/SKILL.md); it does not establish DSH ownership, Session, or cleanup state.
