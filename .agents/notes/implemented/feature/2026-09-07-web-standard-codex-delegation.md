# Agent Note: Web standard sessions can delegate to Codex

Status: implemented

English | [中文](2026-09-07-web-standard-codex-delegation.zh.md)

## Problem

Web users had to copy or select a special Agent Preset before an ordinary conversation could delegate a self-contained task to Codex. That setup made a safe product integration behave like configuration work and prevented an existing Session from expressing the intent naturally.

## Decision

The Web composition configures the existing `codex` provider with `permissionMode: approve-for-me`, which maps to Codex automatic approval review and its workspace-write sandbox. The shipped `standard` Agent Preset exposes the existing `subagent_codex` tool. A user can therefore ask Codex to implement or review a bounded task in an ordinary standard conversation; the tool waits in the foreground by default, returns the final Codex answer to the same parent turn, and lets the parent continue without a preset switch.

The child uses the parent Session workspace, which can differ from the checkout that runs the DSH Host. The model-facing tool cannot select a permission mode or raise its own authority. The existing [permission decision](2026-08-15-product-subagent-noninteractive-permissions.md) owns the native mapping, and the [one-shot scheduling decision](2026-08-12-product-subagent-one-shot-background-tasks.md) owns foreground and optional Job behavior. This downstream Web default is an explicit exception to the opt-in exposure described by the [production exclusion decision](../simplification/2026-08-12-production-dsh-excludes-product-subagent-providers.md).

## Verification

A composition test loads the Web patch and standard preset and fails unless the Host selects `approve-for-me` and the standard tool row is enabled. A real browser session using `standard` and `Workspace Write` invoked `subagent_codex`; the packaged Codex app-server wrote an exact marker in the Session workspace, returned its path, and the parent Agent read the file and completed the same turn. The listener remained on port 3080 under the intended source checkout.

## Alternatives considered

**Require a dedicated relay preset.** This adds a mode choice before the user can express an ordinary delegation intent and prevents existing standard Sessions from using the integration.

**Expose a separate read-only provider and tool by default.** Read-only remains a supported deployment option, but it cannot implement normal workspace tasks and adds another model-visible tool name.

**Register the tool on the Host plane.** Web isolates model-facing tools by Agent Preset. A global tool would bypass that ownership and expose the capability to unrelated presets.

## Consequences

Standard Web conversations can use Codex without address entry, connection setup, or preset management. Each invocation still starts a fresh Codex process and model turn, so the standard schema has a fixed token cost and calls have product startup and network latency. Workspace writes retain Codex automatic review; stronger authority remains an explicit Profile decision. Other profiles and presets keep their own exposure choices.
