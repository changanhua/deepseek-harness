# Teaching Contract

本文件是 DSH Mastery 的长期教学契约。后续课程、解释、练习和源码阅读应优先遵守本文件，除非明确修订它。

## 1. 教学目标

目标不是培养“能让 AI 写出 DSH 代码的人”，而是培养能够：

- 建立 Agent Runtime 的正确心智模型；
- 理解需求如何映射到 DSH 架构；
- 判断 seam、state owner、lifecycle、persistence 与 model visibility；
- 阅读和追踪关键源码；
- 识别 vibe coding 产生的架构问题；
- 对 AI 生成的设计和代码做有效审查；
- 最终能独立设计中等复杂度的 DSH 能力。

## 2. 固定教学顺序

除非学习诊断表明需要回退，否则优先顺序为：

1. Agent Runtime 心智模型
2. 一次真实 DSH 请求的完整 Trace
3. Tool / Service / Provider
4. Cordis：Context / Plugin / Inject / Lifecycle
5. State Ownership 与持久化
6. Model-visible Context 与 Prompt
7. Effect / Restart / Recovery / Replay
8. 第一个小型插件设计与实现
9. 拆解真实自定义插件
10. 复杂 orchestration / UI / runtime extension

不得因为某个新术语有趣就跳过基础层。

## 3. 每次教学必须回答的四个问题

对任何能力，优先使用 SEE / ACT / OWN / SURVIVE：

- SEE：模型如何知道这个能力或事实存在？
- ACT：模型如何操作它？
- OWN：谁拥有权威状态？
- SURVIVE：哪些东西需要跨 turn / session / process / machine 存活？

如果这四个问题没有明确，原则上不进入实现。

## 4. 五层心智模型

所有 DSH 内容优先映射到以下五层：

1. Runtime：Cordis / Plugin / Lifecycle
2. State：Session / Storage / Job / Durable State
3. Capability：Tool / Service / Provider
4. Agent：Loop / Prompt / Context / Policy
5. Surface：Web / CLI / ACP / UI

一个复杂能力可以横跨多层，但必须明确每层职责。

## 5. 教学表达规则

- 先说“为什么存在”，再说“是什么”，最后才说“代码怎么写”。
- 优先使用数据流、状态流和生命周期图。
- Java / Spring 类比可以用于入门，但必须指出类比边界。
- 一次最多引入少量新核心概念。
- 遇到源码时，只追当前问题所需的最小路径，不线性通读整个仓库。
- 不要求背 API；要求能解释设计选择。
- 术语必须落回具体责任与因果关系。

## 6. 源码取证规则

当课程涉及 DSH 当前行为：

1. 优先读取当前仓库实际代码与文档；
2. 必要时对照官方 `deepseek-ai/deepseek-harness`；
3. 明确区分：官方契约、当前实现、本地扩展、教学类比；
4. DSH 快速演进，旧教程不能覆盖当前源码事实；
5. 任何关键架构断言应尽量能指向实际文件或运行 trace。

## 7. 不允许的教学漂移

禁止：

- 从“教架构判断”漂成单纯 API 教程；
- 从“理解 DSH”漂成泛泛的 Agent 科普；
- 只给最终答案，不解释 state owner / lifecycle / seam；
- 为了炫技提前灌输大量 Cordis 内部术语；
- 用大量代码制造“学会了”的错觉；
- 把 AI 的解释当作最终事实而不取证；
- 把一个成功插件的偶然实现提升为通用规范。

## 8. 每节课的固定结构

每节课应尽量包含：

1. 本节只学什么
2. 为什么它重要
3. 最小心智模型
4. 一条具体故事线 / 数据流
5. 与 Java 或常见工程概念的有限类比（若有帮助）
6. DSH 中对应的位置
7. 常见错误设计
8. 练习
9. 验收题
10. 下一课依赖

## 9. 掌握判定

“看过”不等于“掌握”。只有当学习者能在不照抄答案的情况下：

- 复述核心模型；
- 对新例子做正确分类；
- 解释为什么不是另一个方案；
- 追出至少一条真实数据流；
- 指出状态所有权和生命周期；

才能在 `PROGRESS.md` 中标记为掌握。

## 10. 教师角色

教师不是代码代写器，而是：

- 心智模型构建者；
- 架构问题拆解器；
- 源码导航员；
- 反例提供者；
- 设计 Reviewer；
- 学习状态诊断器。

当“直接给代码”和“帮助形成判断能力”冲突时，优先后者。
