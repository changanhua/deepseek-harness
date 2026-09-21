# Browser assistant semantic page atlas plan

English | [中文](2026-09-21-browser-assistant-semantic-page-atlas.zh.md)

**Goal / definition of done:** Replace observation-shaped page cognition cards with one evidence-backed semantic atlas per exact page document. A user can understand page structure, known content, available actions and important omissions at a glance; select a region for detail; and locate current references without treating inferred or unread content as known.

**Scope:** This plan owns cognition projection and extension rendering. It does not add a new reader, storage system, site-specific scraper, authorization path, background poller or model-generated source of truth. The [personal browser assistant V2 decision](../../../.agents/notes/proposed/feature/2026-09-20-personal-browser-assistant-v2.md) owns the rationale and authority boundaries.

## Design philosophy

### One map, three reading speeds

The primary view is a semantic map, not a screenshot and not a list of tool observations. In under one second, shape and state expose the main content, side regions and unread areas. In several seconds, region cards expose content, entity and action counts. Selection opens a region inspector with known content, available actions, omissions and evidence.

The atlas absorbs the old overview and actionable-element views. Structure and evidence remain secondary inspection views because they answer debugging and verification questions rather than the ordinary “what does the Agent know and what can it do here?” question.

### Evidence before aesthetics

Every visible fact comes from a committed result delivered to the Agent. Solid, partial and unread states describe observed coverage, not visual confidence. Unknown geometry or region membership stays unplaced instead of being invented. A locator appears only while its exact page, snapshot and element identities remain valid.

The atlas may shorten delivered text for display, but it never creates an authoritative model summary. A future generated synthesis must be labelled as generated, cite evidence records and remain visually distinct from deterministic facts.

### Universal core, page-shaped vocabulary

One page model supports articles, Q&A feeds, catalogs, search results, forms, dashboards and unknown pages. A presenter may choose page-shaped labels and emphasis from semantic roles, headings, collections and controls. It may not alter evidence, coverage, locator validity, action authority or omissions.

A site-specific adapter is justified only after observed pages prove that generic semantics cannot recover an important repeated structure. Such an adapter enriches labels and grouping, preserves the generic fallback and never reads or acts independently.

The sidebar remains an adapter. Browser providers collect bounded evidence under DSH authority, the Host/Session log owns committed truth, `assistant-cognition.js` performs a pure deterministic projection, and the sidebar renders and dispatches typed commands. The extension UI neither persists an independent semantic state nor decides lifecycle or authorization policy.

### Spatial truth without pixel imitation

The map normalizes observed region bounds into a stable grid and preserves broad relationships such as top, main, side, repeated feed and below-viewport content. It does not reproduce page styling or every nested DOM box. Nested landmarks collapse into the nearest useful parent unless they carry distinct content, actions or coverage.

The current page expands by default. Other current documents render as compact map cards; previous documents retain evidence summaries but show invalid locators. Observation count never becomes page count.

### Visible action is not execution authority

Region action chips provide discovery and exact-page location. Mutating actions still use the existing Browser action, approval, target-revision and unknown-outcome rules. A map cannot grant authority, replay an uncertain write or silently switch to the foreground tab.

## Frozen projection contract

The projection groups observations by `installationId + tabId + frameId + documentId + url`. Each page exposes identity, current/previous state, observations, aggregate coverage, regions, unplaced actions, omissions and evidence references. The latest document per tab/frame is current; earlier exact documents are previous.

Each region exposes a stable projection ID, semantic role, label, normalized bounds, importance, coverage state, bounded delivered text, entity/collection summaries, current actions, omissions and evidence references. Bounds and semantic content come from `browser_page_map` and delivered snapshots; the projection strips selectors and other private implementation details.

Each action retains its exact page, snapshot and element identities, role, label, state and region membership. Membership uses containment when trustworthy bounds exist and semantic context otherwise. An action with no trustworthy membership appears under unplaced actions; the renderer never guesses a region.

Coverage is a set of explicit measures, not one invented completeness score: delivered text range, observed collection items versus reported item count, controls returned versus pagination state, tree nodes/cursor, regions observed and known truncation. The UI may display a local ratio only where numerator and denominator are both supplied by evidence.

The projection remains bounded by existing Browser limits. It retains at most the delivered 32 regions, 128 controls and bounded tree/text previews per observation; it aggregates references instead of storing a second full DOM database.

## Interaction and layout rules

