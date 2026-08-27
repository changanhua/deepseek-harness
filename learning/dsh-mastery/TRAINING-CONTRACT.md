# DSH Mastery Lab Training Contract

本文件定义训练系统的稳定原则。它不是为了固定某个“老师”的说法，而是为了保证整个 Lab 始终服务于同一个目标：提升独立 DSH / Agent Runtime 工程判断能力。

## 1. 训练目标

训练优先级依次是：

1. 建立正确的 Agent Runtime 心智模型；
2. 能从行为追到真实源码和状态流；
3. 能判断 seam、state ownership、lifecycle、persistence 与 model visibility；
4. 能安全修改已有设计；
5. 能独立提出中等复杂度设计；
6. 能审查和反驳不可靠设计；
7. 最终能设计新的 runtime primitive 或 seam。

## 2. 不以“课程完成”为目标

完成状态必须由证据支持。以下都不能单独构成 mastery：

- 阅读完一篇 lesson；
- 模型解释过；
- 能复述术语；
- 代码“能跑”；
- 自己主观认为已经懂了。

有效 evidence 包括但不限于：

- 在未知例子上做出正确分类或预测；
- 独立还原 source trace；
- 修改代码并通过验证；
- 解释为什么方案 B 不成立；
- 找出一个真实设计中的 blocking flaw；
- 给出可执行验证计划；
- 对失败进行正确复盘并修正心智模型。

## 3. SEE / ACT / OWN / SURVIVE

分析任何能力时优先回答：

- SEE：模型如何知道能力或事实存在？
- ACT：模型如何操作它？
- OWN：谁拥有 authoritative state？
- SURVIVE：什么必须跨 turn / session / process / machine 存活？

这是一组诊断抓手，不是要求所有问题都机械套模板。

## 4. 五层压缩模型

复杂设计可先压回五层：

1. Runtime：Cordis / Plugin / Lifecycle
2. State：Session / Storage / Job / Durable State
3. Capability：Tool / Service / Provider
4. Agent：Loop / Prompt / Context / Policy
5. Surface：Web / CLI / ACP / UI

当真实源码不完全符合这个抽象时，以源码事实为准，并明确指出抽象边界。

## 5. 训练单元类型

- **Lesson**：建立和校正心智模型。
- **Trace**：沿真实行为还原调用、状态和事件路径。
- **Lab**：必须操作代码、运行系统或验证假设。
- **Case Study**：先独立重建设计，再与真实实现对照。
- **Challenge**：在最少提示下完成新需求设计或 review。

仅靠 Lesson 不足以提升工程等级。

## 6. Source authority

实现级事实的优先级：

1. 当前目标 commit 的源码与可复现运行结果；
2. 当前官方 exports / types / README / architecture notes；
3. 已验证并记录版本的本地 evidence；
4. 教学材料和 case 总结；
5. 历史聊天、旧教程和模型先验。

涉及快速演进的 DSH API 时必须记录版本或 commit，不能用旧记忆覆盖当前事实。

## 7. Adapt before invent

面对新设计：

1. 先识别问题类别；
2. 找现有官方 seam；
3. 找至少一个邻近 precedent；
4. 明确 precedent 哪部分可迁移、哪部分不可迁移；
5. 只有现有 seam 无法表达需求时才允许提出新 primitive；
6. 新 primitive 必须说明为什么不能通过组合现有能力解决。

## 8. 本地自定义能力的地位

`runtime-awareness`、`task_queue`、Work Observatory、durable orchestration 等本地扩展不是默认正确答案。

它们进入 `cases/` 时必须按照以下顺序训练：

```text
隐藏旧答案
→ 重新定义问题
→ 学习者先设计
→ 当前源码取证
→ 阅读旧实现
→ Review
→ Redesign
→ 提炼可迁移经验
```

## 9. Evidence 与状态

仓库不维护人工 `PROGRESS.md`。

当前能力状态应由：

```text
CURRICULUM.yaml
+ evidence/*
= derived skill state
```

推导得到。

Evidence 允许记录失败。失败 evidence 对诊断 prerequisite 同样重要，不应只保存成功结果。

## 10. 自适应推进

默认推荐路径可以存在，但下一单元应依据：

- prerequisite 是否满足；
- 最近 evidence 暴露出的薄弱点；
- 当前真实工程任务；
- 学习者是否已经能在未知问题上迁移；

决定。

## 11. 训练表达原则

- 先因果和责任，再 API 和语法；
- 优先用数据流、状态流、生命周期图；
- Java / Spring 类比仅用于搭桥，必须说明边界；
- 一次只引入必要的新核心概念；
- 源码阅读采用 trace-driven，而不是目录通读；
- 实现前要求预测，实现后要求解释偏差；
- 能自动验证的内容尽量不用自然语言自评。

## 12. 项目成功标准

真正关心的指标是：

- Architecture prediction accuracy
- Source trace accuracy
- Seam selection accuracy
- State ownership accuracy
- Review catch rate
- Independent design ratio
- Rework rate
- Explanation compression

总体趋势应是：架构判断能力上升，而不是简单增加课程阅读量。
