# DeepSeek Harness 研究：当前状态 Source of Truth

> 文档性质：固定版本研究基线，不是滚动追踪的最新官方说明  
> 研究对象：`deepseek-ai/deepseek-harness`  
> 固定提交：`47f943859bef60e4160492346772ded9b24f765a`  
> 对应版本：`dsh 0.1.0-rc.5`  
> 提交日期：2026-08-13  
> 文档整理日期：2026-08-14

## 0. 阅读规则与证据边界

本文是对上述固定提交的独立研究记录。后续上游代码、文档、Session 格式或产品行为发生变化时，不应直接用本文代表新版本。

本文使用三类标签：

- **事实**：已在固定提交的官方源码、架构文档或测试中找到直接依据。
- **推断**：由源码调用顺序、数据结构或系统行为推导，尚未通过真实故障注入完全验证。
- **判断**：研究者对定位、成熟度或工程取舍的综合评价。

置信度含义：

- **高（0.85–1.00）**：源码、文档、测试之间有多处相互印证，或矛盾点已被明确定位。
- **中（0.65–0.84）**：有清晰源码依据，但缺真实运行、崩溃注入或长时间验证。
- **低（<0.65）**：仅确认能力入口存在，尚不足以确定完整语义或稳定性。

本轮证据边界：结论来自固定提交上的官方源码、架构文档和测试代码交叉取证；未独立完成整套应用的本地启动、真实 Web UI 验收、长时间运行和破坏性恢复实验。官方公开检查未检索到失败结论，但这不等于本研究独立复现通过。

---

## 1. 执行摘要

### 核心结论

**判断｜高置信度（0.90）**

DeepSeek Harness 不是“带 Web UI 的 Coding Agent”，而是一套本地优先、插件化、可恢复的 Agent Runtime。它最有价值的部分不是某个具体工具，而是以下机制组合：

1. 以 append-only `SessionEvent` 为事实主干；
2. 将 `Agent` 作为进程内活动 driver，而非主要耐久对象；
3. 原生接纳同一步零到多个工具调用，并区分并行与独占调度；
4. 在模型请求和工具副作用前建立语义 durability checkpoint；
5. 从日志重建模型请求、恢复状态和 UI 投影；
6. 保留原始事实，仅压缩模型可见 surface；
7. 通过 Cordis、Profile、Bundle、Preset 和 scope 组合能力。

最简架构图如下：

```text
Cordis 可逆插件运行时
        ↓
Host Plane：Persistence / Model / Sandbox / Approval / Registries
        ↓
Agent Preset：Prompt / Tools / Skills / Goal / Workflow
        ↓
Live Agent Driver：idle / running
        ↓
Append-only SessionEvent Log
        ↓
Model Context / Recovery / Projection / UI / Telemetry
```

**判断｜高置信度（0.88）**

更准确的定位是：

> DeepSeek Harness 是一个以 Session Event Log 为事实内核、以 Cordis 为动态组合运行时的 Agent 微内核。

它当前更适合单机、单进程或受控进程内的可组合 Agent；不是以多机、多 worker、强隔离、多租户和跨进程耐久调度为首要目标的分布式 Agent 平台。

---

## 2. 固定研究版本

| 项目 | 固定值 | 性质 | 置信度 |
|---|---|---|---:|
| 官方仓库 | `deepseek-ai/deepseek-harness` | 事实 | 1.00 |
| Commit | `47f943859bef60e4160492346772ded9b24f765a` | 事实 | 1.00 |
| 版本 | `dsh 0.1.0-rc.5` | 事实 | 1.00 |
| 提交日期 | 2026-08-13 | 事实 | 1.00 |
| 发布阶段 | developer preview | 事实 | 0.98 |
| 兼容承诺 | 官方明确警告可能发生破坏性变化 | 事实 | 0.98 |

因此，本文中的“当前”只表示该固定提交的当前状态。

---

## 3. 项目定位

### 3.1 产品表面

**事实｜高置信度（0.92）**

项目提供或建模了以下能力：

- Web UI、Headless、ACP、JSON-RPC 等交互入口；
- 多 Provider / 多模型接入；
- 文件、Shell、终端、Web、LSP、Skill 等工具；
- Subagent、Workflow、Goal、Plan、Todo；
- Approval、Tool Restriction、Guard 和 Sandbox；
- Session 恢复、分叉、Compaction；
- Profile、Bundle、Patch、Agent Preset；
- 动态插件、运行时能力注册和 UI Projection。

