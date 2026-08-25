# Evals（private-holdout 实验台）

这里定义 **Paired Eval 基础设施**，不是知识库，也不放 holdout 答案。

## 核心原则

> 同一个弱模型、同一道陌生题，只改变「有没有 Architecture Intelligence」，然后让不可见 rubric 独立判卷。

这是 Phase 0 第一次真正意义上的**因果验证**。

## Prompt / Rubric 分离（铁律）

| 面 | 文件 | 谁能读 |
|---|---|---|
| 模型面 | `<task>.prompt.yaml`（`id` / `requirement` / `constraints`） | **只有被评测的模型** |
| 判卷面 | `<task>.rubric.yaml`（`blocking_findings` / `expected_properties` / `forbidden_patterns`） | **只有 Evaluator** |

**绝不允许** `expected_design` / `baseline_trap` 等答案字段出现在模型可见的 prompt 中。
`holdout-task.schema.json` 用 `additionalProperties:false` 在 schema 层禁止。

## 目录边界

```text
# committed —— 基础设施，不含 holdout 内容
.agents/dsh-intelligence/evals/     README + holdout-task / trial-result / scoring schema
scripts/dsh-intelligence/           run-eval.ts / run-eval.spec.ts / prepare-private-eval.ts

# gitignored，永不提交
.dsh-intelligence/private-evals/
├── tasks/          任务 prompt + rubric（真实 holdout 只在这里）
└── runs/<run-id>/  baseline/ + intelligence/ + manifest.json + comparison.json
```

## 六个锁定协议

1. **Private boundary**：`.dsh-intelligence/private-evals/**` 不参与 retrieval、snapshot source collection、知识晋升；Architect Skill 不读取。
2. **Paired identity**：baseline/full 必须同一 `task_id + prompt_hash + model + temperature + max_tokens + seed(可用时)`，否则该对 trial 无效。
3. **Baseline 真的是 baseline**：baseline 不注入 Contract Kernel / Pattern / Retriever / ADP workflow；full 才启用。否则比较的是两个不同 prompt，而非系统增益。
4. **Fail closed**：缺 task、id 不一致、prompt hash 不一致、模型执行失败、缺 rubric、缺必需 metrics —— 任一发生，整对标 `INVALID`，**绝不按 0 finding 算优秀**。
5. **Raw output immutable**：模型原始回答先按 hash 落盘，再 `normalized findings → score`；后续改 scorer 无需重跑模型。
6. **禁止 eval → knowledge 自动晋升**：private holdout 是测试集。失败只能 `failure → candidate lesson`，不能 `failure → Pattern validated`，防止测试集污染训练知识。

## 第一轮建议（8–12 题）

- 2 × seam placement、2 × state ownership/durability、2 × model-visible/event semantics、1 × Settings vs domain state、1 × Preset vs global service、1 × compose vs invent、1 × repo-tool vs runtime plugin。
- 至少 2 题设计成「看似该 invent、其实 reuse/compose」；再 2 题确实该 invent——测的是理解架构，而不是机械执行「别造新东西」。

## 第一轮指标

- 主看：`Architecture Blocking Findings ↓`、`Unsupported Invention Rate ↓`、`Hallucinated Symbol Rate ↓`、`Evidence Grounding Rate ↑`
- 次看：`Design Delta Rate`、`Seam Pass@1`、`Placement Pass@1`、`Token Cost`、`Latency`
