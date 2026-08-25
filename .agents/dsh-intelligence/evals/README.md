# Evals（private-holdout 实验台）

这里定义 **Paired Eval 基础设施**，不是知识库，也不放 holdout 答案。

## 核心原则

> 同一个弱模型、同一道陌生题，只改变「有没有 Architecture Intelligence」，然后让不可见 rubric 独立判卷。

这是 Phase 0 第一次真正意义上的**因果验证**。

## Prompt / Rubric 分离（铁律）

| 面 | 文件 | 谁能读 |
|---|---|---|
| 模型面 | `<id>.prompt.yaml`（`id` / `category` / `prompt`） | **只有被评测的模型** |
| 判卷面 | `<id>.rubric.yaml`（`id` / `category` / `rubric`） | **只有 Evaluator** |

**绝不允许** `expected_design` / `baseline_trap` 等答案字段出现在模型可见的 prompt 中。
两个面各有独立 schema（`holdout-prompt.schema.json` / `holdout-rubric.schema.json`），加载器在读取时**真执行** schema 校验：
`additionalProperties:false` 从结构上拒绝任何 schema 未列出的字段，答案字段一旦混入 prompt 即被判为任务加载失败。

## 目录边界

```text
# committed —— 基础设施，不含 holdout 内容
.agents/dsh-intelligence/evals/     README + holdout-prompt / holdout-rubric / trial-result / scoring schema
scripts/dsh-intelligence/           run-eval.ts / run-eval.spec.ts / prepare-private-eval.ts

# gitignored，永不提交
.dsh-intelligence/private-evals/
├── tasks/
│   ├── manifest.yaml         套件清单：suite_id + 任务全集（evaluator 只按它枚举）
│   ├── <id>.prompt.yaml      模型面
│   └── <id>.rubric.yaml      判卷面
└── runs/<run-id>/
    ├── manifest.json         run 元数据（run_id / created_at / identity）
    ├── baseline/             baseline 的 <id>.raw.txt（模型原始输出）+ <id>.json（arm 记录）
    ├── intelligence/         intelligence 的 <id>.raw.txt + <id>.json
    └── comparison.json       结果输出
```

## 七个锁定协议

1. **Private boundary**：`.dsh-intelligence/private-evals/**` 不参与 retrieval、snapshot source collection、知识晋升；Architect Skill 不读取。
2. **Paired identity**：baseline/full 必须同一 `task_id + prompt_hash + model + temperature + max_tokens + seed(可用时)`，否则该对 trial 无效。
3. **Baseline 真的是 baseline**：baseline 的 `system` 必须是 `baseline-no-intelligence`、intelligence 必须是 `full-intelligence`，硬校验，否则整对 `INVALID`——这是实验的因果变量。
4. **Fail closed**：任务全集由 `tasks/manifest.yaml` 锁定。manifest 里的任务缺 prompt / 缺 rubric / schema 失败 / id 不一致，全部显式判 `INVALID`，**绝不静默跳过**；目录里 manifest 之外的多余任务报 warning；一个 VALID trial 都没有时套件失败并以非零码退出。
5. **Raw output immutable**：模型原始输出写入 `<id>.raw.txt`，arm 记录 `raw_output_ref` 与 `sha256:<64hex>` 声明 hash。运行时重读 raw 文件计算 sha256，与声明 hash 不符或文件缺失 → `INVALID`。后续改 scorer 无需重跑模型。
6. **禁止 eval → knowledge 自动晋升**：private holdout 是测试集。失败只能 `failure → candidate lesson`，不能 `failure → Pattern validated`，防止测试集污染训练知识。
7. **Evaluator provenance**：arm 必须记录 `evaluator_type` / `evaluator_model(可选)` / `evaluator_prompt_hash` / `rubric_hash` / `source_output_hash` / `evaluator_version` / `normalized_findings_hash`。运行时校验：`source_output_hash` 必须等于 `raw_output_hash`（findings 确实来自这份 raw）；`normalized_findings_hash` 必须等于 findings 序列化的 sha256（findings 未被篡改）；`rubric_hash` 必须等于任务 rubric 文件内容的 sha256（判卷用的 rubric 就是当前任务文件）。证据链：`raw output → evaluator + rubric → normalized findings → score`。

## 指标语义

- 四主指标先记**原始计数**：`architecture_blocking_findings`（P0 findings 数）、`unsupported_inventions`、`hallucinated_symbols`；**不**对全部 findings 做 rate 归一化。
- `evidence_grounding_rate = 有证据支持的 required claims / rubric 的 expected_properties 数`。Evaluator 必须对每个 `expected_property` 显式判定并产出一条 finding（`evidence.grounded` 表示有证据、`evidence.gap` / `evidence.ungrounded` 表示无证据）；未判定的 claim 按未 grounded 计（fail closed），`expected_properties` 为空时视为全 grounded。
- `evidence.grounded` / `evidence.gap` / `evidence.ungrounded` 是正面或中性的判卷记录，用非 P0 severity 标注，避免污染 `architecture_blocking_findings` 的计数。
- comparison 的 `verdict` 由 blocking / unsupported / hallucinated 计数下降与 grounding 率上升的加权和决定。

## 第一轮建议（8–12 题）

- 2 × seam placement、2 × state ownership/durability、2 × model-visible/event semantics、1 × Settings vs domain state、1 × Preset vs global service、1 × compose vs invent、1 × repo-tool vs runtime plugin。
- 至少 2 题设计成「看似该 invent、其实 reuse/compose」；再 2 题确实该 invent——测的是理解架构，而不是机械执行「别造新东西」。

## 第一轮指标

- 主看：`Architecture Blocking Findings ↓`、`Unsupported Inventions ↓`、`Hallucinated Symbols ↓`、`Evidence Grounding Rate ↑`
- 次看：`Design Delta Rate`、`Seam Pass@1`、`Placement Pass@1`、`Token Cost`、`Latency`
