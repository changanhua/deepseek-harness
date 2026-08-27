# @deepseek-ai/dsh-task-queue-executor-dsh

[English](README.md) | 中文

`agent.run@1` 的 WorkHandler Provider。它向 `ctx.taskQueue` 注册一个 handler；准入、派发、取消、结算与持久 `ChangeSet` 仍由本地队列后端持有。

## 执行

handler 在自动初始化的 `task-worker` profile 下启动当前 DSH argv，然后把 [`worker.cordis.patch.yml`](worker.cordis.patch.yml) 作为最终命令行 overlay 应用。它使用配置的 `workspaceDir` 作为子进程 `cwd`。

该提供方只向子进程传入 `DSH_HOME`、`DSH_PERMISSION_MODE=workspace-write` 与遥测退出值。环境中的 secret 仍由 subprocess 服务清理；子进程从 `$DSH_HOME/.credentials.yaml` 解析受管模型凭据。成功 stdout 会成为有界的 `AgentRunOutput.assistantText`，固定 summary 绝不回显 worker 输出。空 stdout 只产生 summary，不产生 `assistantText`；非零退出只在结构化失败中保留配置的最新 stderr 尾部，取消、prepare 失败与 spawn 失败遵循队列后端的普通失败策略。

## 限制 overlay

最终 overlay 保留基础 `workspace-write` sandbox 下的一次性前台 shell，让已安装 Skill 能调用所需 CLI；同时禁用后台进程 job、递归任务队列提交、goal、subagent 与 Ralph、工作流扇出、HMR，以及交互式权限预设表层。shell 工具会显式移除 `run_in_background`；由于 overlay 位于 profile 与 home patch 之后，worker 持久配置无法恢复已禁用的编排与后台表层。

## 配置

| key | 默认值 | 含义 |
|---|---|---|
| `launcher` | 必填 | 当前 DSH 启动器的非空 argv 前缀 |
| `dshHome` | 必填 | 转发给子进程的 harness home |
| `workspaceDir` | 必填 | worker 可写的既有工作目录 |
| `profile` | `task-worker` | 专用一次性 profile |
| `maxAssistantBytes` | `65536` | 作为语义文本持久化的最大 UTF-8 字节数 |
| `collectBytes` | `262144` | 每条输出流在 spill 前的内存收集上限 |
| `failureTailBytes` | `8192` | 非零退出失败中包含的最大 UTF-8 stderr 尾部 |
| `graceMs` | `5000` | 子进程终止升级前的宽限期 |
| `maxAttempts` | `3` | Queue 拒绝后续重试前允许的最大准入尝试次数 |

`maxAssistantBytes` 和 `failureTailBytes` 不得超过 `collectBytes`；字节上限必须是安全整数，UTF-8 截断绝不会持久化半个码点。非法配置会在插件加载时快速失败。

## 模型体验

通过 `@deepseek-ai/dsh-tool-agent-run-task-queue` 与 `@deepseek-ai/dsh-tool-task-queue` 间接呈现；前者持有准入，后者持有稳定终态通知与显式结果读取，本提供方只供应有界 typed outcome。

#### KV Cache 影响

无直接失效；具名消费方持有工具 schema 与提示词前缀变更，任务结果则追加在可复用请求前缀之后。

## 已知限制与暂缓事项

- **准入由 WorkKind 持有**——`@deepseek-ai/dsh-tool-agent-run-task-queue` 只准入 `agent.run@1`；其他能力使用各自的 WorkKind Consumer 与 handler。
- **没有持久 continuation**——任务完成会产生持久队列状态与 owner 通知，但不会自行唤醒或恢复 goal。
- **一个宿主持有一个队列根目录**——多宿主 session 与任务 ownership 不属于该提供方。
