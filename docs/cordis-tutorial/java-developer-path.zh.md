# Java 开发者路径

[English](java-developer-path.md) | 中文

本文面向熟悉依赖注入、接口、回调和常规应用生命周期管理，但尚未使用过 DeepSeek Harness 的 Java 开发者。它先建立运行时模型；随后你可以在临时目录中动手实践同一组概念。

本文不是可运行的章节。如果你想用最短路径掌握项目词汇，请先阅读本文，再继续[你的第一个插件](01-first-plugin.md)。

## 读完后你应理解什么

读完本文后，你应能跟踪一个请求在 harness 中的完整路径，定位每一部分由哪个服务或包负责，并为新能力选择正确的扩展点。

主要请求路径是：

```text
dsh entry
  -> Profile
  -> Bundle and Patch layers
  -> Agent
  -> Turn
  -> Step
  -> Prompt and Tool schemas
  -> LLM
  -> Tool execution
  -> SessionEvent log
  -> next Step or Turn end
```

[架构参考](../architecture.md)负责完整的组合关系和事件地图；本文只规定阅读顺序。

## Java 到 Harness 的映射

以下只是有用的第一层近似，不是替代定义。

| Harness 概念 | Java 开发者的第一层近似 | 重要差异 |
| --- | --- | --- |
| Cordis Context | Spring `ApplicationContext` | 它还负责类型化事件、作用域和可撤销的插件 effect。 |
| Plugin | Spring 配置模块加生命周期钩子 | 模型适配器、Session 日志和 Agent loop 也都是插件。 |
| `ctx.foo` 服务 | 注入的服务 | 服务具有明确的 Definition、Provider 和 Consumer 关系。 |
| `ctx.effect()` / `ctx.on()` | 资源注册和事件订阅 | 注册和监听会随所属插件一起撤销。 |
| Agent | 驱动工作的运行时对象 | 它拥有 inbox、Session 和 Agent 作用域上下文。 |
| Session | 事件溯源流 | 它不是 JPA 实体；模型历史由追加式事件投影得到。 |
| Turn | 一次被接纳的对话循环 | 一个 Turn 可以包含多个 Step。 |
| Step | 一次模型请求及其工具调用 | 工具执行和产生的持久化记录属于这个 Step。 |
| Tool | 模型可调用的函数端点 | 它还包括 schema、策略流水线、执行、呈现和结果记录。 |
| Scope | Agent 本地的子上下文 | 它控制作用域贡献的可见性和生命周期，不是任意嵌套的 DI。 |
| Profile / Bundle / Patch | 部署组合 | 它们选择和覆盖插件行，而不是表示业务实体。 |
| MCP | 外部工具适配器 | MCP 客户端发现外部工具，并把它们注册到 `ctx.tools`。 |
| Skill | 可加载的指令包 | Skill 提供指令和资源提示，不是 Tool。 |

准确的定义请使用[子系统索引](../subsystems/README.md)以及负责该能力的包 README。

## 按这个顺序阅读

1. 阅读[架构](../architecture.md)中的 Cordis、Profile 与 Bundle、核心包、事件、Turn 流程和 Session 日志。
2. 阅读[核心](../subsystems/core.md)，理解 Agent 的所有权、inbox 投递、取消，以及 Agent 与 Session 的关系。
3. 阅读[Session](../subsystems/session.md)和[Session 持久化](../subsystems/persistence.md)，理解为什么事件日志是权威来源，以及 JSONL 和 SQLite 如何让它持久化。
4. 阅读[工具](../subsystems/tools.md)和[工具执行流水线](../tool-execution-pipeline.md)，把模型 schema、策略检查、执行和结果串起来。
5. 阅读[技能](../subsystems/skills.md)、[Skill 工具 README](../../packages/skill/tool-skill/README.md)和[MCP 客户端 README](../../packages/mcp/mcp-client/README.md)，区分指令和外部工具。
6. 完成[你的第一个插件](01-first-plugin.md)和[进入 harness](07-into-the-harness.md)，再把你的小型组合与[headless-agent](../../examples/headless-agent/composition.md)对照。

不要一开始就阅读完整模块图或事件生产者／消费者表。熟悉请求路径之后，再回到[文档图谱索引](../graph-atlas.md)。

## 阅读代码时使用这个模板

对每个陌生的包回答以下五个问题：

- 这个包为 Consumer 解决什么问题？
- 它负责哪个 service、provider、consumer、event 或 tool？
- `src/` 或包 README 中最小的真实入口是什么？
- 哪些内容是持久化的，哪些只在运行时存在，哪些是派生的？
- 哪个聚焦测试或真实运行时组合验证了这项行为？

包 README 是 Consumer 契约；子系统页面负责共享类型以及服务或事件语义；架构页说明这个包如何参与运行时；生成目录负责完整清单，不要手工重建这些清单。

## 保持这些区分

| 不要合并理解 | 应该理解为 |
| --- | --- |
| Session 和实体 | Session 是追加式事实来源；投影提供读取模型。 |
| Tool 和 Skill | Tool 执行操作；Skill 提供完成工作的指令。 |
| MCP 和存储 | MCP 可以连接拥有自己数据的服务，但 DSH 只负责桥接其工具。 |
| Agent 实时事件和 Session 事件 | Agent 事件观察进行中的工作；Session 事件可在重新加载和回放时保留。 |
| Cache 和权威来源 | 投影缓存加速 fold；Session 日志仍然是权威来源。 |

[Session 持久化](../subsystems/persistence.md)和[投影缓存 README](../../packages/session/session-projection-cache/README.md)详细说明了这些持久化规则。

## 继续实现功能

要新增模型可见能力，请从[构建 Tool](../user/develop/basic/tool.md)开始。要新增可替换的平台能力，请阅读[能力分层](../user/develop/practice/index.md)。要了解全部可用服务和事件，请使用[子系统页面](../subsystems/README.md)，不要继续扩展本文的导览内容。

如果一个设计选择没有当前代码、测试或包契约的依据，请把它记录为 proposal 或 Agent Note，不要把它写成当前架构事实。
