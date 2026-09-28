# Agent Note: Lazy MCP capability endpoint

Status: implemented

English | [中文](2026-09-26-lazy-mcp-capability-endpoint.zh.md)

## Problem

DSH Profiles are selective. Exporting every currently mounted tool to Codex would either expose a partial, accidental roster or force one Profile to load every possible tool. A direct external tool call also needs DSH policy, a durable receipt, and a fresh agent scope without creating a model turn.

## Decision

One loopback MCP endpoint publishes a deployment-owned catalog. Each row binds a declaration to a preset; reading the catalog does not mount that preset. The first call single-flights the standing mount, then runs the declared native tool through a fresh real Agent and `ToolRuntime`. The endpoint keeps catalog discovery separate from execution readiness.

The catalog declaration and loaded tool must have the same name, description, input schema, and output schema. A mismatch fails closed. Each call appends a start and terminal session event, flushes it before returning, and records `observed`, `failed`, or `unknown`; only the terminal state guides recovery. The endpoint returns bounded MCP text and JSON results, never a durable copy of an oversized or unsupported value.

The endpoint is an authenticated, origin-less, loopback Streamable HTTP surface. It accepts stateless `POST` exchanges. Host teardown stops admission, aborts owned work, closes incomplete exchanges, and drains its calls. A cancelled waiter does not cancel a shared preset mount.

## Boundaries

The endpoint accepts only passive, native-tool presets. Mounting one must not begin a model turn, wait for user input, start an independent task, or require a presentation channel. PTC presets are refused. Tool policy still runs through the native executor, including a denial for `ask` when no approval channel exists.

This endpoint does not make DSH Profiles globally discoverable, start another Profile or Host, bridge MCP Resources or Prompts, add a durable task API, or make Codex depend on DSH for its independent browser connector. The broader [browser capability platform design baseline](../../proposed/architecture/2026-09-26-browser-capability-platform.md) remains a separate proposal.

## Alternatives considered

**Export the active Profile's registry.** It makes externally visible tools depend on incidental Host composition and cannot expose an unloaded preset. The catalog-to-preset binding is explicit instead.

**Create one MCP adapter per tool.** It duplicates discovery, lifecycle, metadata, and auditing work. One protocol endpoint can publish any declared native tool.

**Run every call through the DSH model loop.** A direct tool call needs policy and an agent scope, not planning. A model turn would add latency and unrelated session events.

**Mount every preset at Host startup.** It removes first-call load latency but defeats Profile selectivity and activates unrelated dependencies.

## Verification

- Metadata discovery leaves every bound preset unloaded.
- Concurrent first calls mount one preset once; calls to another preset do not activate it.
- A failed mount has no retained partial composition and a repaired preset can be retried.
- Each accepted call has its own real Agent and durable terminal evidence, with no model turn, step, or assistant event.
- Native ToolRuntime policy, PTC refusal, metadata drift refusal, cancellation, response bounds, loopback authentication, Origin refusal, and Host teardown have focused tests.
- A built Profile process test reads stored Sessions through the persistence service. Codex CLI acceptance calls the endpoint, selects a candidate through the real Flash provider, and retrieves a fixture file through glob.

## Consequences

First use pays preset-load latency. A state returned by `dsh_capabilities` may be stale before a later call; it is status, not a reservation. Cooperative cancellation cannot prove that a started side effect did not occur, so unknown calls must remain unreplayed. A passive-preset rule is architectural discipline until a composition-level admission check exists.
