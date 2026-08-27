# Agent Note: Queue 固定操作白名单

Status: implemented

[English](2026-08-27-queue-operation-run.md) | 中文

## 问题

Queue v2 可以持久调度类型化工作，但宿主还需要一条暴露有限维护或构建操作的窄路径。旧 executor adapter 接受 prompt、脚本路径、任意 argv 或 executor 名称；复用它们会让调用方选择进程拓扑，并恢复 typed WorkKind 所移除的通用 executor selector。

持久进程 Attempt 对取消证据的要求也高于直接子进程退出。只有 subprocess capability 证明整棵进程树静止后，Queue 才能记录 `canceled`；无法证明这一事实的退出、超时、取消或崩溃不能成为安全重试。

## 决策

`@deepseek-ai/dsh-operation-run-task-queue` 是默认不挂载的 `operation.run@1` WorkKind Bridge，`@deepseek-ai/dsh-tool-operation-run-task-queue` 是其 Agent Consumer。Agent 只提交 `operationId`；宿主配置把该标识映射为固定 revision、argv、cwd、资源声明、重试策略、输出限额、终止宽限和超时。Admission 持久化这些 resolved facts 的防御性副本，因此配置重载不能改变已准入的 WorkItem。

Bridge 复用 `ctx.subprocess` 的净化环境进程启动、进程树终止、输出收集和静止检查。Queue 继续拥有持久 Work、Attempt、Result、Notification、重试、恢复和 owner delivery。成功 stdout 与失败 stderr 通过 `TextRetainer` 限界；结果不暴露 argv、cwd、环境变量、spill path 或完整失败输出。

Consumer 从 live Session 派生 Agent authority，只注册 `operation_run_enqueue` 和 `operation_run_enqueue_batch`。它们的 schema 只包含 title、operation identifier、idempotency key 和 Batch concurrency bound。通用 Queue tools 仍负责模型可见的状态、取消、重试、显式结果读取和 owner delivery。

两个 package 都不进入 base、web 或 standard 的 active row。base Queue 预留一个 `operation-run` 资源单位，CLI dependency graph 保证两个 package 可解析；部署需要显式挂载 Bridge 和 Consumer，并提供至少一个固定、无秘密的 operation definition。

## 安全与生命周期边界

配置会拒绝未知字段、非规范 operation id、credential-shaped argv flag、header、环境赋值、URL userinfo 和常见 credential literal。这项结构过滤用于补充有限宿主白名单的人工评审；它不是 credential store，也不允许把不透明秘密作为位置参数。

一个 operation lifecycle 只有一个 owner。取消与超时按 first-cause 规则锁存原因，并共享一个幂等 terminate-and-wait promise。只有 `waitForExit()` 证明整棵进程树退出时才返回 canceled；静止检查失败或拒绝时返回 unknown 和 operator Attention。持久化的取消请求会压过 terminal settlement 前到达的 success。非零退出与超时已经开始副作用，不能自动重试。

## 验证

Bridge 测试固定 closed configuration 与 admission schema、resolved-fact durability、限界输出、first-cause 取消和超时、cancel-versus-exit success、tree quiescence 与 Cordis disposal。Local Queue 测试固定原子 settlement 规则：已持久化的取消请求会压过随后到达的 handler success。

真实 Loader 纵切会调用已注册的 Agent Consumer，在持久化前拒绝越权或扩宽输入，运行固定 Node operation，重开 Queue root，在 Session flush 后交付稳定且只含 metadata 的 owner Notification，并通过 `task_queue_result` 读取类型化限界结果。Queue Workspace 浏览器测试取消真实父进程和后代进程，只在两者退出后观察 durable `canceled`，刷新与重载后保留该 outcome，并证明最终 Queue root lock 可再次取得。

## 曾考虑的替代方案

**复用旧 node、shell、Codex、Claude、OpenCode 或 ArkCLI adapter。** 这些 adapter 接受任意执行控制或 provider prompt，也没有类型化 admission、resolved-fact durability 和 WorkKind 专属结果契约。

**增加通用 shell 或 argv WorkKind。** 只从 tool schema 删除执行控制并不能在直接 admission 边界强制执行规则。有限宿主白名单让调用方无法表达任意进程构造。

**把 operation 注册和执行放入 Queue core。** Queue core 拥有持久调度，而不拥有 subprocess 或业务 operation 语义。WorkKind Bridge 保留 [Queue v2 ownership split](../architecture/2026-08-27-queue-v2-reuse-boundaries.zh.md)。

**直接把 Skill 脚本放入 Queue。** Skill 是模型指导，可能构造动态参数或调用多个 capability。每个 production operation 都需要稳定的宿主定义或 domain-specific WorkKind，而不是隐式脚本 executor。

## 后果

宿主可以暴露持久进程操作而不授予调用方进程构造权限，同时继续复用其他 WorkKind 的 Queue owner、重试、恢复、结果与通知契约。默认不挂载可以防止部署暴露空白或意外的 operation catalog。

白名单必须保持有限并经过评审。反复需要参数时要建立新契约或 domain-specific WorkKind；identifier 不能成为编码后的 argv。credential-shaped validation 会有意保守地拒绝形似秘密的无害参数，而任意不透明位置文本仍需要人工评审。

限界文本不能表达 byte-exact 或大型文件结果。此类 Consumer 需要单独的 Artifact capability 和 authority model，而不能暴露 spill path。无法证明后代退出的 subprocess Provider 会产生 operator Attention，而不是猜测取消成功或重试安全。
