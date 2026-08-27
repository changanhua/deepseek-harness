# Task Queue Remote

[English](README.md) | 中文

Queue v2 operator facade 的宿主 Remote。生成的浏览器命名空间是 `ctx.remote.taskQueue`；Cordis 服务键保持为 `taskQueueRemote`，避免与 Queue provider 冲突。

## Remote 方法

- `snapshot(input)` 通过一次 operator 读取返回聚合状态计数、有限 WorkItem 行与可选的所选详情。每行都包含四状态 operator 投影（`queued`、`running`、`attention`、`done`）和已结束时的 outcome。未传 limit 时也能接受空 Queue。
- `cancel(id)` 请求取消一个 WorkItem。
- `retry(id)` 重试一个失败 WorkItem。
- `resolveUnknown(id, resolution)` 对 unknown attempt 应用受限 operator 决定。浏览器输入可以授权另一次 Attempt或确认失败；不能 reconcile 实时 ownership，也不能提供未经验证的成功 result。
- `pause()` 与 `resume()` 控制派发，但不禁用准入或 operator 操作。

`./views` 导出拥有 JSON-compatible 浏览器类型：`QueueWorkSummaryView`、`QueueWorkAttemptView`、`QueueWorkView`、`QueueStatsView`、`QueueSnapshotInput`、`QueueSnapshotView` 与 `QueueUnknownResolutionInput`。结果 output 在跨越 Remote transport 前会经过 canonicalize。

## 消费方

- `@deepseek-ai/dsh-client-ui-task-queue` 渲染 Queue 工作台。
- `@deepseek-ai/dsh-api-remotes` 挂载生成的 Remote contribution。

## Model Experience

None, as 此浏览器 Remote 传输 Queue 记录且不注册模型界面。

#### KV Cache effect

无；本包从不组装模型输入。

## 已知限制与延后工作

- Remote 暴露 operator 读取、取消、重试、unknown resolution 与派发暂停控制；准入保留在类型化宿主和模型工具入口。
- 批量 UI 操作目前为每个 WorkItem 发送一次 Remote mutation，并在最后刷新一次。
