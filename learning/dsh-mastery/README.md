# DSH Mastery

这是一个面向真实 DeepSeek Harness（DSH）工程实践的长期学习项目。

目标不是“看懂一些源码”或“会调用几个工具”，而是逐步形成能够独立判断 DSH 架构的心智模型：面对一个需求，知道它应该进入哪一层、依赖哪些 seam、状态归谁、生命周期如何闭合、怎样验证设计是否成立。

## 核心目标

学习完成后，应能稳定回答：

1. 模型这一轮到底看到了什么？
2. 模型到底能做什么？
3. 系统真正的状态在哪里？
4. 谁拥有这个状态？
5. 哪些状态必须跨 turn / session / process 存活？
6. Tool / Service / Provider / Plugin / Preset / Settings 分别解决什么问题？
7. 一个需求应该挂在哪个 DSH seam 上？
8. 一个插件卸载、重启、失败后会发生什么？
9. UI 是真值还是投影？
10. 如何用测试、trace 和官方实现验证设计，而不是靠感觉？

## 学习方法

本课程坚持：

- 心智模型先于源码细节。
- 先追一条真实数据流，再读相关文件。
- 先判断 state ownership，再讨论代码结构。
- 先解释“为什么”，再解释“怎么写”。
- 每节课必须包含可验证的学习目标与练习。
- 不以术语记忆代替架构理解。
- 不把某个偶然实现当成 DSH 框架契约。
- 课程事实以当前 DSH 源码为准，教程与旧经验只作为辅助证据。

## 文件结构

- `TEACHING-CONTRACT.md`：长期教学契约，防止课程方向漂移。
- `PROJECT-INSTRUCTIONS.md`：可复制到 ChatGPT Project 的固定指令。
- `CURRICULUM.md`：课程路线与每阶段验收标准。
- `PROGRESS.md`：学习状态，只记录已经验证的掌握情况。
- `lessons/`：正式课程。

## 当前起点

第一阶段不要求直接写复杂插件。先建立：

`Agent Runtime → State Ownership → Capability → Lifecycle → DSH Composition`

的稳定心智模型。

第一课见：`lessons/01-agent-runtime.md`。
