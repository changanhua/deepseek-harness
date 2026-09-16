# Session Review V0

[中文](README.zh.md)

**Implementation candidate, not runtime-accepted.** Based on personal
`master@eb00de8d41df7e4bb1ea89b62882efed63945f90`.
An opt-in, repository-local **out-of-tree Cordis plugin**, not a separate app.
It has a native Web workspace and a dedicated read-only analyst preset.
It does not modify the core loop, default Profile, generated Remotes, workspace
lockfile, or the 57 formal personal-package registrations.

## User flow

Select an ordinary Session, an already configured provider/model, a diagnostic
or countercheck perspective, and an inclusive event range. Confirm transfer of
historical text and tool arguments. The Host freezes that range in the first
input of a new review Session. The selected model produces observations,
hypotheses and experiments. Citation expanders show the exact exported evidence;
the workspace opens either the source or the raw analysis Session.

The V0 analyzer is a DSH agent with a fixed restrictive preset. It does **not**
select arbitrary existing Agents, arbitrary presets, or external Codex/Claude
CLI execution. Those require separate bounded adapters. There is no automatic
session-end trigger, memory promotion, Skill editing or Issue creation.

## Explicit setup

Use a built checkout of the pinned baseline plus this branch. These commands
use the existing CLI grammar; **installation and real Loader boot were not run
in the authoring environment**. Do not enable it on an irreplaceable Home before
completing [VALIDATION.md](VALIDATION.md).

1. Install the local package into the target Web Profile using an **absolute**
   path (relative paths resolve in the Profile directory):

   ```text
   dsh plugin --profile <existing-web-profile> add "file:/absolute/checkout/downstream/plugins/session-review"
   ```

   In a repository development installation, invoke the same arguments through
   `pnpm dsh`. `private: true` prevents registry publication.

2. In that Profile's `cordis.patch.yml`, append the Host marker:

   ```yaml
   - insert:
       - id: personal-session-review
         name: '@changanhua/dsh-session-review'
   ```

3. Add `/absolute/checkout/downstream/plugins/session-review/presets` as a
   trusted `agent-presets` root. Read `dsh --profile <name> --dump-config` first.
   Preserve the existing default, roots and derived-root flags: a patch replaces
   the **whole** targeted config, not one array member. This repository does
   not overwrite your Profile to perform that operation. The preset policy
   explicitly consumes `sessionController` from the baseline's `web-host`
   realm. Deployments with different realms require a reviewed composition.

4. Restart the Host and reload Web, then open **More → 会话复盘**. Use localhost
   or HTTPS: evidence verification requires Web Crypto. No model runs on boot,
   catalog loading, source selection, history inspection or refresh.

Keep the package/preset paths stable while review Sessions exist. Disable the
UI row and remove the root only after stopping active reviews; retained Sessions
and their evidence are not deleted. A removed preset prevents normal resumption
of its Sessions. Copying the plugin alone does not back up Session data.

## Ownership and boundaries

| Part | Responsibility |
| --- | --- |
| `client.mjs` | Native shell/sidebar UI, model selection, consent, navigation |
| `controller.mjs` | Existing Session RPCs and explicit recovery of one submission |
| `policy.mjs` | Preset-scoped tool denial, source checks, pre-step capture, request route |
| `contract.mjs` | Exact schemas, projection, complete-value limits, digest and citations |
| `presets/` | Complete persona without runtime context; policy only, no tool plugins |
| `tests/` | Dependency-free contract tests with explicit synthetic Host/Remote doubles |

Session remains the only durable owner. The first admitted user message contains
the frozen request, source identity/range, evidence, instructions and digest;
normal assistant/turn events own the result. The source Session is inspected
without resuming it or writing to it. Reviews are discoverable by an encoded
Session-ID prefix, but association is validated against the logged snapshot,
not trusted from a name. No Review database, Queue, scheduler or new Remote exists.

The client saves a small Host-bound pending record **before** creation. Double
clicks share one in-flight submission. Explicit recovery reuses the same Session
and RPC identities and exact original request; the existing Host owns prompt
deduplication. An admitted submission is only reread, never resent automatically.
Inspect the raw review first after an ambiguous response. This is not a claim
of exactly-once provider billing after a Host crash. Clearing the local record
neither cancels nor deletes potentially running remote work.

The policy allows only the first turn/step, denies all Tool execution through
`tools.guard`, and does not install tools. Request-scoped model selection does
not update the global default. A human-owned title is pinned before the prompt
to avoid the automatic title-model path. Ordinary native prompts sent later to
a review Session are rejected by policy; native chat is not itself a disabled
composer. Tool guards are not an OS sandbox against trusted same-process plugins.

## Model experience and limitations

The selected range is projected, not an entire raw log dump. Direct user text,
settled assistant text, tool calls/results, boundaries and available usage are
retained. System prompts, request headers, injected user-role background,
reasoning, raw streams, provider replay state, attachment blocks and opaque
Tool metadata are omitted. Omissions are visible; this intentionally limits
root-cause certainty. Text/tool arguments may still contain secrets: **no DLP
or semantic secret-redaction guarantee** is provided. `/feedback` is never used.

Source and target must have the same normalized `cwd`; subagent sources and
cross-worktree transfer are refused. The baseline is a trusted single-operator
Host, not a new multi-user authorization system. The public `inspect()` can
materialize full source history before projection: the output cap is **not**
a proven bound on disk IO or peak source-read memory.

V0 caps: 300 source events, 128 KiB complete rewritten input, 4,096 requested
output tokens, 180 seconds of cooperative cancellation. These are provisional
product limits, not measured optima or a monetary authorization. Oversized
ranges reject rather than silently clip; narrow the displayed event bounds.
The fixed system persona, request framing, adapter retries and possible provider
behavior mean this is not a full Token/price ledger. No extra logical recovery
loop is added, but adapter-internal retry policy remains adapter-owned.

Reports must be plain JSON with known evidence IDs. Invalid, interrupted,
non-completed, incomplete-window and corrupt-digest results are not displayed
as accepted structured reports. Users can inspect the raw Session. A correct
hash detects alteration of the exported envelope; it is not a signature or a
proof of semantic truth. Model hypotheses never become verified facts.

There is no separate summarizer call. Each explicit review creates its own
request prefix; source Sessions' prefixes are untouched. UI copy is Chinese in
V0. Result refresh is manual; the existing chat supplies live output. Full
search, graphical event-range selection, multi-tab submission coordination and
external-agent execution are deferred. Actual end-to-end readiness is unverified.
