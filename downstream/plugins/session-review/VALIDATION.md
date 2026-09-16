# Validation / 验证记录

Base: `eb00de8d41df7e4bb1ea89b62882efed63945f90`.
Scope: only `downstream/plugins/session-review/`.

## Executed in the authoring container

Node v22.16.0, Linux container, dependency-free checks:

```sh
cd downstream/plugins/session-review
node --test tests/*.test.mjs
node --check index.mjs
node --check client.mjs
node --check controller.mjs
node --check policy.mjs
node --check contract.mjs
```

Result: **33 tests passed; zero failed or skipped**. Syntax checks passed.
Node prints its experimental MockTimers warning for the deadline test.
Fixtures match the pinned public Session v3 shapes: user data directly holds a
message; assistant/tool-result data holds `message`; turn/end holds `reason`.
These are local contract tests, NOT actual DSH execution or Windows evidence.

The source audit also checked the first turn/step numbering in agent-loop,
the Web `sessionController: web-host` realm, and the public CLI plugin grammar.
No dependency installation, paid model call, Profile edit, original Session
edit, full repository test/build, real Loader composition or browser test ran.

## Required before product acceptance (not run)

1. Install the private local plugin with the supported CLI on a clean checkout
   and an isolated Home. Preserve original defaults/roots. Boot the real Loader;
   confirm the UI row, policy row and `web-host` injection are active, not waiting.
2. Use an actual ordinary same-cwd Session as source. Freeze the original event
   bytes; run a controlled replay-backed review. Confirm exact logged snapshot,
   original RPC identity, chosen request/header route and unchanged source bytes.
3. Assert through the real ToolRuntime executor that a tool emitted by the
   subject cannot perform writes; invoke it both normally and through direct
   dispatch. A tested fake guard callback is not this evidence.
4. In a real browser, open the workspace, select a model/perspective/range,
   submit once, read a settled JSON report, expand citations and navigate both
   ways. Reload and restart Host; read the same recorded review without a new
   provider call. Record actual served build, Profile, port and screenshots.
5. Exercise source gaps/oversize, unavailable model/preset, foreign cwd,
   transport loss after create and prompt, cancellation, timeout, plugin unload,
   malformed report, forged reference and changed digest. None may become a
   claimed pass. Assert no source mutation, duplicate admitted prompt or orphan
   timer. Verify policy disposal does not leave listeners or tool guards.
6. Verify first-prompt title generation is suppressed by the pinned human
   title, and there are no auxiliary model calls. Check source IO separately.
7. A live model smoke requires separate explicit provider/model, scope and
   budget authorization. Record actual usage and adapter retries; do not reuse
   unrelated historic experiment authorizations. Cancel and unknown remain
   explicit non-success. No automatic publish/merge/Memory/Skill/Issue writes.

在上述真实组合与浏览器证据齐全前，本分支只能称为“实现候选”，不能以这些 33 项
替身测试代替完整产品验收。尤其不能宣称任意 Agent/Codex CLI、统一费用账本或完全
无人值守已经实现。