### 3.2 架构本质

**判断｜高置信度（0.90）**

“Everything is a plugin”准确描述了业务能力的可替换性，但不代表系统没有核心。不可绕开的元协议包括：

- Cordis `Context`；
- 插件依赖解析和激活规则；
- effect 注册、反向清理与 quiescence；
- waterfall 事件语义；
- scope、realm 和生命周期；
- `SessionEvent` envelope 与顺序；
- Profile、Bundle、Patch 的装载与协调；
- Agent 与 Session 的身份和生命周期关系。

因此，更准确的说法是：它没有固定的特权业务核心，但存在一个抽象程度更高、语义更重的元运行时核心。

---

## 4. Cordis

### 4.1 作用

**事实｜高置信度（0.90）**

Cordis 不只是依赖注入容器。它主要提供：

- **时间可组合性**：插件注册的运行时 effect 在卸载时可以反向撤销；
- **空间可组合性**：组件声明依赖，依赖出现时激活，消失时停止或重组；
- 共享 `Context`、scope 与 realm；
- waterfall 事件和可组合中间件；
- disposer、异步 cleanup 和卸载等待；
- 配置协调、热重载与运行时重组基础。

DeepSeek Harness 将 Cordis vendored 到仓库中，并对重入卸载、配置事务、HMR、异步清理等做了本地处理。

### 4.2 工程含义

**判断｜高置信度（0.84）**

Cordis 使模型、工具、Session、Persistence、Agent Loop、UI 等能力能以插件形式组合，但也把复杂性集中到：

- listener 顺序；
- `next()` 与短路语义；
- scope 继承；
- effect ownership；
- disposer 正确性；
- 依赖动态出现/消失；
- 配置层叠和事务协调；
- 调试时的因果追踪。

“插件已卸载”最多直接证明注册贡献被撤销，不能自动证明文件、外部副作用、子进程、异步任务或 durable facts 已被回滚。

### 4.3 安全边界

**事实｜高置信度（0.92）**

Cordis scope 是组合、所有权和生命周期边界，不是恶意代码安全边界。same-process 插件拥有宿主级信任；动态插件 VM 的 timeout 不保证异步代码真正停止；Workflow worker thread 也不是安全隔离边界。

---

## 5. Agent / Session / Turn / Step

### 5.1 Agent

**事实｜高置信度（0.94）**

`Agent` 首先是进程内活动句柄，核心表面大致包括：

```text
id
session
inbox
status: idle | running
send / followup / steer / inject
cancel
whenIdle
```

它的主要作用是接收输入、驱动 loop、协调取消并把执行收敛回 `idle`。主要耐久事实不保存在 Agent 对象本身，而在 Session 日志中。

### 5.2 Session

**事实｜高置信度（0.95）**

Session 是执行和交互事实的主要耐久容器。模型历史、恢复、Compaction surface、Projection 和 UI 节点原则上都从 Session 事件派生，而不是由另一份长期可变的 `messages[]` 充当权威状态。

### 5.3 Turn 与 Step

**事实｜高置信度（0.94）**

- 一个 `turn` 是一轮 Agent 工作边界，可包含零个或多个 step。
- 一个 `step` 包含一次逻辑模型请求，以及该次模型响应产生的零到多个工具调用和相应结果。

典型主链：

```text
Input / Inbox
    ↓
turn/start
    ↓
agent/pre-step
    ↓
step/start
    ↓
Request reconstruction
    ↓
LLM stream
    ↓
assistant message + tool calls
    ↓
Tool policy / approval / scheduling / execution
    ↓
tool results
    ↓
下一 step 或 turn/end
```

---

## 6. Append-only SessionEvent

### 6.1 事实主干

**事实｜高置信度（0.96）**

Session 是 append-only typed event log。研究中确认的主要事件类型包括：

```text
turn/start
step/start
user/message
request/header
request/context
assistant/chunk*
assistant/message
tool/call*
approval/asked
approval/decided
tool/result*
llm/retry
llm/retry-started
step/end
turn/end
```

`Session.append()` 的重要行为：

- 验证输入可表达为 lossless JSON；
- 对数据做深度快照并冻结；
- 分配连续 `seq`；
- 事件一旦进入内存日志即成为权威事实；
- observer 失败被隔离，不能反向推翻已经 append 的事实。

### 6.2 核心不变量

**事实｜高置信度（0.94）**

> Model-visible means logged：模型能看到的内容，应能够从 Session Log 重建。

