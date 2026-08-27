# @deepseek-ai/dsh-tool-image-generation-task-queue

[English](README.md) | 中文

面向 Agent 的 Queue v2 `image.generate@1` 准入工具。`image_generate_enqueue` 提交一个完整提示词和 provider 支持的输出设置。`image_generate_enqueue_batch` 使用一个正数 `maxParallel` 上限，原子提交有序且具有独立标题的完整提示词。两个工具都从当前 Session 派生 owner 权限，并由 host 持有 provider 执行控制。

## 模型体验

间接通过 `image_generate_enqueue` 与 `image_generate_enqueue_batch` 工具 schema 及其渲染的 Queue id 产生影响。

#### KV Cache 影响

挂载或移除此插件时，工具 schema 会改变可复用的请求前缀。

## 已知限制与延后工作

- Batch 准入要求调用前已完成每条提示词和输出设置。
- 调用方必须提供实时 Agent 会话，且不能选择 Queue 执行内部参数。
