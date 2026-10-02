# Agent Note: Planning navigation centres on the Plan

Status: implemented

English | [中文](2026-09-30-planning-object-navigation.zh.md)

## Problem

The planning pool, complete detail and every operation occupied one page. Continuing a Plan or Focus required rebuilding the viewing context, while the first exploratory Case introduced a domain-specific action into the generic object workspace.

## Decision

Overview and Plan Workspace are separate navigation states over the same Board. Current state, work and discussion, thinking desk, and history and sources project existing facts. Project search, filter, recent explicit selection and per-Plan Focus/tab remain disposable Client interaction state. They never authorize or describe canonical changes. Proposal review retains exact-generation adoption and stale-base rejection.

Continue work resolves the exact subject against the native owner's available Session list. An existing binding retains its original subject and base revision. If no Session remains available, the existing native creation path binds a new Session before opening it. A failed list read stops continuation instead of inferring absence.

The thinking desk consumes generic Design Case summaries and ResourceRef identities. The existing SBC owner returns only retained records and derives drift from current provider facts. Reading a summary never creates exploration. Its separate owner page keeps the existing record keys, baseline, coordinates, selection and undo. Returning refreshes Planning while preserving the viewing context; no rebase, Proposal or canonical mutation follows navigation.

## Alternatives considered

- A second Overview or thinking-state database would compete with canonical Planning and duplicate lifecycle rules.
- Treating every Plan as an SBC Case would create exploration on ordinary browsing and make the product domain-specific.
- Rebinding a Session to the current selection would erase the durable context from which its proposals were produced.
- A case registry or full thinking platform has no second real consumer and remains deferred.

## Consequences

Canonical state and exploration retain their existing owners and schemas. The read-only adapter extends the existing Remote rather than Planning core. UI checks cover tab separation, exact-subject continuation and a non-FC27 summary; Loader checks cover read-only summaries and persisted exploration across restart. Assembled Web checks cover native Session binding/adoption and Case navigation with retained exploration and visible drift. Personal installation is a separate delivery claim.
