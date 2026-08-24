# Agent Note: ToolRuntime.register() 拒绝非 object 根的参数 schema

Status: implemented

[English](2026-08-24-register-object-root-parameters-gate.md) | 中文

## Problem

DSH 的 `ToolSchema.parameters` 类型为 `Record<string, unknown>`，每个 adapter 都将其原样透传到 provider 线路（`packages/llm/llm-pi-ai/src/context.ts` 的 `toolsOf`、`packages/llm/llm-deepseek/src/serialize.ts` 的序列化器）。严格的 OpenAI 兼容网关会拒绝 `parameters` 不是 `type: "object"` JSON Schema 的函数。`defineTool()` 会把它的 `ParameterSchemaSpec` map 编译成 `{ type: 'object', properties: {} }`——这道隐式门——但裸的 `ctx.tools.register(ToolDefinition)` 路径绕过了这道编译，于是一个 `parameters` 写成裸 `oneOf` 根或空 `{}` 的工具会被注册、流到线路、并在发起任何模型调用前以 HTTP 400 失败整个请求。`runtime_inspect` 是第一个撞上这个问题的（[单个工具修复](2026-08-24-runtime-inspect-flat-parameter-schema.zh.md)）；让它漏进来的框架级缺口仍然敞开。

## Decision

`packages/core/tools/src/index.ts` 的 `ToolRuntime.register()` 现有 output-schema 断言之后调用 `assertObjectJsonSchema(definition.parameters)`，抛出 `` tool "${name}" parameters must be an object-rooted JSON Schema (model-facing function calling requires type: "object"): <violations> ``。`assertObjectJsonSchema()` 此前为 subagent 与 workflow 的 structured output 强制的同一 object 根约束，现在覆盖注册入口。`packages/llm/llm/src/types.ts` 的 `ToolSchema.parameters` 记录了契约：根 MUST 为 `type: "object"`，adapter 原样透传，`defineTool` 编译成 object 根，`register()` 在裸路径上断言该约束。

## Alternatives considered

**在 adapter 线路层把非 object 根转换成 object 根。** 已否决：这会让每个 adapter 为单个工具引入投影，掩盖而非在注册时拒绝畸形契约，且分支重叠的 `oneOf` 根没有忠实的机械 object 根投影。缺陷属于注册边界——model-facing seam 内一层。

**仅在类型层面把 `ToolSchema.parameters` 收紧为 `ObjectJsonSchema`。** 已否决：类型约束不保护运行时构造的定义（MCP `inputSchema`、structured-output schema、sandbox `harness.defineTool` 产物），而线路失败是运行时行为。运行时断言才是承重门；类型变更只是记录它。

**只在 schema 投影（`schemas()`）处加门，不在注册处加。** 已否决：投影是读取期，可能被 assembly override 跳过；注册是单一提交点，坏定义在此要么接受要么拒绝，且 registry 的 HMR 回滚语义已经驻留于此。

## Consequences

- 裸注册带非 object 根 `parameters`（裸 `oneOf`、空 `{}`、或任何缺 `type: "object"` 的根）会在注册时被拒绝，先于它到达线路，而不是日后让整个 provider 请求失败。
- 每个已发布工具都经 `defineTool` 或 `sandboxDefineTool`（后者调用 `defineTool`）注册，故均编译成 object 根；structured-output 工具（`packages/subagent/subagent-in-process-driver/src/structured.ts`）注册的是调用方定义的 `ObjectJsonSchema`；MCP 工具原样注册 server 的 `inputSchema`，MCP spec 本就要求其为 object schema，gate 现在会在 server 违规时拒绝它，而非让它以线路 400 浮现。
- tools 类型系统在 TS 层面仍允许裸 `oneOf` 参数根；运行时 gate 即契约。未来若有裸工具需要非 object 参数根，必须围绕 object 根重构，正如 `runtime_inspect` 所做。

## Testing

`packages/core/tools/tests/register-gate.spec.ts` 从 `../src/index.ts`（源平面，非 built `lib/`）import `ToolRuntime`，断言 gate 拒绝裸 `oneOf` 根、拒绝空 `parameters: {}`、接受显式 object 根、并接受 `defineTool` 产物不变；4 个测试通过。`tsc --noEmit` 对 `packages/core/tools` 与 `packages/llm/llm` 类型检查无错误。
