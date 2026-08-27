# Learning Runtime Tooling

目标是让学习状态由机器推导，而不是由人维护 Markdown checklist。

V1 只有一个 CLI：

```bash
pnpm exec tsx learning/dsh-mastery/tooling/dsh-mastery.ts check
pnpm exec tsx learning/dsh-mastery/tooling/dsh-mastery.ts status
pnpm exec tsx learning/dsh-mastery/tooling/dsh-mastery.ts next
```

三个命令都支持 `--json`：

```bash
pnpm exec tsx learning/dsh-mastery/tooling/dsh-mastery.ts check --json
pnpm exec tsx learning/dsh-mastery/tooling/dsh-mastery.ts status --json
pnpm exec tsx learning/dsh-mastery/tooling/dsh-mastery.ts next --json
```

人类终端默认读文本；Agent / 自动化应优先读 JSON，避免解析自然语言。

CLI 不写任何隐藏状态；每次运行都重新读取：

```text
CURRICULUM.yaml
+
evidence/**/*.yaml
```

## `check`

验证学习 Runtime 本身有没有结构性错误：

- `CURRICULUM.yaml` 引用的 unit path 是否存在；
- unit id 是否唯一；
- capability / prerequisite / routing id 是否有效；
- prerequisite 是否形成合法 DAG；
- evidence 的 unit/capability/evidence-item id 是否有效；
- source-grounded evidence 是否固定 repository + commit；
- case study 是否在 independent reconstruction evidence 前被提前 reveal；
- `PROGRESS.md` / `progress.yaml` 等第二个手工进度库是否重新出现。

JSON 形状：

```json
{
  "ok": true,
  "issues": []
}
```

CI/Agent 修改学习系统后应先跑它。

## `status`

从 evidence 推导：

- unit completion；
- capability state；
- 支撑 capability 判断的 evidence 文件。

文本示意：

```text
DSH Mastery Lab: 2/12 units complete

state_ownership          strong [evidence/...yaml, evidence/...yaml]
source_navigation        partial [evidence/...yaml]
cordis_lifecycle         insufficient evidence
```

JSON 还会返回每个 unit 的 `complete / attempts / evidenceItems`，适合 Agent 做下一步规划。

V1 的 `strong` 刻意保守：至少需要两个不同 unit / 任务上的 pass，避免把“刚学会复述”当成迁移能力。

## `next`

按 `routing.default_path` 与 prerequisite 计算下一训练单元。

规则：

1. 已完成 unit 跳过；
2. 被 prerequisite 阻塞时，返回最早未完成的 prerequisite；
3. 已经尝试但 evidence 为 partial/fail 的 unit 优先继续修正；
4. 输出仍缺的 evidence item，而不是只说“继续第几课”。

文本示意：

```text
trace-real-request -> labs/02-request-trace.md
reason: earliest ready unit on the default path
evidence needed: source_trace_with_files_and_responsibilities, prediction_vs_actual_diff
```

JSON 会同时返回 unit `id/type/path/trains/prerequisites/reason/unmetEvidence`，因此 Teacher Agent 可以直接加载对应文件。

## Tests

核心推导规则接入仓库现有 Vitest discovery（`scripts/**/*.spec.ts`），不另造测试系统：

```bash
pnpm exec vitest run scripts/dsh-mastery.spec.ts
```

覆盖：

- 当前真实 `learning/dsh-mastery/` 自检必须为零错误；
- prerequisite routing；
- source pin；
- case reveal guard；
- 跨任务 mastery；
- 禁止第二进度库。

## Design boundary

V1 不做：

- Web UI；
- 数据库；
- LLM 自动打分；
- 自动修改 evidence；
- 复杂推荐模型。

原因是先让**状态协议和证据语义稳定**。未来 `status/next/check` 可以换实现，但不能再引入一个与 Git evidence 并行的权威状态源。
