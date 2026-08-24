# Agent Note: ToolRuntime.register() rejects a non-object-rooted parameters schema

Status: implemented

English | [中文](2026-08-24-register-object-root-parameters-gate.zh.md)

## Problem

DSH's `ToolSchema.parameters` is typed `Record<string, unknown>`, and every adapter passes it verbatim onto the provider wire (`toolsOf` in `packages/llm/llm-pi-ai/src/context.ts`, the serializer in `packages/llm/llm-deepseek/src/serialize.ts`). A strict OpenAI-compatible gateway rejects a function whose `parameters` is not a `type: "object"` JSON Schema. `defineTool()` compiles its `ParameterSchemaSpec` map into `{ type: 'object', properties: {} }` — the invisible gate — but the raw `ctx.tools.register(ToolDefinition)` path bypassed that compilation, so a tool authored with a bare `oneOf` root or an empty `{}` for `parameters` would register, flow to the wire, and fail the whole request with HTTP 400 before any model call. `runtime_inspect` was the first to hit this ([the per-tool fix](2026-08-24-runtime-inspect-flat-parameter-schema.md)); the framework gap that let it through remained open.

## Decision

`ToolRuntime.register()` in `packages/core/tools/src/index.ts` now calls `assertObjectJsonSchema(definition.parameters)` after the existing output-schema assertion, throwing `` tool "${name}" parameters must be an object-rooted JSON Schema (model-facing function calling requires type: "object"): <violations> ``. The same object-root constraint `assertObjectJsonSchema()` already enforces for subagent and workflow structured outputs now covers the registration entry point. `ToolSchema.parameters` in `packages/llm/llm/src/types.ts` documents the contract: the root MUST be `type: "object"`, the adapter passes it verbatim, `defineTool` compiles to an object root, and `register()` asserts the raw path.

## Alternatives considered

**Convert non-object roots to an object root in the adapter wire layer.** Rejected: it would add a per-tool projection to every adapter, hide a malformed contract instead of failing it at registration, and a `oneOf` root whose branches overlap has no faithful mechanical object-root projection. The defect belongs at the registration boundary, one layer inside the model-facing seam.

**Tighten `ToolSchema.parameters` to `ObjectJsonSchema` at the type level only.** Rejected: a type constraint does not protect runtime-constructed definitions (MCP `inputSchema`, structured-output schemas, sandbox `harness.defineTool` results), and the wire failure is a runtime behavior. The runtime assertion is the load-bearing gate; the type change documents it.

**Gate only at schema projection (`schemas()`), not at registration.** Rejected: projection is read-time and may be skipped by an assembly override; registration is the single commit point where a bad definition is either accepted or rejected, and the registry's HMR rollback semantics already live there.

## Consequences

- A raw registration with a non-object-rooted `parameters` (bare `oneOf`, empty `{}`, or any root lacking `type: "object"`) is rejected at registration, before it can reach the wire, instead of failing an entire provider request later.
- Every shipped tool registers through `defineTool` or `sandboxDefineTool` (which calls `defineTool`), so both compile to an object root; the structured-output tool (`packages/subagent/subagent-in-process-driver/src/structured.ts`) registers a caller-defined `ObjectJsonSchema`; MCP tools register the server's `inputSchema` verbatim, where the MCP spec already requires an object schema and the gate now rejects a server that violates it rather than letting it surface as a wire 400.
- The tools type system still permits a bare `oneOf` parameter root at the TS level; the runtime gate is the contract. A future raw tool that needs a non-object parameter root must restructure around an object root, exactly as `runtime_inspect` did.

## Testing

`packages/core/tools/tests/register-gate.spec.ts` imports `ToolRuntime` from `../src/index.ts` (source plane, not built `lib/`) and asserts the gate rejects a bare `oneOf` root, rejects an empty `parameters: {}`, accepts an explicit object root, and accepts a `defineTool` fixture unchanged; the four tests pass. `tsc --noEmit` type-checks `packages/core/tools` and `packages/llm/llm` with no errors.
