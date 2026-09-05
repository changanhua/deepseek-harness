# `@changanhua/dsh-tool-runtime-inspect`

[English](README.md) | 中文

`runtime_inspect` 是 DSH 权威运行时状态的模型侧 Consumer。它自己不发现宿主事实：fact 查询委托给 `ctx.runtimeFacts`，命令解析委托给 `ctx.subprocess.resolveExecutable()`，并报告同一个 subprocess provider 的 `executionWorld`。

## Tool 约定

工具有两个带 tag 的请求变体：

```json
{ "kind": "facts", "keys": ["host.os", "web-search.exa.credential-configured"] }
```

省略 `keys` 时检查当前已注册的全部 runtime fact。返回对象保留 registry 的每一种观测状态（`ok`、`unknown`、`unavailable`、`probe-failure`），并等待 async inspect-only fact；调用方取消信号会继续传给 registry。

```json
{ "kind": "command", "command": "codex" }
```

命令检查只调用 `ctx.subprocess.resolveExecutable(command, undefined, signal)`。成功返回 `{ "resolved": "...", "world": "local|remote" }`；失败返回稳定的 `{ "status": "unavailable", "reason": "..." }`，不会把 provider 的任意原始诊断透给模型。取消仍按取消处理，不会伪装成 availability 结果。

Schema 禁止混入另一个变体的字段和任意额外字段。command 变体有意不提供 `env` 参数：该工具不能变成注入或回显带凭据环境变量的通道。

## Ownership 与安全

- Runtime fact 值只来自已注册 fact owner；本包不重复探测、不覆盖 owner。
- executable 解析只来自当前 subprocess provider；本包不独立读取 `PATH`、检查文件系统或调用 shell。
- `world` 只来自 `ctx.subprocess.executionWorld`。
- 不查询 credential value；provider credential fact 只暴露 `credential-configured` 这类安全派生状态。
- command-resolution 异常不原样返回，因为 provider 诊断可能带部署细节。

## Model Experience

### `runtime_inspect` tool

#### What the model sees

本包不贡献单独的 system-prompt section；使用说明保留在工具描述中。模型看到一个 `runtime_inspect` 工具，请求由 `kind: "facts" | "command"` 判别：`facts` 接受可选 `keys`，`command` 必须提供一个 `command` 字符串，且不暴露 `env` 字段。

#### Token effect

插件可见期间，tool definition 的每次请求成本固定；definition 不枚举 fact key 或解析后的 command path。

#### KV Cache effect

tool definition 与 scope visibility 不变时前缀稳定；插件生命周期变化或 scoped tool restriction 可能改变 tool projection。

### Inspection results

#### What the model sees

facts 调用按 key 返回结构化观测（`ok`、`unknown`、`unavailable`、`probe-failure`）；command 成功时返回 `{ "resolved": "...", "world": "local|remote" }`，无法解析时返回稳定且不含 secret 的 `unavailable` 结果。provider 原始异常文本与 credential value 不会呈现给模型。

#### Token effect

结果成本随数据变化：facts 调用随请求或已注册 key 集合增长，command 调用只返回一个有界记录。保留的调用与结果会留在对话历史中，直到 compaction。

#### KV Cache effect

Append-only；新返回的 inspection 内容追加在可复用请求前缀之后，不会使已有 KV-cache entry 失效。

## 已知限制与暂缓事项

- V1 只支持已注册 facts 与 executable resolution；它不是 Doctor、provider readiness 框架、网络扫描器或通用进程检查器。
- V1 不为每个 command 预注册 fact，也不暴露原始环境变量、proxy URL、credential value 或 subprocess provider 原始异常文本。
- 更丰富的 execution-world 描述与自动网络可达性 probe 仍按 Runtime Awareness 设计推迟。
