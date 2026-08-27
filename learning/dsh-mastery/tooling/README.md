# Learning Runtime Tooling

目标是让学习状态尽量由机器推导，而不是由人维护 Markdown checklist。

## Planned commands

### `next`

输入：`CURRICULUM.yaml + evidence/`

输出：推荐的下一训练单元及原因：

- unmet prerequisite；
- 最近失败 evidence；
- 当前工程任务可替代的训练机会；
- case reveal 是否已满足前置条件。

### `status`

从 evidence 推导 capability 状态，而不是读取手写完成表。

建议输出：

```text
state_ownership       strong
source_navigation     partial
cordis_lifecycle      weak
architecture_review   insufficient evidence
```

状态必须能回链到 evidence 文件。

### `check`

验证：

- `CURRICULUM.yaml` 引用的 unit path 是否存在；
- prerequisite 是否形成合法 DAG；
- evidence 的 unit/capability id 是否有效；
- source-grounded evidence 是否缺 commit/version；
- case study 是否在 independent reconstruction 前被提前 reveal；
- 不允许出现第二个 authoritative progress file。

## Non-goal

第一版不需要复杂 Web UI、数据库或学习推荐模型。先保证文件协议稳定，等真实 evidence 累积后再实现自动评分和路由。
