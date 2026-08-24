# `@deepseek-ai/dsh-tool-command-profile`

[English](README.md) | 中文

`command_profile` 是 DSH 命令知识平面的模型侧消费方。查询委托给 `ctx.commandProfiles.query()`，返回带完整 provenance 的候选可执行程序名。该工具绝不断言安装或可用性，保持"候选 ≠ 存在"。

## 工具契约

工具接受一组 object-root 参数：

```json
{ "query": "github", "limit": 3 }
```

`query` 必填，对 profile id、别名、展示名、标签与描述做词法匹配；`limit` 为 1..10 的可选整数（默认 5）。查询失败返回空 `matches` 数组而非错误，模型可以用不同查询重试。

## 候选 ≠ 存在

profile 只给出候选名，不证明候选可解析、已安装、已认证或属于某个版本。本包 prompt 段指示模型在未由当前执行确立该事实时，用 `runtime_inspect kind=command` 确认候选；返回 DTO 刻意不暴露任何可用性字段。

## Model Experience

### System prompt

#### What the model sees

本包贡献一段稳定的指导文本，钉死"候选 ≠ 存在"。

##### Command-profile 指导

```markdown
A command profile supplies candidate executable names only. It does not prove installation or runtime availability. Before concluding that a candidate command is available or unavailable, use authoritative runtime command inspection (runtime_inspect kind=command) unless current execution already established that fact.
```

#### Token effect

插件加载期间每次请求的固定指导成本；profile 内容绝不进入这段稳定文本。

#### KV Cache effect

插件与指导文本不变时前缀稳定。

### command_profile 工具

#### What the model sees

一个接受 `{ query, limit? }` 的 `command_profile` 工具。工具定义不枚举任何 profile 内容。

#### Token effect

插件可见期间每次请求的固定工具定义成本。

#### KV Cache effect

工具定义与作用域可见性不变时前缀稳定。

### 查询结果

#### What the model sees

结果列出匹配的 profile，含 `id`、`displayName`、`description` 与 `candidates`——每条候选携带 `command` 及其 `provenance`（`source`/`contributorId`）。不出现任何可用性字段。

#### Token effect

取决于数据：由 `limit` 与命中 profile 数界定。保留的结果在压缩前一直留在会话历史里。

#### KV Cache effect

仅追加；新返回的 profile 内容跟在可复用请求前缀之后，不使既有 KV-cache 条目失效。

## 已知限制与待办

- **候选不是配方** — 启动形式（`npx foo`、`python -m foo`）超出范围，由注册表拒绝。
- **无推荐排序** — 匹配是词法且确定的；尝试哪个候选由模型决定。