这意味着日志不仅用于保存聊天文本，也需要保存请求包络、动态上下文、工具 schema、工具调用与结果，以及影响后续模型行为的关键状态。

### 6.3 原始流与语义事件

**事实｜中高置信度（0.84）**

系统同时保留原始 assistant stream chunk 和完成后的语义消息。前者支持流式 UI、重放和调试，后者构成模型历史和恢复的稳定语义表面。

---

## 7. 模型调用与多工具调度

### 7.1 多 Provider 与模型中立性

**事实｜高置信度（0.90）**

`dsh-llm-pi-ai` 是通用多 Provider adapter。研究确认它考虑了：

- Provider catalog；
- 不同 endpoint 和协议；
- OpenAI-compatible 网关及自定义 Provider；
- reasoning effort 和不同 reasoning wire format；
- context window、max tokens、image modality；
- Provider retry、replay state 和 model override。

默认 Persona 使用当前 `{{model}}`，而非将 Agent 身份锁定为某个固定模型。因此它更接近 model-neutral Agent Runtime 加第一方模型体验，而不是只允许单一厂商模型的 Harness。

### 7.2 同一步多个工具调用

**事实｜高置信度（0.97）**

一个 step 原生允许零到多个工具调用。调度不是简单 `Promise.all()`：

1. 每个调用按工具声明分类为 `parallel` 或 `exclusive`；
2. 相邻并行调用进入 rolling pool；
3. 独占调用在前后形成屏障；
4. 并发量受 `maxParallelToolCalls` 限制；
5. 执行期间工具注册发生变化时，尚未开始的调用会重新分类；
6. 已启动调用收到取消后仍需等待协作式收敛；
7. 尚未派发的调用会得到结构化“派发前取消”结果；
8. 即使后面的调用先完成，`tool/result` 仍按模型原始调用顺序写入 Session。

官方测试覆盖三工具并发、独占屏障、运行时工具替换、滚动补充并发槽，以及完成顺序不同但按模型调用顺序提交结果。

### 7.3 取舍

**判断｜高置信度（0.90）**

按模型调用顺序提交结果保证了历史确定性，但会产生 head-of-line blocking：前面的慢调用会阻止后面已完成结果先进入权威历史。这是明确的确定性取舍。

### 7.4 Tool Presentation

**事实｜中高置信度（0.82）**

工具可见方式至少包括：

- `native`：模型直接看到工具 schema；
- `code`：模型主要通过 `run_code` 和生成 SDK 使用能力；
- `both`：两者并存。

不同模型能否稳定驾驭完整能力面、哪种 presentation 最优，尚无本轮独立 benchmark 证据。

---

## 8. Durability checkpoint

### 8.1 内存提交与磁盘耐久分离

**事实｜高置信度（0.94）**

事件 append 到内存日志后即成为 Session 权威事实；磁盘 Persistence 是独立 seam，并采用异步批处理。系统不会在每个 append 后都同步写盘，而是在具有外部语义的边界执行显式 checkpoint / flush。

### 8.2 默认语义屏障

**事实｜高置信度（0.96）**

默认 checkpoint policy 在至少三类边界建立 durability barrier：

```text
模型请求前
确保完整请求前缀已耐久，再调用 Provider

顶层工具 body 前
确保 tool/call 已耐久，再允许产生外部副作用

下一 step 前
确保上一 step 的响应和工具结果已耐久
```

flush 失败时，后续模型调用或工具 body 不会执行，整体采取 fail-closed 立场。

### 8.3 核心模式

```text
Durable Intent
    ↓ checkpoint
External Dispatch
    ↓
Durable Outcome
```

**判断｜高置信度（0.95）**

这是该项目最重要的架构机制之一。它不提供通用 exactly-once，但显著缩小了崩溃后“系统不知道外部动作是否发生”的范围。

---

## 9. 崩溃恢复

### 9.1 两类关键恢复状态

**事实｜高置信度（0.96）**

恢复逻辑明确区分：

```text
assistant/message 中存在工具调用
但没有 durable tool/call
    → TOOL_NOT_STARTED

存在 durable tool/call
但没有 tool/result
    → TOOL_OUTCOME_UNKNOWN
```

对于 `TOOL_OUTCOME_UNKNOWN`，恢复提示要求：

- 只读或幂等工作才适合自动重试；
- 对可能产生副作用的操作，应先检查外部现实；
- 无法确认时询问用户；
- 不能假定成功，也不能假定失败。

### 9.2 Exactly-once 边界

**事实｜高置信度（0.92）**

