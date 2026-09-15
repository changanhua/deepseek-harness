# Agent Note: Web 标准会话可以委派给 Codex

Status: implemented

[English](2026-09-07-web-standard-codex-delegation.md) | 中文

## 问题

Web 用户必须先复制或选择特殊 Agent Preset，普通对话才能把一项自包含任务委派给 Codex。这种设置让安全的产品集成变成配置工作，也使现有 Session 无法自然表达该意图。

## 决策

Web 组合把现有 `codex` 提供方配置为 `permissionMode: approve-for-me`，该模式映射到 Codex 自动审批评审及其 workspace-write sandbox。随附的 `standard` Agent Preset 公开现有 `subagent_codex` 工具。用户因此可以在普通标准会话中让 Codex 实现或审查一项有界任务；工具默认在前台等待，把 Codex 的最终回答返回同一父轮次，并让父 agent 无需切换 preset 即可继续。

子级使用父 Session 的工作区，该路径可以与运行 DSH Host 的 checkout 不同。面向模型的工具不能选择权限模式或提升自己的权限。现有[权限决策](2026-08-15-product-subagent-noninteractive-permissions.zh.md)负责原生映射，[一次性调度决策](2026-08-12-product-subagent-one-shot-background-tasks.zh.md)负责前台与可选 Job 行为。这个下游 Web 默认值是[生产排除决策](../simplification/2026-08-12-production-dsh-excludes-product-subagent-providers.zh.md)所述选择性公开方式的明确例外。

## 验证

组合测试读取 Web patch 与标准 preset，并在 Host 未选择 `approve-for-me` 或标准工具行仍被禁用时失败。使用 `standard` 与 `Workspace Write` 的真实浏览器会话调用了 `subagent_codex`；打包的 Codex app-server 在 Session 工作区写入准确标记并返回路径，父 Agent 随后读取该文件并完成同一轮次。监听器继续在预期源码 checkout 下使用 3080 端口。

## 考虑过的替代方案

**要求专用接续 preset。** 用户需要先选择模式才能表达普通委派意图，而且现有标准 Session 无法使用该集成。

**默认公开独立只读提供方和工具。** 只读仍是受支持的部署选项，但它无法实现普通工作区任务，还会增加一个面向模型的工具名称。

**在 Host plane 注册工具。** Web 通过 Agent Preset 隔离面向模型的工具。全局工具会绕过该归属，并把能力公开给无关 preset。

## 后果

标准 Web 对话无需填写地址、设置连接或管理 preset 即可使用 Codex。每次调用仍会启动新的 Codex 进程和模型轮次，因此标准 schema 有固定 token 成本，调用也包含产品启动与网络延迟。工作区写入保留 Codex 自动评审；更高权限仍是显式 Profile 决策。其他 Profile 与 preset 保留自己的公开选择。
