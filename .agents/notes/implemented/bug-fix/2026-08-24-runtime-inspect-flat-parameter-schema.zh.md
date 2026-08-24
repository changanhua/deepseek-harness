# Agent Note: runtime_inspect 使用扁平的 object 根参数 schema

Status: implemented

[English](2026-08-24-runtime-inspect-flat-parameter-schema.md) | 中文

## Problem

`runtime_inspect` 工具把参数声明为顶层 `oneOf` tagged union（`{ kind: "facts" }` / `{ kind: "command", command }`），没有根 `type: "object"`。DSH 把工具参数 schema 原样透传给 provider（`packages/llm/llm-pi-ai/src/context.ts` 的 `toolsOf`、`packages/llm/llm-deepseek/src/serialize.ts` 的序列化器）。严格的 OpenAI 兼容网关会拒绝 `parameters` 不是 `type: "object"` JSON Schema 的函数——`Invalid schema for function 'runtime_inspect': schema must be a JSON Schema of 'type: "object"', got 'type: null'`——于是该 provider 下的每次请求都在发起任何模型调用前以 HTTP 400 失败。这是仓库中唯一一个参数根为裸 `oneOf` 的工具：其他所有顶层 `oneOf` 要么位于 output schema（`tool-goal`、`tool-terminal`、`tool-subagent`、`tool-skill`），要么位于具名参数之下（`tool-cordis`）。

## Decision

`packages/extensions/tool-runtime-inspect/src/index.ts` 中的 `RUNTIME_INSPECT_PARAMETERS` 现在采用扁平 `type: "object"` 根，带 `additionalProperties: false`、`required: ["kind"]`，`kind` 为 `facts` / `command` 的字符串 `enum`，`keys` 与 `command` 为可选属性。由于扁平 schema 无法表达 tagged union 的约束（`command` 变体必须有 `command`，`facts` 变体禁止带 `command`），`validateInspectVariant` 在执行时强制这些组合，其违规项与 `validateJsonSchemaValue` 的结果合并后再抛出 `ToolArgsError`。模型可见契约不变：请求以 `kind` 判别，`facts` 接受可选 `keys`，`command` 需要一个 `command` 字符串。

## Alternatives considered

**保留顶层 `oneOf` tagged union。** 已否决：这正是缺陷本身。严格校验函数 schema 的网关会持续拒绝该工具。

**改成同时携带 `oneOf` 的顶层 object。** 已否决：JSON Schema 不允许在同一个节点上同时声明 `type` 与 `oneOf`，DSH 自己的 schema 校验器也拒绝该组合（`schema cannot declare both type and oneOf`）。

**在 adapter 线路上把顶层 `oneOf` 转换为 object 根。** 已否决：这会让每个 adapter 为一个工具引入转换，掩盖而非修复畸形契约，而且 `oneOf` 分支相互重叠，任何机械的 object 根投影都无法忠实还原。

## Consequences

- `runtime_inspect` 的参数 schema 能被要求 object 根的网关接受，严格 provider 不再在发起模型调用前让整个请求失败。
- 跨变体检查移入执行：模型发出 `{ kind: "facts", command: "..." }` 或 `{ kind: "command" }` 时，工具仍返回 `INVALID_ARGS`，而不是上游 400。
- tools 类型系统仍允许裸 `oneOf` 参数根；目前只有 `runtime_inspect` 用过它，未来若再有原始工具使用，将遇到同样的严格网关拒绝。后续的 [register object-root gate](2026-08-24-register-object-root-parameters-gate.zh.md) 关闭了该框架缺口。

## Testing

`packages/extensions/tool-runtime-inspect/tests/runtime-inspect.spec.ts` 断言扁平的 object 根 schema（`type: "object"`、`kind` enum、无 `oneOf`），并断言跨变体与缺参（`{ kind: "facts", command: "codex" }`、`{ kind: "command" }`）会被拒绝。该包 8 个测试全部通过，`tsc -b` 对该包类型检查通过。
