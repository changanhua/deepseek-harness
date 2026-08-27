# Evidence

`evidence/` 是 DSH Mastery Lab 的学习事实层，不是成功展示墙，也不是手工进度表。

进度只由 `CURRICULUM.yaml + evidence/**/*.yaml` 推导。这里同时保存成功、失败、误判和后续修正；失败记录不得删除。

## 文件命名

建议：

```text
YYYY-MM-DD__<unit-id>__<short-id>.yaml
```

同一天有多个 attempt 时，可加入时间或递增后缀。Runtime 按 `recorded_at + path` 排序；后来的 evidence 会覆盖同一 evidence item 的旧 outcome，但不会删除历史文件。

## V1 Schema

```yaml
version: 1
unit: trace-real-request
capabilities:
  - source_navigation
  - request_tracing
recorded_at: 2026-08-27T13:30:00+08:00

# 涉及当前源码事实的训练必须固定来源版本。
source:
  repository: changanhua/deepseek-harness
  commit: 894fa35e5a3defe51c5615103e993efaa67680f8

attempt:
  prompt_or_task: |
    学习者实际面对的问题。
  prediction_before_reveal: |
    在读答案/完整实现前的判断。

observations:
  - claim: <观察到的事实>
    evidence: <file:symbol / line range / test / trace / commit>

verification:
  method: <test / source trace / runtime experiment / review>
  result: pass | partial | fail

# 机器判定 unit 是否完成的权威字段。
# key 必须来自 CURRICULUM.yaml 对应 unit.evidence。
evidence_items:
  source_trace_with_files_and_responsibilities: pass
  prediction_vs_actual_diff: partial

# capability 状态由这些可迁移能力证据推导。
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

## 推导语义

### Unit completion

一个 unit 只有在其 `CURRICULUM.yaml -> evidence` 列出的**每个 evidence item 的最新 outcome 都为 `pass`** 时才算完成。

因此：

- “读过 lesson”不会推进状态；
- `partial` 不等于完成；
- 后续 regression 可以把已经 pass 的 item 降回 partial/fail；
- correction 通过新增 evidence 恢复，不修改历史记录。

### Capability state

V1 `status` 使用保守规则：

- 没有行为证据：`insufficient evidence`
- 最新 evidence 为 fail：`weak`
- 有 pass/partial，但只在单一 unit 上证明：`partial`
- 至少在两个不同 unit / 任务中 pass：`strong`

这不是心理测量模型，只是为了防止“一道题答对就宣布掌握”。以后有真实样本后再升级评分。

## Case reveal guard

带有：

```yaml
reveal_policy: reconstruct_before_reading_existing_design
```

的 case，必须先产生一个**更早的 evidence 文件**：

```yaml
evidence_items:
  independent_design_before_reveal: pass
```

之后才能记录 `review_findings`、`redesigned_contract` 等 post-reveal evidence。`check` 会阻止把“看完答案后的复述”伪装成独立设计。

## Rules

1. `prediction_before_reveal` 是一等字段：没有它，很难判断是真正迁移还是看答案后的复述。
2. 涉及 `source_navigation` / `request_tracing` 的 evidence 必须记录 repository + commit。
3. `fail` 不删除；后续新增 correction evidence。
4. 不用一句“理解良好”代替具体行为证据。
5. 同一个 capability 应在多个不同任务上出现，才能支持稳定 mastery 判断。
6. `evidence_items` 决定 unit completion；`assessment.demonstrated` 决定 capability 状态，二者不要混用。
7. Evidence 的目标是支持诊断和路由，而不是制造漂亮的完成率。
