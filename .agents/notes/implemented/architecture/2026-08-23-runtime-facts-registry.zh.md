# Agent Note: 有主运行时事实与同步基线投影

Status: implemented

[English](2026-08-23-runtime-facts-registry.md) | 中文

## 问题

宿主平台、进程位置、代理配置和已绑定 Web URL 等运行时属性原本藏在彼此无关的进程 API、环境变量或具体提供方后面。模型可以看到工具 schema 与选定策略上下文，却没有一套小而权威的词汇来表达这些事实。消费方若自行回答运行时问题，就会重复 probe、推断提供方标识，或暴露原始环境值。

同一种投影机制也不能安全地把所有观测视为相同。进程常量可以只采样一次；热加载的 Service Provider 必须重新读取；凭据与网络检查可能异步；PID、代理或 URL 细节不应进入每个请求。在 system-prompt 组装期间等待所有 probe 会给普通轮次增加延迟与失败耦合。

## 决策

### 一个有主标量注册表

`@deepseek-ai/dsh-runtime-facts` 注册 `ctx.runtimeFacts`。每个点分隔小写 kebab-case 键只有一个活动 owner，重复注册会快速失败。owner 提供描述、无 secret 的标量 resolver，以及三个相互独立的声明：`evaluation`（`sync` 或 `async`）、`freshness`（`static` 或 `dynamic`）与 `exposure`（`baseline` 或 `inspect`）。注册及缓存观测遵循 owner 的 Cordis effect 生命周期。

`list()` 返回不含 resolver 的元数据。`inspect()` 针对每个请求键报告 `ok`、`unknown`、`unavailable` 或 `probe-failure`，并独立收敛每个 resolver 失败。static 观测会在注册生命周期内复用；dynamic 观测会重新执行。同步失败会被记录并视为 unavailable。异步 reject 或 cancel 会被记录并作为清理后的 probe failure 返回，而不会使整个检查 reject。

### 自动上下文保持同步且受作用域约束

注册表贡献一个 order-120 的 `systemPrompt.context` 项。其同步 `render()` 只选择 `evaluation: sync` 加 `exposure: baseline` 的事实，按 code-unit 键顺序排序可用行，并在无适用值时发出空字符串。提示词组装绝不会启动异步 probe。

事实可通过 `relevance` 声明必要工具名称。注册表而非各提供方会针对当前作用域，在权威 `ctx.tools` 注册表上求值这些名称。缺少作用域或必要工具不可见会抑制该行。结果文本进入 agent loop 现有的带来源运行时上下文替换路径，因此值发生变化时可记录、可回放，而无需添加新的 Session 事件类型。

Web host 组合挂载注册表与 Host provider，agent preset 决定模型是否可以调用 `runtime_inspect`。`standard` 与 `code` preset 在各自作用域中挂载该工具；该工具不贡献单独的 system-prompt section。`minimal` 省略它并抑制 runtime context，从而保持固定的双工具组合。

### 宿主提供方委托变化事实

`@deepseek-ai/dsh-runtime-facts-host` 拥有初始 Host 清单。`runtime.execution-world` 是其唯一 baseline 事实，并动态委托给 `ctx.subprocess.executionWorld`；本地提供方报告 `local`，E2B 报告 `remote`，因此消费方不从平台或 class 标识推断位置。这是对[可移植执行环境决策](2026-07-28-portable-execution-world-consumers.zh.md)的扩展，而不是替代。

`host.os`、`host.arch`、`host.pid`、五个清理后的 `host.proxy.*` 标量及 `web.server-url` 仅供 inspect。代理元数据来自一个启动环境快照，并丢弃凭据、原始 URL、路径、查询与片段。Web URL 委托给当前 `ctx.webServer` 绑定，执行环境委托给当前 subprocess 服务；两者都是 dynamic，因为这些服务可以热加载。可选服务缺失时，其事实为 unavailable，而不会进行猜测。

## 验证

聚焦注册表测试固定了键与声明校验、重复所有权、effect dispose 与重载、全部三个声明维度、确定性渲染、集中 relevance、static 缓存、dynamic 重新求值、四种检查状态、异步取消及失败收敛。宿主提供方测试固定了确切清单、local 到 remote 委托、可选服务缺失、启动快照代理优先级与清理，以及带 secret URL 的移除。本地与 E2B subprocess 测试分别固定其 `executionWorld` 值；包 invariant 会把已注册所有权与实际组装的 baseline 文本进行比较。

## 考虑过的替代方案

**直接暴露选定环境变量。** 拒绝，因为环境变量名不是领域权威，代理值可能包含凭据，而且原始字符串没有所有权、新鲜度或暴露策略。

**把所有 Host probe 放进一个注册表实现。** 拒绝，因为 subprocess 与 Web 服务拥有自身可热加载状态。集中 probe 会跨包边界推断，并在提供方替换后保留陈旧值。

**每次提示词组装都等待异步事实。** 拒绝，因为凭据或网络 probe 会增加请求延迟，并让普通模型调用依赖可选诊断。异步工作保持为显式检查。

**用一种事实类别编码时序与可见性。** 拒绝，因为 resolver 时序、缓存生命周期与模型暴露方式相互独立。组合 enum 要么允许无效歧义，要么膨胀为无关状态的乘积。

**把进程事实注册为一个对象。** 拒绝，因为标量键允许独立暴露与 unavailable 状态、确定性渲染和字段级清理，而无需嵌套值协议。

**自动投影宿主平台与 shell 语言。** 拒绝，因为作用域内的 shell 工具已经表明命令语言，架构极少改变普通决策，而在每份保留的运行时快照中重复这些细节会增加上下文，却不能证明命令可用。OS 与架构仍可检查；命令解析仍归 `runtime_inspect`。

## 后果

运行时上下文获得一份小型、确定性、可回放的基线，不增加异步请求延迟。检查消费方可以共享相同的所有权与失败词汇，无需重复 probe。提供方承担显式声明与清理义务，可热加载事实必须标为 dynamic。static 结果没有 TTL，inspect-only 事实只有在挂载单独授权的消费方后才有面向模型的路径；注册表有意不成为通用配置、健康检查或环境发现服务。