项目没有宣称对通用外部工具提供 exactly-once。可靠工具仍应使用 `callId` 作为幂等键，或实现业务级检查、补偿和人工确认。

### 9.3 未完成 turn 与错误收敛

**事实｜中高置信度（0.82）**

Agent driver 在成功、异常或取消路径的 `finally` 中回到 `idle`，减少 live UI 永久处于运行中的风险。但某些 turn 外错误可能只通过 live `agent/error: string` 传播，刷新后未必保留为完整的耐久失败投影。

### 9.4 尚待真实验证

**推断｜中置信度（0.70）**

源码恢复分类设计清晰，但以下情况仍需故障注入验证：

- 工具副作用完成、`tool/result` 尚未落盘时强杀进程；
- 批量 append 尾部部分写入或存储失败；
- 多工具调用部分完成、部分取消、部分 unknown 时的重放；
- Persistence provider 卸载或失败与 Agent 取消同时发生；
- 恢复后 UI 是否稳定区分 not-started、unknown、failed 和 cancelled。

---

## 10. Persistence

### 10.1 Persistence 是可替换 seam

**事实｜高置信度（0.89）**

内存 Session 事实与磁盘持久化职责分离，Persistence provider 可以作为插件替换。Session append 不以同步磁盘写入作为每次事件提交的必要条件，耐久性通过显式 flush/checkpoint 获取。

### 10.2 单写者约束

**事实｜高置信度（0.92）**

当前 JSONL 后端要求同一 Session 只有一个 live writer。该约束适合本地优先、单进程 ownership 模型，不应被误解为已经具备多 worker 协调、lease、分布式并发写或高可用语义。

### 10.3 格式稳定性

**事实｜高置信度（0.94）**

当前 Session format 属于预发布格式，官方不承诺向后兼容，旧格式可能被拒绝加载。任何依赖其长期保存关键资产的系统都需要固定 commit、保留 raw export、记录版本，并在升级前运行迁移和恢复测试。

---

## 11. Context / Request reconstruction

### 11.1 请求不是临时拼接的 messages

**事实｜高置信度（0.94）**

模型请求由多类来源共同编译：

```text
Session log
+ request/header
+ system prompt sections
+ tool schemas
+ runtime context
+ inbox claimed inputs
+ injected context
+ workspace instructions
+ skills
+ goal / plan state
+ compaction projection
= Model Request
```

### 11.2 `request/header`

**事实｜高置信度（0.93）**

每次请求的稳定包络以完整快照形式记录，而不只是 hash。内容包括：

- Provider / Model / 调用配置；
- System Prompt；
- Tool Schemas；
- Adapter defaults。

这允许恢复和审计回答：当时实际发送了什么、何时切换模型或工具集合、历史前缀是否仍适合 KV cache 复用。

### 11.3 动态上下文

**事实｜高置信度（0.90）**

时间、权限状态、Goal、workspace instructions、Skill 等动态内容不必不断重写稳定 system prompt，而可以作为带来源的 durable `user/message` 追加到历史。

workspace instructions 的处理体现了这种模型：

- 初始指令链进入第一步；
- 进入更具体目录后追加更具体指令；
- 文件修改时追加 replacement notice；
- 文件删除时追加 tombstone；
- digest 用于避免重复注入；
- 旧指令被 Compaction 移出 surface 后，可按当前现实重新注入。

### 11.4 时序风险

**推断｜中置信度（0.74）**

`inject()`、`followup`、`steer` 和 pre-step claim 的相对时序可能决定内容进入当前请求还是下一请求。需要在 idle、pre-step 前后、stream 中、tool result 后和 Compaction 中分别做时序实验，才能确认全部边界行为。

---

## 12. Compaction

### 12.1 原始事实不被改写

**事实｜高置信度（0.95）**

Compaction 不删除或重写原始 Session Log，而是：

```text
保留原始事件
    ↓
生成 compaction summary
    ↓
在模型可见 surface 上替换一段旧节点
    ↓
deriveMessages() 投影替换后的 surface
```

### 12.2 已确认性质

**事实｜高置信度（0.92）**

- 原始事实仍可审计和重放；
- summary 记录自己覆盖的 seq 范围；
- 工具调用和结果不会被从中间截断；
- Compaction 失败不破坏原始历史；
- 能检测崩溃留下的孤立 compaction bracket；
- UI 可以保留原始视图，同时模型只接收压缩后的 surface。

### 12.3 评价

**判断｜高置信度（0.93）**

