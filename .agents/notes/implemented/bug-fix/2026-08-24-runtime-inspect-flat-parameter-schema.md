# Agent Note: runtime_inspect uses a flat object-rooted parameter schema

Status: implemented

English | [中文](2026-08-24-runtime-inspect-flat-parameter-schema.zh.md)

## Problem

The `runtime_inspect` tool declared its parameters as a top-level `oneOf` tagged union (`{ kind: "facts" }` / `{ kind: "command", command }`) with no root `type: "object"`. DSH passes tool parameter schemas to the provider verbatim (`toolsOf` in `packages/llm/llm-pi-ai/src/context.ts`, the serializer in `packages/llm/llm-deepseek/src/serialize.ts`). A strict OpenAI-compatible gateway rejects a function whose `parameters` is not a `type: "object"` JSON Schema — `Invalid schema for function 'runtime_inspect': schema must be a JSON Schema of 'type: "object"', got 'type: null'` — so every request under that provider failed with HTTP 400 before any model call. This was the only tool in the repository with a bare `oneOf` parameter root: every other top-level `oneOf` lives in an output schema (`tool-goal`, `tool-terminal`, `tool-subagent`, `tool-skill`) or under a named parameter (`tool-cordis`).

## Decision

`RUNTIME_INSPECT_PARAMETERS` in `packages/extensions/tool-runtime-inspect/src/index.ts` is now a flat `type: "object"` root with `additionalProperties: false`, `required: ["kind"]`, `kind` as a string `enum` of `facts` / `command`, and `keys` and `command` as optional properties. Because a flat schema cannot express the tagged-union constraints that a `command` variant requires `command` and a `facts` variant forbids it, `validateInspectVariant` enforces those combinations at execution, and its violations join the `validateJsonSchemaValue` result before a `ToolArgsError` is thrown. The model-facing contract is unchanged: the request discriminates on `kind`, `facts` accepts optional `keys`, and `command` requires one `command` string.

## Alternatives considered

**Keep the top-level `oneOf` tagged union.** Rejected: it is the defect. A strict gateway that validates function schemas keeps rejecting the tool.

**Rewrite the schema as a top-level object that also carries `oneOf`.** Rejected: JSON Schema does not allow `type` and `oneOf` on the same node, and DSH's own schema validator rejects that combination (`schema cannot declare both type and oneOf`).

**Convert a top-level `oneOf` into an object root in the adapter wire layer.** Rejected: it would add a conversion for one tool to every adapter, hide a malformed contract instead of fixing it, and the `oneOf` branches overlap in a way no mechanical object-root projection reproduces.

## Consequences

- The `runtime_inspect` parameter schema is accepted by gateways that require an object root, so strict providers no longer fail the whole request before a model call.
- The cross-variant checks moved into execution: a model that emits `{ kind: "facts", command: "..." }` or `{ kind: "command" }` still receives `INVALID_ARGS` from the tool rather than an upstream 400.
- The tools type system still permits a bare `oneOf` parameter root; only `runtime_inspect` used one, and a future raw tool that does so will hit the same strict-gateway rejection. The follow-on [register object-root gate](2026-08-24-register-object-root-parameters-gate.md) closes that framework gap.

## Testing

`packages/extensions/tool-runtime-inspect/tests/runtime-inspect.spec.ts` asserts the flat object-rooted schema (`type: "object"`, `kind` enum, no `oneOf`) and that cross-variant and missing arguments (`{ kind: "facts", command: "codex" }`, `{ kind: "command" }`) are rejected. The package's eight tests pass, and `tsc -b` type-checks the package.
