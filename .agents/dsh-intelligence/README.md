# DSH Architecture Intelligence（V0）

仓库级架构质量控制与学习数据生产系统。设计见 [`docs/dsh-post-training-system-design.md`](../../docs/dsh-post-training-system-design.md)（新版要求系统自身也必须符合 DSH）。

**定位：repo-tool**。本系统只拥有可审查知识（`.agents/dsh-intelligence/`）、命令（`scripts/dsh-intelligence/`）与可重建运行产物（`.dsh-intelligence/`）；不注册 Cordis Service，不拥有 Agent、Session、Tool、LLM 或运行时事件域。落点由 [`self-adp.yaml`](./self-adp.yaml) 固定（`implementation_kind: repo-tool`、`seam_disposition: none`）。

## 目录

- `contract-kernel/kernel.yaml` — C01…C12 常驻规则（≤1,200 tokens）
- `contract-kernel/sources.yaml` — 来源指针（origin/artifact_kind/lifecycle 三正交）
- `schemas/` — Evidence Capsule / ADP / Implementer handoff JSON Schema
- `contract-index/` — 仓库规则与生成目录的指针 + digest（不复制 API prose）
- `knowledge/` — patterns / anti-patterns / cases / candidates / deprecated
- `retrieval/` — task-taxonomy、routing-policy、token-budgets
- `evals/` — rubrics 与 visible-tasks（holdout 放 `.dsh-intelligence/private-evals/`，永不入索引）
- `self-adp.yaml` — 本系统自用 ADP

## 命令（`tsx scripts/dsh-intelligence/*.ts`）

| 命令 | 作用 |
|---|---|
| `snapshot.ts [--out <file>]` | Target Lock + 静态事实（git + catalog digest），生成后自校验 evidence schema |
| `validate-adp.ts <adp.yaml>` | schema + 8 条硬检查 + 6 条 placement 校验；`--evidence <file>` 校验 Evidence Capsule |
| `retrieve.ts <query> [--kind=...]` | 词法检索知识种子，遵守 token 预算，只返回 pointer + 摘要 |
| `propose-candidate.ts <run-id> --kind=...` | 从 Run 产物生成 candidate（只 propose） |
| `promote.ts <candidate> --approver <who>` | 显式授权晋升（Pattern ≥2 verified Case 等条件） |
| `run-eval.ts --baseline <json> --full <json>` | paired trial：weighted blocking finding score、placement blockers、≥3/4 通过判断 |

## 校验

```sh
npx vitest run scripts/dsh-intelligence          # 23 项测试
npx tsx scripts/dsh-intelligence/validate-adp.ts .agents/dsh-intelligence/self-adp.yaml   # 期望 PASS
```

## 关键不变量

1. `dsh_placement` 先于包/service 设计；出现 DSH 概念重定义立即停止。
2. 模型只 `propose`，不 `promote`；promotion 必须显式授权。
3. 检索结果是候选，不是事实；知识库不能充当运行时探针。
4. 未通过验证切片时只改 schema / Kernel / 硬检查，不扩建 Case Library。