该设计正确地区分了“事实层”和“模型上下文表面”。摘要是对原始事实的可追溯投影替换，而不是历史事实的破坏性重写。

---

## 13. Tools visibility / authorization

### 13.1 模型可见性

**事实｜高置信度（0.91）**

`ToolRestriction` 用于过滤某个 Agent 从全局或父 scope 继承的工具：

```text
global / ancestor tools
        ↓ restrictions
visible tools
        ↓
tool schemas enter request
```

这回答的是“模型看见哪些候选能力”，不是“某次调用最终是否被授权执行”。

### 13.2 派发授权与执行管线

**事实｜高置信度（0.92）**

实际工具调用还要经过类似以下管线：

```text
tools/pre-execute waterfall
    ↓
approval
    ↓
monotonic guards
    ↓
tools/execute wrappers
    ↓
tool body
    ↓
tools/post-execute
    ↓
finalizeContent / authoritative result
```

工具还可以声明输出 schema、canonical value、模型内容渲染、UI presentation、timeout、cancellation 和并发安全类型。

### 13.3 Monotonic deny

**事实｜高置信度（0.91）**

monotonic guard 只能“无意见”或“拒绝”，不能返回 allow 去覆盖其他 guard 的拒绝。这降低了后注册 listener 重新放行已经拒绝请求的风险。

### 13.4 剩余风险

**判断｜中高置信度（0.82）**

扩展性仍大量依赖 waterfall listener 顺序、`next()`、prepend 和错误处理规则。最终行为可能成为插件排列的结果。需要继续验证：

- scoped tool 是否可能绕过 inherited restriction；
- Code Mode 和嵌套调用是否走完全相同的授权与审批管线；
- 审批后工具参数是否仍与被批准的快照一致；
- 运行中 policy 变化是否影响已接纳但未派发调用；
- policy 决策能否作为稳定耐久事实重建。

---

## 14. Approval

### 14.1 Fail-closed 结果模型

**事实｜高置信度（0.95）**

审批结果为闭合枚举：

```text
allowed-once
rejected
cancelled
unavailable
```

只有 `allowed-once` 可以放行。缺少 answerer、answerer 抛错或返回非法值都会变成 `unavailable`，因此审批默认 fail-closed。

### 14.2 审计事件

**事实｜高置信度（0.93）**

每次审批记录：

```text
approval/asked
approval/decided
```

并存在 asked/decided 配对 invariant。审批问答发生在开放 turn 内。

### 14.3 不是真正的跨重启耐久等待

**推断｜中高置信度（0.82）**

当前审批等待本身是进程内 Promise，而不是可跨重启恢复的独立 durable work item。按调用顺序推断：

1. 写入 `tool/call`；
2. 写入 `approval/asked`；
3. 在进程内等待用户；
4. 写入 `approval/decided`；
5. 进入 `tools/execute` 前 flush；
6. 执行工具 body。

如果进程在等待审批时崩溃，且此前事件已经落盘，恢复时可能看到 durable `tool/call` 但没有 `tool/result`，进而保守归类为 `TOOL_OUTCOME_UNKNOWN`。安全上不会误执行，但实际语义更可能是“工具尚未开始，只是在等待审批”。

这说明审批的安全立场正确，但恢复精度和跨重启继续能力仍有限。

---

## 15. LLM retry 与文档/源码矛盾

### 15.1 文档说法

**事实｜高置信度（0.98）**

固定版本的 LLM Retry / Streaming 文档声称：Agent-level recovery 每次重试会开启新的、带编号的 durable turn。

### 15.2 源码实际行为

**事实｜高置信度（0.99）**

`rc.5` 实现实际是：

```text
同一个 turn
同一个 step
Provider 调用失败
    ↓
记录 llm/retry
    ↓
等待 backoff
    ↓
在 step() 内 continue
    ↓
再次请求 Provider
```

测试还明确断言：一次失败加一次成功请求后，Session 中仍只有一个：

```text
step/start { turn: 1, step: 1 }
```

因此，该固定提交的文档与实现存在确定矛盾；应以源码和测试描述的 same-step retry 为准。

### 15.3 更深层的建模限制

**判断｜高置信度（0.91）**

核心 Session 模型没有一等 `ModelCallAttempt`。同一 step 内的多个 Provider attempt 只能通过以下事件间接重建：

- raw assistant chunks；
- `llm/retry`；
- `llm/retry-started`；
- usage；
- 最终 assistant message。

