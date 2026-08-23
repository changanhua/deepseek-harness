# `@deepseek-ai/dsh-tool-runtime-inspect`

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

本包注册一个稳定的 `runtime_inspect` tool schema，以及一段稳定 prompt，要求模型在有权威 runtime fact 时优先查询而不是推断。动态宿主值不会进入稳定 section；baseline 继续由 `@deepseek-ai/dsh-runtime-facts` 自动投影，长尾事实只在工具调用后出现。

#### KV Cache 影响

工具 schema 与 prompt guidance 在插件生命周期内稳定，所以 runtime value 变化本身不会使稳定请求前缀失效。`runtime_inspect` 结果属于普通 turn 内容，只影响该次调用之后的对话。

## 已知限制与暂缓事项

- V1 只支持已注册 facts 与 executable resolution；它不是 Doctor、provider readiness 框架、网络扫描器或通用进程检查器。
- V1 不为每个 command 预注册 fact，也不暴露原始环境变量、proxy URL、credential value 或 subprocess provider 原始异常文本。
- 更丰富的 execution-world 描述与自动网络可达性 probe 仍按 Runtime Awareness 设计推迟。
