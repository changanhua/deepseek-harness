# DSH Mastery Curriculum

课程不是按 API 分类，而是按“架构判断能力”递进。

## Stage 1 — 建立 Agent Runtime 心智模型

### Lesson 01：Agent 不是模型

目标：理解 Model、Harness、Context、Tool、State、Persistence、UI 的关系。

验收：能够用 SEE / ACT / OWN / SURVIVE 分析一个简单后台任务能力。

### Lesson 02：追一次真实 DSH 请求

目标：从用户输入开始，沿 Session → Context → Agent Loop → Model → Tool → Result → Log 追一条真实路径。

验收：能指出一轮执行中“事实在哪里产生、在哪里记录、下一轮模型为何能看到”。

### Lesson 03：Tool / Service / Provider

目标：理解模型接口、领域能力和可替换实现之间的边界。

验收：面对 5 个需求能判断主要属于 Tool、Service、Provider 或组合，并解释为什么。

---

## Stage 2 — 理解 DSH 为什么“一切皆插件”

### Lesson 04：Cordis 的最小模型

Context、Plugin、inject、Service、fiber lifecycle。

验收：能解释“依赖 service 尚未出现时插件为什么不应该自己轮询等待”。

### Lesson 05：Composition

Bundle、Profile、Preset、Cordis config、静态 Loader plugin 与 Dynamic Cordis definition。

验收：能解释“系统装了什么”和“运行时临时长出了什么”的区别。

### Lesson 06：Effect 与资源所有权

listener、timer、route、socket、watcher 等为什么必须跟随插件生命周期。

验收：能识别至少三种 lifecycle leak。

---

## Stage 3 — 状态是 Agent 工程的骨架

### Lesson 07：State Ownership

模型上下文、Session、Service state、Durable Store、Derived View。

验收：能为一个跨 session 的任务系统确定唯一 authoritative state。

### Lesson 08：Persistence / Restart / Recovery

重启、幂等、lease、attempt、replay 的基础概念。

验收：给一个“worker 执行到一半崩溃”的场景，能描述系统应该如何恢复。

### Lesson 09：Model-visible State

哪些事实进入 prompt，哪些通过 tool 按需发现，哪些不应该让模型看到。

验收：能设计一个低 token 成本的 runtime-awareness 信息面。

---

## Stage 4 — 第一次真正做插件

### Lesson 10：小型 Host-only Plugin

只实现一个职责清晰、无复杂持久化的小能力。

### Lesson 11：加入 Tool Surface

把 Service 能力正确暴露给模型，设计 schema、description、失败语义与 output render。

### Lesson 12：加入 Web Surface

仅在确有价值时引入 client half、slot / card / settings surface。

验收：能解释 Host 与 Client 各自为什么存在，且 UI 不成为业务真值。

---

## Stage 5 — 用自己的历史设计反向学习

### Lesson 13：runtime-awareness 解剖

关注：事实来源、freshness、authority、projection、prompt budget、on-demand introspection。

### Lesson 14：task_queue 解剖

关注：queue truth、consumer、claim、lease、attempt、restart、model surface。

### Lesson 15：Work Observatory / Durable Orchestration

关注：时间语义、事件、幂等、恢复、并发与可观测性。

这一阶段不以“把旧代码讲懂”为目标，而是把旧实现重构成可迁移的设计经验。

---

## Stage 6 — 独立架构能力

### Lesson 16：从需求选择 DSH seam
### Lesson 17：设计评审与 anti-pattern
### Lesson 18：源码 precedent 检索
### Lesson 19：复杂插件的 host/client/state 组合
### Lesson 20：独立设计挑战

最终验收：

给一个未见过的中等复杂度 DSH 需求，学习者可以：

1. 写出问题定义；
2. 用 SEE / ACT / OWN / SURVIVE 分析；
3. 映射五层；
4. 选择 seam；
5. 确定 authoritative state；
6. 描述生命周期与恢复；
7. 找到相关官方 precedent；
8. 给出候选方案与取舍；
9. 给出验证计划；
10. 最后才进入实现。

## 调整规则

课程编号是稳定导航，不是强制课时。如果验收失败，应补练或回退；如果某项已有充分掌握，可以缩短，但不得跳过对应能力的验收。
