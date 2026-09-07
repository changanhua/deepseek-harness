# Agent Note: Queue operator 诊断与 Batch 操作

Status: implemented

[English](2026-09-07-queue-operator-diagnostics-and-batch-actions.md) | 中文

## Problem

operator 可以看出 work 正在 queued，却无法判断派发是否暂停、Handler 是否不可用或并发限制是否被占用。Remote 还保留第二份 pause flag；其他 host 入口暂停 Queue 时，两者会发生分叉。工作台只提供逐行操作，并把每个结构化 result 都渲染为 JSON tree。

## Decision

`OperatorWorkQueue.dispatchState()` 读取由 Provider 持有的进程状态。`waitReason()` 使用控制 claim 的相同 Handler、全局并发、Batch 并发与资源检查，为 queued WorkItem 派生一个瞬时解释。这些读取不会增加 durable status 或调度优先级。Remote 把它们复制到 browser-safe snapshot。

`WorkQueueStore` 会单独暂存每个已校验的 projection，并仅在 append 完成同步后发布。查询因此只会观察上一个 durable projection 或已提交的后继 projection。同步失败会令已打开的 store 进入 faulted 状态，并拒绝后续 mutation，直到重开和 recovery，确保完整写入但未同步的行不会在进程中可见，派发也不会跨越不确定的持久化边界继续运行。

工作台可以从选中的 WorkItem 聚焦一个 Batch。它复用现有的逐 WorkItem Remote mutation 来重试失败成员或取消未完成成员，在分组完成后刷新一次，并在取消运行中 work 前要求风险确认。Agent、operation 与 image result 使用小型 WorkKind 专属展示；格式错误的已知 result 与未知 result 形状仍使用 `JsonTree`。

## Alternatives considered

**持久化 blocked state 或等待原因。** 拒绝，因为 Handler 注册或容量释放时，原因可以在没有 durable Work transition 的情况下变化。它继续作为 durable state 上的运行时投影。

**让每个 Remote 记住 pause state。** 拒绝，因为命令与其他可信 host caller 可以暂停同一 Provider，而不经过该 Remote instance。

**在 Queue service 与 Remote 增加 Batch mutation method。** 拒绝，因为当前操作是复用既有授权与逐 WorkItem transition 的 operator 便利能力。client store 已经组合这些操作并报告部分失败，无需创建另一种 durable transaction contract。

**构建 schema-driven result renderer。** 拒绝，因为 Queue core 不持有 WorkKind presentation。少量已知 renderer 可改善当前任务，而 JSON fallback 能保留不熟悉的 output。

## Consequences

operator 可以区分容量等待、缺少 composition 与 store fault，并能在无需逐行选择的情况下操作一个 Batch。Batch 操作刻意不具备原子性：当某个成员发生竞争或失败时，其他成功的成员 transition 仍保持提交，工作台会在一次刷新后报告这些失败。Image result 会标识 durable Attachment，但不打开其字节；服务端分页与事件驱动的浏览器刷新仍属于独立工作。

## Testing

store 测试固定 publish-after-sync 顺序、同步失败后 fail-closed mutation，以及重开后的 replay。scheduler 与 Remote 测试固定由 Provider 持有的 running、paused、faulted 状态和 queued wait projection。client 测试固定可读的等待文案、Batch 聚焦、风险确认后的分组操作、一次刷新后的部分失败报告、已知 WorkKind result rendering、错误格式 result fallback，以及已有的串行刷新行为。browser 测试通过构建后的 Web 应用执行真实 staged-handler 等待与风险确认后的 Batch 取消。
