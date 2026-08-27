# Agent Note: 受限 DSH 任务队列执行器

Status: implemented

[English](2026-08-26-task-queue-dsh-executor.md) | 中文

## Problem

持久任务队列需要通过自身插件组合执行真实 Harness worker，但不能把宿主运行拓扑暴露为每个业务任务的字段。若直接复用普通 headless profile 且不添加最终限制，后台子进程还会暴露递归 queue、goal、subagent、workflow 与后台进程表层；若彻底移除前台执行，CLI 型 Skill 虽然可见却无法使用。Queue 核心也不应为通用 worker 虚构一个路径型产物写入能力或保存无界 stdout。

## Decision

`@deepseek-ai/dsh-task-queue-executor-dsh` 提供 `agent.run@1` 的 `WorkHandler`。它通过 `ctx.effect()` 注册 handler；`@deepseek-ai/dsh-task-queue-local` 持有持久准入、Attempt、重试、取消、结算、恢复、关闭与资源调度，`ctx.subprocess` 持有实时进程树。当前包拆分由 [Queue v2 ownership 决策](../architecture/2026-08-27-queue-v2-reuse-boundaries.zh.md) 持有。

WorkKind 专属的 `@deepseek-ai/dsh-tool-agent-run-task-queue` Consumer 持有 `task_queue_enqueue` 与 `task_queue_enqueue_batch`。它们的 schema 接受标题、提示词、幂等键和 Batch 并发上限，不暴露 executor、profile、model、credential 或 shell 字段。通用 Queue Consumer 保持 WorkKind 无关，并持有结果读取和 owner Notification 投递。

自动初始化的 `task-worker` profile 使用 base 加 headless。每次 DSH 任务启动都会在 profile 与 home 层之后添加包自有的限制 patch。最终层保留当前平台的一次性前台 shell 工具，移除后台执行，并禁用 Job、所有 Queue Consumer 与 Provider、Goal、Subagent/Ralph、Workflow、HMR 与交互式权限预设表层。这样，文件系统发现的 Skill 可以调用所需 CLI，同时不会获得递归编排或后台进程 ownership。子进程使用以准入 `workspaceDir` 为根的 `workspace-write` sandbox 策略。若部署共享默认模型引用可选 Provider 路由，必须在 `task-worker` profile 安装该 Provider bundle；worker 不复制凭据，也不改写全局模型选择。

提供方会显式转发 harness home，但不会转发凭据值。subprocess 服务仍会清理环境，worker 从 harness home 的凭据文档解析受管凭据。成功退出时，handler 会去除尾部换行，并把最多 `maxAssistantBytes` 个 UTF-8 stdout 字节存为 `AgentRunOutput.assistantText`，且不会截断半个码点。summary 是绝不回显模型输出的固定文本；失败退出只在结构化失败中保留配置的最新 stderr 尾部；空 stdout 不带 `assistantText`。

## Alternatives considered

**要求每个任务指定 executor。** 否决，因为 executor 名称描述宿主进程拓扑，而不是业务意图。这会迫使普通用户与提交任务的模型理解部署接线，并诱导每种业务能力各造一个适配器。

**通过 `agent.run@1` 路由 typed 图片生成。** 否决，因为 Provider 发现、图片资源 claim、Batch 并发和 Attachment-backed 输出属于专用 `image.generate@1` WorkKind，而不是不透明的 worker transcript。

**直接运行普通 `headless` profile。** 否决，因为 home 与 profile patch 可能保留递归编排与后台 job，使排队子进程能够扩大自身权限或递归入队工作。

**彻底移除 worker 的 shell。** 否决，因为文件系统发现的 CLI 型 Skill 会保持模型可见，却无法完成其声明的动作。现有 workspace sandbox 下的前台执行是这些 Skill 所需的最窄能力；后台 job 仍被禁用。

**向 worker 暴露 Queue 本地 output 目录。** 否决，因为 `agent.run@1` 返回有界 typed JSON，Queue 核心没有通用路径写入器。未来的 byte-exact 文件 Consumer 必须另行证明 Artifact capability 的必要性。

**把完整 worker stdout 持久化为 `assistantText`。** 否决，因为 WorkResult 只承载带稳定 summary 的有界语义投影，失败诊断也只保留配置的尾部。

**任务结算时恢复 owner goal。** 暂缓。持久 continuation 需要另行决定授权、唤醒与 session lease。

## Testing

聚焦测试固定仅含意图的 WorkKind 准入、经过验证的启动器配置、最终 overlay 位置、仅前台 shell 配置、显式环境值、workspace 准备、effect dispose、空输出、失败尾部保留，以及多字节安全的结果上限。调度器与组合测试固定延迟 handler 注册和 `task-worker` 初始化。真实 Queue 垂直验证成功的受限 worker 结果、稳定 owner Notification、确认前 Session flush，以及显式 `task_queue_result` 读取。

## Consequences

Agent 提交持久 `agent.run@1` 意图时无需了解或填写运行拓扑。宿主会把任务路由到受限 DSH worker；该 worker 可以使用已安装的 CLI 型 Skill，同时递归编排与后台 Job 仍不可用。更宽的前台命令表层由现有 workspace sandbox 约束。这不会增加持久 Goal continuation 或多宿主 ownership；这些能力仍是独立的后续决策。
