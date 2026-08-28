# @deepseek-ai/dsh-task-queue-executor-dsh

[English](README.md) | 中文

`executor: dsh` 的 Service Provider。它向 `ctx.taskQueue` 注册一个 `ExecutorAdapter`；spawn、超时、取消、重试、结算与持久 run log 仍完全由本地队列后端持有。

## 执行

适配器在自动初始化的 `task-worker` profile 下启动当前 DSH argv，然后把 [`worker.cordis.patch.yml`](worker.cordis.patch.yml) 作为最终命令行 overlay 应用。它创建 `workspaceDir` 并作为子进程 `cwd`，另行创建 `outputDir` 存放产物，同时把两个绝对任务路径写进 worker 提示词。任务没有 `workspaceDir` 时，为兼容旧记录而使用 `outputDir`。

该提供方只向子进程传入 `DSH_HOME`、`DSH_PERMISSION_MODE=workspace-write` 与遥测退出值。环境中的 secret 仍由 subprocess 服务清理；子进程从 `$DSH_HOME/.credentials.yaml` 解析受管模型凭据。成功 stdout 会成为有界的 `TaskResult.assistantText`，固定 summary 绝不回显 worker 输出，完整进程证据则保留在队列 run log 中。空 stdout 只产生 summary，不产生 `assistantText`；非零退出、超时、取消、prepare 失败与 spawn 失败遵循队列后端的普通失败策略，绝不会被规范化为成功。

## 限制 overlay

最终 overlay 禁用 shell 与进程 job、递归任务队列提交、goal、subagent 与 Ralph、工作流扇出、HMR，以及交互式权限预设表层。基础 sandbox 策略仍根据 worker `cwd` 解析 `workspace-write`，文件系统提供方也仍受沙箱约束。由于该 overlay 位于 profile 与 home patch 之后，worker 持久配置无法重新启用这些已禁用配置项。

## 配置

| key | 默认值 | 含义 |
|---|---|---|
| `launcher` | 必填 | 当前 DSH 启动器的非空 argv 前缀 |
| `dshHome` | 必填 | 转发给子进程的 harness home |
| `profile` | `task-worker` | 专用一次性 profile |
| `maxAssistantBytes` | `65536` | 作为语义文本持久化的最大 UTF-8 字节数 |
| `collectBytes` | `262144` | 每条输出流在 spill 前的内存收集上限 |
| `graceMs` | `5000` | 子进程终止升级前的宽限期 |

`maxAssistantBytes` 不得超过 `collectBytes`；字节上限必须是安全整数，UTF-8 截断绝不会持久化半个码点。非法配置会在插件加载时快速失败。

## 模型体验

通过 `@deepseek-ai/dsh-tool-task-queue` 间接呈现；该消费方持有提交 schema、coding-agent 指引、终态 summary 通知与状态投影，本提供方只供应有界语义结果。

#### KV Cache 影响

无直接失效；具名消费方持有工具 schema 与提示词前缀变更，任务结果则追加在可复用请求前缀之后。

## 已知限制与暂缓事项

- **不会自动派发**——Agent 或宿主操作员必须显式入队 `executor: dsh`；该提供方不会自主选择任务。
- **没有持久 continuation**——任务完成会产生持久队列状态与 owner 通知，但不会自行唤醒或恢复 goal。
- **一个宿主持有一个队列根目录**——多宿主 session 与任务 ownership 不属于该提供方。
