# @deepseek-ai/dsh-runtime-facts

[English](README.md) | 中文

用于记录当前 Harness 运行时无 secret 标量事实的有主注册表。提供方各自注册一个事实键；消费方可以列出声明、检查选定值，或把同步基线渲染到动态运行时上下文。注册表自身不发现能力，也不探测宿主。决策记录：[runtime-facts Agent Note](../../../.agents/notes/implemented/architecture/2026-08-23-runtime-facts-registry.zh.md)。

## 配置

```yaml
- id: runtime-facts
  name: '@deepseek-ai/dsh-runtime-facts'
  config:
    includeInRuntimeContext: true
```

`includeInRuntimeContext` 默认为 `true`。设为 `false` 会关闭本包的自动基线贡献，但不关闭注册、列举或检查。

## 注册与所有权

`ctx.runtimeFacts.registerFact(declaration)` 校验完整声明，为一个 owner 保留其点分隔小写 kebab-case 键，并返回确切的 effect disposer。重复所有权会在注册时失败。dispose 会移除声明及其缓存观测。

每条声明有三个相互独立的维度：

| 维度 | 取值 | 含义 |
|---|---|---|
| `evaluation` | `sync`、`async` | 要求哪种 resolver 形式；异步事实在求值时仅限检查。 |
| `freshness` | `static`、`dynamic` | static 事实会在注册生命周期内观测一次；dynamic 事实每次观测都重新求值。 |
| `exposure` | `baseline`、`inspect` | baseline 事实可进入自动上下文；inspect 事实需要显式消费方。 |

值只能是有限数值、布尔值或单行字符串。提供方承担更强的义务：值与诊断都不得包含 secret。同步 resolver 失败会被记录并视为 unavailable。异步 reject 或 abort 会被收敛为 `probe-failure`；一个事实失败不会使其他键的检查 reject。

## 基线投影

注册表贡献 `systemPrompt.context({ name: 'runtime-facts', order: 120, ... })`。每次组装只求值同步 baseline 事实，按 JavaScript code-unit 键顺序排序，省略 unavailable 值，并在无适用事实时返回空字符串。提示词组装绝不会启动异步 resolver。

声明可通过 `relevance.tools` 要求可见工具名称。注册表针对组装作用域在 `ctx.tools` 上集中求值这些名称。缺少作用域、缺少工具服务，或任一必要工具不可见时，会抑制该事实而不改变其值。

## 检查

`list()` 按键顺序返回不含 resolver 的元数据。`inspect(keys, context?)` 为每个请求键返回一种结果：`ok`、`unknown`、`unavailable` 或 `probe-failure`。static 异步观测共享首个进行中的 probe 并缓存其结果；dynamic 观测会重新执行。注册表本身不提供面向模型的工具；消费方决定如何授权和呈现检查。

生成的 [`ctx.runtimeFacts` 服务目录](../../../docs/subsystems/runtime-facts.zh.md#ctxruntimefacts--runtimefacts)负责方法签名。

## 模型体验

### 同步基线快照

#### 模型看到的内容

至少一个同步 baseline 事实可用且相关时，本包会在 system-prompt 服务带来源的运行时上下文快照中贡献以下片段。`<key>` 行经过排序，缺失值会省略。

##### Runtime-facts 片段

```markdown
Host runtime facts:
- <key>: <scalar-value>
```

#### Token 影响

有条件产生。当前片段在有效期间保持模型可见；内容相同的组装不会新增替换快照。求值同步完成，不增加 probe 延迟。

#### KV Cache 影响

渲染行不变时前缀稳定。行发生变化会让运行时上下文投影替换其活动快照，并可能从首个变化的上下文 token 起使复用失效。

## 已知限制与暂缓事项

- **标量声明不能证明保密性**：注册表会拒绝非标量和多行结果，但每个提供方仍必须在注册前清理标识符和诊断。
- **不自动投影异步事实**：网络、凭据及其他异步 probe 需要显式检查，绝不延迟提示词组装。
- **没有过期策略**：static 观测持续到其注册被 dispose；提供方必须把可热加载服务状态声明为 dynamic。
- **没有内置模型工具**：本包只提供服务和基线投影；检查需要单独授权的消费方。