这会限制逐 attempt 的 Provider、延迟、错误、成本、fallback 和审计表达。后续研究应确认新版是否增加一等 attempt identity，或至少形成稳定 projection。

---

## 16. Goal

### 16.1 模型

**事实｜高置信度（0.90）**

Goal 不是另一套独立 Agent 执行引擎，而是同一 Session 内的耐久工作主线：

```text
Durable Goal Snapshot
+ revision / CAS
+ active / paused / blocked / complete
+ Goal Round Driver
```

### 16.2 驱动语义

**事实｜高置信度（0.87）**

- 激活后，driver 向同一个 Agent 发送下一轮 followup；
- 人类消息优先，且不消耗自动 round cap；
- 每轮 Goal 变更会先 flush，再开始下一轮；
- 恢复后不会静默继续自动执行，而要求人显式恢复。

### 16.3 能力边界

**事实/判断｜中高置信度（0.83）**

当前 Goal 是轻量、Session-local 的持久化 continuation 机制。未见其承担：

- 独立 evaluator；
- 跨 Session 项目结构；
- 完整资源预算；
- 分布式调度；
- 复杂异常自动恢复策略。

---

## 17. Jobs / Schedule / Workflow

### 17.1 Jobs

**事实｜高置信度（0.90）**

Jobs 是进程内后台任务注册表，状态包括：

```text
running
stopping
completed
killed
failed
```

它处理取消、资源释放和 ownership 隔离，但不是跨进程、跨重启的 durable task engine。当前研究未发现完整的 lease、attempt、retry policy、dependency、dead-letter 或分布式 worker 语义。

### 17.2 Workflow

**事实｜中高置信度（0.84）**

Workflow 用于模型生成或驱动的子 Agent 编排，默认可以通过 worker thread 执行。worker thread 是并发与资源组织机制，不是恶意代码安全边界。

需要继续验证 Workflow 的定义版本、输入输出契约、失败聚合、取消传播、重启恢复和与 SessionEvent 的完整对应关系。

### 17.3 Schedule

**事实｜低置信度（0.58）**

固定提交中存在 Schedule/定时工作相关能力入口或产品表面，但本轮源码研究没有形成足够证据来确认其完整耐久语义。当前不能断言它具备跨重启可靠触发、时区/DST 处理、misfire policy、并发去重、lease 或分布式调度。

在完成专项源码追踪和重启实验前，Schedule 应视为“已确认存在能力入口、尚未确认工程保证”的部分。

### 17.4 综合判断

**判断｜高置信度（0.87）**

Jobs、Workflow、Schedule 不应被合并理解为一个成熟的通用耐久任务平台。它们更接近 Harness 内部的后台执行、Agent 编排与定时能力集合，其强项仍在本地 Agent Runtime，而不是分布式任务基础设施。

---

## 18. Agent Preset

### 18.1 作用

**事实｜高置信度（0.90）**

Agent Preset 用于定义某类 Agent 的能力组合，包括但不限于：

- Persona / system prompt；
- 模型与 reasoning 配置；
- 可见工具和 Tool Presentation；
- Skill；
- Goal、Todo、Plan、Workflow 等能力；
- scope-local 注册项和运行时上下文。

Profile、Bundle、Patch 和 Preset 共同支持不同发行形态及不同 Agent 组合，而不必直接改写默认 Agent Loop。

### 18.2 工程价值

**判断｜高置信度（0.88）**

Preset 把“选择模型”扩展成“选择完整 Agent Configuration”。强模型、成本较低的模型和本地小模型未必适合面对同样的工具数量、presentation 和 Persona。Preset 是进行模型 × 能力面 × 提示词 × reasoning 组合实验的自然边界。

### 18.3 尚未证明的部分

**判断｜中置信度（0.70）**

项目没有公开足以证明某个 Preset 或模型组合任务效果领先的 benchmark 结果。`BENCHMARK.md` 在本轮固定版本中主要提供运行方法，而不是可用于比较的正式结果集。

---

## 19. UI Projection

### 19.1 Host-side projection

**事实｜高置信度（0.91）**

浏览器不需要自行遍历所有原始 `SessionEvent` 猜测状态。Host 提供 projection registry：

```text
Durable Session Events
        ↓
Pure Projection Units
        ↓
{ asOfSeq, values }
        ↓
BFF / Client Store
        ↓
UI Nodes
```

Projection 在宿主侧权威计算；客户端以 higher-seq-wins 合并。快照表示一个一致的日志截面。

### 19.2 优点

