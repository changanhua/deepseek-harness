# Evidence

`evidence/` 是 DSH Mastery Lab 的学习事实层，不是成功展示墙。

进度由 `CURRICULUM.yaml + evidence/` 推导。这里同时保存成功、失败、误判和后续修正。

## 文件命名

建议：

```text
YYYY-MM-DD__<unit-id>__<short-id>.yaml
```

## 最小 Schema

```yaml
version: 1
unit: trace-real-request
capabilities:
  - source_navigation
  - request_tracing
recorded_at: 2026-08-27
source:
  repository: changanhua/deepseek-harness
  commit: <sha>

attempt:
  prompt_or_task: |
    学习者实际面对的问题。
  prediction_before_reveal: |
    在读答案/完整实现前的判断。

observations:
  - claim: <观察到的事实>
    evidence: <file:line / test / trace / commit>

verification:
  method: <test / source trace / runtime experiment / review>
  result: pass | partial | fail

assessment:
  strengths: []
  misconceptions: []
  demonstrated:
    source_navigation: partial
    request_tracing: pass
  routing:
    ready_for: []
    revisit: []

artifacts:
  commits: []
  files: []
  prs: []
```

## Rules

1. `prediction_before_reveal` 很重要：没有它，很难判断是真正迁移还是看答案后的复述。
2. 实现级 evidence 尽量记录 DSH commit。
3. `fail` 不删除；后续新增 correction evidence。
4. 不用一句“理解良好”代替具体行为证据。
5. 同一个 capability 应在多个不同任务上出现，才能支持稳定 mastery 判断。
6. Evidence 的目标是支持诊断和路由，而不是制造漂亮的完成率。
