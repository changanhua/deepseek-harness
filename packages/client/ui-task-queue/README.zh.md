# Client UI Task Queue

Queue 模块的浏览器面：侧栏的一级 Queue 导航入口（带实时状态徽标），以及位于
中心列、基于 taskQueue Remote 的 Queue 工作区。

工作区（设计 §4）一屏回答四个问题：服务是否健康、正在运行什么、什么需要人
处理、所选任务产出了什么。默认视图展示服务状态与容量、状态筛选与搜索、任务
列表和所选任务详情；内部字段（receipt、运行 pid、command fingerprint）保留在
显式的 Diagnostics 展开之后。

## 壳层契约

- `sidebar.modules` —— 导航入口（`id: queue-module`），注册进侧栏壳位于会话
  区域与底脚之间的模块座位。徽标由 store 的 stats 推导（`N running`、
  `N failed`、`faulted` 或 `idle`）。
- `shell.view` —— 中心列模块视图（`id: queue`），当 `queue` 模块激活时由框架
  的模块环渲染。会话保持在下方挂载，切回时状态不丢。

## 数据流

一个 `QueueStore`（snapshot/subscribe）同时服务两个入口。它读取
`ctx.remote.taskQueue`（stats 与 list 并行），通过 `get` 选择任务详情，并且
每次变更（`cancel` / `retry` / `pause` / `resume`）成功后都先向宿主重新读取
再更新快照 —— 视图从不编造后端未确认的状态。5 秒轮询让徽标保持实时；工作区
挂载时刷新并提供手动刷新。每次写操作都通过 aria-live 区域报告 进行中 →
成功/失败。

## 已知限制

- 尚未转发 `task-queue/*` 事件：在这些事件加入 remote 白名单之前，轮询是刷新
  的底线。
- 容量读数只显示实时计数（`N running · M starting`），没有分母：
  `QueueStats` 不暴露 `maxConcurrent`，界面绝不凭空发明一个。
