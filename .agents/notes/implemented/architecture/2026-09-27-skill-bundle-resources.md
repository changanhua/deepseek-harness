# Agent Note: Provider-owned Skill bundle resources

Status: implemented

English | [中文](2026-09-27-skill-bundle-resources.zh.md)

## Problem

A scoped Agent can load a Skill while lacking a general filesystem tool. Its application model and flow references then remain inaccessible. Treating a returned directory path as read authority would bypass the provider, scope precedence and invocation policy that selected the Skill.

## Decision

The existing Skill service delegates attachment reads to the selected provider. The model-facing `skill` tool supplies its invocation purpose; candidate policy, current definition and exact registration remain bound across loading. Provider disposal, cancellation or a changed scope winner prevents returning stale content. Resource-base metadata does not grant file access.

The local provider accepts canonical relative paths inside directory-style bundles, verifies filesystem containment, and returns complete bounded UTF-8 text. Flat Skill files have no attachment namespace. The tool renders an attachment separately from the main instructions and never runs its code merely because it was read.

This extends the [Skill invocation policy](../feature/2026-07-28-skill-invocation-policy.md) and enables the [application flow](2026-09-27-browser-application-bindings.md). Both decisions remain active; neither is superseded.

## Alternatives considered

**Give every Skill consumer a filesystem tool.** That grants a broader operation set than loading a selected bundle requires and does not cover non-filesystem providers.

**Inline every attachment into the main instructions.** That loses selective loading and repeatedly spends context on code or application models not needed by the current task.

**Load attachments from resourceBase in the consumer.** Metadata would become authority, allowing provider shadowing and lifecycle checks to diverge between the instruction body and its resources.

## Consequences

Providers opt in to attachments; unsupported reads fail explicitly. Complete text and rendered results have byte bounds rather than silent truncation. Required evidence covers winning scope, model invocation changes, exact registration replacement, disposal, path containment, text rejection and a composed Agent loading the selected resource. Browser flows still use their original tool pipeline and task authority.
