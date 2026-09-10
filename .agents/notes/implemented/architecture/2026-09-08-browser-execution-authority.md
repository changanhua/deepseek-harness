# Agent Note: Browser execution authority and recovery

Status: implemented

English | [中文](2026-09-08-browser-execution-authority.zh.md)

## Problem

A browser operation acts in a document the user already has open. Foreground-tab selection is mutable, extension workers can restart, and a lost response does not prove a page effect failed. Reusing [Content import authority](../feature/2026-09-07-browser-content-import.md) would also turn permission to save supplied text into permission to operate authenticated pages.

## Decision

The [browser family](../../../../packages/browser/README.md) separates its service definition, Host extension provider, and Chrome execution runtime. It uses an installation-specific browser grant in the existing credential provider, independent of Web cookies and Content import. The signed-in owner approves a requested subset. Revocation invalidates dispatch permission before asynchronous credential writes complete; replacement advances the grant epoch, which every live connection and request must match.

The [subsystem contract](../../../../docs/subsystems/browser.md) binds operations to a Session, installation, tab, frame and Chrome document identity. Snapshot elements retain isolated-world DOM object references and their action-relevant attributes. Page commands target the recorded document, including navigation; a newly focused tab cannot absorb an earlier operation.

The Host keeps a bounded request table for current callers. Chrome persists minimal execution intent before dispatching a page effect and retains bounded receipts separately from action inputs. Unknown writes lock the whole tab across workers, Host restarts, Sessions and grant changes. A missing initialized journal fails closed. Reconnection queries status without replaying the original action. Cancellation asks the current executor to stop; acknowledgement of an unknown write requires evidence that the old operation cannot issue another action.

Content import keeps its separate data and authority contract. Browser execution does not establish model-tool exposure, semantic approval policy, or conversation-history ownership; those consumers must use their owning services.

The model-tool consumer owns a finite observe-act-verify task through the native Agent lifecycle; its continuations enter the Session log as plugin messages. Machine success conditions require fresh observations. Separate action and continuation budgets bound retries, and an unknown result terminates the task without replay. Complete DOM snapshots use retained tree cursors and exact node references; expiry or semantic changes reject old targets. These choices preserve traceable correction without a second model loop or silent selector rebinding.

## Alternatives considered

Page-entry bindings retain the inspected region, item and field identities as well as their values. A matching document id alone does not make an old binding current. The executor checks that evidence before replacing a mount and again before dispatching a click from a reused node. Confirmed collection markers have document-and-owner-local retention independent of the observer, while the consumer retains the business results. The dynamic Plugin runner owns cleanup and preserves unresolved mounts until the executor confirms no residue; ordinary model turn completion does not end a persistent Plugin.

**Reuse the Content token or Web cookie.** Both enlarge an existing authorization beyond its stated purpose. Independent installation grants preserve separate revocation and make the requested browser access visible to the owner.

**Replay an action after reconnecting.** A page may have completed a click or submission before its receipt disappeared. Durable identity and status queries retain that uncertainty without producing a second effect.

**Keep write locks only on the Host.** Host restart loses its in-memory table while the document can still execute. The extension is the common execution owner and keeps the restart-safe lock; the Host table provides early admission rejection.

**Resolve a selector against the current tab.** Both the active tab and the matching DOM node can change between observation and execution. Document-bound object references reject stale targets instead of transferring an old intent to a new element. Semantic snapshot search and pagination return new exact references. The tool reads one bounded snapshot after an action or stale preparation, letting the model inspect the result and select a new target without silently rebinding or replaying a write. This costs a read and additional tool-result context; unavailable feedback does not overwrite the original action outcome.

**Require a debugger/CDP session for ordinary DOM work.** The verified DOM route covers explicit reads and bounded actions without debugger permission or debugger attachment conflicts. Enhanced execution remains a separate capability choice when ordinary document execution cannot satisfy a concrete operation.

## Consequences

Grant, channel, journal, and DOM tests pin the authority and recovery boundaries. Real isolated Chrome acceptance exercises the actual worker against the built Web Profile, including receipt loss, restart, stale references, navigation observation and cancellation. The choice gives up automatic recovery by retry: an unavailable executor can leave a tab write-locked until quiescence can be established. Separate grants and a small durable journal add state, but keep browser effects independent from the lifetime of a Web interface or Host caller.
