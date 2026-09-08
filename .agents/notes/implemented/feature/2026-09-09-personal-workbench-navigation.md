# Agent Note: Personal workbench navigation

Status: implemented

English | [中文](2026-09-09-personal-workbench-navigation.zh.md)

## Problem

A conversation-first home requires users to reopen individual threads to find running work, unread results, and pending decisions. Project browsing must not create work merely to display its status.

## Decision

The [Workspace UI](../../../../packages/client/ui-workspace/README.md) owns a workbench projection over the existing Session list, Workspace membership, and pending-interaction sources. Its view state is shared between primary navigation and the main module; domain state remains with the existing controllers. Work rows open their existing conversations, and project cards select only a viewing filter. Available tool cards follow the module registry through its registration lifecycle.

The [sidebar](../../../../packages/client/ui-sidebar/README.md) provides an additive primary-navigation seat. The [layout](../../../../packages/client/ui-layout/README.md) provides idempotent module activation alongside the existing toggle action. A hidden conversation retains its draft and mounted details while the workbench is visible.

## Alternatives considered

**A separate task database for the home page.** Rejected because duplicated execution and approval state could diverge from the domain that owns the operation.

**A community workbench as the application root.** The accepted local prototype determines the navigation. Community split panes remain useful design references, but their session bindings and layout ownership do not establish this application's project and execution semantics.

**Treat every completed run as an accepted result.** Rejected because an unread completion reminder proves neither independent verification nor human acceptance.

## Consequences

The workbench adds no background model calls, approval authority, or execution scheduler. It can show only facts published by the existing controllers; Queue and Delivery keep their own detail pages and mutation rules. The overview does not provide a separate document store or replace the conversation's result and trajectory renderers.

Focused tests cover project membership, archived and child filtering, pending and unread states, module registration changes, and navigation remounts. Browser acceptance uses a recorded Session through the shipped Web composition.
