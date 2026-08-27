# DSH Mastery Lab

DSH Mastery Lab 是一套面向真实 DeepSeek Harness 源码与真实设计任务的工程训练系统，而不是以“读完课程”为完成标准的教程。

## Mission

通过源码取证、可执行实验、设计挑战和真实项目重构，训练独立追踪、判断、修改、设计和审查 DSH / Agent Runtime 的能力。

核心变化是：从依赖模型替自己做架构判断，逐步转向自己做架构判断、让模型辅助取证和实现，并能够审查模型给出的设计。

## North Star

面对一个未见过的 DSH 需求，在进入实现之前，学习者能否先给出基本正确的架构判断：

- 模型如何 SEE 这个能力或事实；
- 模型如何 ACT；
- authoritative state 由谁 OWN；
- 什么必须 SURVIVE turn / session / process / machine；
- 应该选择哪个 DSH seam；
- host / client / state / model-visible surface 如何分工；
- 失败、重启、恢复和验证如何处理。

## 能力等级

- L0 User：能运行和使用 DSH。
- L1 Navigator：能定位主要模块和源码入口。
- L2 Reader：能追一条真实请求、状态或生命周期路径。
- L3 Modifier：能安全修改已有能力并预测影响面。
- L4 Designer：能独立设计中等复杂度 DSH capability。
- L5 Reviewer：能系统审查 DSH 设计。
- L6 Runtime Engineer：能修改核心机制、设计新的 seam 和 runtime primitive。

## 训练循环

```text
Concept
→ Mental Model
→ Source Trace
→ Prediction
→ Experiment / Modification
→ Failure / Review
→ Evidence
→ Assessment
→ Next Unit
```

“看过”“听懂了”“解释过”都不是完成证据。

## Zero-manual-progress model

项目没有 `PROGRESS.md`。学习状态每次都从下面两类事实重新推导：

```text
CURRICULUM.yaml
+
evidence/**/*.yaml
        ↓
status / next / check
```

常用命令：

```bash
pnpm exec tsx learning/dsh-mastery/tooling/dsh-mastery.ts check
pnpm exec tsx learning/dsh-mastery/tooling/dsh-mastery.ts status
pnpm exec tsx learning/dsh-mastery/tooling/dsh-mastery.ts next
```

- `check`：验证 curriculum DAG、引用、evidence schema、source pin、case reveal 顺序和单一状态源。
- `status`：从 evidence 推导 unit completion 与 capability state。
- `next`：按 prerequisite 和未满足 evidence 推荐下一训练单元。

这些命令**不写状态**，因此执行器可以被替换而不会产生双写。

## Repository model

- `TRAINING-CONTRACT.md`：训练原则、证据规则与权威层级。
- `CURRICULUM.yaml`：唯一课程/能力图真值。
- `PROJECT-INSTRUCTIONS.md`：ChatGPT Project 的薄启动协议。
- `AGENTS.md`：任何 Agent 修改本目录时必须遵守的规则。
- `lessons/`：建立心智模型。
- `labs/`：需要 trace、修改、运行或验证的训练。
- `cases/`：真实系统重构。
- `evidence/`：成功、失败、误判和修正证据；学习状态由此推导。
- `references/`：固定源码版本、source anchors 等可追溯参考。
- `templates/`：lesson / lab / case-study 模板。
- `tooling/`：`next` / `status` / `check` 的实现和协议说明。
- `scripts/dsh-mastery.spec.ts`：接入仓库现有 Vitest gate 的学习 Runtime 测试。

## Source authority

涉及 DSH 当前事实时：

```text
当前目标版本源码 / 运行证据
> 官方契约与当前 README/types
> 已验证的 Lab / Case evidence
> 教学材料
> 模型先验或历史聊天
```

源码训练应固定 commit。第一条真实 request trace 使用 `references/source-baseline.yaml` 固定版本，避免“课程没变但源码已经换了”的伪稳定。

## 默认训练路径

```text
Agent Runtime
→ Request Trace
→ Tool / Service / Provider
→ Cordis Lifecycle
→ State Ownership
→ Persistence / Recovery
→ Model-visible Context
→ Small Plugin Lab
→ Real Case Reconstruction
→ Independent Design / Review
```

这只是推荐路径，不是固定课表。如果 evidence 表明 prerequisite 未掌握，应回到对应能力补练，而不是机械推进。
