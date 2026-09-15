---
description: "显式组合本地项目记忆，支持模型提出候选与人工复核。"
kind: "package-bundle"
---

# @changanhua/dsh-personal-memory

[English](README.md) | 中文

## 概述

这个私有 Bundle 为已提供 Workspace、Storage Domain、Sessions、文件访问、Tools、Commands 和 System Prompt 的 Profile 增加来源检查后的项目记忆。它挂载本地 Provider、三个模型工具和人工 `/memory` 命令。

## 目录

- [组合](#composition)
- [验证](#verification)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

## 组合

<a id="composition"></a>

在测试或开发 Profile 的 `dsh.profile.bundles` 中，将这个 Bundle 显式加在 `dsh-base` 和 `dsh-web-app` 后面。Profile 的模块解析器必须能够找到该包。这个源码包尚未发布到公共注册表。构建仓库后，通过 `dsh --profile <name>` 启动组合后的 Profile。

| 配置项 | 所属包 | 用途 |
| --- | --- | --- |
| `project-memory-local` | [memory-local](../../memory/memory-local/README.zh.md) | Workspace 范围、来源检查、持久版本与决策 |
| `tool-project-memory` | [tool-memory](../../memory/tool-memory/README.zh.md) | `memory_search`、`memory_read` 和 `memory_propose` |
| `command-project-memory` | [command-memory](../../memory/command-memory/README.zh.md) | 人工列表、查看、接纳、拒绝和撤回 |

本地 Provider 的所有权锁位于 `DSH_HOME/storages/project-memory-ownership/`。组合后的 Storage Domain 后端保存 `project_memory` domain 数据。Bundle 不改变 base 或 Web 默认配置，不注册新页面，也不替换既有 Provider。省略它时，新增工具和命令均不存在。

## 验证

<a id="verification"></a>

[Loader 测试](tests/loader.e2e.ts) 在隔离测试目录中通过受支持的 ACP Profile 启动已构建 CLI，为该测试补充 Workspace，并在不调用模型的情况下运行真实 Agent 的工具和人工命令路径。它检查显式启用、持久接纳、正常关闭和锁释放。这些证据确认组合行为；真实模型召回和浏览器验收仍需独立验证。

[验收测试](tests/acceptance.e2e.ts) 使用实际 Web Host 组合与真实模型调用，检查新会话产物、正常重启、来源修订、项目隔离和撤回。独立的 [Web snapshot 驱动](../../../apps/web/tests/project-memory.snapshot.ts) 负责浏览器提出候选与人工复核的证据。[收益对照](tests/benefit.e2e.ts) 分别启用与禁用记忆，测量五个固定产物任务，再检查到期与冲突命题。它将已接纳记忆的复用与准备投入分开报告；五个样本不能证明普遍生产力或全生命周期成本收益。

构建后运行 `pnpm run test:e2e -- packages/bundle/personal-memory/tests/acceptance.e2e.ts`，将文件名换为 `benefit.e2e.ts` 即可运行对照。这些测试使用已授权的 `DEEPSEEK_API_KEY` 调用 DeepSeek V4 Flash，不回放且不重试。没有密钥时按仓库约定跳过，以支持无凭据 CI；跳过结果不能满足真实验收。无模型的[重启测试](tests/acceptance-scaffold.e2e.ts) 单独检查测试存储保留。测试证据写入 `.artifacts/project-memory/`。

## 模型体验

<a id="model-experience"></a>

### 组合后的记忆能力

#### 模型看到什么

[tool-memory Consumer](../../memory/tool-memory/README.zh.md#model-experience) 拥有 `memory_search`、`memory_read` 和 `memory_propose`、对应的固定指引和有界结果。这个 Bundle 不提供额外提示词。

#### Token 影响

启用后增加 Consumer 的 schema 与指引。结果 Token 取决于 Agent 请求的记忆。

#### KV Cache 影响

组合稳定时 schema 和指引保持稳定；经过来源检查的结果在请求后进入对话历史。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 一个本地 Host 独占一个记忆根目录。遗留所有权锁需要先核实其进程已退出，再删除那个精确锁文件。
- Workspace 身份保持独立，worktree 也相互分离。Bundle 不合并项目或同步外部知识库。
- 模型只能提出候选；确切人工命令才能接纳或撤回。接纳不绕过当前来源、复核期限或冲突检查。

### 开发备注

保持此包为静态 patch 载体。运行时状态和权限归属记忆插件与现有基础设施。
