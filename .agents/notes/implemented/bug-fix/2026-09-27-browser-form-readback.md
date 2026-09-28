# Agent Note: Explicit form values and scoped browser reads

Status: implemented

English | [中文](2026-09-27-browser-form-readback.zh.md)

## Problem

Suppressing every input value prevents an agent from comparing a prepared form with the user's requested text. Filtering controls while retaining whole-page prose also adds unrelated material to targeted reads.

## Decision

The [independent MCP connector](../../../../packages/mcp/browser-extension-mcp/README.md) and [DSH browser tools](../../../../packages/browser/tool-browser/README.md) expose opt-in current input/textarea values through `includeValues`. The shared extension reader preserves their whitespace, marks truncation or redaction, and keeps values out of default reads, background observations and query matching. Password, file, hidden and autocomplete-marked credential/payment fields remain excluded. An unmarked field is not guaranteed to be non-sensitive; callers choose the intended form.

A query scopes prose and structure to the returned controls' nearest local containers, including the current control page. `textScope` makes that coverage explicit. Whole-page reads remain available without a query. Existing exact references may be reused for stable sequential input; submission checks require a fresh complete value read.

This supplements the [browser execution authority decision](../architecture/2026-09-08-browser-execution-authority.md), which continues to own permission, identity and unknown-action recovery. It implements the observation choice in the [platform proposal](../../proposed/architecture/2026-09-26-browser-capability-platform.md) without completing that proposal's task-scope work. Both records retain independent rationale; neither is superseded.

## Alternatives considered

**Expose values in every snapshot.** This expands routine observation beyond the form the agent intends to inspect. Explicit reads preserve default omission and bound the added content.

**Use screenshots for every form check.** Images are useful for layout, but they do not provide exact multiline text or explicit field truncation. Structured values support deterministic comparisons.

**Keep whole-page prose alongside filtered controls.** This hides the scope mismatch and retains the output cost that prompted the targeted read. Explicit local scope makes missing evidence visible.

## Consequences

Callers must distinguish empty values from omitted, redacted and truncated values, and must not infer whole-page absence from a local query. Value text has a shared budget; querying one field can recover values shortened by preceding fields. A field longer than the entire budget remains incomplete. DOM and connector tests cover current values, query scope, privacy markers and pagination; isolated Chromium exercises built MCP calls and reference reuse against actual form state. Personal installed processes require a separate release activation before these source changes become live.
