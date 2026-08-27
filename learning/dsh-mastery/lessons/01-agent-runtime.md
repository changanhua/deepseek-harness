# Lesson 01 — Agent 不是模型：把 Agent 拆成运行时

## 本节只学什么

只建立一个稳定心智模型：

> 一个工程化 Agent，不是“LLM + 几个工具”，而是一套负责上下文、能力、状态、生命周期和表面的 Runtime。

本节暂不深入 Cordis Fiber、Slot、HMR、Preset merge 等细节。

## 1. 为什么这件事重要

很多 vibe coding 的 Agent 可以工作，但一复杂就开始失控。常见原因不是语法，而是没有回答：

- 状态归谁？
- 模型为什么能看到这个事实？
- 一个 Tool 背后真正负责业务的是谁？
- 重启以后什么还存在？
- UI 显示的是事实还是投影？

如果这些问题没设计，代码很容易把模型上下文、内存变量、UI 状态和 durable state 混在一起。

## 2. 从最粗糙模型开始

最简单的 Agent 心智模型：

```text
User
  ↓
LLM
  ↓
Tool
  ↓
Result
```

它能解释 demo，却不能解释真实工程。

更完整的模型：

```text
                    ┌────────────┐
                    │   Model    │
                    │ 推理 / 决策 │
                    └─────┬──────┘
                          │
User → Harness → Context → Agent Loop
          │          │         │
          │          │         ├─ 请求模型
          │          │         ├─ 执行工具
          │          │         └─ 决定下一步
          │          │
          │          ├─ Prompt
          │          ├─ Tools
          │          ├─ Runtime Facts
          │          └─ Policy
          │
          ├─ Session
          ├─ Persistence
          ├─ Approval
          ├─ Runtime
          └─ UI / CLI
```

模型只是 Runtime 中的一部分。

## 3. 最小 Agent Loop

把框架细节全部删掉，一个 Agent Loop 可以压缩成：

```text
while true:
    context = build_context()
    response = model(context)

    if response wants tool:
        result = execute_tool()
        record(result)
        continue

    return response
```

只观察四个位置：

1. `build_context()`：模型知道什么？
2. `model()`：谁做推理？
3. `execute_tool()`：模型能改变什么？
4. `record()`：事实如何进入系统历史？

后面学习 DSH 时，会不断把复杂实现压回这四个问题。

## 4. 第一核心概念：State Ownership

需求：

> 让 Agent 记住一个 TODO，以后继续处理。

先不要写 `todos = []`，而要问：TODO 的 authoritative state 到底是谁拥有？

可能的位置：

```text
模型“记忆”
Prompt
当前 Session
某个 Service 的内存
文件 / 数据库 Durable Store
```

这些不是等价方案。

如果 TODO 必须在进程重启后仍然存在，那么模型上下文或内存对象都不够。

因此第一条原则：

> 先设计 state owner，再设计 API。

## 5. Tool 和真正能力不是一回事

用 Java / Spring 做有限类比：

```text
Model
  ↓
task_create Tool       ≈ 面向 LLM 的 Controller/API
  ↓
TaskQueueService       ≈ Domain Service
  ↓
Durable Store          ≈ Repository / DB
```

Tool 是模型的操作面，不等于整个业务能力。

如果把 Queue 的所有状态和逻辑都塞在 Tool 实例里，一旦涉及重启、多 worker、UI、恢复，就很容易失控。

## 6. DSH 五层模型

以后任何能力先映射到：

```text
┌─────────────────────────────┐
│ 5. Surface                  │
│ Web / CLI / ACP / UI        │
├─────────────────────────────┤
│ 4. Agent                    │
│ Loop / Prompt / Context     │
├─────────────────────────────┤
│ 3. Capability               │
│ Tool / Service / Provider   │
├─────────────────────────────┤
│ 2. State                    │
│ Session / Storage / Jobs    │
├─────────────────────────────┤
│ 1. Runtime                  │
│ Cordis / Plugin / Lifecycle │
└─────────────────────────────┘
```

这不是说所有功能都必须五层齐全，而是强迫设计者知道自己在哪一层做什么。

## 7. 四问口诀：SEE / ACT / OWN / SURVIVE

### SEE

模型怎么知道这件事？

可能来自 Prompt、Tool schema、Context、Runtime Awareness 或按需查询。

### ACT

模型怎么操作？

可能通过 Tool、Command、Workflow、Subagent 等。

### OWN

谁拥有权威真值？

Session？Service？Database？Filesystem？Runtime registry？

### SURVIVE

它需要活多久？

```text
Turn
Session
Process
Machine
```

生命周期要求不同，架构选择就不同。

## 8. 故事线：后台任务

需求：

> 让 DSH 创建一个后台任务，10 分钟后仍可以查询状态。

一个合理的第一版心智模型：

```text
User
 ↓
Agent
 ↓
task_create Tool
 ↓
TaskQueueService
 ↓
Durable Store  ← authoritative truth
 ↑
Worker
 ↓
Execution
 ↓
Durable Store
```

Web UI 若存在：

```text
Durable Store
     ↓
Projection
     ↓
Web UI
```

所以：

- Tool = Command Interface
- Service = Domain Capability
- Store = Truth
- UI = View
- Model Context = 某种 Projection

## 9. 常见错误设计

### 错误 A：Tool 自己持有跨 Session 状态

问题：Tool 生命周期未必等于业务状态生命周期。

### 错误 B：UI 显示什么就认为真实状态是什么

问题：UI 只是消费者，不应自动成为 authoritative state。

### 错误 C：为了让模型知道所有事情，把全部 Runtime 信息塞进 Prompt

问题：token 成本、陈旧性、权限和信息噪声都会变差。

### 错误 D：只考虑正常路径

例如 worker claim 任务后进程崩溃，如果没有 recovery 语义，“运行中”可能永久卡死。

## 10. 本节练习

不要写代码。回答：

> “让 DSH 能创建后台任务，10 分钟后还能查询状态。”

1. Model 怎么知道这个能力？
2. Model 调用的是 Tool、Service 还是别的？
3. Tool 后真正负责业务的是谁？
4. Task 的 authoritative state 在哪里？
5. Session 关闭后任务存在吗？为什么？
6. DSH 进程重启后任务存在吗？为什么？
7. Worker 是谁？
8. Worker 崩溃后怎么办？
9. UI 状态是真值还是投影？
10. 哪些资源需要跟随 Runtime 生命周期清理？

## 11. 验收题

> 为什么 `task_queue` 不应该只是几个 Tool？

通过标准：答案至少包含 Tool 只是模型接口、领域能力应有独立 owner、durable state 的生命周期不能依附模型上下文，并能说明重启/恢复对设计的影响。

## 12. 下一课

下一课不再停留在抽象图。

我们会选择一次真实 DSH 请求，从用户消息开始，追踪它如何进入 Session、如何构造模型输入、如何执行 Tool、结果怎样记录并进入下一轮上下文。

目标是第一次把“Agent Runtime 心智模型”钉到真实源码和事件流上。
