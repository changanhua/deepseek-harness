# Agent Note: Delivery Case revisions preserve authority and expose execution prerequisites

Status: implemented

English | [中文](2026-09-05-delivery-case-form-readiness.zh.md)

## Problem

A local idea cannot become executable if the only revision form always omits its verification source. Rebuilding a revision from the visible subset also discards restrictions, unresolved questions, reference links, and clause identities that another entry supplied.

## Decision

The [Delivery workbench](../../../../packages/client/ui-delivery/README.md) edits the existing Contract revision model. Its form exposes base selection and both existing verification source variants. It sends executable arguments separately and leaves plan resolution, schema enforcement, requirement approval, and Packet identity with their existing Host owners.

Unedited fields retain their recorded values. Existing clause identities survive unchanged text, and editing a check's name or timeout does not reinterpret its argument array. The browser uses `HEAD` only as the initial value for a missing base; it does not guess a repository branch name.

## Alternatives considered

**Weaken readiness or supply a successful placeholder check.** Rejected because an executable Packet requires the operator's actual verification plan.

**Create another browser-specific contract or executor path.** Rejected because the existing Remote and Delivery model already support these inputs; a second model would introduce translation and ownership drift.

## Consequences

Idea capture remains lightweight. Advancing a Case requires explicit execution inputs without erasing constraints the form does not edit. Browser coverage follows the real Web/Delivery composition through Packet creation on a repository whose branch is `master`; this human-only workflow makes no model call and does not prove Codex execution or verifier correctness.
