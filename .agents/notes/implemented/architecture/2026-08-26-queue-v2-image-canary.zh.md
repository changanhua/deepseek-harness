# Agent Note: Queue v2 image canary

Status: implemented

[English](2026-08-26-queue-v2-image-canary.md) | 中文

## Problem

持久任务队列把通用 worker 路由、生命周期状态、provider discovery 与结果文件混在同一个 `Task` 记录中。它无法在生图副作用开始前保存带类型图片请求的已解析 Agent Plan 事实，也无法安全地让图片字节具有由 attempt 持有的持久身份。

## Decision

Queue v2 在独立、带 schema version 的根目录下保存不可变的 `WorkItem` intent 与 resolved facts、事件派生状态和原子 `ChangeSet` 记录。本地 provider 只串行 durable mutation，`WorkHandler.resolveAdmission()` 与 `prepare()` 留在 FIFO 外。handler 声明资源，local configuration 提供容量。live handler 在 `start()` 同步返回 ownership。[Queue v2 ownership 决定](2026-08-27-queue-v2-reuse-boundaries.zh.md)把持久图片字节交给 `ctx.attachments`，而不是 Queue-owned artifact writer。

`image.generate@1` 在 admission 解析图片 provider、model、输出设置和 prompt。它的 start 阶段通过 `ctx.imageGeneration` 消费这些保存的事实，经 `ctx.attachments` 保存返回图片，并在 typed result 中持久化 `ImageAttachmentRef`。单项与 Batch 图片准入工具从 live Session 签发 Agent authority，不能选择 Queue execution internals。

shipped composition 把当前记录格式保存在 `$DSH_HOME/task-queue-v3`，manifest schema 为 3。不兼容的记录变更使用新的 manifest 版本与根目录；provider 会保留并拒绝早期 root，而不是推断缺失的 durable facts。

## Alternatives considered

**把图片保留在通用 DSH executor 后面。** 拒绝，因为 provider discovery 和图片结果归属会发生在不透明的 worker run 中，既没有 durable resolved facts，也没有由 attempt 持有的图片 reference。

**让 handler 自己选择并发度。** 拒绝，因为多个 handler 无法作出 deployment-wide capacity 决定；handler 声明需求，本地 provider 负责允许使用可用容量。

**直接把生成文件写进 output directory。** 拒绝，因为 terminal result 可能指向未经验证的 host path，而不是经过授权、按内容寻址的 Attachment reference。

## Consequences

canary 增加独立 WorkKind package、本地持久 store 和图片准入工具。image handler 仍是带类型的 WorkKind，而不是通用 executor payload；通用 Queue tool 与 owner delivery 保持 WorkKind-independent。

## Testing

定点测试覆盖 ChangeSet fold、snapshot tail recovery、manifest version rejection、composed root selection、root ownership、handler execution、Attachment-backed result persistence、image handler 的 resolve/start 行为和十项 Batch concurrency。
