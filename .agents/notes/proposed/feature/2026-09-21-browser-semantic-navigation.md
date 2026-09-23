# Agent Note: Browser semantic navigation and source location

Status: proposed

English | [中文](2026-09-21-browser-semantic-navigation.zh.md)

## Problem

DOM regions, chapter outlines, and excerpts explain collection results but do not help readers understand related ideas or choose where to go deeper. Model summaries can organize meaning, but valid source identifiers do not prove faithful interpretation. New candidates and page changes can also disrupt the existing reading position.

## Proposal

Use Overview → Focus → Source as the reading path and separate source snapshots, semantic maps, and view state. Browser collects ordered source blocks on explicit reads and retains private source anchors; Session tool results own delivered facts. The model reads complete bounded block pages through `browser_read_source` and submits two-level navigation through `browser_publish_semantic_map`. Publication validates read receipts, sources, hierarchy, versions, and overall size; webpage text grants neither instructions nor authority.

Semantic generation is an explicitly marked user turn, tracked by a replayable Session projection through Host recovery. A monotonic Host tool guard limits that turn to snapshot, source reading, and map publication, including through nested tool transports. Its in-band marker only restricts authority; page text cannot create a user turn, and later ordinary turns retain their usual policy.

The source and read-receipt authority is another bounded host-only Session projection. It validates call/result provenance as events arrive, retains only recent snapshots, and fails closed for evicted or changed sources. Each source carries the selected target revision from its snapshot call and the page identity returned by the authenticated observation. A rebind, clear, or later snapshot attempt prevents publishing an older source; a newer document observation makes the previous source stale without requiring a same-tab rebind. Source location targets the observed document and verifies its current text. Tool execution does not synchronously scan historical Session events.

Each source block retains its order and exact document/snapshot identity. Duplicate text has distinct identifiers, code preserves whitespace, and tables retain row order. Source location first verifies the document, then compares the retained node with the captured text. Text changes, removed nodes, evicted caches, and replaced documents fail explicitly without guessing from similar text. Scrolling updates only the reading position of existing sources; relevant mutations invalidate location claims without rerunning the model.

A semantic map is replaceable AI interpretation. Referenced blocks must appear in committed source-read results, and unorganized blocks remain accessible. Source existence and semantic fidelity have separate acceptance. The UI identifies AI summaries and human-review status without model-reported confidence scores. The program owns map versions and node identities; a new candidate remains an explicitly selectable version instead of silently replacing the current map. Expansion, return, and source location do not invoke the model again.

This proposal partially supersedes the spatial-region primary view in [personal browser assistant V2](2026-09-20-personal-browser-assistant-v2.md); its Session, exact-target, authority, and unknown-result rules remain applicable. The [delivery plan](../../../../docs/superpowers/plans/2026-09-21-browser-semantic-navigation.md) owns slices and acceptance order. Articles, tutorials, and documentation form the first complete vertical; FUTBIN remains a list-page acceptance target.

## Alternatives considered

**Deterministic region boxes as the semantic map.** They support evidence and structure inspection but cannot organize meaning, so they serve only as fallback navigation.

**One model call generates the graph and locators.** This combines interpretation errors with location errors and cannot guarantee navigation after page changes. The program assigns source identities; the model only selects references.

**Freeze a complete knowledge-graph taxonomy and free canvas first.** Fixed claim, evidence, and counterexample types constrain tutorials and lists. Unverified distances and edges can imply nonexistent causality. Verify grouped navigation first, then add relations supported by evidence.

## Acceptance criteria

A real model generates a map from read blocks of the pinned page. The user moves through overview, focus, and source to highlight the correct passage, then returns to the same reading position. Switching unrelated tabs does not change the target, expansion adds no model call, candidate versions can be selected explicitly, and invalid references or stale versions are rejected. Held-out semantic cases check qualifications, numbers, negation, and attribution; navigation tasks compare against contents, search, and ordinary summaries. Structure, builds, screenshots, or simulated data cannot independently close acceptance.

## Risks

Source validation cannot prove model interpretation correct. Browser anchors have bounded capacity; reading an old snapshot does not guarantee location in the current page. Source blocks and generated outputs are bounded, and omissions remain visible. The first release does not promise complete infinite-scroll processing or complex causality, and article tests do not replace FUTBIN or other list-page acceptance.
