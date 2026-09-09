# Agent Note: Project resources with manual service ownership

Status: implemented

English | [中文](2026-09-09-project-resources.zh.md)

## Problem

Frequently reused notes, files and local service commands need a stable home beyond a conversation. Repeatedly reconstructing paths and launch commands makes simple project work expensive.

## Decision

The [Workspace Controller](../../../../packages/api/workspace-controller/README.md#project-resources) owns a project-local configuration file and process handles created through the existing local subprocess provider. The [Workspace UI](../../../../packages/client/ui-workspace/README.md) adds a small resource section to its existing project page. Notes remain ordinary Markdown and files remain in their original locations. No automatic knowledge extraction, external synchronization, model tool, service dependency graph or restart scheduler is introduced.

File mutations serialize per project and use an exclusive short-lived writer lock before replacing the configuration. Reads reject corrupt configuration rather than repairing it. A process belongs to the Host that started it, independent of the current conversation. Duplicate starts in that Host reuse the live handle. Stop and disposal await the owned process tree; stop does not depend on the project's directory remaining available.

## Alternatives considered

**A new knowledge database and universal resource registry.** Ordinary files and a small configuration cover the first consumers without a new indexing or synchronization system.

**Use conversation Jobs as permanent services.** Their process-local owner lifecycle does not express a manually controlled project service's independent lifetime.

**Automatically restore services after restart.** Manual startup preserves the first version's explicit execution boundary and avoids dependency, readiness and restart policy.

## Consequences

The user can reuse resources across conversations and Host restarts without duplicating source files. Service state and recent logs are observations of this Host's processes, not persisted health claims. Files stay after deregistration. Project-relative paths and canonical link checks bound file operations; foreign processes are never adopted or killed by port number.

Text preview is size-bounded; binary viewing, automatic discovery, knowledge synchronization, durable logs and crash recovery are outside this implementation. A writer crash can leave a lock requiring an explicit check before removal. Browser acceptance exercises files, a real HTTP listener, navigation, stop and Host reopening; focused tests cover write conflicts, invalid paths and teardown.
