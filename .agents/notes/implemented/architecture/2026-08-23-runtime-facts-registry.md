# Agent Note: Owned runtime facts with synchronous baseline projection

Status: implemented

English | [中文](2026-08-23-runtime-facts-registry.zh.md)

## Problem

Runtime properties such as host platform, process location, proxy configuration, and a bound Web URL existed behind unrelated process APIs, environment variables, or concrete providers. A model could see tool schemas and selected policy context but had no small authoritative vocabulary for these facts. Consumers that tried to answer runtime questions would otherwise duplicate probes, infer provider identity, or expose raw environment values.

One projection mechanism also cannot safely treat every observation alike. Process constants can be sampled once; a hot-loaded Service Provider must be read again; credential and network checks may be asynchronous; and PID, proxy, or URL details should not enter every request. Awaiting all probes during system-prompt assembly would add latency and failure coupling to ordinary turns.

## Decision

### One owned scalar registry

`@deepseek-ai/dsh-runtime-facts` registers `ctx.runtimeFacts`. Each dotted lowercase kebab-case key has one active owner, and duplicate registration fails loud. The owner supplies a description, a secret-free scalar resolver, and three independent declarations: `evaluation` (`sync` or `async`), `freshness` (`static` or `dynamic`), and `exposure` (`baseline` or `inspect`). Registration and cached observations follow the owner's Cordis effect lifetime.

`list()` returns resolver-free metadata. `inspect()` reports `ok`, `unknown`, `unavailable`, or `probe-failure` per requested key and contains each resolver failure independently. Static observations are reused for the registration lifetime; dynamic observations run again. Synchronous failures are logged and treated as unavailable. Asynchronous rejection or cancellation is logged and returned as a sanitized probe failure rather than rejecting the complete inspection.

### Automatic context remains synchronous and scoped

The registry contributes one order-120 `systemPrompt.context` entry. Its synchronous `render()` selects only `evaluation: sync` plus `exposure: baseline`, sorts available rows by code-unit key order, and emits an empty string when none applies. Prompt assembly never launches an asynchronous probe.

A fact may declare required tool names through `relevance`. The registry, not each provider, evaluates those names against the authoritative `ctx.tools` registry for the current scope. An absent scope or hidden required tool suppresses the row. The resulting text enters the agent loop's existing sourced runtime-context replacement path, so a changed value is logged and replayable without adding a new Session event type.

The Web host composition mounts the registry and Host provider, while agent presets decide whether the model may call `runtime_inspect`. The `standard` and `code` presets mount the tool in their own scopes; the tool contributes no separate system-prompt section. `minimal` omits it and suppresses runtime context, preserving its fixed two-tool composition.

### Host provider delegates changing facts

`@deepseek-ai/dsh-runtime-facts-host` owns the initial Host inventory. `runtime.execution-world` is its only baseline fact and delegates dynamically to `ctx.subprocess.executionWorld`; the local provider reports `local` and E2B reports `remote`, so consumers do not infer location from platform or class identity. This extends rather than replaces the [portable execution-world decision](2026-07-28-portable-execution-world-consumers.md).

`host.os`, `host.arch`, `host.pid`, five sanitized `host.proxy.*` scalars, and `web.server-url` are inspect-only. Proxy metadata comes from one launch-environment snapshot and discards credentials, raw URL, path, query, and fragment. The Web URL delegates to the current `ctx.webServer` bind and the execution world delegates to the current subprocess service; both are dynamic because those services can hot-load. Missing optional services make their facts unavailable rather than guessed.

## Verification

Focused registry suites pin key and declaration validation, duplicate ownership, effect disposal and reload, all three declaration dimensions, deterministic rendering, centralized relevance, static caching, dynamic reevaluation, the four inspection states, asynchronous cancellation, and failure containment. Host-provider suites pin the exact inventory, local-to-remote delegation, absent optional services, launch-snapshot proxy precedence and sanitization, and secret-bearing URL removal. Local and E2B subprocess suites pin their respective `executionWorld` values; package invariants compare registered ownership with the actual assembled baseline text.

## Alternatives considered

**Expose selected environment variables directly.** Rejected because environment names are not domain authority, proxy values may contain credentials, and raw strings provide no ownership, freshness, or exposure policy.

**Put every Host probe in one registry implementation.** Rejected because subprocess and Web services own their hot-loadable state. Central probing would infer across package boundaries and keep stale values after provider replacement.

**Await asynchronous facts during every prompt assembly.** Rejected because credential or network probes would add request latency and make ordinary model calls depend on optional diagnostics. Asynchronous work remains explicit inspection.

**Encode timing and visibility as one fact kind.** Rejected because resolver timing, cache lifetime, and model exposure vary independently. A combined enum would either permit invalid ambiguity or grow a product of unrelated states.

**Register process facts as one object.** Rejected because scalar keys allow independent exposure and unavailable states, deterministic rendering, and field-level sanitization without a nested value protocol.

**Project host platform and shell language automatically.** Rejected because scoped shell tools already identify their command language, architecture rarely changes ordinary decisions, and repeating those details in every retained runtime snapshot adds context without establishing command availability. OS and architecture remain inspectable; command resolution stays with `runtime_inspect`.

## Consequences

Runtime context gains a small, deterministic, replayable baseline without asynchronous request latency. Inspection consumers can share the same ownership and failure vocabulary without duplicating probes. Providers pay an explicit declaration and sanitization obligation, and hot-loadable facts must be marked dynamic. Static results have no TTL, inspect-only facts have no model-facing path until a separate authorized consumer is mounted, and the registry deliberately does not become a general configuration, health-check, or environment-discovery service.
