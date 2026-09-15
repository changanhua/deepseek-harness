# Client UI Task Queue

[English](README.md) | 中文

Queue v2 的浏览器工作台。一个共享 `QueueStore` 通过 `ctx.remote.taskQueue` snapshot 同时服务侧栏入口与中心列工作区。

## 壳层贡献

- `sidebar.modules` 注册 `queue-module`。徽标报告 failed/unknown attention、运行数量、暂停状态或 idle。
- `shell.view` 注册 `queue` 工作区，同时保留下层 conversation 的挂载状态。

## 工作区

工作台把耐久记录投影为四种 operator 状态——待执行、运行中、需处理和已结束——并把每个终态 outcome（已成功、已失败、已取消）保留在已结束状态内部。行按 operator 紧急度排序（需处理、运行中、待执行、已结束），再按更新时间排序；四个筛选（全部、进行中、需处理、已完成）统计每个投影。搜索对标题或 ID 大小写不敏感。

主从布局在紧凑任务列表旁展示一个结构化详情面板。选中一行会展示类型、owner、尝试进度与时间戳，以及当前失败、每次尝试和结果。刷新失败后，store 保留最后一次成功的行、详情与刷新时间戳，页面会在错误横幅旁如实标注它们。

动作限定在选中的行：待执行或运行中的任务可取消，失败任务可重试，需处理任务既可确认重试（需先显式勾选已知悉可能产生重复副作用）也可填写原因后确认失败。未知重试一律描述为“确认重试”，绝不说“安全重试”。成功反馈使用 toast；变更失败会保留在对应行旁边。

Store 通过一次 `snapshot()` 调用读取行、计数与可选详情。mutation 后会刷新，并使用一条串行的五秒轮询链，因此旧响应不能覆盖较新的读取结果。

## Model Experience

None, as 此浏览器工作台渲染 Queue 记录且不注册模型界面。

#### KV Cache effect

无；本包从不组装模型输入。

## 已知限制与延后工作

- 因 Queue 生命周期事件尚未转发到浏览器，刷新依赖轮询。
- Result output 通过 JSON tree 渲染；artifact 专属预览仍属延后工作。
- 不提供 `confirm-succeeded` 的结果编辑；UI 仅保留重试与确认失败。
- Batch 范围操作与服务端分页仍属延后工作，除非真实量级要求它们。