- Use the atlas as the default cognition view. Keep only Structure and Evidence as secondary tabs; do not restore separate Overview or Actionable tabs.
- Encode read state with text and border treatment as well as color. Every map region is keyboard selectable and has an equivalent accessible name and status.
- Put the most useful safe navigation/location actions directly in a region. Collapse the remainder behind a count without hiding that they exist.
- Selecting a region updates one inspector with Known content, Available actions and Not covered. The inspector does not duplicate raw DOM metadata.
- Locate a region or element in the pinned page without changing the target. Stale locators remain visible only as historical evidence and cannot dispatch.
- Follow the available container width. At approximately 40 viewport percent, use map plus inspector columns; below 700 CSS pixels, stack them. Avoid long prose wider than 72 characters per line.
- Render current pages as a deck: the selected page is expanded and other pages show compact semantic thumbnails with title, page type, coverage and omissions.
- Preserve a deterministic generic fallback for missing bounds, unknown page types, Canvas, cross-origin frames and virtualized content. The fallback is a semantic outline, not an empty map.

## Delivery plan

### P0 — Freeze page-level behavior with failing tests

Owner: root/Sol. Extend `apps/chrome-extension/tests/assistant-cognition.spec.ts` before production edits. RED cases cover grouping multiple observations into one exact page, page count versus observation count, current/previous documents, region bounds and text retention, explicit omissions, unplaced actions and stale locator removal.

Completion: every test names the production change that makes it pass; failures come from the current observation-list projection rather than fixture or import errors.

### P1 — Project pages, regions and coverage

Owner: Sol. Reshape `apps/chrome-extension/src/assistant-cognition.js` from `{ items }` to page-level projection. Preserve public `browser_page_map` role, label, text, importance, stability and bounds; normalize geometry and deduplicate nested landmarks deterministically. Keep observation provenance and history inside each page.

Add element bounds to `apps/chrome-extension/src/browser-page.js` only if tests prove semantic context cannot assign actions reliably. Bound and validate any new public field through the existing Browser result path; do not add another Host route or persistence format.

Completion: focused cognition and browser-page tests pass; malformed or extreme bounds fail closed; no page read occurs during projection.

### P2 — Render the atlas as the primary cognition surface

Owner: Terra after P1 freezes fixtures. Modify `apps/chrome-extension/src/sidebar.js`, `sidebar.css`, `sidebar.html` only as needed, plus `tests/sidebar.spec.ts`. Render the page deck, atlas grid, region action chips and selection inspector; retain Structure and Evidence secondary views. Use container queries for the wide and stacked layouts.

Completion: sidebar tests cover keyboard selection, text equivalents for state, wide/stacked layout hooks, current and previous pages, empty/fallback maps, stale locators and command payloads. The renderer consumes projection facts and contains no website detection or Host policy.

### P3 — Prove cross-page generality

Owner: Sol integration. Add deterministic fixtures for an article, Q&A feed, catalog/list, form/dashboard and unknown page. Test one generic projection and presenter path; do not create five site adapters. Verify that each fixture exposes its main region, primary collection or fields, safe direct actions and explicit gaps.

Completion: the same projection and renderer pass all fixtures. Add a specialized presenter only when one repeated semantic pattern cannot be represented without losing important content or action grouping.

### P4 — Real extension boundary and acceptance

Owner: Sol. Build the extension, reload the exact candidate and inspect one real Zhihu question page plus one structurally different page. Confirm map geometry against observed regions, content/actions against delivered results, unread areas against actual truncation and every locator against the pinned page. Browsing another tab must not retarget the atlas or its actions.

Completion: retain screenshots, Session/request/page/snapshot identities and source-result comparisons under the existing browser-assistant evidence directory. The HTML prototype is a visual reference, not acceptance evidence. Do not restart the working Host until the source and focused checks are stable and a real boundary run is ready.

## Evolution policy

Place a new fact in the map only when it improves at-a-glance understanding across at least three page patterns. Region-specific detail belongs in the inspector; raw lifecycle and DOM facts belong in Evidence or Structure. Add a new top-level cognition view only when it serves a distinct user job that neither map, inspector nor evidence can express.

Prefer generic semantic roles and collection patterns over domain names. Preserve a working generic fallback before adding an adapter. Remove an adapter when the generic model reaches equivalent clarity.

Evaluate improvements against four outcomes: time to identify the page's main content, correctness of known-versus-unread boundaries, time to locate the intended action and absence of wrong-page or stale-locator dispatch. Visual density alone is not success.

Potential later layers are ordered: better deterministic entity grouping; multi-page comparison; optional screenshot backdrop; optional generated synthesis. Each layer requires its own evidence and must not weaken deterministic facts, target authority, bounded reads or accessibility.

## Escalation conditions

Stop and revise this design if implementation requires automatic page polling, a second DOM store, model-generated facts in the authoritative projection, selector exposure to the sidebar, site adapters with independent reads/actions, or a Host/public Browser contract broader than bounded geometry and semantic grouping.

Escalate a changed target, authorization, persistence or unknown-outcome rule to the V2 owner before implementation. Ordinary CSS/layout iteration and deterministic projection fixes remain inside this plan.
