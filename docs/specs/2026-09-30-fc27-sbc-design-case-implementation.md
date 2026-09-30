# FC27 SBC Design Case implementation

## Scope and observed state

Implement WP0/WP1 from the user-supplied FC27 SBC Design Case context. Planning remains canonical; exploration persists separately and never executes Planning commands. The supplied kickoff references an absent docs/design-cases path; the actual input is docs/fc27-sbc-design-case in the main checkout.

The current Planning provider uses planning_boards.json through StorageDomain. A Board has items with immutable revisions and headRevisionId, and optional focuses with independent versions. Focus updates also advance their Plan revision. buildPlanningContext already resolves Plan/Focus ownership. The observed personal Board contains the FC27 plan plan-f36f9f77-4681-4f8a-beea-5438924bf5ee under project a3c65999-c04b-4a69-91bf-154866e40222, titled with the original FC27/SBC description; the named Focus is absent. Reuse the Plan, support optional selected Focus, and do not rename or create canonical objects as a side effect of opening exploration.

## Implementation order

1. Extend Planning Remote with SBC-specific read/open and exploratory operations, backed by a separate sbc_design_cases StorageDomain. Persist the existing PlanningRevision and PlanningFocus types as frozen projections, with independent layout, selection, undo history, and optimistic case version. No new Planning schema or Planning mutation route.
2. Add an SBC-specific module inside ui-planning. Open from the selected Plan/Focus, render canonical projection separately from exploration, support pointer dragging and keyboard rearrangement, selection and undo. Use a lifecycle-owned React-free controller and typed locale copy.
3. Compare saved base Plan revision and Focus version with fresh provider facts at open/read, refresh, and local operation. Expose current identifiers and drift while preserving the saved projection and exploration. Do not merge/rebase automatically.
4. Verify persistence and drift through the real personal-planning Loader composition, including restart, unchanged canonical Board, concurrent case writes and cancellation. Verify GUI dragging/selection/undo and repeated entry. Build generated Remote and client artifacts, then exercise the real FC27 Plan in an isolated verification instance using a copy of its Board.

## Review corrections

SBC operations are opt-in and lazily resolve exploratory storage; absence of that storage does not disable ordinary Planning Remote operations. Per-record persistence uses a path-safe hash of the project and subject, with deployment-configured case count and serialized-byte limits. Undo stores inverse movement coordinates rather than complete layout snapshots; selection does not consume spatial undo. The UI must commit one move on pointer release and keep pointer-move preview local. Coordinate and prefixed-node identity validation cover all 200 legal canonical entries and 256-character canonical ids. Failed initialization is not retained as a permanently rejected promise.

The real FC27 Plan is reused without renaming. The named Focus is not established by exploration. The existing Planning create-Focus action is the canonical entry for establishing it; real Focus acceptance remains pending until that action is performed and its resulting identity is read back. Automated fixtures establish their own Focus through the real Planning provider and do not stand in for personal data acceptance.

## Files and evidence

Owners: planning-remote/src/sbc-design-case.ts and types.ts own only exploratory storage and wire data; ui-planning/src/client/SbcDesignCase.tsx and sbc-design-controller.ts own presentation and interaction. PlanningObject provides the entry; the existing Slot contribution supplies controller hooks. Update the owning README pairs and record the decision in an Agent Note.

Acceptance: real Plan/Focus → open → move/select → undo → persist → reload/restart → canonical revision update → retained local state plus visible drift. Unit/GUI checks, Loader restart evidence, generated-artifact build and browser evidence remain separate claims. The active desktop, gateway and primary DSH processes remain running.

## Verification status

The focused Planning/Remote/UI and real Loader tests pass (11 files, 62 tests). Host and Client artifact builds and the aggregate Client typecheck pass. Four edited documentation pairs, Client UI localization, Client package rules, focused lint and diff whitespace pass. The assembled browser test passes both with controlled canonical data and with a read-only copy of the personal FC27 Board. It exercises generated Remote, pointer drag, selection, reload, undo, retained base projection, visible revision drift and full page reload. The real Loader test separately proves persistence across Host composition restart and selected Focus drift.

Reproduce the controlled browser path with `DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/sbc-design-case.e2e.ts` (set the environment variable with PowerShell on Windows). Optional `SBC_ACCEPTANCE_BOARD` names a local planning_boards.json to copy into isolated storage; `SBC_ACCEPTANCE_SCREENSHOT` names the screenshot output. Neither option writes the original Board. Personal acceptance retains the original Plan and revision identities while substituting only the isolated Workspace identity.

The full GUI run has 5 failing files outside this change (16 failing tests); comparison confirms their source is unchanged from the branch base. The documentation quick checks have 9 unsuccessful checks, including unchanged corpus pairing, type-equivalence and README defects; scoped changed pairs pass. Full replay Web verification was interrupted after the existing browser-platform bootstrap could not connect its extension within the test timeout. No baseline cleanup is included. The branch remains unmerged and the active personal instance is not upgraded; live Focus creation and live deployment acceptance remain separate work.
