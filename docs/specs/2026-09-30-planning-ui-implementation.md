# Planning UI PUI-WP1–3 implementation

Reference: [object workspace redesign](https://github.com/changanhua/deepseek-harness/blob/master/docs/specs/2026-09-30-planning-ui-object-workspace-redesign.md).

## Scope

Deliver an Overview and one Plan Workspace with four tabs. Reuse canonical Planning, native Sessions, exact Proposal adoption, sources and evolution. Keep existing FC27 exploration as the first adapter. Preserve its record keys and storage schema. Planning core schema is unchanged.

## Implementation units

1. PUI-WP1: derive active/inbox/pending/archived views from the Board. Preserve project/search selection and an explicitly selected recent Plan. Pending capture remains a Proposal; count each Proposal once.
2. PUI-WP2: separate Plan navigation from Overview. Lift Focus selection across tabs. Reorganize existing editing and history components; expose existing Proposal review through a Header action. Continue an existing exact-subject Session when its native owner can open it; otherwise create a native Session. Never rewrite an existing binding.
3. PUI-WP3: add a read-only Design Case summary operation in the existing exploration owner. Query only existing records for the selected Plan/Focus, with generic ResourceRef identity. Render an entry card and open the existing case through a separate owner view. Returning preserves Plan/Focus/tab and refreshes canonical and case facts. Missing/error are distinct from no drift.

## Verification

First establish failing UI navigation and read-only summary tests. Run focused Planning UI, runtime, exploration and Loader tests. Build generated Host Remote and Client artifacts, then exercise the real Web composition: ordinary Plan without a Case, FC27 Case open/explore/return/reopen, unchanged canonical Board, revised canonical state with visible drift, exact-subject native Session continuation and explicit Proposal adoption. Verify typed locales, Client package contracts, focused lint and documentation pairs. Broad pre-existing failures are reported separately.

## Delivery boundary

Code is isolated on codex/planning-ui-workspace with the existing FC27 WIP copied as an input baseline. The original worktree remains unchanged. No active desktop, app-server, connector or primary DSH process is restarted. Source, generated artifacts, isolated Web acceptance and active personal deployment are reported separately.
