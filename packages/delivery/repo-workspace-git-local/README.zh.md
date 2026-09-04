---
description: "为 Personal Delivery 的修改与验证提供本地 Git identity 检查、有界 blob 读取和 Attempt-owned worktree lease。"
kind: "package-reference"
---

# @changanhua/dsh-repo-workspace-git-local

[English](README.md) | 中文

## 概述

`dsh-repo-workspace-git-local` 让可信宿主验证已配置的本地 Git repository、从 Contract base rule 捕获完整 commit、读取精确的有界 blob、比较不可变 revision，并为每个 Queue Attempt 提供隔离的修改或验证 worktree。修改 lease 会在执行器完全停稳后创建一个受治理的检查点；每个 lease 要么删除 checkout，要么保留它以供 operator 恢复。Git 命令都通过 `ctx.subprocess` 运行，可变 host path 绝不会成为持久 authority。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [继续探索](#further-exploration)
- [Model Experience](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

当 Personal Delivery 的 repository 与 worktree 位于同一个执行世界时，把此提供方挂载在一个 `ctx.subprocess` 提供方旁边。

### 何时选择

当单宿主 repository 的配置路径就是精确 Git toplevel 时，选择此提供方。`resolveBase()` 在不创建 checkout 的情况下捕获完整 commit；`readBlob()` 在调用方给出的完整字节上限内读取 Git object storage；修改与验证 worktree 只会在 Queue Attempt 拥有其 lease 后开始。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `repositories` | 必填 | 从稳定 `repositoryId` 到精确本地 Git checkout root 的封闭映射。 |
| `worktreeRoot` | 必填 | 包含哈希化 Attempt ownership 目录与隔离 checkout 的真实目录。 |
| `graceMs` | `5000` | 每个受治理 Git 子进程使用的 TERM-to-KILL 宽限期。 |
| `maxGitOutputBytes` | `4 MiB` | 每条 Git 诊断流的完整上限；配置不得超过 `64 MiB`。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#changanhuadsh-repo-workspace-git-local)是完整字段参考。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

提供方会先对照 Git 的物理 toplevel 检查每个配置路径，再铸造 revision proof。Blob 读取会解析 `commit:path`、验证 object type 与 size，然后收集原始 piped bytes。Attempt id 会变为 SHA-256 目录名；crash-durable ownership marker 在提供方重建后仍绑定 purpose、repository、base 与 target。POSIX 发布会同步 marker 与受影响目录，Windows 则使用 write-through namespace move，并向每次 Git 调用提供 `core.longpaths=true`。worktree 创建失败会报告经过空白归一化且最多 512 个字符的 Git 诊断。清理会在变更前重新证明 root、owner directory、checkout identity 与精确的普通 marker；它只删除精确的 Git registration，绝不会 prune 无关 worktree。`lstat` 遍历不会跟随 link-shaped descendant；每个 Git 进程都会在操作完成前达到整棵进程树退出。

</details>

-----

<a id="further-exploration"></a>
## 继续探索

- [Repository workspace Service Definition](../repo-workspace/README.zh.md) — 提供方无关的 proof 与 lease 约定。
- [Personal Delivery 子系统](../../../docs/subsystems/delivery.zh.md) — 包拓扑与 authority ownership。
- [Personal Delivery Protocol V1](../../../docs/specs/2026-08-29-delivery-protocol-v1.md) — 完整 commit、evidence 与恢复语义。

-----

<a id="model-experience"></a>
## Model Experience

### 无直接模型上下文

#### 模型看到什么

模型不会直接看到任何内容。`ctx.repoWorkspace` 只提供宿主侧 Git fact 与 operation-local worktree path；是否把任何派生内容送入模型由 runner 决定。

#### Token effect

直接 token 为零。

#### KV Cache effect

无；此包从不组装模型输入。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限本地执行世界** — remote workspace 与 multi-host lease 需要另一个提供方和生命周期决策。
- **保留的 worktree 需要 operator 操作** — 不确定的 Attempt 会保留 checkout；此提供方不会授权 retry 或虚构成功。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
