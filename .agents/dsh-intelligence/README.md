# DSH Architecture Intelligence（V0）

仓库级架构质量控制与学习数据生产系统。设计见 [`docs/dsh-post-training-system-design.md`](../../docs/dsh-post-training-system-design.md)。

**定位：repo-tool**。本系统只拥有可审查知识（`.agents/dsh-intelligence/`）、命令（`scripts/dsh-intelligence/`）与可重建运行产物（`.dsh-intelligence/`）；不注册 Cordis Service，不拥有 Agent、Session、Tool、LLM 或运行时事件域。落点由 [`self-adp.yaml`](./self-adp.yaml) 固定。

## 目录

- `contract-kernel/kernel.yaml` — C01…C12 常驻规则（≤1,200 tokens）
- `contract-kernel/sources.yaml` — 来源指针（origin/artifact_kind/lifecycle 三正交）
- `schemas/` — Evidence Capsule / ADP / Implementer handoff JSON Schema
- `contract-index/` — 仓库规则与生成目录的指针 + digest（不复制 API prose）
- `knowledge/` — patterns / anti-patterns / cases / candidates / deprecated
- `retrieval/` — task-taxonomy、routing-policy、token-budgets
- `evals/visible-tasks/` — **公开回归题**，包含 expected design，因此绝不是 holdout
- `.dsh-intelligence/private-evals/` — 本地正式 holdout；被 `.gitignore` 排除，不进入知识索引
- `self-adp.yaml` — 本系统自用 ADP

## 命令（`tsx scripts/dsh-intelligence/*.ts`）

| 命令 | 作用 |
|---|---|
| `snapshot.ts [--profile <name>] [--host-scope <scope>] [--out <file>]` | Target Lock + 静态事实；文件/目录生成物都做确定性 SHA-256 |
| `validate-adp.ts <adp.yaml> [--evidence <evidence.json>]` | schema + Kernel + placement + Evidence binding；Evidence ID 统一为 `evidence:<revision-prefix>` |
| `retrieve.ts <query> [--kind=...] [--include-candidates]` | 默认只检索 validated/current/verified；candidate 必须显式研究模式 |
| `propose-candidate.ts <run-id> --kind=...` | 从 Run 产物生成 candidate（只 propose） |
| `promote.ts <candidate> --approver <who>` | 显式授权 + 类型化证据门槛后才晋升；approver 本身不能绕过证据要求 |
| `run-eval.ts --baseline <json> --full <json> [--tasks-dir <dir>]` | fail-closed paired trial：任务集必须完整配对，duration 缺失不能通过成本门槛 |

## 校验

```sh
npx vitest run scripts/dsh-intelligence
npx tsx scripts/dsh-intelligence/validate-adp.ts .agents/dsh-intelligence/self-adp.yaml
```

真实 Architect 流程应额外执行：

```sh
npx tsx scripts/dsh-intelligence/snapshot.ts --profile web --out .dsh-intelligence/evidence.json
npx tsx scripts/dsh-intelligence/validate-adp.ts .dsh-intelligence/runs/<run-id>/adp.yaml --evidence .dsh-intelligence/evidence.json
```

## 关键不变量

1. `dsh_placement` 先于包/service 设计；出现 DSH 概念重定义立即停止。
2. Evidence Capsule 与 ADP 必须真实绑定，不能手写一个看似合法的 capsule ID 绕过 Target Lock。
3. 模型只 `propose`，不 `promote`；promotion 同时要求显式授权与证据先决条件。
4. 正常检索不加载 candidate；检索结果是候选，不是运行事实。
5. 公开 regression suite 与私有 holdout 分离；缺失 paired output / duration 一律 fail closed。
6. 未通过验证切片时只改 schema / Kernel / 硬检查，不扩建 Case Library。