**判断｜高置信度（0.89）**

该结构清晰分离：

- 原始耐久事实；
- 模型可见历史；
- 恢复状态；
- 面向用户的 read model。

如果某个 Projection 有 bug，理论上可以从原始日志 replay 修复，而无需修改权威事实。

### 19.3 已知缺口

**事实/判断｜中置信度（0.75）**

某些错误仍可能只以 live 字符串形式暴露，未必拥有完整耐久 failure projection。真实 UI 是否始终准确区分 provider failure、tool failure、policy rejection、approval unavailable、cancelled 和 unknown effect，尚未做浏览器刷新与进程重启验收。

---

## 20. 工程成熟度

### 20.1 分项评价

以下是固定提交上的研究判断，不是官方评分：

| 维度 | 评价 | 置信度 |
|---|---:|---:|
| 单机 Agent Runtime 架构 | 8.5/10 | 0.90 |
| 多工具调度与取消收敛 | 9/10 | 0.93 |
| 上下文可追溯与恢复 | 9/10 | 0.91 |
| 外部副作用不确定性处理 | 8.5/10 | 0.90 |
| 动态组合能力 | 9/10，复杂度高 | 0.86 |
| 权限与审批基础 | 7/10，安全立场正确但耐久等待不足 | 0.84 |
| 多进程耐久调度 | 4/10，不是主要目标 | 0.82 |
| 多租户插件安全 | 3/10，不适合作为安全隔离 | 0.90 |
| Model Attempt 审计 | 5/10，缺一等 attempt | 0.91 |
| 产品成熟度 | 约 6/10，RC / developer preview | 0.82 |

### 20.2 证据强弱

```text
架构和源码语义：0.90
真实 Web UI 体验：0.65
长时间运行稳定性：0.60
任务效果与模型增益：证据不足
```

**判断｜高置信度（0.90）**

仓库表现出很强的工程纪律，特别是在多调用调度、事件顺序、故障分类、Compaction 和 Cordis 生命周期测试上。但 developer preview、预发布 Session format、文档与 retry 实现矛盾，以及缺少真实 benchmark 结果，都说明它尚不应被当作已经稳定的基础设施产品。

---

## 21. 已知限制

### 已由固定提交确认

1. **预发布兼容性**：官方不保证 Session 和插件接口向后兼容。
2. **单写者 Persistence**：JSONL 后端要求同一 Session 单一 live writer。
3. **非分布式任务引擎**：Jobs 主要是进程内注册表。
4. **插件非安全沙箱**：same-process plugin、VM 和 worker thread 不构成强安全边界。
5. **审批等待非跨重启 durable work item**：安全上 fail-closed，但恢复语义可能退化为 outcome unknown。
6. **缺一等 ModelCallAttempt**：same-step retry 的各 Provider attempt 主要靠事件间接重建。
7. **文档与实现矛盾**：LLM retry 文档称新 turn，源码和测试实际为同 turn、同 step。
8. **确定性提交代价**：按模型调用顺序提交工具结果会造成 head-of-line blocking。
9. **无通用 exactly-once**：外部工具仍需幂等键、检查或补偿。
10. **部分错误耐久性有限**：turn 外 live error 可能不是完整持久化 failure object。

### 尚未完成验证

1. 真实浏览器刷新后，审批、工具卡片、错误和 unknown effect 是否完全一致；
2. 强杀进程时 checkpoint 与 Persistence 尾部的实际恢复表现；
3. Plugin / Persistence / Tool provider 动态卸载与取消的竞态；
4. 长时间运行中的内存、observer、timer、worker 和 disposer 泄漏；
5. Schedule 的跨重启、时区、misfire、去重和并发语义；
6. 多种非默认模型在 `native` / `code` / `both` 下的任务质量；
7. 大工具输出、Compaction 和后续恢复的准确性；
8. 自定义 Provider、Sandbox 和动态插件的真实安全边界；
9. Session schema 升级和迁移工具的可用性；
10. benchmark、成本、延迟和真实完成率。

---

## 22. 结论

### 22.1 已经可以成立的结论

**判断｜高置信度（0.92）**

DeepSeek Harness 在固定提交上已经展示出一套完整、相互咬合的 Agent Runtime 思路：

```text
append-only facts
    ↓
request reconstruction
    ↓
model response with N tool calls
    ↓
visibility / approval / monotonic deny
    ↓
parallel-exclusivity scheduling
    ↓
durability checkpoint
    ↓
external side effect
    ↓
durable result or explicit uncertainty
    ↓
replay / compaction / UI projection
```

