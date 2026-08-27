# @deepseek-ai/dsh-image-generation-task-queue

[English](README.md) | 中文

Queue v2 `image.generate@1` WorkHandler。准入阶段在持久化前解析图片 provider 事实；派发阶段生成图片，并在报告成功前通过 `ctx.attachments` 保存并返回持久 attachment 引用。

## 调度

每个 attempt 申领一个 `image-generation` 资源单位。部署容量与 Queue 批次限制共同决定并行度。`maxAttempts` 默认为 `1`，由 handler 的 Cordis 配置在准入前提供。

## 模型体验

间接通过拥有图片准入 schema 与结果渲染的 `@deepseek-ai/dsh-tool-image-generation-task-queue` 产生影响。

#### KV Cache 影响

不直接失效；模型可见变更由上述工具持有。

## 已知限制与延后工作

- 一个 WorkItem 表示一个提示词与一个 resolved provider 请求。
- Provider 失败保留类别、副作用与重试证据；是否允许重试由 Queue 策略决定。
