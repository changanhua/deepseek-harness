# Agent Note: 受限 DSH 任务队列执行器

Status: implemented

[English](2026-08-26-task-queue-dsh-executor.md) | 中文

## Problem

持久任务队列可以运行本地脚本和外部 coding-agent CLI，却无法通过自身插件组合执行真实 Harness worker。若直接复用普通 headless profile 且不添加最终限制，后台子进程还会暴露递归 queue、goal、subagent、workflow 与 shell 表层。把产物目录同时当作 checkout 会混淆就地修改与结果收集，而在任务快照中保存无界 stdout 又会重复 run log 已持有的数据。

## Decision

`@deepseek-ai/dsh-task-queue-executor-dsh` 是 `executor: dsh` 的 Service Provider。它通过 `ctx.effect()` 注册适配器，并把子进程 ownership、重试、超时、取消、结算与 run log 持久性留在 `@deepseek-ai/dsh-task-queue-local`。基础组合包启用 `dsh` 准入，并在队列服务后恰好挂载一个提供方。

自动初始化的 `task-worker` profile 使用 base 加 headless。每次 DSH 任务启动都会在 profile 与 home 层之后添加包自有的限制 patch，因此持久用户配置无法重新启用 shell/job、递归任务提交、goal、subagent/Ralph、workflow、HMR 或交互式权限预设表层。子进程使用以显式 `workspaceDir` 为根的 `workspace-write` sandbox 策略；`outputDir` 仍是独立产物目录。缺少 `workspaceDir` 的旧记录会在物化时沿用 `outputDir`。

提供方会显式转发 harness home，但不会转发凭据值。subprocess 服务仍会清理环境，worker 从 harness home 的凭据文档解析受管凭据。成功退出时，适配器会去除尾部换行，并把最多 `maxAssistantBytes` 个 UTF-8 stdout 字节存为 `TaskResult.assistantText`，且不会截断半个码点。summary 是绝不回显模型输出的固定文本；完整 stdout 与 stderr 保留在 run log 中。空 stdout 不带 `assistantText`，失败的 attempt 也绝不会进入语义规范化。

## Alternatives considered

**直接运行普通 `headless` profile。** 否决，因为 home 与 profile patch 可能保留递归编排与 shell 工具，使排队子进程能够扩大自身权限或递归入队工作。

**让 `outputDir` 同时承担 checkout 与产物根目录。** 否决，因为执行器需要显式的既有 workspace，而队列需要可独立扫描的结果目录。混用会把任意 checkout 文件报告成任务产物。

**把完整 worker stdout 持久化为 `assistantText`。** 否决，因为 run log 已持有完整进程证据。任务快照只承载带稳定 summary 的有界语义投影。

**任务结算时自动派发工作或恢复 owner goal。** 暂缓。显式入队加持久 owner 通知是 P1 执行纵向切片；自主选择与持久 continuation 需要另行决定授权、唤醒与 session lease。

## Testing

聚焦适配器测试固定经过验证的启动器配置、最终 overlay 位置、显式环境值、workspace 与产物目录创建、effect dispose、空输出，以及多字节安全的结果上限。调度器与组合测试固定延迟适配器注册、`task-worker` 初始化及一个基础组合包提供方。真实进程 E2E 会让已构建 DSH CLI 连接 mock LLM server，检查实际模型请求中存在任务 capsule 且不存在递归或 shell 工具，并验证持久语义结果与 run log。

## Consequences

Agent 可以针对既有 workspace 显式入队持久 DSH coding 任务，之后消费有界语义答案与产物，而无需授予子进程递归编排或 shell 执行能力。这不会增加自动派发、持久 goal continuation 或多宿主 ownership；这些能力仍是独立的后续决策。
