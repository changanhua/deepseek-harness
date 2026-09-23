# Browser semantic navigation delivery plan

English | [中文](2026-09-21-browser-semantic-navigation.zh.md)

## Approved outcome

The user enters a topic overview of collected page content in the browser assistant, focuses a topic to see its children and sources, locates and highlights the correct original passage, and returns to the previous reading position. Model summaries, source text, and human judgments have distinct labels. Articles, tutorials, and documentation form the first complete vertical; FUTBIN remains a list-page acceptance target, so article support alone cannot close this task.

## Ownership and reuse

`SourceSnapshot` reuses Browser collection and committed Session tool results to record the exact document, snapshot, extractor version, ordered content blocks, and omissions. The browser's private cache retains only nodes and text needed to verify source location; it grants no write capability. `SemanticMap` is a replaceable derivative bound to a source result and persisted as a regular tool result. `ViewState` owns the expansion path, selection, and position within a map version; the model cannot change it.

The model proposes grouping, labels, and summaries through `browser_publish_semantic_map`, referencing existing block identifiers only. The publication tool reads delivered snapshots from the initiating Session and checks references, hierarchy, overall bounds, and versions. The program assigns map and node identities; unorganized source remains accessible. A new candidate does not automatically reconcile old identities. Layout and expansion are deterministic within a map version.

The extension marks its semantic-generation user turn, and a replayable Session projection retains that state across Host recovery. A Host-side monotonic tool guard permits only `browser_snapshot`, `browser_read_source`, and `browser_publish_semantic_map` until that turn ends, including when the model attempts Dynamic Cordis or a tool transport. The marker only removes authority; it never grants it. Test this boundary against webpage-injected instructions and confirm a later ordinary turn regains its normal tool policy.

## Dependency order

1. Source closure: bounded text blocks, preserved code and table representation, distinct identical-text blocks, paragraph location, and rejection after text changes. Missing sources, evicted caches, and replaced documents must fail explicitly.
2. Semantic candidate: a minimal two-level navigation format, source validation, rejection of unknown references and stale results, and retained unorganized content. The model interprets evidence without creating sources or locators.
3. Complete reading path: explicit generation, Overview → Focus → Source, local expansion without inference, and preserved return position. Without a valid semantic artifact, show source-structure navigation and generation state without calling it a semantic map.
4. Reader feedback: retain human corrections and error flags separately from model maps in trusted extension storage, bound to the exact map and node. Serialize writes, reject conflicting revisions, preserve corrections across candidate generation, and record bounded source-navigation outcomes without rewriting source evidence.
5. Real acceptance: actual model generation, extension-to-page source assertions, held-out samples, and reading-task comparisons. Screenshots, valid JSON, builds, and structural tests cannot independently establish acceptance.

## Parallel ownership

The primary integrator owns source contracts, extension collection, projection, UI, runtime, documentation, and final acceptance. The tool implementer owns only the publication tool and its unit tests. Read-only exploration identifies current Session/tool contracts; independent review checks references, versions, authority, and evidence gaps after the candidate stabilizes. Shared contracts, catalog generation, and integration remain serial.

After tool integration, the verification worker owns the real-browser semantic test and fixed evaluation fixtures. A separate feedback implementer owns only the local feedback store and its unit tests; the primary integrator owns trusted-message admission and all UI integration. Neither worker changes the generation prompt, public source contract, or the other's files.

## Acceptance conditions

Source tests cover duplicate paragraphs, code whitespace, table order, truncation, deletion, text replacement, and navigation. Publication tests cover missing references, forged tool text, other Sessions, stale snapshots, target rebind or clear during generation, an uncertain later snapshot, cycles, unreachable nodes, and overall size. Browser tests assert that the actual highlighted source equals the expected passage and check keyboard use, narrow layouts, return position, and failure fallback.

Semantic evaluation checks subject identity, numbers, negation, qualifications, and attribution across authors. A second model only flags suspected defects, never certifies correctness. Keep held-out cases within an initial fixed set of about 20 pages; extend beyond articles incrementally and record FUTBIN separately. Compare correct source retrieval, elapsed time, expansion count, and misunderstanding against native contents, search, and ordinary summaries. Any claimed percentage improvement requires measurements.

## Boundaries

Do not silently read uncollected pages, regenerate on DOM mutations, draw unsupported relations, or present model scores as confidence. The first release does not promise complete understanding of infinite scrolling pages or complex causality. Treat reading an old snapshot and locating it in the current page as separate operations; preserve source evidence on invalidation rather than guessing a new location.

This plan replaces the primary view and delivery sequence of the [region atlas plan](2026-09-21-browser-assistant-semantic-page-atlas.md); its exact-page, authorization, and unknown-result rules remain applicable. Closure requires complete navigation and source evidence on supported pages, not a passing prerequisite alone.