它最值得肯定的五个原则是：

1. 一步多调用是正常协议能力；
2. 模型可见内容必须能从事实日志重建；
3. 外部副作用前必须先持久化意图；
4. 崩溃后必须区分“未开始”和“结果未知”；
5. 原始事实、模型上下文 surface 和 UI read model 必须分层。

### 22.2 不应过度外推的结论

**判断｜高置信度（0.91）**

不能仅凭这些设计推断：

- 已达到分布式、高可用、多租户平台成熟度；
- 插件可以安全运行不受信任代码；
- Approval 能跨重启无损继续；
- Jobs / Schedule 已等价于耐久任务系统；
- 所有 Provider attempt 都可完整审计；
- 默认模型或 Preset 具有已公开证明的任务效果优势；
- developer preview 的 Session 数据可以长期无迁移风险保存。

### 22.3 最终定位

> 在该固定提交上，DeepSeek Harness 是一个架构质量很高、恢复意识强、动态组合能力突出的本地 Agent 内核；它的事实日志、多工具调度、durability checkpoint、request reconstruction、Compaction 和 Projection 设计已经具备很高研究价值。与此同时，它仍处于 RC / developer preview，核心适用边界是本地和受控进程内运行，而非强隔离、分布式、长期稳定兼容的通用 Agent 平台。

---

## 23. 后续研究问题

### P0：决定恢复语义是否真正可靠

1. 工具产生外部副作用后、`tool/result` 落盘前强杀进程，重启后是否稳定得到 `TOOL_OUTCOME_UNKNOWN`？
2. 审批等待中强杀进程，能否区分“未执行、等待审批”和“已派发、结果未知”？
3. 多工具调用部分完成、部分运行、部分未派发时，取消和恢复如何为每个 call 写终态？
4. Persistence flush 失败是否在所有模型调用和顶层工具 body 前都严格 fail-closed？
5. `callId` 在恢复、重试、fork 和 Provider replay 中是否保持稳定？

### P1：确认上下文和治理是否可审计

6. `inject()` 在各执行阶段准确进入哪一个 model request？
7. Compaction 后 workspace instructions、Goal、Skill 和 policy context 如何恢复，是否会重复或丢失？
8. Tool Restriction、Approval、Guard、Code Mode 和嵌套工具调用是否共享同一条不可绕过的 dispatch path？
9. 审批完成后，工具参数是否以不可变快照绑定到同一次 dispatch？
10. policy 或工具注册在调用排队期间变化时，系统采用 proposal-time 还是 dispatch-time snapshot？

### P1：确认插件生命周期

11. 工具运行中卸载工具插件、依赖 provider、Approval provider 或 Persistence provider，会 drain、cancel 还是留下悬空状态？
12. disposer 抛错、超时或重入时，Cordis 是否仍能达到 quiescence？
13. 父 scope 卸载后，子 scope 的监听器、timer、worker、文件句柄和注册项是否完全消失？
14. 动态插件对其他 Session、Secret 和 Host Context 的实际访问范围是什么？

### P2：确认产品与模型效果

15. UI 刷新和进程重启后，running、awaiting approval、failed、cancelled、not-started、unknown 是否一致显示？
16. 不同模型在 `native`、`code`、`both` 下的协议正确率、任务成功率、恢复能力、成本和延迟如何？
17. 大输出和多次 Compaction 后，模型是否仍能准确遵循原始约束？
18. Goal 的 round cap、人类优先、pause/block/resume 在真实长任务中是否稳定？
19. Schedule 是否具备跨重启触发、时区/DST、misfire、幂等和并发控制？
20. Session format 升级时，官方是否提供可验证、可回滚的迁移路径？

---

## 24. 更新本 Source of Truth 的规则

后续更新本文时，应遵守：

1. 每次研究必须固定新的 commit，不用浮动 `main` 直接覆盖旧结论；
2. 对发生变化的结论保留“旧版本行为 → 新版本行为”的差异记录；
3. 文档、源码、测试和真实运行结果分别标注，不互相替代；
4. 对真实副作用和崩溃恢复结论，必须附故障注入条件和持久化证据；
5. 对 UI 结论，至少完成真实交互、刷新和进程重启验证；
6. 对 benchmark 结论，记录模型、Provider、Preset、工具表面、任务集、成本和失败样本；
7. 任何“已修复”“可恢复”“耐久”“安全”结论，都必须说明适用边界和反证条件。

